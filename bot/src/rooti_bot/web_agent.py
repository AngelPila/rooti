"""Rooti inside the web app, on the bot's own address: the same API as server/rooti.mjs, for the website this
container serves. The browser keeps the conversation and runs the tools on the page; this side holds the keys and
sends the prompt and tools in hermes/rooti (WEB.md, web-tools.json), shared with the Node server.

- GET  /api/rooti        whether Rooti can answer here (a model key) and hear voice (a Groq key)
- POST /api/rooti        one model call: the farmer's conversation and the page context in, Rooti's message out
- POST /api/rooti/voice  a recorded voice note in, its text out"""
import json
import logging
import os
import re
import threading
import time

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from rooti_bot import config

log = logging.getLogger("rooti.web_agent")
PROMPTS = config.REPO / "bot" / "hermes" / "rooti"
# The URLs can point elsewhere so a test runs against a fake model
CHAT_URL = os.environ.get("ROOTI_CHAT_URL", "https://api.deepseek.com/chat/completions")
STT_URL = os.environ.get("ROOTI_STT_URL", "https://api.groq.com/openai/v1/audio/transcriptions")
LANGUAGE = {"es": "Spanish, always with «usted».", "en": "English. Keep the same warmth, without the coastal Spanish slang."}
LIMITS = {"chat": 80, "voice": 30}  # per address every 10 minutes; a question takes one call per tool round
_hits: dict[str, list[float]] = {}
_lock = threading.Lock()


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
    return out if out and out[0]["role"] == "user" else None


def _ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()


def mount(api: FastAPI) -> None:
    @api.get("/api/rooti")
    async def status():
        return JSONResponse({"on": bool(os.environ.get("DEEPSEEK_API_KEY")), "voice": bool(os.environ.get("GROQ_API_KEY"))},
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
        payload = {"model": config.model()[1], "temperature": 0.4, "max_tokens": 500, "tools": TOOLS, "tool_choice": "auto",
                   "messages": [{"role": "system", "content": _system(lang, _clean(body.get("context"), 8000))}, *msgs]}
        async with httpx.AsyncClient(timeout=40) as http:
            r = await http.post(CHAT_URL, json=payload, headers={"Authorization": f"Bearer {os.environ['DEEPSEEK_API_KEY']}"})
        if r.status_code != 200:
            log.error("model %s: %s", r.status_code, r.text[:300])
            raise HTTPException(502, "model")
        m = (r.json().get("choices") or [{}])[0].get("message") or {}
        out = {"role": "assistant", "content": m.get("content") or ""}
        if m.get("tool_calls"):
            out["tool_calls"] = m["tool_calls"]
        return {"message": out}

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
                                data={"model": "whisper-large-v3-turbo", "language": "en" if lang == "en" else "es", "response_format": "json"})
        if r.status_code != 200:
            log.error("voice %s: %s", r.status_code, r.text[:300])
            raise HTTPException(502, "voice")
        return {"text": str(r.json().get("text", "")).strip()[:1500]}
