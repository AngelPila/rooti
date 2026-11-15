"""Vecinos on the bot's own address: what farmers nearby saw, shared between everyone who opens the app.

The same API as server/server.mjs (which runs it on Postgres), here on the bot's SQLite file, because the website is
served by the bot. The app does not change: when this answers, posts are shared; when it does not, the app falls
back to its example posts and the phone's own storage.
- GET  /api/vecinos?zone=<zone>         the zone's posts and their replies, newest first
- POST /api/vecinos                     a new post: {type, zone, text | crop+sowMonth+sowYear+result, area?, unit?, author}
- POST /api/vecinos/<id>/replies        a reply: {author, text}
- POST /api/vecinos/<id>/report         one report per device; 3 reports take a post off the feed

A post never stores a phone number or coordinates: the author is a masked name, the place a zone key.
The WhatsApp tools (tools.py) read and write the same tables from the gateway's venv, which has no FastAPI: the
routes import it inside mount().
"""
import json
import math
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from rooti_bot import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS vec_posts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('asi_me_fue', 'aviso', 'pregunta')),
  zone TEXT NOT NULL,                  -- pilot zone (daule, babahoyo, quevedo) or pt:<lat>,<lon> rounded to 0.1°
  crop TEXT, sow_month INTEGER, sow_year INTEGER,
  result TEXT CHECK (result IN ('bien', 'regular', 'perdio')),
  area REAL, unit TEXT,
  text TEXT,                           -- what a farmer wrote, in their own language
  text_es TEXT, text_en TEXT,          -- example posts ship in both languages
  author TEXT NOT NULL,                -- "Pedro R.": first name and last initial only
  role TEXT CHECK (role IN ('tecnico')),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'whatsapp', 'example')),
  example INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,   -- set by a moderator
  created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS vec_posts_zone ON vec_posts (zone, created_at DESC);
CREATE TABLE IF NOT EXISTS vec_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL REFERENCES vec_posts (id) ON DELETE CASCADE,
  author TEXT NOT NULL, role TEXT CHECK (role IN ('tecnico')),
  text TEXT, text_es TEXT, text_en TEXT,
  example INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS vec_replies_post ON vec_replies (post_id, created_at);
CREATE TABLE IF NOT EXISTS vec_reports (
  post_id TEXT NOT NULL REFERENCES vec_posts (id) ON DELETE CASCADE,
  reporter TEXT NOT NULL,
  created_at REAL NOT NULL,
  PRIMARY KEY (post_id, reporter)
);
"""
TYPES = {"asi_me_fue", "aviso", "pregunta"}
RESULTS = {"bien", "regular", "perdio"}
UNITS = {"ha", "cuadra", "acre", "m2"}
ZONE = re.compile(r"^(daule|babahoyo|quevedo|pt:-?\d{1,2}\.\d,-?\d{1,3}\.\d)$")
PILOTS = {"daule": (-1.86, -79.98), "babahoyo": (-1.80, -79.53), "quevedo": (-1.03, -79.46)}  # app/main.js PILOTS
REPORTS_TO_HIDE = 3
ECUADOR = timezone(timedelta(hours=-5))  # Guayaquil has no daylight saving
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_seeded = False


@contextmanager
def connect():
    global _seeded
    db = sqlite3.connect(config.data_dir() / "rooti.db", timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(SCHEMA)
    if not _seeded:
        _seed(db)
        _seeded = True
    try:
        yield db
        db.commit()
    finally:
        db.close()


def zone_of(lat: float, lon: float) -> str:
    """The app's zoneKey: the pilot zone within 40 km, else the 0.1° square, so WhatsApp and the app share a feed."""
    near = next((k for k, (la, lo) in PILOTS.items() if math.hypot(la - lat, lo - lon) * 111 < 40), None)
    return near or f"pt:{lat:.1f},{lon:.1f}"


def _day(date: str) -> float:
    """An example's day, at noon in Ecuador, as a timestamp."""
    return datetime.fromisoformat(date).replace(hour=12, tzinfo=ECUADOR).timestamp()


