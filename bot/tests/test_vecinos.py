"""Vecinos on the bot: the same answers the app gets from server/server.mjs."""
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ROOTI_DATA", str(tmp_path))
    from rooti_bot import vecinos
    importlib.reload(vecinos)  # a fresh database and fresh write limits for each test
    api = FastAPI()
    vecinos.mount(api)
    return TestClient(api), vecinos


def test_examples_are_loaded_once_and_marked(client):
    c, _ = client
    posts = c.get("/api/vecinos?zone=daule").json()["posts"]
    assert posts and all(p["example"] for p in posts)
    assert all(p["zone"] == "daule" for p in posts)
    first = next(p for p in posts if p["id"] == "d1")
    assert first["date"] == "2026-11-12" and first["replies"] and first["text_es"]
    assert c.get("/api/vecinos?zone=daule").json()["posts"] == posts  # loading twice adds nothing


def test_a_report_is_shared_and_its_author_masked(client):
    c, _ = client
    body = {"type": "asi_me_fue", "zone": "daule", "crop": "rice", "sowMonth": 1, "sowYear": 2026, "result": "bien",
            "area": 2, "unit": "cuadra", "author": "pedro antonio ramírez", "phone": "0999999999"}
    r = c.post("/api/vecinos", json=body)
    assert r.status_code == 201
    post = next(p for p in c.get("/api/vecinos?zone=daule").json()["posts"] if p["id"] == r.json()["id"])
    assert post["author"] == "Pedro R." and post["crop"] == "rice" and post["sowMonth"] == 1
    assert "phone" not in post and "example" in post and post["example"] is False
    assert post["ts"].endswith("Z")
    # Newest first
    assert c.get("/api/vecinos?zone=daule").json()["posts"][0]["id"] == r.json()["id"]


def test_replies_and_reports(client):
    c, _ = client
    pid = c.post("/api/vecinos", json={"type": "pregunta", "zone": "pt:-1.9,-79.9", "text": "¿Alguien sembró maní?",
                                       "author": "Ana"}).json()["id"]
    assert c.post(f"/api/vecinos/{pid}/replies", json={"author": "Luis T", "text": "Yo, en junio."}).status_code == 201
    assert c.post("/api/vecinos/nope/replies", json={"author": "x", "text": "y"}).status_code == 404
    post = c.get("/api/vecinos?zone=pt:-1.9,-79.9").json()["posts"][0]
    assert post["replies"][0]["author"] == "Luis T." and post["replies"][0]["text"] == "Yo, en junio."
    # The same device counts once; three devices take it off the feed
    assert c.post(f"/api/vecinos/{pid}/report", json={"device": "a"}).json() == {"ok": True, "new": True}
    assert c.post(f"/api/vecinos/{pid}/report", json={"device": "a"}).json()["new"] is False
    c.post(f"/api/vecinos/{pid}/report", json={"device": "b"})
    assert c.get("/api/vecinos?zone=pt:-1.9,-79.9").json()["posts"]
    c.post(f"/api/vecinos/{pid}/report", json={"device": "c"})
    assert c.get("/api/vecinos?zone=pt:-1.9,-79.9").json()["posts"] == []


@pytest.mark.parametrize("body", [
    {"type": "spam", "zone": "daule", "text": "x"},
    {"type": "aviso", "zone": "guayaquil-centro", "text": "x"},
    {"type": "aviso", "zone": "daule", "text": "   "},
    {"type": "asi_me_fue", "zone": "daule", "crop": "coca", "sowMonth": 1, "sowYear": 2026, "result": "bien"},
    {"type": "asi_me_fue", "zone": "daule", "crop": "rice", "sowMonth": 13, "sowYear": 2026, "result": "bien"},
    {"type": "asi_me_fue", "zone": "daule", "crop": "rice", "sowMonth": 1, "sowYear": 1990, "result": "bien"},
    {"type": "asi_me_fue", "zone": "daule", "crop": "rice", "sowMonth": "x", "sowYear": 2026, "result": "bien"},
])
def test_bad_posts_are_refused(client, body):
    c, _ = client
    assert c.post("/api/vecinos", json=body).status_code == 400


def test_limits(client):
    c, v = client
    assert c.get("/api/vecinos?zone=x").status_code == 400
    assert c.post("/api/vecinos", content=b"[1]", headers={"content-type": "application/json"}).status_code == 400
    assert c.post("/api/vecinos", content=b"{" + b" " * 5000 + b"}").status_code == 413
    # The web cannot pretend a post came from WhatsApp, and long text is cut
    pid = c.post("/api/vecinos", json={"type": "aviso", "zone": "quevedo", "text": "a" * 500, "source": "whatsapp"}).json()["id"]
    with v.connect() as db:
        row = db.execute("SELECT source, length(text) n, author FROM vec_posts WHERE id = ?", (pid,)).fetchone()
    assert (row["source"], row["n"], row["author"]) == ("web", 280, "Vecino")
    # A few writes per person, then a pause
    codes = [c.post("/api/vecinos", json={"type": "aviso", "zone": "quevedo", "text": f"{i}"}).status_code for i in range(10)]
    # 8 per 10 minutes; three used above (a refused body counts too, as in server.mjs: the limit runs first)
    assert 429 in codes and codes.count(201) == 5


def test_moderator_can_hide(client):
    c, v = client
    pid = c.post("/api/vecinos", json={"type": "aviso", "zone": "babahoyo", "text": "Venta de urea barata"}).json()["id"]
    assert v.set_hidden(pid)
    assert all(p["id"] != pid for p in c.get("/api/vecinos?zone=babahoyo").json()["posts"])
    assert c.post(f"/api/vecinos/{pid}/replies", json={"text": "hola"}).status_code == 404
