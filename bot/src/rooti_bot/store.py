"""Each farmer's lot and the alerts sent to them, in one SQLite file. A farmer is their WhatsApp number."""
import json
import sqlite3
import time
from contextlib import contextmanager

from rooti_bot import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS farmers (
  phone TEXT PRIMARY KEY,
  name TEXT,
  lat REAL, lon REAL, place TEXT,
  crops TEXT NOT NULL DEFAULT '[]',       -- crop ids from app/data/crops.json
  current TEXT NOT NULL DEFAULT '[]',     -- what they grow today
  area REAL, unit TEXT NOT NULL DEFAULT 'cuadra',
  irrigation INTEGER NOT NULL DEFAULT 0,
  waterlog INTEGER,                       -- 1 the plot gets waterlogged, 0 it does not, NULL unknown
  priority TEXT NOT NULL DEFAULT 'soil',  -- soil | water | income
  alerts_ok INTEGER NOT NULL DEFAULT 0,   -- agreed to get alerts Rooti sends first
  notes TEXT NOT NULL DEFAULT '',
  created_at REAL NOT NULL, updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  phone TEXT PRIMARY KEY REFERENCES farmers(phone) ON DELETE CASCADE,
  inputs TEXT NOT NULL, result TEXT NOT NULL, computed_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL REFERENCES farmers(phone) ON DELETE CASCADE,
  kind TEXT NOT NULL,                     -- heavy_rain | sow_window
  key TEXT NOT NULL,                      -- what makes it the same alert (the day of the rain, the month to sow)
  text TEXT NOT NULL,
  created_at REAL NOT NULL, sent_at REAL, reminded_at REAL, call_opened_at REAL,
  UNIQUE (phone, kind, key)
);
"""
LOT_FIELDS = ("name", "lat", "lon", "place", "crops", "current", "area", "unit", "irrigation", "waterlog", "priority",
              "alerts_ok", "notes")
JSON_FIELDS = ("crops", "current")


@contextmanager
def connect():
    db = sqlite3.connect(config.data_dir() / "rooti.db", timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(SCHEMA)
    try:
        yield db
        db.commit()
    finally:
        db.close()


def _farmer(row) -> dict | None:
    if row is None:
        return None
    out = dict(row)
    for key in JSON_FIELDS:
        out[key] = json.loads(out[key] or "[]")
    for key in ("irrigation", "alerts_ok"):
        out[key] = bool(out[key])
    out["waterlog"] = None if out["waterlog"] is None else bool(out["waterlog"])
    return out


def get(phone: str) -> dict | None:
    with connect() as db:
        return _farmer(db.execute("SELECT * FROM farmers WHERE phone = ?", (phone,)).fetchone())


def update(phone: str, **fields) -> dict:
    """Creates the farmer on first contact; only the given fields change."""
    now = time.time()
    unknown = set(fields) - set(LOT_FIELDS)
    if unknown:
        raise ValueError(f"campos desconocidos: {', '.join(sorted(unknown))}")
    values = {k: json.dumps(v) if k in JSON_FIELDS else (int(v) if isinstance(v, bool) else v) for k, v in fields.items()}
    with connect() as db:
        db.execute("INSERT OR IGNORE INTO farmers (phone, created_at, updated_at) VALUES (?, ?, ?)", (phone, now, now))
        if values:
            sets = ", ".join(f"{k} = ?" for k in values)
            db.execute(f"UPDATE farmers SET {sets}, updated_at = ? WHERE phone = ?", (*values.values(), now, phone))
    return get(phone)


def all_with_alerts() -> list[dict]:
    with connect() as db:
        rows = db.execute("SELECT * FROM farmers WHERE alerts_ok = 1 AND lat IS NOT NULL").fetchall()
    return [_farmer(r) for r in rows]


def lot_inputs(farmer: dict) -> dict:
    """What the plan depends on: a change to any of these makes the saved plan stale."""
    return {k: farmer.get(k) for k in ("lat", "lon", "crops", "current", "area", "unit", "irrigation", "waterlog",
                                       "priority")}


def saved_plan(phone: str) -> tuple[dict, dict, float] | None:
    with connect() as db:
        row = db.execute("SELECT inputs, result, computed_at FROM plans WHERE phone = ?", (phone,)).fetchone()
    return (json.loads(row["inputs"]), json.loads(row["result"]), row["computed_at"]) if row else None


def save_plan(phone: str, inputs: dict, result: dict) -> None:
    with connect() as db:
        db.execute("INSERT OR REPLACE INTO plans (phone, inputs, result, computed_at) VALUES (?, ?, ?, ?)",
                   (phone, json.dumps(inputs), json.dumps(result, ensure_ascii=False), time.time()))


def add_alert(phone: str, kind: str, key: str, text: str) -> int | None:
    """The alert's id, or None when this same alert already went out."""
    with connect() as db:
        cur = db.execute("INSERT OR IGNORE INTO alerts (phone, kind, key, text, created_at) VALUES (?, ?, ?, ?, ?)",
                         (phone, kind, key, text, time.time()))
        return cur.lastrowid if cur.rowcount else None


def alert(alert_id: int) -> dict | None:
    with connect() as db:
        row = db.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
    return dict(row) if row else None


def mark_alert(alert_id: int, field: str, at: float | None = None) -> None:
    if field not in ("sent_at", "reminded_at", "call_opened_at"):
        raise ValueError(field)
    with connect() as db:
        db.execute(f"UPDATE alerts SET {field} = ? WHERE id = ?", (at or time.time(), alert_id))


def unopened_alerts(sent_before: float) -> list[dict]:
    """Alerts sent before `sent_before` whose call nobody opened and that got no reminder yet."""
    with connect() as db:
        rows = db.execute("SELECT * FROM alerts WHERE sent_at IS NOT NULL AND sent_at < ? AND call_opened_at IS NULL "
                          "AND reminded_at IS NULL", (sent_before,)).fetchall()
    return [dict(r) for r in rows]


def alerts_sent_since(phone: str, since: float) -> int:
    with connect() as db:
        return db.execute("SELECT COUNT(*) FROM alerts WHERE phone = ? AND sent_at >= ?", (phone, since)).fetchone()[0]
