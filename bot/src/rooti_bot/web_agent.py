"""Rooti inside the web app, on the bot's own address: the same API as server/rooti.mjs, for the website this
container serves. The browser keeps the conversation and runs the tools on the page; this side holds the keys and
sends the prompt and tools in hermes/rooti (WEB.md, web-tools.json), shared with the Node server.

- GET  /api/rooti        whether Rooti can answer here (a model key) and hear voice (a Groq key)
- POST /api/rooti        one model call: the farmer's conversation and the page context in, Rooti's message out
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
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from rooti_bot import config
from rooti_bot.voice import VOICE, speakable

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
LIMITS = {"chat": 80, "voice": 30, "say": 120}
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


TEMPLATE = re.sub(r"<!--.*?-->\s*", "", (PROMPTS / "WEB.md").read_text(encoding="utf-8"), count=1, flags=re.S)
TOOLS = json.loads((PROMPTS / "web-tools.json").read_text(encoding="utf-8"))
PERSONA = _persona()


def _system(lang: str, context: str) -> str:
    return TEMPLATE.replace("{persona}", PERSONA).replace("{language}", LANGUAGE[lang]).replace("{context}", context)


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
    out = []
    for m in items[-40:]:
        role = m.get("role") if isinstance(m, dict) else None
        if role == "user":
            out.append({"role": "user", "content": _clean(m.get("content"), 1500)})
        elif role == "assistant":
            calls = [{"id": _clean(c.get("id"), 80), "type": "function",
                      "function": {"name": _clean((c.get("function") or {}).get("name"), 40),
                                   "arguments": _clean((c.get("function") or {}).get("arguments"), 2000)}}
                     for c in (m.get("tool_calls") or [])[:4] if isinstance(c, dict)]
            msg = {"role": "assistant", "content": _clean(m.get("content"), 2000) or (None if calls else "")}
            out.append({**msg, "tool_calls": calls} if calls else msg)
        elif role == "tool":
            out.append({"role": "tool", "tool_call_id": _clean(m.get("tool_call_id"), 80), "content": _clean(m.get("content"), 3000)})
        else:
            return None
    # The cut at 40 can land inside a turn; the model only accepts a history that starts with the farmer
    first = next((i for i, m in enumerate(out) if m["role"] == "user"), None)
    return out[first:] if first is not None else None


def _ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()


def mount(api: FastAPI) -> None:
    @api.get("/api/rooti")
    async def status():
        return JSONResponse({"on": bool(os.environ.get("DEEPSEEK_API_KEY")), "voice": bool(os.environ.get("GROQ_API_KEY")), "say": True},
                            headers={"Cache-Control": "no-store"})

    @api.post("/api/rooti")
    async def chat(request: Request):
        if not os.environ.get("DEEPSEEK_API_KEY"):
            raise HTTPException(503, "off")
        if not _allowed("chat", _ip(request)):
            raise HTTPException(429, "slow down")
        body = await request.json()
        msgs = _messages(body.get("messages"))
        if not msgs:
            raise HTTPException(400, "messages")
        lang = "en" if body.get("lang") == "en" else "es"
        payload = {"model": config.model()[1], "temperature": 0.4, "max_tokens": 400, "tools": TOOLS,
                   "messages": [{"role": "system", "content": _system(lang, _clean(body.get("context"), 8000))}, *msgs]}
        # The last round of a turn must answer in words, so a model that keeps calling tools still says something.
        # DeepSeek now and then answers with neither words nor tools: ask again, then insist on words.
        async with httpx.AsyncClient(timeout=40) as http:
            for choice in ["none"] if body.get("final") else ["auto", "auto", "none"]:
                r = await http.post(CHAT_URL, json={**payload, "tool_choice": choice},
                                    headers={"Authorization": f"Bearer {os.environ['DEEPSEEK_API_KEY']}"})
                if r.status_code != 200:
                    log.error("model %s: %s", r.status_code, r.text[:300])
                    raise HTTPException(502, "model")
                c = (r.json().get("choices") or [{}])[0]
                m = c.get("message") or {}
                if (m.get("content") or "").strip() or m.get("tool_calls"):
                    out = {"role": "assistant", "content": m.get("content") or ""}
                    if m.get("tool_calls"):
                        out["tool_calls"] = m["tool_calls"]
                    return {"message": out}
                log.warning("empty answer (%s, %s)", c.get("finish_reason"), choice)
        return {"message": {"role": "assistant", "content": ""}}

    @api.post("/api/rooti/voice")
    async def voice(request: Request, lang: str = "es"):
        if not os.environ.get("GROQ_API_KEY"):
            raise HTTPException(503, "off")
        if not _allowed("voice", _ip(request)):
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
        speech = _speech(text, "en" if lang == "en" else "es", _ip(request))
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
