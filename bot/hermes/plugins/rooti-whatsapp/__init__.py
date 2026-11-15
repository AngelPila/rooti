"""{{MARKER}}. rooti-bot hermes-perfil rewrites this file on every boot.

Rooti on WhatsApp, adapted from Vinci's vinci-whatsapp and vinci-botones plugins. No model involved.

- Only private chats: a group message never reaches Rooti (a group is not one farmer's lot).
- A forwarded audio or an .m4a is transcribed like a voice note (Hermes hears only voice notes on its own).
- A question split across bubbles reaches the model as one (Vinci's endpointing): 3 s after a bubble that ends
  mid-clause, 0.3 s after «?» or «.», 1 s otherwise, never more than 20 s from the first one.
- Only Rooti talks to a farmer, never Hermes: a message starting with «/» is plain chat, not a command; Hermes'
  first-contact note (which has the model mention /help) is off; and a Hermes notice on its way out (an error, a
  warning, any of its own strings) is dropped, spoken by no voice note, and replaced by a short apology when the
  farmer would otherwise get no answer at all.
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
# Text only Hermes writes: its name, its commands, provider errors, code blocks. Rooti speaks plain Spanish.
LEAK_RE = re.compile(r"hermes|(?:^|\s)/[a-z]{2,}\b|api key|provider said|http \d{3}|settings →|openrouter|```",
                     re.IGNORECASE)
APOLOGY = "Disculpe, ahorita no le pude responder. ¿Me escribe de nuevo en un ratito?"
TIMES = "{{DATA}}/tiempos.jsonl"
_HEARD = {}
_TURNS = {}  # chat → the farmer's last message: when it arrived and whether it was a voice note


def register(ctx):
    _no_first_contact_note()
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
    _no_commands(adapter)
    _quiet(adapter)
    _time_voice(adapter)


def _no_first_contact_note():
    """Hermes asks the model to introduce itself and mention /help on the install's first message ever."""
    try:
        import agent.onboarding as onboarding
        onboarding.first_contact_turn_note = lambda *_a, **_k: None
    except Exception as exc:
        logger.warning("no pude apagar la nota de primer contacto: %s", exc)


def _no_commands(adapter):
    """A farmer's «/ayuda» is chat for the model, never a Hermes command or an answer to a Hermes prompt."""
    if getattr(adapter, "_rooti_plain", False):
        return
    build = adapter._build_message_event

    async def plain_event(*args, **kwargs):
        event = await build(*args, **kwargs)
        if event is not None:
            event.allow_gateway_control = False
        return event

    adapter._build_message_event = plain_event
    adapter._rooti_plain = True


_PHRASES = None


def _hermes_phrases():
    """Long literal pieces of every string Hermes can show a user (its locales, its turn-failure copy)."""
    global _PHRASES
    if _PHRASES is not None:
        return _PHRASES
    texts = []
    try:
        import os
        from pathlib import Path
        import yaml
        import agent
        dirs = [os.environ.get("HERMES_BUNDLED_LOCALES"), Path(agent.__file__).resolve().parents[1] / "locales"]
        for folder in (Path(d) for d in dirs if d):
            for name in ("en.yaml", "es.yaml"):
                if (folder / name).exists():
                    texts += _strings(yaml.safe_load((folder / name).read_text(encoding="utf-8")))
            if texts:
                break
        import agent.turn_failure_copy as failure_copy
        texts += _strings([v for v in vars(failure_copy).values() if isinstance(v, (str, dict, list, tuple))])
    except Exception as exc:
        logger.warning("no pude leer los textos de Hermes: %s", exc)
    pieces = {piece.strip().lower() for text in texts for piece in re.split(r"\{[^}]*\}|\n", text)}
    _PHRASES = [p for p in pieces if len(p) >= 24]
    return _PHRASES


def _strings(node):
    if isinstance(node, str):
        return [node]
    if isinstance(node, dict):
        node = list(node.values())
    if isinstance(node, (list, tuple)):
        return [s for item in node for s in _strings(item)]
    return []


def _from_hermes(text):
    if not isinstance(text, str) or not text.strip():
        return False
    if HERMES_NOTICE_RE.match(text) or LEAK_RE.search(text):
        return True
    lower = text.lower()
    return any(piece in lower for piece in _hermes_phrases())


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
    play, prepare = adapter.play_tts, adapter.prepare_tts_text

    async def timed_play(chat_id, audio_path, **kwargs):
        result = await play(chat_id, audio_path, **kwargs)
        _note_reply(chat_id, "voz")
        return result

    def quiet_prepare(text):  # an empty script means no voice note
        return "" if _from_hermes(text) else prepare(text)

    adapter.play_tts = timed_play
    adapter.prepare_tts_text = quiet_prepare
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
        if _from_hermes(content):
            from gateway.platforms.base import SendResult
            turn = _TURNS.get(str(chat_id))
            if HERMES_NOTICE_RE.match(content) or not turn or "texto" in turn or turn.get("disculpa"):
                logger.info("aviso de Hermes no enviado: %r", content[:120])
                return SendResult(success=True)
            logger.warning("el turno falló, en su lugar va una disculpa: %r", content[:200])
            turn["disculpa"] = True
            return await send(chat_id, APOLOGY, reply_to=reply_to, metadata=metadata, **kwargs)
        result = await send(chat_id, content, reply_to=reply_to, metadata=metadata, **kwargs)
        _note_reply(chat_id, "texto")
        return result

    adapter.send = quiet_send
    adapter._rooti_quiet = True