def _seed(db) -> None:
    # Example posts ship with the app; they are loaded once, marked as examples, and never overwrite a real post.
    posts = json.loads((config.REPO / "app/data/vecinos.json").read_text(encoding="utf-8")).get("posts", [])
    for p in posts:
        new = db.execute(
            "INSERT OR IGNORE INTO vec_posts (id, type, zone, crop, sow_month, sow_year, result, area, unit, text_es,"
            " text_en, author, role, source, example, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'example',1,?)",
            (p["id"], p["type"], p["zone"], p.get("crop"), p.get("sowMonth"), p.get("sowYear"), p.get("result"),
             p.get("area"), p.get("unit"), p.get("text_es"), p.get("text_en"), p["author"], p.get("role"),
             _day(p["date"]))).rowcount
        if new:
            for x in p.get("replies", []):
                db.execute("INSERT INTO vec_replies (post_id, author, role, text_es, text_en, example, created_at)"
                           " VALUES (?,?,?,?,?,1,?)",
                           (p["id"], x["author"], x.get("role"), x.get("text_es"), x.get("text_en"), _day(x["date"])))


def _crops() -> set[str]:
    data = json.loads((config.REPO / "app/data/crops.json").read_text(encoding="utf-8"))
    return set(data.get("crops", {}))


def clean(value, limit: int) -> str:
    return _CONTROL.sub("", value).strip()[:limit] if isinstance(value, str) else ""


def mask_name(name) -> str:
    """The same rule as the app: first name and last initial, nothing else is stored."""
    words = [re.sub(r"[^\w'.-]|\d|_", "", w) for w in clean(name, 80).split()]
    words = [w for w in words if w]
    if not words:
        return "Vecino"
    first = words[0][:1].upper() + words[0][1:24].lower()
    return first if len(words) == 1 else f"{first} {words[-1][0].upper()}."


def _date(ts: float) -> str:
    return datetime.fromtimestamp(ts, ECUADOR).strftime("%Y-%m-%d")


def _row(row) -> dict:
    out = {k: row[k] for k in row.keys() if row[k] is not None}
    for k in ("example",):
        if k in out:
            out[k] = bool(out[k])
    return out


def list_posts(zone: str) -> list[dict]:
    with connect() as db:
        posts = db.execute(
            "SELECT p.id, p.type, p.zone, p.crop, p.sow_month AS sowMonth, p.sow_year AS sowYear, p.result, p.area,"
            " p.unit, p.text, p.text_es, p.text_en, p.author, p.role, p.example, p.created_at FROM vec_posts p"
            " WHERE p.zone = ? AND NOT p.hidden"
            " AND (SELECT count(*) FROM vec_reports r WHERE r.post_id = p.id) < ?"
            " ORDER BY p.created_at DESC LIMIT 200", (zone, REPORTS_TO_HIDE)).fetchall()
        if not posts:
            return []
        ids = [p["id"] for p in posts]
        replies = db.execute(
            f"SELECT post_id, author, role, text, text_es, text_en, example, created_at FROM vec_replies"
            f" WHERE post_id IN ({','.join('?' * len(ids))}) ORDER BY created_at", ids).fetchall()
    out, by_id = [], {}
    for p in posts:
        item = _row(p)
        ts = item.pop("created_at")
        item.update(date=_date(ts), ts=datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z"),
                    replies=[])
        by_id[item["id"]] = item
        out.append(item)
    for r in replies:
        item = _row(r)
        item["date"] = _date(item.pop("created_at"))
        by_id[item.pop("post_id")]["replies"].append(item)
    return out


def add_post(body: dict, source: str = "web") -> str:
    kind, zone, text = body.get("type"), str(body.get("zone") or ""), clean(body.get("text"), 280)
    if kind not in TYPES or not ZONE.match(zone):
        raise ValueError("type or zone")
    crop = month = year = result = area = unit = None
    if kind == "asi_me_fue":
        crop, result = str(body.get("crop") or ""), body.get("result")
        try:
            month, year = int(body.get("sowMonth")), int(body.get("sowYear"))
        except (TypeError, ValueError):
            raise ValueError("report fields") from None
        this_year = datetime.now(ECUADOR).year
        if crop not in _crops() or not 1 <= month <= 12 or not this_year - 10 <= year <= this_year or result not in RESULTS:
            raise ValueError("report fields")
        try:
            size = float(body.get("area"))
        except (TypeError, ValueError):
            size = 0
        if 0 < size < 100000:
            area, unit = size, body.get("unit") if body.get("unit") in UNITS else "ha"
    elif not text:
        raise ValueError("text")
    post_id = "w" + format(int(time.time() * 1000), "x") + secrets.token_hex(3)
    with connect() as db:
        db.execute("INSERT INTO vec_posts (id, type, zone, crop, sow_month, sow_year, result, area, unit, text, author,"
                   " source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (post_id, kind, zone, crop, month, year, result, area, unit, text or None,
                    mask_name(body.get("author")), source, time.time()))
    return post_id


