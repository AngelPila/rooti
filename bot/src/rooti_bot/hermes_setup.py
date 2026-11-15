"""`rooti-bot hermes-perfil`: Rooti's Hermes home, written on every boot (Vinci's hermes_setup, cut down).

Rooti is one bot on one number, so it lives in Hermes' default profile: no multiplexed profiles and no routes per
sender. Every farmer gets their own Hermes session (one per chat); what Rooti knows about each lot lives in
rooti.db, not in Hermes' memory, which is per profile and would carry one farmer's words into another's chat."""
import copy
import json
import os
import shutil
import sys
from pathlib import Path

import yaml

from rooti_bot import config

MARKER = "Generado por rooti-bot hermes-perfil"
PLUGIN = "rooti-whatsapp"
TOOLSETS = ["mcp-rooti"]  # no clarify: its numbered menus and reply prompts are Hermes, not Rooti
# Everything else Hermes has stays off: Rooti answers from its own tools, never from a terminal, files or the web.
BLOCKED = ["terminal", "file", "code_execution", "browser", "computer_use", "delegation", "cronjob", "kanban",
           "vision", "video", "image_gen", "video_gen", "todo", "connections", "homeassistant", "spotify",
           "x_search", "a2a", "web", "search", "memory", "session_search", "skills", "tts"]
VOICE = {"tts": {"provider": "edge", "edge": {"voice": "es-EC-LuisNeural"}},
         # A voice note gets a voice note back (Hermes' own auto-TTS for voice input); text gets text.
         "voice": {"auto_tts": True},
         # Groq's Whisper (free tier), not Hermes' default local one, which the image lacks.
         "stt": {"provider": "groq", "language": "es"}}
MODEL_KEYS = ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "GROQ_API_KEY")


def hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")


def _write_if_changed(path: Path, text: str) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def _merge(base: dict, extra: dict) -> dict:
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _merge(base[key], value)
        else:
            base[key] = value
    return base


def _env_file(path: Path, values: dict[str, str]) -> bool:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    kept = [ln for ln in lines if ln.split("=", 1)[0].strip() not in values]
    return _write_if_changed(path, "\n".join(kept + [f"{k}={v}" for k, v in values.items()]) + "\n")


def bridge_dir(home: Path) -> Path | None:
    for candidate in (home / "scripts" / "whatsapp-bridge", home / "hermes-agent" / "scripts" / "whatsapp-bridge",
                      Path("/opt/hermes/scripts/whatsapp-bridge")):
        if (candidate / "bridge.js").exists():
            return candidate
    return None


def _own_number(creds: Path) -> str:
    try:
        me = json.loads(creds.read_text(encoding="utf-8"))["me"]["id"]
    except (OSError, ValueError, KeyError, TypeError):
        return ""
    return me.split(":")[0].split("@")[0]


def managed_config(home: Path, bot: str) -> dict:
    provider, model = config.model()
    managed = {
        "model": {"provider": provider, "default": model},
        "timezone": "America/Guayaquil",
        "platform_toolsets": {"whatsapp": TOOLSETS, "cli": TOOLSETS, "cron": ["mcp-rooti"]},
        "agent": {"disabled_toolsets": BLOCKED},
        "tools": {"tool_search": {"enabled": "off"}},
        "skills": {"project_discovery": False},
        "mcp_servers": {"rooti": {"command": bot, "args": ["mcp"],
                                  "env": {"ROOTI_DATA": str(config.data_dir()), "ROOTI_BRIDGE": config.bridge_url(),
                                          "ROOTI_CALL_URL": config.call_url(),
                                          "ROOTI_CALL_SECRET": os.environ.get("ROOTI_CALL_SECRET", ""),
                                          "ROOTI_NODE": config.node_bin()},
                                  "timeout": 180, "tools": {"resources": False, "prompts": False}}},
        "gateway": {"message_timestamps": {"enabled": True}},
        # Hermes pings the home channel (the operator's number) with «♻️ Gateway en línea» on every boot, so each
        # redeploy texted that person; its other operator notices are already off (suppress_warning_notifications).
        "platforms": {"whatsapp": {"gateway_restart_notification": False}},
        # Hermes' WhatsApp default posts a line per tool call, and its warnings are English and for an operator.
        "display": {"suppress_warning_notifications": True, "busy_ack_enabled": False,
                    "platforms": {"whatsapp": {"tool_progress": "off", "busy_ack_detail": False}}},
        "onboarding": {"profile_build": "off"},
        "whatsapp": {"reply_prefix": "", "unauthorized_dm_behavior": "ignore"},
        "plugins": {"enabled": [PLUGIN]},
        **copy.deepcopy(VOICE),
    }
    test = os.environ.get("ROOTI_TEST_BRIDGE")  # E2E: a stand-in bridge already running on this port
    if test:
        managed["whatsapp"].update(bridge_port=int(test.rsplit(":", 1)[1]), bridge_script=os.environ["ROOTI_TEST_SCRIPT"])
    else:
        bridge = bridge_dir(home)
        if bridge is not None:
            for name in ("rooti-bridge.js", "url_button.js"):
                _write_if_changed(bridge / name, (config.TEMPLATES / "whatsapp" / name).read_text(encoding="utf-8"))
            managed["whatsapp"]["bridge_script"] = str(bridge / "rooti-bridge.js")
    return managed


