"""Vecinos end to end: the real app in a headless browser, served by the Node server without a database, so the feed
runs on the example posts and this phone's storage. Run from server/: python -m pytest tests/e2e (needs node,
pnpm install, pytest and playwright with its Chromium)."""
import os
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright

SERVER = Path(__file__).resolve().parents[2]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def app_url():
    port = free_port()
    env = {**os.environ, "PORT": str(port), "TRUST_PROXY": "0"}
    env.pop("DATABASE_URL", None)
    proc = subprocess.Popen(["node", "server.mjs"], cwd=SERVER, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}"
    for _ in range(150):
        try:
            urllib.request.urlopen(url + "/healthz", timeout=1)
            break
        except OSError:
            time.sleep(0.2)
    yield url
    proc.terminate()


@pytest.fixture()
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def open_vecinos(page, url):
    page.goto(url + "/?lang=es#/")
    page.locator(".hero-actions .btn.glass").click()
    page.wait_for_url("**#/plan")
    page.goto(url + "/?lang=es#/vecinos")
    expect(page.locator(".vh-side h1")).to_have_text("Vecinos de Daule", timeout=30_000)


def post(page, text):
    return page.locator(".vh-post", has_text=text)


def test_phone_neighbors_read_as_a_thread_with_faces(app_url, browser):
    page = browser.new_page(viewport={"width": 390, "height": 844}, has_touch=True)
    open_vecinos(page, app_url)

    estero = post(page, "Se llenó el estero")
    expect(estero.locator(".vh-rail img.vh-av")).to_have_attribute("src", "img/vecinos/jm.webp")
    expect(estero.locator(".vh-kind")).to_have_text("Aviso")
    # The answer hangs from the post, with its own face
    expect(estero.locator(".vh-reps li")).to_contain_text("En el recinto de nosotros igual")
    expect(post(page, "Sembré maíz en diciembre").locator(".vh-report")).to_contain_text("Se perdió")
    expect(page.locator(".vh-fine")).to_contain_text("generadas con IA")
    # Once the page has risen in, nothing scrolls sideways
    page.wait_for_function("document.documentElement.scrollWidth <= innerWidth", timeout=5_000)


def test_farmer_says_same_here_and_replies(app_url, browser):
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    open_vecinos(page, app_url)

    same = post(page, "Se llenó el estero").locator(".vh-act.same")
    expect(same).to_contain_text("6")
    same.click()
    same = post(page, "Se llenó el estero").locator(".vh-act.same")
    expect(same).to_have_attribute("aria-pressed", "true")
    expect(same).to_contain_text("7")
    page.reload()
    expect(post(page, "Se llenó el estero").locator(".vh-act.same")).to_contain_text("7")

    page.evaluate("localStorage.setItem('rooti:vecName1', JSON.stringify('Pedro Ruiz'))")
    page.reload()
    question = post(page, "soya en lote que se encharca")
    question.locator(".vh-act", has_text="Responder").click()
    question.locator(".vp-reply textarea").fill("Yo la sembré en camas altas y aguantó.")
    question.locator(".vp-reply .btn.lime").click()
    reply = post(page, "soya en lote que se encharca").locator(".vh-reps li").last
    expect(reply).to_contain_text("Yo la sembré en camas altas")
    # A real farmer's reply shows their initials, never one of the example faces
    expect(reply.locator("span.vh-av")).to_have_text("PR")


def test_composer_opens_the_form(app_url, browser):
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    open_vecinos(page, app_url)
    page.locator(".vh-compose").click()
    expect(page.locator(".vec-form")).to_be_visible()
    page.locator(".vec-form .btn.soft").click()
    expect(page.locator(".vh-compose")).to_be_visible()
