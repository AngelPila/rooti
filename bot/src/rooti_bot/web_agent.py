"""Rooti inside the web app, on the bot's own address. Every website talks to this one API: the one this container
serves directly, and the Node one (server/) through the address in its data/bot.json. The browser keeps the
conversation and runs the tools on the page; this side holds the keys and sends the prompt and tools in hermes/rooti
(WEB.md, web-tools.json, glossary.json).

- GET  /api/rooti        whether Rooti can answer here (a model key) and hear voice (a Groq key)
- POST /api/rooti        one model round: the farmer's conversation and the page context in, Rooti's message out,
  streamed as NDJSON lines: {"delta": text} while it writes, then {"message": …} or {"error": …}
- POST /api/rooti/turn   how a finished question went (words, tools, seconds), for `rooti-bot web-turnos`
- POST /api/rooti/voice  a recorded voice note in, its text out
- GET  /api/rooti/say    a reply in (?text=&lang=), Rooti saying it out loud (mp3, the Edge voice it has on WhatsApp).
  It streams as Edge speaks, and every reply is synthesized once: the page asks for it as soon as the reply shows."""
import asyncio
import json
import logging
import os
import re
import threading
import time
from collections import OrderedDict

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from rooti_bot import calls, config, store
from rooti_bot.voice import VOICE, speakable
from rooti_bot.web import client_ip

log = logging.getLogger("rooti.web_agent")
PROMPTS = config.REPO / "bot" / "hermes" / "rooti"
# The URLs can point elsewhere so a test runs against a fake model
CHAT_URL = os.environ.get("ROOTI_CHAT_URL", "https://api.deepseek.com/chat/completions")
STT_URL = os.environ.get("ROOTI_STT_URL", "https://api.groq.com/openai/v1/audio/transcriptions")
LANGUAGE = {"es": "Spanish, always with «usted».", "en": "English. Keep the same warmth, without the coastal Spanish slang."}
# Place and crop names Whisper otherwise mishears ("Daule" came back as "dable")
VOCABULARY = "Daule, Babahoyo, Quevedo, Salitre, Vinces, Los Ríos, Guayas, cuadras, hectáreas, arroz, maíz, soya, maní, fréjol, riego, invierno, verano, El Niño, Rooti."
SPEAKERS = {"es": VOICE, "en": "en-US-AndrewNeural"}
# Per address every 10 minutes; a question takes one call per tool round. «say» counts only new syntheses.
LIMITS = {"chat": 80, "voice": 30, "say": 120, "turn": 40}
_hits: dict[str, list[float]] = {}
_lock = threading.Lock()


class Speech:
    """One Edge synthesis that any number of listeners stream: from its first chunk while it runs, or whole once done."""

    def __init__(self, text: str, voice: str):
        self.chunks: list[bytes] = []
        self.done = self.failed = False
        self._more = asyncio.Event()
        self.task = asyncio.create_task(self._run(text, voice))

    async def _run(self, text: str, voice: str) -> None:
        import edge_tts

        try:
            async for c in edge_tts.Communicate(text, voice).stream():
                if c["type"] == "audio":
                    self.chunks.append(c["data"])
                    self._wake()
        except Exception as exc:
            log.error("say: %s", exc)
            self.failed = True
        finally:
            self.done = True
            self._wake()

    def _wake(self) -> None:
        self._more.set()
        self._more = asyncio.Event()

    async def started(self) -> bool:
        while not self.chunks and not self.done:
            await self._more.wait()
        return bool(self.chunks)

    async def stream(self):
        i = 0
        while True:
            while i < len(self.chunks):
                yield self.chunks[i]
                i += 1
            if self.done:
                return
            await self._more.wait()


SPOKEN: OrderedDict[str, Speech] = OrderedDict()  # ~5 MB at 300 replies of ~15 s
SPOKEN_MAX = 300


def _speech(text: str, lang: str, ip: str) -> Speech | None:
    """The synthesis of `text`, started now or shared with whoever asked first; None when this address asked too much."""
    key = f"{lang}:{text}"
    if (s := SPOKEN.get(key)) and not s.failed:
        SPOKEN.move_to_end(key)
        return s
    if not _allowed("say", ip):
        return None
    SPOKEN[key] = s = Speech(text, SPEAKERS[lang])
    while len(SPOKEN) > SPOKEN_MAX:
        SPOKEN.popitem(last=False)
    return s