def run() -> int:
    home = hermes_home()
    own = Path(sys.prefix) / "bin" / "rooti-bot"  # the venv's own, not the image's as-hermes wrapper
    bot = str(own) if own.exists() else shutil.which("rooti-bot") or str(own)
    config_file = home / "config.yaml"
    current = yaml.safe_load(config_file.read_text(encoding="utf-8")) if config_file.exists() else {}
    merged = _merge(copy.deepcopy(current if isinstance(current, dict) else {}), managed_config(home, bot))
    # The Hermes image seeds OpenRouter's base_url, which would send any other provider's calls there.
    merged["model"].pop("base_url", None)
    changed = _write_if_changed(config_file, yaml.safe_dump(merged, allow_unicode=True, sort_keys=False))

    creds = home / "platforms" / "whatsapp" / "session" / "creds.json"
    paired = creds.exists() or os.environ.get("ROOTI_TEST_BRIDGE")
    env = {"WHATSAPP_MODE": "bot", "WHATSAPP_ALLOW_ALL_USERS": "true", "WHATSAPP_REQUIRE_MENTION": "true",
           **{k: os.environ[k] for k in MODEL_KEYS if os.environ.get(k)}}
    # Without a home channel Hermes greets every farmer's first message with a «/sethome» notice: the operator's
    # number (ROOTI_OPERATOR) gets Hermes' own deliveries, or else Rooti's own number does.
    home_channel = os.environ.get("ROOTI_OPERATOR") or _own_number(creds)
    if home_channel:
        env["WHATSAPP_HOME_CHANNEL"] = home_channel
    if paired:  # enabled without a session, every gateway start would wait on a bridge that only shows a QR
        env["WHATSAPP_ENABLED"] = "true"
    changed |= _env_file(home / ".env", env)

    changed |= _write_if_changed(home / "SOUL.md", (config.TEMPLATES / "rooti" / "SOUL.md").read_text(encoding="utf-8"))
    values = {"MARKER": MARKER, "BOT": bot, "DATA": str(config.data_dir()), "HOME": str(Path.home()),
              "BRIDGE": config.bridge_url()}
    for template in sorted((config.TEMPLATES / "plugins" / PLUGIN).glob("*.*")):
        text = template.read_text(encoding="utf-8")
        for key, value in values.items():
            text = text.replace("{{" + key + "}}", value)
        changed |= _write_if_changed(home / "plugins" / PLUGIN / template.name, text)

    print(f"• Hermes de Rooti en {home} {'(actualizado)' if changed else '(sin cambios)'}")
    if not paired:
        print("⚠ WhatsApp: el número de Rooti no está vinculado. Corre `rooti-bot whatsapp-vincular <número>` con el "
              "gateway detenido y vuelve a arrancarlo.")
    return 0


def link_number(phone: str | None) -> int:
    import subprocess
    home = hermes_home()
    bridge = bridge_dir(home)
    if bridge is None or not (bridge / "node_modules" / "@whiskeysockets" / "baileys").is_dir():
        print("No encuentro el puente de WhatsApp de Hermes con sus dependencias.", file=sys.stderr)
        return 1
    session = home / "platforms" / "whatsapp" / "session"
    session.mkdir(parents=True, exist_ok=True)
    number = "".join(c for c in phone if c.isdigit()) if phone else ""
    return subprocess.run([config.node_bin(), str(config.TEMPLATES / "whatsapp" / "vincular.mjs"), str(session),
                           *([number] if number else [])],
                          env={**os.environ, "BAILEYS_DIR": str(bridge / "node_modules")}).returncode
