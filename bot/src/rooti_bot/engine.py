"""The web app's planner (bot/engine/rooti.mjs), run with Node, plus the saved plan of each lot."""
import fcntl
import hashlib
import json
import os
import subprocess
from contextlib import contextmanager
from datetime import datetime, timezone

from rooti_bot import config, store

ENGINE = config.BOT_DIR / "engine" / "rooti.mjs"
PLAN_VERSION = 3  # Invalidate saved plans when the calculation changes.
MODEL_FILE = config.REPO / "app" / "data" / "risk-model.json"


class EngineError(Exception):
    pass


def run(request: dict, timeout: int = 180) -> dict:
    env = {**os.environ, "ROOTI_ENGINE_CACHE": str(config.data_dir() / "engine-cache.json")}
    try:
        proc = subprocess.run([config.node_bin(), str(ENGINE)], input=json.dumps(request), capture_output=True,
                              text=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:  # a new plot waits on NASA POWER and SoilGrids, which can be slow for minutes
        raise EngineError("los datos de la NASA y del suelo no respondieron a tiempo; se puede probar en un rato") \
            from None
    try:
        out = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        raise EngineError(f"el motor no respondió JSON: {proc.stderr.strip()[-300:]}") from None
    if out.get("error"):
        raise EngineError(out["error"])
    return out


def cold(farmer: dict) -> bool:
    """True when the lot's plan is not saved yet, so asking for it means waiting on NASA."""
    saved = store.saved_plan(farmer["phone"])
    return not saved or saved[0] != _plan_inputs(farmer)


def _plan_inputs(farmer: dict) -> dict:
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    try:
        model_version = MODEL_FILE.stat().st_mtime_ns
    except OSError:
        model_version = None
    return {**store.lot_inputs(farmer), "mode": "auto", "plan_version": PLAN_VERSION, "climate_month": month,
            "risk_model_version": model_version}


@contextmanager
def _one_at_a_time(phone: str):
    # The page's save (web.py, the call server) and the chat (the MCP server) can ask for the same new plan at once.
    path = config.data_dir() / "locks" / f"{hashlib.sha256(phone.encode()).hexdigest()[:16]}.lock"
    path.parent.mkdir(exist_ok=True)
    with open(path, "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def plan_for(farmer: dict, *, fresh: bool = False, mode: str = "auto") -> dict:
    """The lot's plan. The first one takes up to a minute (NASA POWER and SoilGrids); after that it is read from
    the database until the lot, planner version or calendar month changes."""
    if farmer.get("lat") is None or not farmer.get("crops"):
        raise EngineError("Todavía no sé dónde está el lote o qué siembra.")
    if fresh or mode != "auto":
        return run({"cmd": "plan", "lot": store.lot_inputs(farmer), "mode": mode})
    inputs = _plan_inputs(farmer)
    with _one_at_a_time(farmer["phone"]):
        saved = store.saved_plan(farmer["phone"])
        if saved and saved[0] == inputs:
            return saved[1]
        result = run({"cmd": "plan", "lot": store.lot_inputs(farmer), "mode": mode})
        store.save_plan(farmer["phone"], inputs, result)
    return result


def this_year(farmer: dict) -> dict:
    return run({"cmd": "year", "lot": {"lat": farmer["lat"], "lon": farmer["lon"]}})