def _persona() -> str:
    soul = (PROMPTS / "SOUL.md").read_text(encoding="utf-8")
    parts = [soul.split(h, 1)[1].split("\n## ", 1)[0].strip() for h in ("## Quién eres", "## Tu personalidad") if h in soul]
    return "\n\n".join(parts)


def _tools() -> list:
    """web-tools.json with the crop ids and the page's marks as enums, from the same crops.json the page uses."""
    crops = sorted(json.loads((config.REPO / "app" / "data" / "crops.json").read_text(encoding="utf-8"))["crops"]) + ["mulch"]
    ideas = ["irrigation", "straw", "legume", "instead", "nino", "dry", "all"]
    marks = ["route", "years", "calendar", "cover", "plans", "unknowns", "nino", "sow",
             *(f"crop-{c}" for c in [*crops, "bare"]), *(f"idea-{i}" for i in ideas)]
    tools = json.loads((PROMPTS / "web-tools.json").read_text(encoding="utf-8"))
    for tool in tools:
        props = tool["function"]["parameters"]["properties"]
        for key in ("crops", "current"):
            if key in props:
                props[key]["items"]["enum"] = crops
        if "mark" in props:
            props["mark"]["enum"] = marks
    return tools


GLOSSARY = "\n".join(f"{e['name_en']}: {e['en']}" for e in json.loads((PROMPTS / "glossary.json").read_text(encoding="utf-8")))
TEMPLATE = re.sub(r"<!--.*?-->\s*", "", (PROMPTS / "WEB.md").read_text(encoding="utf-8"), count=1, flags=re.S)
TOOLS = _tools()
TOOL_NAMES = {t["function"]["name"] for t in TOOLS}
PERSONA = _persona()


def _system(lang: str, context: str, whatsapp: str) -> str:
    return (TEMPLATE.replace("{persona}", PERSONA).replace("{glossary}", GLOSSARY).replace("{language}", LANGUAGE[lang])
            .replace("{whatsapp}", whatsapp).replace("{context}", context))


def _farmer(token: str) -> dict | None:
    """The farmer a page opened from WhatsApp belongs to; None for the public website or a link that no longer holds."""
    if not token:
        return None
    try:
        return calls.redeem(token)
    except (ValueError, RuntimeError):
        return None


def _from_whatsapp(session: dict | None) -> str:
    """What Rooti knows of this farmer from the chat, which the page cannot see: read from the database, not the page."""
    if not session or not session.get("farmer"):
        return "The farmer opened the website directly; you know nothing about them beyond the page."
    f, lines = session["farmer"], ["This farmer also talks to Rooti on WhatsApp and opened this page from a button there."]
    if f.get("name"):
        lines.append(f"Their name: {f['name']}.")
    if (f.get("chosen") or {}).get("name"):
        lines.append(f"The plan they picked: «{f['chosen']['name']}»" + (f": {f['chosen']['route']}" if f["chosen"].get("route") else "") + ".")
    lines.append("They get heavy-rain and time-to-sow alerts on WhatsApp." if f.get("alerts_ok") else "They have not asked for alerts.")
    if f.get("notes"):
        lines.append(f"Notes from the chat: {f['notes'][:400]}")
    return " ".join(lines)


def _allowed(kind: str, ip: str) -> bool:
    now, key = time.time(), f"{kind}:{ip}"
    with _lock:
        recent = [t for t in _hits.get(key, []) if now - t < 600]
        _hits[key] = recent + ([now] if len(recent) < LIMITS[kind] else [])
        return len(recent) < LIMITS[kind]


def _clean(value, size: int) -> str:
    return value[:size] if isinstance(value, str) else ""


