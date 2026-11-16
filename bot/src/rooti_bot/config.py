"""Where Rooti's bot keeps things and how it reaches the outside, all from the environment (Coolify's variables)."""
import os
import secrets
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BOT_DIR = REPO / "bot"
TEMPLATES = BOT_DIR / "hermes"


def data_dir() -> Path:
    path = Path(os.environ.get("ROOTI_DATA") or Path.home() / ".local/share/rooti-bot")
    path.mkdir(parents=True, exist_ok=True)
    return path


def bridge_url() -> str:
    return os.environ.get("ROOTI_BRIDGE", "http://127.0.0.1:3000").rstrip("/")


def call_url() -> str:
    """Rooti's public address: its website and pages (deploy/s6/rooti-web behind Coolify's proxy)."""
    return os.environ.get("ROOTI_CALL_URL", "").rstrip("/")


def whatsapp_number() -> str:
    """Rooti's own number, for the website's «Continuar en WhatsApp» (wa.me): ROOTI_WHATSAPP, else the number the
    bridge is linked to."""
    if os.environ.get("ROOTI_WHATSAPP"):
        return "".join(ch for ch in os.environ["ROOTI_WHATSAPP"] if ch.isdigit())
    import json
    home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
    try:
        me = json.loads((home / "platforms/whatsapp/session/creds.json").read_text(encoding="utf-8"))["me"]["id"]
    except (OSError, ValueError, KeyError, TypeError):
        return ""
    return me.split(":")[0].split("@")[0]


def call_secret() -> bytes:
    """Signs the call links. Without ROOTI_CALL_SECRET, a random one is made once in the data volume, so the
    gateway, the alerts and the call server (separate processes) share it and links survive a redeploy."""
    secret = os.environ.get("ROOTI_CALL_SECRET", "")
    if secret:
        return secret.encode()
    path = data_dir() / "call-secret"
    if not path.exists():  # written aside and linked in, so a process never reads it half written
        draft = path.with_name(f".call-secret.{os.getpid()}")
        draft.write_text(secrets.token_urlsafe(32))
        draft.chmod(0o600)
        try:
            os.link(draft, path)
        except FileExistsError:
            pass
        finally:
            draft.unlink()
    return path.read_bytes().strip()


def node_bin() -> str:
    return os.environ.get("ROOTI_NODE", "node")


def model() -> tuple[str, str]:
    return os.environ.get("ROOTI_PROVIDER", "deepseek"), os.environ.get("ROOTI_MODEL", "deepseek-chat")