def add_reply(post_id: str, author, text) -> bool:
    text = clean(text, 280)
    if not text:
        raise ValueError("text")
    with connect() as db:
        return db.execute("INSERT INTO vec_replies (post_id, author, text, created_at)"
                          " SELECT id, ?, ?, ? FROM vec_posts WHERE id = ? AND NOT hidden",
                          (mask_name(author), text, time.time(), post_id)).rowcount > 0


def report(post_id: str, reporter: str) -> bool:
    with connect() as db:
        return db.execute("INSERT OR IGNORE INTO vec_reports (post_id, reporter, created_at)"
                          " SELECT id, ?, ? FROM vec_posts WHERE id = ?", (reporter, time.time(), post_id)).rowcount > 0


def set_hidden(post_id: str, hidden: bool = True) -> bool:
    """For a moderator: take a post off the feed, or bring it back."""
    with connect() as db:
        return db.execute("UPDATE vec_posts SET hidden = ? WHERE id = ?", (int(hidden), post_id)).rowcount > 0


# A few writes per person, enough for a farmer, too few for a spammer. In memory: it resets on deploy, which is fine.
_hits: dict[str, list[float]] = {}


def _allowed(key: str, most: int, window: float = 600) -> bool:
    now = time.time()
    recent = [t for t in _hits.get(key, []) if now - t < window]
    _hits[key] = recent
    if len(recent) >= most:
        return False
    recent.append(now)
    if len(_hits) > 5000:
        for k in [k for k, v in _hits.items() if not any(now - t < window for t in v)]:
            del _hits[k]
    return True


def _ip(request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    return (forwarded.split(",")[0] if forwarded else (request.client.host if request.client else "?")).strip()


async def _json(request) -> dict:
    from fastapi import HTTPException
    raw = await request.body()
    if len(raw) > 4096:
        raise HTTPException(413, "too large")
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(400, "bad json") from None
    if not isinstance(body, dict):
        raise HTTPException(400, "bad json")
    return body


def mount(api) -> None:
    from fastapi import HTTPException, Request
    from fastapi.responses import JSONResponse
    no_store = {"Cache-Control": "no-store"}

    @api.get("/api/vecinos")
    async def posts(zone: str = ""):
        if not ZONE.match(zone):
            raise HTTPException(400, "zone")
        return JSONResponse({"posts": list_posts(zone)}, headers=no_store)

    @api.post("/api/vecinos")
    async def new_post(request: Request):
        if not _allowed("w:" + _ip(request), 8):
            raise HTTPException(429, "slow down")
        body = await _json(request)
        try:  # the web never sets the source: only the WhatsApp tool writes source="whatsapp"
            return JSONResponse({"id": add_post(body)}, status_code=201, headers=no_store)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None

    @api.post("/api/vecinos/{post_id}/replies")
    async def new_reply(post_id: str, request: Request):
        if not _allowed("w:" + _ip(request), 8):
            raise HTTPException(429, "slow down")
        body = await _json(request)
        try:
            saved = add_reply(post_id[:40], body.get("author"), body.get("text"))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        if not saved:
            raise HTTPException(404, "post")
        return JSONResponse({"ok": True}, status_code=201, headers=no_store)

    @api.post("/api/vecinos/{post_id}/report")
    async def new_report(post_id: str, request: Request):
        ip = _ip(request)
        if not _allowed("r:" + ip, 30):
            raise HTTPException(429, "slow down")
        body = await _json(request)
        return JSONResponse({"ok": True, "new": report(post_id[:40], clean(body.get("device"), 64) or ip)},
                            headers=no_store)
