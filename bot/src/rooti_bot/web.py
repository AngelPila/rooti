"""Rooti's website and the pages farmers open from WhatsApp: the web app itself (app/, served at the root) signed in
as one farmer, plus the small API it talks to. Mounted on the call server (call_server.app), so the website, the API
and the call page (/llamada) share one address.

- GET  /data/bot.json       where this API is and Rooti's number, for the app's WhatsApp buttons
- GET  /api/lot             the farmer's lot as the app keeps it, the plan they picked, the alert the link answers
- PUT  /api/lot             the lot drawn or corrected on the page: saved, its plan computed, Rooti confirms in the chat
- POST /api/choice          the plan picked on the page: saved, Rooti confirms in the chat
- POST /api/handoff         (any website) a lot made without WhatsApp, for a code the farmer sends to Rooti

The page sends its signed link (calls.token) in X-Rooti-Token."""
import logging
import threading
import time

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from rooti_bot import bridge, calls, config, engine, lots, store

log = logging.getLogger("rooti.web")
HANDOFFS_PER_HOUR = 10
_hits: dict[str, list[float]] = {}
_lock = threading.Lock()
_nasa_lock = threading.Lock()
_nasa_cache = (0.0, None)


def _session(token: str) -> dict:
    try:
        return calls.redeem(token)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(403, f"Enlace no válido: {exc}") from None


def _later(work, *args) -> None:
    """Chat messages go out after the page got its answer: the bridge or the planner never make the page wait."""
    def run():
        try:
            work(*args)
        except Exception as exc:  # the farmer still has the page; the chat message is a courtesy
            log.error("%s: %s", work.__name__, exc)
    threading.Thread(target=run, daemon=True).start()


def _confirm_lot(phone: str, fields: dict) -> None:
    lot = lots.describe(fields)
    try:
        engine.plan_for(store.get(phone))
    except engine.EngineError as exc:
        log.warning("plan de %s: %s", phone[:6], exc)
        bridge.send_text(phone, f"Listo, recibí su lote: {lot}. Su plan está en la página; si quiere, pregúnteme aquí.")
        return
    bridge.send_button(phone, f"Listo, recibí su lote: {lot}. Ya revisé su plan con los datos de la NASA: aquí lo "
                              "tiene para volver a verlo cuando quiera.", "Ver mi plan", calls.page(phone, "plan"))


def _confirm_choice(phone: str, chosen: dict, ask_alerts: bool) -> None:
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

    @api.get("/api/nasa/imerg")
    def nasa_catalog():
        global _nasa_cache
        with _nasa_lock:
            expires, catalog = _nasa_cache
            if expires <= time.monotonic():
                try:
                    catalog = engine.run({"cmd": "imerg_catalog"}, timeout=14)
                except engine.EngineError:
                    catalog = None
                _nasa_cache = (time.monotonic() + (3600 if catalog else 60), catalog)
        if not catalog:
            raise HTTPException(503, "Earthdata MCP unavailable")
        return JSONResponse(catalog, headers={"Cache-Control": "public, max-age=3600"})

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
                "whatsapp": config.whatsapp_number(), "call": calls.link(session["phone"], alert and alert["id"])}

    @api.put("/api/lot")
    async def put_lot(request: Request, x_rooti_token: str = Header("")):
        session = _session(x_rooti_token)
        try:
            fields = lots.from_app(await request.json())
        except (lots.LotError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from None
        store.update(session["phone"], **fields)
        if fields.get("crops"):
            _later(_confirm_lot, session["phone"], fields)
        return {"saved": sorted(fields)}

    @api.post("/api/choice")
    async def choose(request: Request, x_rooti_token: str = Header("")):
        session = _session(x_rooti_token)
        body = await request.json()
        chosen = {"key": str(body.get("key", ""))[:20], "name": str(body.get("name", ""))[:60],
                  "route": str(body.get("route", ""))[:400], "at": time.time()}
        if not chosen["key"] or not chosen["name"]:
            raise HTTPException(400, "falta el plan")
        farmer = store.update(session["phone"], chosen=chosen)
        _later(_confirm_choice, session["phone"], chosen, not farmer["alerts_ok"])
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
