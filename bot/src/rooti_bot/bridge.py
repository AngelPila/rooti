"""Messages Rooti sends on its own (an alert, the call button), straight to Hermes' WhatsApp bridge, without the model."""
import json
import urllib.error
import urllib.request

from rooti_bot import config


def _post(path: str, payload: dict, timeout: int = 30) -> dict:
    request = urllib.request.Request(f"{config.bridge_url()}/{path}", data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read() or b"{}")


def send_text(chat: str, text: str) -> dict:
    return _post("send", {"chatId": chat, "message": text})


def send_voice(chat: str, ogg_path: str) -> dict:
    """A voice bubble: the bridge sends an .ogg (opus) as a voice note."""
    return _post("send-media", {"chatId": chat, "filePath": ogg_path, "mediaType": "audio"}, timeout=60)


def send_button(chat: str, text: str, button: str, url: str, *, log: bool = True) -> dict:
    """A message with one button that opens a page (hermes/whatsapp/url_button.js); the bare link when the bridge
    lacks that route. Logged, so the next turn knows which pages the farmer already has."""
    try:
        sent = _post("send-url-button", {"chatId": chat, "text": text, "buttonText": button, "url": url})
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
        sent = send_text(chat, f"{text}\n\n{button}: {url}")
    if log:
        from rooti_bot import store
        store.queue_button(chat, button, text, url, sent=True)
    return sent
