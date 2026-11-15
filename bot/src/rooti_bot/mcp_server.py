"""Rooti's tools for Hermes, as a stdio MCP server (the protocol subset Vinci's mcp_server.py speaks).

Every call carries `_canal`, the chat it comes from, which the rooti-whatsapp plugin sets (pre_tool_call): it is in
no schema, so the model never sees or sets whose lot a call reads. Calls run in threads, so a farmer whose first
plan takes a minute does not hold up the others."""
import json
import logging
import sys
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor

from rooti_bot import tools

PROTOCOLS = ("2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25")
CHANNEL_ARG = "_canal"
log = logging.getLogger("rooti.mcp")


def _text(text: str, error: bool = False) -> dict:
    return {"content": [{"type": "text", "text": text}], "isError": error}


def _farmer_id(channel) -> str | None:
    chat = (channel or {}).get("chat") if isinstance(channel, dict) else None
    # Only private chats: a group is not one farmer's lot.
    if not chat or (channel.get("tipo") and channel["tipo"] not in ("dm", "private")):
        return None
    return chat


def call(name: str, arguments: dict) -> dict:
    arguments = dict(arguments)
    farmer = _farmer_id(arguments.pop(CHANNEL_ARG, None))
    if farmer is None:
        return _text("No sé de qué agricultor es esta conversación: solo atiendo chats privados de WhatsApp.", True)
    try:
        result = tools.call(name, farmer, arguments, chat=True)
    except tools.ToolError as exc:
        return _text(str(exc), error=True)
    except Exception as exc:  # one bad call never kills the server
        log.error("%s: %s\n%s", name, exc, traceback.format_exc())
        return _text(f"Error interno en {name}: {exc}", error=True)
    return _text(json.dumps(result, ensure_ascii=False))


def handle(message: dict) -> dict | None:
    msg_id, method, params = message.get("id"), message.get("method"), message.get("params") or {}
    if msg_id is None:
        return None
    if method == "initialize":
        asked = params.get("protocolVersion")
        result = {"protocolVersion": asked if asked in PROTOCOLS else PROTOCOLS[-1],
                  "capabilities": {"tools": {"listChanged": False}},
                  "serverInfo": {"name": "rooti", "version": "0.1.0"}}
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": [{"name": t.name, "description": t.description, "inputSchema": t.schema(),
                             "annotations": {"destructiveHint": False, "openWorldHint": False}} for t in tools.TOOLS]}
    elif method == "tools/call":
        result = call(str(params.get("name")), params.get("arguments") or {})
    else:
        return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


def serve() -> int:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    lock = threading.Lock()

    def answer(message):
        reply = handle(message)
        if reply is not None:
            with lock:
                sys.stdout.write(json.dumps(reply, ensure_ascii=False) + "\n")
                sys.stdout.flush()

    with ThreadPoolExecutor(max_workers=8) as pool:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                answer({"id": None})
                continue
            pool.submit(answer, message)
    return 0