def _messages(items) -> list | None:
    if not isinstance(items, list):
        return None
    out, waiting = [], set()
    for m in items[-40:]:
        role = m.get("role") if isinstance(m, dict) else None
        # Every tool call is answered before anything else is said
        if role in ("user", "assistant") and waiting:
            return None
        if role == "user":
            out.append({"role": "user", "content": _clean(m.get("content"), 1500)})
        elif role == "assistant":
            tool_calls = [{"id": _clean(c.get("id"), 80), "type": "function",
                           "function": {"name": _clean((c.get("function") or {}).get("name"), 40),
                                        "arguments": _clean((c.get("function") or {}).get("arguments"), 2000)}}
                          for c in (m.get("tool_calls") or [])[:4] if isinstance(c, dict)]
            # Only Rooti's own tools: a page cannot make the model believe it called something else
            if any(c["function"]["name"] not in TOOL_NAMES for c in tool_calls):
                return None
            waiting = {c["id"] for c in tool_calls}
            msg = {"role": "assistant", "content": _clean(m.get("content"), 2000) or (None if tool_calls else "")}
            out.append({**msg, "tool_calls": tool_calls} if tool_calls else msg)
        elif role == "tool":
            call_id = _clean(m.get("tool_call_id"), 80)
            # A tool result answers a call made just before, once; the cut at 40 may drop its call, and so the result
            if call_id not in waiting:
                if out:
                    return None
                continue
            waiting.discard(call_id)
            out.append({"role": "tool", "tool_call_id": call_id, "content": _clean(m.get("content"), 3000)})
        else:
            return None
    # The cut at 40 can land inside a turn; the model only accepts a history that starts with the farmer
    first = next((i for i, m in enumerate(out) if m["role"] == "user"), None)
    return out[first:] if first is not None else None


