"""{{MARKER}}. rooti-bot hermes-perfil rewrites this file on every boot.

Rooti on WhatsApp, adapted from Vinci's vinci-whatsapp and vinci-botones plugins. No model involved.

- Only private chats: a group message never reaches Rooti (a group is not one farmer's lot).
- A forwarded audio or an .m4a is transcribed like a voice note (Hermes hears only voice notes on its own).
- A question split across bubbles reaches the model as one (Vinci's endpointing): 3 s after a bubble that ends
  mid-clause, 0.3 s after «?» or «.», 1 s otherwise, never more than 20 s from the first one.
- Hermes' notices for an operator (self-improvement review, busy ack) never reach a farmer.
- Every Rooti tool call carries the chat it comes from (`_canal`), so the tools read that farmer's lot and two
  farmers at once never mix; the model never sees or sets it.
- Every turn starts with the farmer's lot (`rooti-bot contexto`), so the first answer needs no tool round trip.
- How long each answer took, from the farmer's message to Rooti's first text and first voice note, goes to
  <ROOTI_DATA>/tiempos.jsonl (`rooti-bot tiempos` sums it up). The clock starts once the bubbles are joined, so
  the farmer also waits the 0.3–3 s of endpointing on top. The chat is kept only as a hash.
Voice replies to voice notes are Hermes' own (voice.auto_tts), with Edge TTS's Ecuadorian voice.
"""
import asyncio
import hashlib
import json
import logging
import re
import subprocess
import time

logger = logging.getLogger("rooti-whatsapp")

BOT = "{{BOT}}"
ENV = {"ROOTI_DATA": "{{DATA}}", "HOME": "{{HOME}}", "PATH": "/usr/local/bin:/usr/bin:/bin"}
MCP_TOOLS = ("mcp__rooti__", "mcp_rooti_")
CHANNEL_ARG = "_canal"
AUDIO = ("ptt", "audio")
HERMES_NOTICE_RE = re.compile(
    r"\s*(?:💾\s|💡\s*First-time tip|[↪⏩⏳⚡]️?\s*(?:Redirected|Steered|Queued for|Interrupting|"
    r"Ejecución actual redirigida|Redirigido a la ejecución|En cola para el siguiente|Interrumpiendo la tarea))")
TIMES = "{{DATA}}/tiempos.jsonl"
_HEARD = {}
_TURNS = {}  # chat → the farmer's last message: when it arrived and whether it was a voice note


def register(ctx):
    ctx.register_hook("pre_gateway_dispatch", _dispatch)
    ctx.register_hook("pre_tool_call", _before_tool)
    ctx.register_hook("pre_llm_call", _turn_context)
    ctx.register_platform_handler("whatsapp", _wire)


def _skip(reason):
    return {"action": "skip", "reason": f"rooti-whatsapp: {reason}"}


async def _dispatch(event=None, **_):
    source = getattr(event, "source", None)
    if source is None or getattr(getattr(source, "platform", None), "value", None) != "whatsapp":
        return None
    if getattr(source, "chat_type", "dm") == "group":
        return _skip("grupo")
    raw = getattr(event, "raw_message", None) or {}
    _TURNS[str(getattr(source, "chat_id", ""))] = {"at": time.time(),
                                                   "kind": "voz" if raw.get("mediaType") == "ptt" else "texto"}
    if raw.get("mediaType") == "sticker":
        return _skip("sticker")
    urls = getattr(event, "media_urls", None) or []
    if raw.get("mediaType") == "audio" and urls:  # a forwarded recording: Hermes hears only voice notes (ptt)
        heard = await _hear(str(urls[0]))
        if heard:
            caption = str(getattr(event, "text", "") or "").strip()
            caption = "" if caption == "[audio received]" else caption
            return {"action": "rewrite", "text": f'"{heard}"' + (f"\n\n{caption}" if caption else "")}
    return None


async def _hear(path):
    if path not in _HEARD:
        from tools.transcription_tools import transcribe_audio
        result = await asyncio.to_thread(transcribe_audio, path, None, "gateway")
        heard = str(result.get("transcript") or "").strip() if result.get("success") else ""
        _HEARD.clear()
        _HEARD[path] = heard or None
    return _HEARD[path]


def _session_env(key):
    from gateway.session_context import get_session_env
    return get_session_env(key, "")


def _before_tool(tool_name="", args=None, **_):
    if not tool_name.startswith(MCP_TOOLS):
        return None
    try:  # always set, so a value the model made up never gets through
        note = {"canal": _session_env("HERMES_SESSION_PLATFORM"), "tipo": _session_env("HERMES_SESSION_CHAT_TYPE"),
                "chat": _session_env("HERMES_SESSION_CHAT_ID")}
    except Exception as exc:
        logger.warning("no sé de qué chat viene %s: %s", tool_name, exc)
        note = {}
    return {"action": "modify", "args": {CHANNEL_ARG: note}}


