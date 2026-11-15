"""The web app's planner (bot/engine/rooti.mjs), run with Node, plus the saved plan of each lot."""
import json
import os
import subprocess

from rooti_bot import config, store

ENGINE = config.BOT_DIR / "engine" / "rooti.mjs"


class EngineError(Exception):
    pass


def run(request: dict, timeout: int = 120) -> dict:
    env = {**os.environ, "ROOTI_ENGINE_CACHE": str(config.data_dir() / "engine-cache.json")}
    proc = subprocess.run([config.node_bin(), str(ENGINE)], input=json.dumps(request), capture_output=True, text=True,
                          timeout=timeout, env=env)
    try:
        out = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        raise EngineError(f"el motor no respondió JSON: {proc.stderr.strip()[-300:]}") from None
    if out.get("error"):
        raise EngineError(out["error"])
    return out


def plan_for(farmer: dict, *, fresh: bool = False, mode: str = "auto") -> dict:
    """The lot's plan. The first one takes up to a minute (NASA POWER and SoilGrids); after that it is read from
    the database until the lot changes, so an answer never waits on NASA."""
    if farmer.get("lat") is None or not farmer.get("crops"):
        raise EngineError("Todavía no sé dónde está el lote o qué siembra.")
    inputs = {**store.lot_inputs(farmer), "mode": mode}
    saved = store.saved_plan(farmer["phone"])
    if saved and not fresh and saved[0] == inputs:
        return saved[1]
    result = run({"cmd": "plan", "lot": store.lot_inputs(farmer), "mode": mode})
    if mode == "auto":
        store.save_plan(farmer["phone"], inputs, result)
    return result


def this_year(farmer: dict) -> dict:
    return run({"cmd": "year", "lot": {"lat": farmer["lat"], "lon": farmer["lon"]}})
