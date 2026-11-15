"""Where Rooti's bot keeps things and how it reaches the outside, all from the environment (Coolify's variables)."""
import os
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
    """The public address of the call page (deploy/s6/rooti-llamada behind Coolify's proxy)."""
    return os.environ.get("ROOTI_CALL_URL", "").rstrip("/")


def call_secret() -> bytes:
    secret = os.environ.get("ROOTI_CALL_SECRET", "")
    if not secret:
        raise RuntimeError("Falta ROOTI_CALL_SECRET: sin ella no puedo firmar los enlaces de llamada.")
    return secret.encode()


def node_bin() -> str:
    return os.environ.get("ROOTI_NODE", "node")


def model() -> tuple[str, str]:
    return os.environ.get("ROOTI_PROVIDER", "deepseek"), os.environ.get("ROOTI_MODEL", "deepseek-chat")
