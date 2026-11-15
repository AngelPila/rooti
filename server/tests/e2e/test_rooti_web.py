"""Rooti inside the web app, end to end: the real app in a headless browser, served by each of its two servers (the
Node one in server/ and the bot's, which serves the public website), against a fake model that answers with the tool
calls a real one would make. Run from server/: python -m pytest tests/e2e (needs node, pnpm install, pytest and
playwright with its Chromium; the bot's case needs ROOTI_BOT_PYTHON, the bot's call environment, or is skipped)."""
import json
import os
import socket
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright

SERVER = Path(__file__).resolve().parents[2]
BOT = SERVER.parent / "bot"
BOT_PYTHON = os.environ.get("ROOTI_BOT_PYTHON", str(BOT / ".venv-call" / "bin" / "python"))


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def call(name: str, **args) -> dict:
    return {"role": "assistant", "content": "", "tool_calls": [
        {"id": f"call_{name}_{time.time_ns()}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}


# What the fake model does for each question, and what it says once its tool answered
SCRIPT = {
    "tres cuadras": (call("change_plot", area=3, unit="cuadra"), "Listo, veci: cambié su tierra a tres cuadras. Si me equivoqué, toque Deshacer."),
    "años": (call("show_on_page", screen="plan", mark="years"), "Fíjese en los puntos: cada uno es un año real."),
    "riego": (call("try_idea", idea="irrigation"), "Con riego le iría mejor. Si le convence, toque el botón."),
}


class FakeModel(BaseHTTPRequestHandler):
    requests: list = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        FakeModel.requests.append(body)
        last, user = body["messages"][-1], next(m for m in reversed(body["messages"]) if m["role"] == "user")
        key = next(k for k in SCRIPT if k in user["content"].lower())
        message = {"role": "assistant", "content": SCRIPT[key][1]} if last["role"] == "tool" else SCRIPT[key][0]
        out = json.dumps({"choices": [{"message": message}]}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *_):
        pass


@pytest.fixture(scope="module", params=["node", "bot"])
def app_url(request, tmp_path_factory):
    model = ThreadingHTTPServer(("127.0.0.1", free_port()), FakeModel)
    threading.Thread(target=model.serve_forever, daemon=True).start()
    port = free_port()
    env = {**os.environ, "PORT": str(port), "TRUST_PROXY": "0", "DEEPSEEK_API_KEY": "fake",
           "ROOTI_CHAT_URL": f"http://127.0.0.1:{model.server_port}/chat"}
    env.pop("DATABASE_URL", None)
    if request.param == "node":
        proc = subprocess.Popen(["node", "server.mjs"], cwd=SERVER, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    else:
        if not Path(BOT_PYTHON).exists():
            model.shutdown()
            pytest.skip("no bot call environment (ROOTI_BOT_PYTHON)")
        env |= {"PYTHONPATH": str(BOT / "src"), "ROOTI_DATA": str(tmp_path_factory.mktemp("rooti-data"))}
        proc = subprocess.Popen([BOT_PYTHON, "-c", "import sys, uvicorn; from rooti_bot.call_server import app; "
                                 "uvicorn.run(app(), host='127.0.0.1', port=int(sys.argv[1]), log_level='warning')", str(port)],
                                cwd=BOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}"
    health = "/healthz" if request.param == "node" else "/api/rooti"
    for _ in range(150):
        try:
            urllib.request.urlopen(url + health, timeout=1)
            break
        except OSError:
            time.sleep(0.2)
    yield url
    proc.terminate()
    model.shutdown()


@pytest.fixture()
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def saved_plan(page) -> dict:
    return page.evaluate("JSON.parse(localStorage.getItem('rooti:plan3'))")


def open_example(page, url):
    page.goto(url + "/?lang=es#/")
    page.locator(".hero-actions .btn.glass").click()
    page.wait_for_url("**#/plan")
    expect(page.locator("[data-rooti='route']")).to_be_visible(timeout=30_000)


def test_phone_farmer_changes_the_plot_by_writing_and_undoes_it(app_url, browser):
    page = browser.new_page(viewport={"width": 390, "height": 844}, has_touch=True)
    open_example(page, app_url)
    page.locator(".rt-fab").click()
    expect(page.locator(".rt-panel")).to_be_visible()
    expect(page.locator(".rt-bot").first).to_contain_text("«Mi plan»")

    page.locator(".rt-cmp input").fill("Me equivoqué, son tres cuadras")
    page.keyboard.press("Enter")
    # Rooti changed the plot: the sheet drops to a bar so the recomputed plan stays in view
    peek = page.locator(".rt-peek")
    expect(peek).to_be_visible(timeout=15_000)
    expect(peek.locator(".rt-chg")).to_contain_text("3 cuadras")
    expect(page.locator(".rt-panel")).to_be_hidden()
    assert saved_plan(page)["area"] == 3 and saved_plan(page)["unit"] == "cuadra"
    assert "Plot: Daule" in json.dumps(FakeModel.requests[-1])

    peek.locator(".rt-chg button").click()
    expect(peek).to_contain_text("lo dejé como estaba")
    assert saved_plan(page)["area"] == 5.2 and saved_plan(page)["unit"] == "ha"


def test_phone_rooti_marks_what_it_explains_and_offers_ideas_without_applying_them(app_url, browser):
    page = browser.new_page(viewport={"width": 390, "height": 844}, has_touch=True)
    open_example(page, app_url)
    page.locator(".rt-fab").click()
    page.locator(".rt-chips button").first.wait_for()
    page.locator(".rt-cmp input").fill("¿Cuántos años le fue bien?")
    page.keyboard.press("Enter")
    expect(page.locator(".rt-marked[data-rooti='years']").first).to_be_visible(timeout=15_000)

    page.locator(".rt-more").click()
    page.locator(".rt-cmp input").fill("¿Y si pongo riego?")
    page.keyboard.press("Enter")
    page.wait_for_url("**#/probar", timeout=15_000)
    expect(page.locator(".rt-marked[data-rooti='idea-irrigation']")).to_be_visible(timeout=15_000)
    offer = page.locator(".rt-peek .rt-offer")
    expect(offer).to_be_visible()
    assert saved_plan(page)["irrigation"] is False
    offer.click()
    assert saved_plan(page)["irrigation"] is True


def test_computer_panel_sits_beside_the_page(app_url, browser):
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    open_example(page, app_url)
    page.locator(".rt-fab").click()
    expect(page.locator(".rt-panel")).to_be_visible()
    assert page.evaluate("getComputedStyle(document.body).paddingRight") == "400px"
    page.locator(".rt-x").first.click()
    assert page.evaluate("getComputedStyle(document.body).paddingRight") == "0px"


def test_without_a_model_key_rooti_stays_hidden(browser):
    port = free_port()
    env = {**os.environ, "PORT": str(port), "TRUST_PROXY": "0"}
    for k in ("DEEPSEEK_API_KEY", "DATABASE_URL"):
        env.pop(k, None)
    proc = subprocess.Popen(["node", "server.mjs"], cwd=SERVER, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=1)
                break
            except OSError:
                time.sleep(0.2)
        page = browser.new_page()
        page.goto(f"http://127.0.0.1:{port}/?lang=es#/")
        page.wait_for_timeout(1500)
        assert page.locator("#rooti").count() == 0
    finally:
        proc.terminate()