def _turn_context(**_):
    try:
        if _session_env("HERMES_SESSION_PLATFORM") != "whatsapp":
            return None
        proc = subprocess.run([BOT, "contexto", "--chat", _session_env("HERMES_SESSION_CHAT_ID")],
                              capture_output=True, text=True, timeout=10, env=ENV)
        text = json.loads(proc.stdout or "{}").get("contexto")
        return {"context": text} if text else None
    except Exception as exc:  # the turn goes on without it
        logger.warning("contexto del turno: %s", exc)
        return None


def _wire(_native, adapter):
    _wire_burst(adapter)
    _quiet(adapter)
    _time_voice(adapter)


def _note_reply(chat_id, what):
    """The first text and the first voice note after the farmer's message, in seconds."""
    turn = _TURNS.get(str(chat_id))
    if not turn or what in turn:
        return
    turn[what] = round(time.time() - turn["at"], 2)
    try:
        with open(TIMES, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"chat": hashlib.sha256(str(chat_id).encode()).hexdigest()[:12], "en": turn["kind"],
                                 "a": round(turn["at"]), "respuesta": what, "segundos": turn[what]}) + "\n")
    except OSError as exc:
        logger.warning("tiempos: %s", exc)


def _time_voice(adapter):
    if getattr(adapter, "_rooti_timed", False):
        return
    play = adapter.play_tts

    async def timed_play(chat_id, audio_path, **kwargs):
        result = await play(chat_id, audio_path, **kwargs)
        _note_reply(chat_id, "voz")
        return result

    adapter.play_tts = timed_play
    adapter._rooti_timed = True


# Vinci's endpointing (vinci-whatsapp), itself ported from Jelou's Jey: no model call, a wrong guess costs one wait.
OPEN_WORDS = frozenset(
    "y e o u ni pero aunque porque pues sino a al de del en con sin para por sobre entre hacia hasta desde contra "
    "segun tras el la los las un una unos unas mi mis tu tus su sus este ese esos esas aquel aquella me te le les "
    "muy tan tambien".split())
DANGLING_WORDS = frozenset(
    "quiero quisiera necesito deseo dame hazme ayudame dime muestrame puedes podes podrias puede puedo debo debes "
    "tengo quiere hay estoy es son esta sea seria fuera que q como cual cuales cuando donde quien cuanto cuanta "
    "cuantos cuantas se lo".split())
MODALS = frozenset("quiero quisiera necesito deseo puedo puedes podes podrias debo debes gustaria".split())
QUESTION_OPENERS = frozenset("que q como cual cuales cuando donde quien quienes cuanto cuanta cuantos cuantas por".split())
BURST_QUIET, BURST_OPEN, BURST_DONE, BURST_WALL = 1.0, 3.0, 0.3, 20.0


def _plain(text):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")


def _looks_open(text):
    text = text.strip()
    if re.search(r"(?:[,:;]|\.\.\.|…)$", text):
        return True
    if not text or re.search(r"[.!?]$", text):
        return False
    words = re.sub(r"[^\w\s]+", " ", _plain(text)).split()
    if not words or words == ["para"]:
        return False
    if words[-1] in OPEN_WORDS:
        return True
    if words[0] in QUESTION_OPENERS:
        return False
    return words[-1] in DANGLING_WORDS or (
        2 <= len(words) <= 4 and words[-2] in MODALS and re.search(r"(?:ar|er|ir)$", words[-1]) is not None)


def _burst_wait(text, first_at, now):
    stripped = (text or "").strip()
    if _looks_open(stripped):
        wait = BURST_OPEN
    elif re.search(r"[.!?]$", stripped) and not re.search(r"(?:\.\.\.|…)$", stripped):
        wait = BURST_DONE
    else:
        wait = BURST_QUIET
    return max(0.0, min(wait, first_at + BURST_WALL - now))


def _wire_burst(adapter):
    if getattr(adapter, "_rooti_burst", False):
        return
    default = adapter._text_batch_delay_for

    def delay_for(pending):
        if pending is None:
            return default(pending)
        now = time.monotonic()
        first_at = getattr(pending, "_rooti_first_at", None) or now
        pending._rooti_first_at = first_at
        wait = _burst_wait(pending.text, first_at, now)
        if getattr(pending, "_last_chunk_len", 0) >= adapter._SPLIT_THRESHOLD:
            wait = max(wait, default(pending))
        return wait

    adapter._text_batch_delay_for = delay_for
    adapter._rooti_burst = True


def _quiet(adapter):
    if getattr(adapter, "_rooti_quiet", False):
        return
    send = adapter.send

    async def quiet_send(chat_id, content, reply_to=None, metadata=None, **kwargs):
        if isinstance(content, str) and HERMES_NOTICE_RE.match(content):
            from gateway.platforms.base import SendResult
            return SendResult(success=True)
        result = await send(chat_id, content, reply_to=reply_to, metadata=metadata, **kwargs)
        _note_reply(chat_id, "texto")
        return result

    adapter.send = quiet_send
    adapter._rooti_quiet = True
