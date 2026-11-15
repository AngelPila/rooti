"""`rooti-bot web`: Rooti's one public address (port 7860 behind Coolify's proxy). It serves the website, the pages
farmers open from WhatsApp and their API (web.py), and the website's chat with Rooti (web_agent.py)."""
from fastapi import FastAPI

from rooti_bot import web, web_agent


def app() -> FastAPI:
    api = FastAPI()
    web.mount(api)
    web_agent.mount(api)
    web.mount_site(api)  # last: the web app answers every path the routes above do not
    return api


def serve(host: str, port: int) -> int:
    import uvicorn
    uvicorn.run(app(), host=host, port=port, log_level="info")
    return 0
