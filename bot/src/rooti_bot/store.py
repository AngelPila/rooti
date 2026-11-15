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
  plot TEXT NOT NULL DEFAULT '[]',        -- the corners drawn on the map, [[lon, lat], ...]
  chosen TEXT,                            -- the plan picked on the plan page: {key, name, route}
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
CREATE TABLE IF NOT EXISTS handoffs (     -- a lot made on the website, waiting for its farmer to write on WhatsApp
  code TEXT PRIMARY KEY,
  lot TEXT NOT NULL,
  created_at REAL NOT NULL, used_by TEXT, used_at REAL
);
CREATE TABLE IF NOT EXISTS buttons (      -- every page button Rooti sends; one a tool asks for waits for the answer
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  label TEXT NOT NULL, text TEXT NOT NULL, url TEXT NOT NULL,
  queued_at REAL NOT NULL, sent_at REAL
);
"""
# Columns added after the first deploy: CREATE TABLE IF NOT EXISTS leaves an older table as it was.
LATER_COLUMNS = {"plot": "TEXT NOT NULL DEFAULT '[]'", "chosen": "TEXT"}
HANDOFF_HOURS = 48
CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I, read aloud or typed by hand
LOT_FIELDS = ("name", "lat", "lon", "place", "crops", "current", "area", "unit", "irrigation", "waterlog", "priority",
              "alerts_ok", "notes", "plot", "chosen")
JSON_FIELDS = ("crops", "current", "plot", "chosen")


@contextmanager
def connect():
    db = sqlite3.connect(config.data_dir() / "rooti.db", timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(SCHEMA)
    have = {row[1] for row in db.execute("PRAGMA table_info(farmers)")}
    for column, kind in LATER_COLUMNS.items():
        if column not in have:
            db.execute(f"ALTER TABLE farmers ADD COLUMN {column} {kind}")
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
        out[key] = json.loads(out[key]) if out[key] else ([] if key != "chosen" else None)
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


def add_handoff(lot: dict) -> str:
    """A short code for a lot made on the website: the farmer sends it to Rooti on WhatsApp to bring the lot along."""
    import secrets
    with connect() as db:
        db.execute("DELETE FROM handoffs WHERE created_at < ?", (time.time() - 7 * 86400,))
        while True:
            code = "RT-" + "".join(secrets.choice(CODE_LETTERS) for _ in range(4))
            cur = db.execute("INSERT OR IGNORE INTO handoffs (code, lot, created_at) VALUES (?, ?, ?)",
                             (code, json.dumps(lot, ensure_ascii=False), time.time()))
            if cur.rowcount:
                return code


def redeem_handoff(code: str, phone: str) -> dict | None:
    """The website's lot for this code, once: a second farmer sending the same code gets nothing."""
    with connect() as db:
        row = db.execute("SELECT lot, created_at, used_by FROM handoffs WHERE code = ?", (code.upper(),)).fetchone()
        if row is None or row["created_at"] < time.time() - HANDOFF_HOURS * 3600:
            return None
        if row["used_by"] not in (None, phone):
            return None
        db.execute("UPDATE handoffs SET used_by = ?, used_at = ? WHERE code = ?", (phone, time.time(), code.upper()))
        return json.loads(row["lot"])


def queue_button(phone: str, label: str, text: str, url: str, *, sent: bool = False) -> int:
    now = time.time()
    with connect() as db:
        return db.execute("INSERT INTO buttons (phone, label, text, url, queued_at, sent_at) VALUES (?, ?, ?, ?, ?, ?)",
                          (phone, label, text, url, now, now if sent else None)).lastrowid


def claim_buttons(phone: str, ids: list[int] | None = None) -> list[dict]:
    """The chat's buttons still waiting, marked sent: whoever claims a button first sends it, never both."""
    claimed = []
    with connect() as db:
        rows = db.execute("SELECT * FROM buttons WHERE phone = ? AND sent_at IS NULL ORDER BY id", (phone,)).fetchall()
        for row in rows:
            if ids is not None and row["id"] not in ids:
                continue
            if db.execute("UPDATE buttons SET sent_at = ? WHERE id = ? AND sent_at IS NULL",
                          (time.time(), row["id"])).rowcount:
                claimed.append(dict(row))
    return claimed


def sent_buttons(phone: str, since: float) -> list[dict]:
    with connect() as db:
        return [dict(r) for r in db.execute("SELECT label, sent_at FROM buttons WHERE phone = ? AND sent_at >= ? "
                                            "ORDER BY sent_at", (phone, since))]
