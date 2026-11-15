"""The links Rooti sends as buttons: the app's pages (the lot, the plan, an alert). Signed, so a
page knows whose lot it is and which alert it answers, and nobody opens another farmer's lot by editing the address."""
import base64
import hashlib
import hmac
import json
import time

from rooti_bot import config, store

LINK_HOURS = 48


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def token(phone: str, alert_id: int | None = None, hours: int = LINK_HOURS) -> str:
    body = _b64(json.dumps({"p": phone, "a": alert_id, "e": int(time.time() + hours * 3600)}).encode())
    return f"{body}.{_b64(hmac.new(config.call_secret(), body.encode(), hashlib.sha256).digest())}"


def page(phone: str, route: str, alert_id: int | None = None, hours: int = LINK_HOURS) -> str:
    """The web app (web.py serves it at the root) opened on `route`, signed in as this farmer. The link rides in the
    fragment, as in Vinci's webviews: it never reaches the proxy or its logs, and the page drops it on reading."""
    base = config.call_url()
    if not base:
        raise RuntimeError("Falta ROOTI_CALL_URL: la dirección pública de las páginas de Rooti.")
    return f"{base}/#t={token(phone, alert_id, hours)}&r={route}"


def redeem(tok: str) -> dict:
    """{phone, alert (or None), farmer} for a valid link; ValueError for a forged or expired one."""
    try:
        body, sig = tok.split(".", 1)
        wanted = _b64(hmac.new(config.call_secret(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, wanted):
            raise ValueError("firma inválida")
        data = json.loads(_unb64(body))
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"enlace dañado: {exc}") from None
    if data.get("e", 0) < time.time():
        raise ValueError("el enlace ya venció")
    alert = store.alert(int(data["a"])) if data.get("a") else None
    if alert and alert["phone"] != data["p"]:
        raise ValueError("el aviso es de otro agricultor")
    return {"phone": data["p"], "alert": alert, "farmer": store.get(data["p"])}
