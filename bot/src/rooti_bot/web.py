"""Rooti's website and the pages farmers open from WhatsApp: the web app itself (app/, served at the root) signed in
as one farmer, plus the small API it talks to. Mounted on Rooti's web server (server.app), so the website and the
API share one address.

- GET  /data/bot.json       where this API is and Rooti's number, for the app's WhatsApp buttons
- GET  /api/lot             the farmer's lot as the app keeps it, the plan they picked, the alert the link answers
- PUT  /api/lot             the lot drawn or corrected on the page: saved, its plan computed, Rooti confirms in the chat
- POST /api/choice          the plan picked on the page: saved, Rooti confirms in the chat
- POST /api/handoff         (any website) a lot made without WhatsApp, for a code the farmer sends to Rooti

The page sends its signed link (calls.token) in X-Rooti-Token."""
import logging
import os
import threading
import time

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from rooti_bot import bridge, calls, config, engine, lots, store

log = logging.getLogger("rooti.web")
HANDOFFS_PER_HOUR = 10
# The page saves on every tweak (each answer, each «Listo», each undo); the chat hears once, after this much quiet.
CHAT_QUIET_S = float(os.environ.get("ROOTI_CHAT_QUIET_S", "45"))
LOT_KEYS = ("lat", "lon", "place", "crops", "current", "irrigation", "plot", "area", "unit", "waterlog")
_hits: dict[str, list[float]] = {}
_pending: dict[tuple[str, str], threading.Timer] = {}
_lock = threading.Lock()


def _session(token: str) -> dict:
    try:
        return calls.redeem(token)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(403, f"Enlace no válido: {exc}") from None


def _later(phone: str, work) -> None:
    """One chat message per burst of saves: a newer save of the same kind replaces the one still waiting, so the
    farmer reads only how the lot or the plan ended up. It never makes the page wait on the bridge or the planner."""
    key = (phone, work.__name__)

    def run():
        with _lock:
            if _pending.get(key) is not timer:
                return
            del _pending[key]
        try:
            work(phone)
        except Exception as exc:  # the farmer still has the page; the chat message is a courtesy
            log.error("%s: %s", work.__name__, exc)

    timer = threading.Timer(CHAT_QUIET_S, run)
    timer.daemon = True
    with _lock:
        if key in _pending:
            _pending[key].cancel()
        _pending[key] = timer
    timer.start()


def _confirm_lot(phone: str) -> None:
    lot = lots.describe(store.get(phone) or {})
    try:
        engine.plan_for(store.get(phone))
    except engine.EngineError as exc:
        log.warning("plan de %s: %s", phone[:6], exc)
        bridge.send_text(phone, f"Listo, recibí su lote: {lot}. Su plan está en la página; si quiere, pregúnteme aquí.")
        return
    bridge.send_button(phone, f"Listo, recibí su lote: {lot}. Ya revisé su plan con los datos de la NASA: aquí lo "
                              "tiene para volver a verlo cuando quiera.", "Ver mi plan", calls.page(phone, "plan"))


def _confirm_choice(phone: str) -> None:
    farmer = store.get(phone) or {}
    chosen, ask_alerts = farmer.get("chosen") or {}, not farmer.get("alerts_ok")
    if not chosen.get("name"):
        return
    text = f"Anotado: eligió «{chosen['name']}»."
    if chosen.get("route"):
        text += f" {chosen['route']}."
    text += " Cualquier duda, me escribe o me manda un audio."
    if ask_alerts:
        text += "\n\n¿Quiere que le avise cuando venga lluvia fuerte o sea buen momento para sembrar?"
    bridge.send_text(phone, text)


def _allowed(key: str) -> bool:
    now = time.time()
    with _lock:
        recent = [t for t in _hits.get(key, []) if now - t < 3600]
        if len(recent) >= HANDOFFS_PER_HOUR:
            _hits[key] = recent
            return False
        _hits[key] = recent + [now]
        return True


def mount(api: FastAPI) -> None:
    # Only the handoff is called from another site (the public website); the rest is the app on this same origin.
    api.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["POST"], allow_headers=["Content-Type"])

    @api.get("/data/bot.json")
    @api.get("/app/data/bot.json")
    async def bot_config():
        return JSONResponse({"url": "", "whatsapp": config.whatsapp_number()}, headers={"Cache-Control": "no-store"})

    @api.get("/api/lot")
    async def get_lot(request: Request, x_rooti_token: str = Header("")):
        session = _session(x_rooti_token)
        # Inside WhatsApp or in another browser: the user agent says it (WAiOS/… in WhatsApp's own webview on iPhone)
        print(f"[páginas] {session['phone'][:6]}… abrió una página: {request.headers.get('user-agent', '?')[:200]}",
              flush=True)
        farmer, alert = session["farmer"], session["alert"]
        if alert:  # the alert was seen: no reminder follows (alerts.run)
            store.mark_alert(alert["id"], "call_opened_at")
        return {"plan": lots.to_app(farmer), "chosen": (farmer or {}).get("chosen"),
                "alert": alert and {k: alert[k] for k in ("kind", "key", "text", "created_at")},
                "whatsapp": config.whatsapp_number()}

    @api.put("/api/lot")
    async def put_lot(request: Request, x_rooti_token: str = Header("")):
        session = _session(x_rooti_token)
        try:
            fields = lots.from_app(await request.json())
        except (lots.LotError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from None
        before = store.get(session["phone"]) or {}
        farmer = store.update(session["phone"], **fields)
        if fields.get("crops") and any(before.get(k) != farmer.get(k) for k in LOT_KEYS):
            _later(session["phone"], _confirm_lot)
        return {"saved": sorted(fields)}

    @api.post("/api/choice")
    async def choose(request: Request, x_rooti_token: str = Header("")):
        session = _session(x_rooti_token)
        body = await request.json()
        chosen = {"key": str(body.get("key", ""))[:20], "name": str(body.get("name", ""))[:60],
                  "route": str(body.get("route", ""))[:400], "at": time.time()}
        if not chosen["key"] or not chosen["name"]:
            raise HTTPException(400, "falta el plan")
        before = (store.get(session["phone"]) or {}).get("chosen") or {}
        store.update(session["phone"], chosen=chosen)
        if before.get("key") != chosen["key"]:
            _later(session["phone"], _confirm_choice)
        return {"saved": True}

    @api.post("/api/handoff")
    async def handoff(request: Request):
        ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0]
        if not _allowed(ip.strip()):
            raise HTTPException(429, "Demasiados intentos; pruebe en una hora.")
        body = await request.json()
        try:
            fields = lots.from_app(body)
        except (lots.LotError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from None
        number = config.whatsapp_number()
        return {"code": store.add_handoff(fields), "whatsapp": number}

    # Links sent before the website moved to the root still open
    api.mount("/app", StaticFiles(directory=config.REPO / "app", html=True), name="app-old")


def mount_site(api: FastAPI) -> None:
    api.mount("/", StaticFiles(directory=config.REPO / "app", html=True), name="app")