async def _round(http: httpx.AsyncClient, payload: dict, choice: str):
    """One streamed model call: yields each piece of text as it comes, then the whole message."""
    text, tool_calls = [], {}
    async with http.stream("POST", CHAT_URL, json={**payload, "tool_choice": choice, "stream": True},
                           headers={"Authorization": f"Bearer {os.environ['DEEPSEEK_API_KEY']}"}) as r:
        if r.status_code != 200:
            log.error("model %s: %s", r.status_code, (await r.aread())[:300])
            raise HTTPException(502, "model")
        async for line in r.aiter_lines():
            if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                continue
            delta = ((json.loads(line[5:]).get("choices") or [{}])[0]).get("delta") or {}
            if delta.get("content"):
                text.append(delta["content"])
                yield {"delta": delta["content"]}
            # Tool calls arrive in pieces too: the first piece of each has its id and name, the rest its arguments
            for piece in delta.get("tool_calls") or []:
                call = tool_calls.setdefault(piece.get("index", 0), {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                call["id"] = piece.get("id") or call["id"]
                fn = piece.get("function") or {}
                call["function"]["name"] += fn.get("name") or ""
                call["function"]["arguments"] += fn.get("arguments") or ""
    message = {"role": "assistant", "content": "".join(text)}
    if tool_calls:
        message["tool_calls"] = [tool_calls[i] for i in sorted(tool_calls)]
    yield {"message": message}


def mount(api: FastAPI) -> None:
    @api.get("/api/rooti")
    async def status():
        return JSONResponse({"on": bool(os.environ.get("DEEPSEEK_API_KEY")), "voice": bool(os.environ.get("GROQ_API_KEY")), "say": True},
                            headers={"Cache-Control": "no-store"})

    @api.post("/api/rooti")
    async def chat(request: Request, x_rooti_token: str = Header("")):
        if not os.environ.get("DEEPSEEK_API_KEY"):
            raise HTTPException(503, "off")
        if not _allowed("chat", client_ip(request)):
            raise HTTPException(429, "slow down")
        body = await request.json()
        msgs = _messages(body.get("messages"))
        if not msgs:
            raise HTTPException(400, "messages")
        lang = "en" if body.get("lang") == "en" else "es"
        system = _system(lang, _clean(body.get("context"), 8000), _from_whatsapp(_farmer(x_rooti_token)))
        payload = {"model": config.model()[1], "temperature": 0.4, "max_tokens": 400, "tools": TOOLS,
                   "messages": [{"role": "system", "content": system}, *msgs]}

        # The last round of a turn must answer in words, so a model that keeps calling tools still says something.
        # DeepSeek now and then answers with neither words nor tools: ask again, then insist on words.
        async def lines():
            started = time.monotonic()
            try:
                async with httpx.AsyncClient(timeout=40) as http:
                    for choice in ["none"] if body.get("final") else ["auto", "auto", "none"]:
                        async for event in _round(http, payload, choice):
                            if "delta" in event:
                                yield json.dumps(event, ensure_ascii=False) + "\n"
                                continue
                            m = event["message"]
                            if m["content"].strip() or m.get("tool_calls"):
                                log.info("round %.1fs %s", time.monotonic() - started,
                                         [c["function"]["name"] for c in m.get("tool_calls", [])] or "words")
                                yield json.dumps({"message": m}, ensure_ascii=False) + "\n"
                                return
                        log.warning("empty answer (%s)", choice)
                yield json.dumps({"message": {"role": "assistant", "content": ""}}) + "\n"
            except (HTTPException, httpx.HTTPError, ValueError) as exc:
                log.error("chat: %s", exc)
                yield json.dumps({"error": "model"}) + "\n"

        return StreamingResponse(lines(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store"})

    @api.post("/api/rooti/turn")
    async def turn(request: Request, x_rooti_token: str = Header("")):
        if not _allowed("turn", client_ip(request)):
            raise HTTPException(429, "slow down")
        body = await request.json()
        tools = [{"name": _clean(t.get("name"), 40), "error": _clean(t.get("error"), 200) or None}
                 for t in (body.get("tools") or [])[:20] if isinstance(t, dict)]
        session = _farmer(x_rooti_token)
        try:
            seconds = min(max(float(body.get("seconds") or 0), 0), 600)
        except (TypeError, ValueError):
            seconds = 0
        store.add_web_turn(session["phone"] if session else None, "en" if body.get("lang") == "en" else "es",
                           _clean(body.get("screen"), 40) or "landing", _clean(body.get("question"), 1500),
                           _clean(body.get("answer"), 2000), tools, seconds, bool(body.get("voice")), bool(body.get("failed")))
        return {"saved": True}

    @api.post("/api/rooti/voice")
    async def voice(request: Request, lang: str = "es"):
        if not os.environ.get("GROQ_API_KEY"):
            raise HTTPException(503, "off")
        if not _allowed("voice", client_ip(request)):
            raise HTTPException(429, "slow down")
        audio = await request.body()
        if not audio or len(audio) > 4 * 1024 * 1024:
            raise HTTPException(413, "audio")
        kind = request.headers.get("content-type", "audio/webm")
        ext = "m4a" if re.search(r"mp4|m4a|aac", kind) else "ogg" if "ogg" in kind else "wav" if "wav" in kind else "webm"
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.post(STT_URL, headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"},
                                files={"file": (f"voice.{ext}", audio, kind)},
                                data={"model": "whisper-large-v3-turbo", "language": "en" if lang == "en" else "es", "response_format": "json",
                                      **({} if lang == "en" else {"prompt": VOCABULARY})})
        if r.status_code != 200:
            log.error("voice %s: %s", r.status_code, r.text[:300])
            raise HTTPException(502, "voice")
        return {"text": str(r.json().get("text", "")).strip()[:1500]}

    async def say(request: Request, text: str, lang: str):
        text = speakable(text)[:1500]
        if not text:
            raise HTTPException(400, "text")
        speech = _speech(text, "en" if lang == "en" else "es", client_ip(request))
        if speech is None:
            raise HTTPException(429, "slow down")
        # Fail before the headers when Edge gives nothing, so the page falls back to the browser's voice
        if not await speech.started():
            raise HTTPException(502, "say")
        return StreamingResponse(speech.stream(), media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=86400"})

    @api.get("/api/rooti/say")
    async def say_get(request: Request, text: str = "", lang: str = "es"):
        return await say(request, text, lang)

    @api.post("/api/rooti/say")
    async def say_post(request: Request):
        body = await request.json()
        return await say(request, str(body.get("text") or ""), str(body.get("lang") or "es"))
