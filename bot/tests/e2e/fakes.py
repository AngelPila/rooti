"""The outside services the E2E stands in for, cut down from Vinci's tests/e2e/fake_servers.py.

FakeWhatsApp is Hermes' WhatsApp bridge as the gateway sees it (GET /health and /messages, POST /send, /send-media,
/send-url-button, /typing, /read): Hermes adopts a running bridge whose scriptHash matches the bridge.js it would
start, so no Node or WhatsApp is involved. ScriptedLLM is an OpenAI-compatible endpoint whose answers come from the
test's script. FakeForecast is Open-Meteo's daily forecast."""
import hashlib
import itertools
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class _Server:
    def __init__(self, handler_cls):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
        self.httpd.owner = self
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()


class _Quiet(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class FakeWhatsApp(_Server):
    BOT = "593990000000@s.whatsapp.net"

    def __init__(self, script: Path):
        super().__init__(_WhatsAppHandler)
        self.script = script
        self.inbox: list[dict] = []
        self.sent: list[dict] = []
        self.lock = threading.Lock()
        self._ids = itertools.count(1)

    def script_hash(self) -> str:
        return hashlib.sha256(self.script.read_bytes()).hexdigest()[:16]

    def _push(self, chat, sender, body, *, group=False, media_type="", extra=None):
        with self.lock:
            self.inbox.append({"messageId": f"E2E{next(self._ids):06d}", "chatId": chat, "senderId": sender,
                               "senderName": "Agricultor", "chatName": "Agricultor", "isGroup": group, "body": body,
                               "hasMedia": False, "mediaType": media_type, "mediaUrls": [], "mentionedIds": [],
                               "botIds": [self.BOT], "timestamp": int(time.time()), "fromMe": False, **(extra or {})})

    def say(self, chat: str, text: str, *, group: bool = False, sender: str | None = None) -> None:
        self._push(chat, sender or chat, text, group=group)

    def location(self, chat: str, lat: float, lon: float) -> None:
        """A shared location as bridge.js reports it (formatLocationText)."""
        self._push(chat, chat, f"[Location: {lat},{lon}]", media_type="location",
                   extra={"nativeType": "locationMessage",
                          "nativeMetadata": {"location": {"latitude": lat, "longitude": lon, "isLive": False}}})

    def messages_to(self, chat: str, since: int = 0) -> list[dict]:
        with self.lock:
            return [m for m in self.sent[since:] if m.get("chatId") == chat
                    and m["path"] in ("send", "send-media", "send-url-button")]

    def mark(self) -> int:
        with self.lock:
            return len(self.sent)

    def wait_for(self, predicate, timeout: float = 90):
        end = time.time() + timeout
        while time.time() < end:
            found = predicate()
            if found:
                return found
            time.sleep(0.2)
        return None


class _WhatsAppHandler(_Quiet):
    def do_GET(self):
        bridge: FakeWhatsApp = self.server.owner
        path = urlsplit(self.path).path
        if path == "/health":
            return self._json(200, {"status": "connected", "scriptHash": bridge.script_hash(),
                                    "sendReadReceipts": False, "queueLength": len(bridge.inbox)})
        if path == "/messages":
            with bridge.lock:
                batch, bridge.inbox = bridge.inbox, []
            return self._json(200, batch)
        if path.startswith("/chat/"):
            return self._json(200, {"name": "Agricultor", "isGroup": False, "participants": []})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        bridge: FakeWhatsApp = self.server.owner
        payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0) or 0)) or b"{}")
        path = urlsplit(self.path).path.strip("/")
        if path == "send-url-button":
            payload = {**payload, "message": payload.get("text", "")}
        with bridge.lock:
            message_id = f"OUT{len(bridge.sent) + 1:06d}"
            bridge.sent.append({"path": path, **payload, "messageId": message_id})
        return self._json(200, {"success": True, "messageId": message_id})


class ScriptedLLM(_Server):
    """script(request) -> {"content": str} or {"tool_calls": [(name, args), ...]}"""

    def __init__(self, script):
        super().__init__(_LLMHandler)
        self.script = script
        self.requests: list[dict] = []
        self.lock = threading.Lock()


class _LLMHandler(_Quiet):
    def do_GET(self):
        self._json(200, {"object": "list", "data": [{"id": "fake", "object": "model", "owned_by": "e2e"}]})

    def do_POST(self):
        llm: ScriptedLLM = self.server.owner
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if not self.path.rstrip("/").endswith("/chat/completions"):
            return self._json(404, {"error": {"message": "not found"}})
        with llm.lock:
            llm.requests.append(req)
        try:
            answer = llm.script(req) or {"content": "ok"}
        except Exception as exc:  # a bug in the script shows up in the chat, not as a hang
            answer = {"content": f"[script error: {type(exc).__name__}: {exc}]"}
        calls = [{"id": f"call_{time.time_ns()}_{i}", "type": "function",
                  "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}
                 for i, (name, args) in enumerate(answer.get("tool_calls") or [])]
        content = answer.get("content", "") if calls else answer.get("content") or "ok"
        finish = "tool_calls" if calls else "stop"
        usage = {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
        created = int(time.time())
        if not req.get("stream"):
            message = {"role": "assistant", "content": content, **({"tool_calls": calls} if calls else {})}
            return self._json(200, {"id": "cmpl", "object": "chat.completion", "created": created, "model": "fake",
                                    "choices": [{"index": 0, "message": message, "finish_reason": finish}],
                                    "usage": usage})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        def chunk(delta, finish_reason=None, **extra):
            data = {"id": "cmpl", "object": "chat.completion.chunk", "created": created, "model": "fake",
                    "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}], **extra}
            self.wfile.write(f"data: {json.dumps(data, ensure_ascii=False)}\n\n".encode())

        chunk({"role": "assistant", "content": content or ""})
        for i, call in enumerate(calls):
            chunk({"tool_calls": [{"index": i, **call}]})
        chunk({}, finish, usage=usage)
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


class FakeForecast(_Server):
    """Open-Meteo's /v1/forecast with daily precipitation_sum: `days` is [(date, mm), ...]."""

    def __init__(self, days):
        super().__init__(_ForecastHandler)
        self.days = days


class _ForecastHandler(_Quiet):
    def do_GET(self):
        days = self.server.owner.days
        self._json(200, {"daily": {"time": [d for d, _ in days], "precipitation_sum": [mm for _, mm in days]}})
