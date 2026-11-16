"""The web app's planner (bot/engine/rooti.mjs), run with Node, plus the saved plan of each lot."""
import fcntl
import hashlib
import json
import logging
import os
import subprocess
import threading
import time
from contextlib import contextmanager

from rooti_bot import config, store

log = logging.getLogger("rooti.engine")
ENGINE = config.BOT_DIR / "engine" / "rooti.mjs"
SOIL_RETRY_S = 86400  # a plan saved without soil asks SoilGrids again after this long
PLAN_FORMAT = 4  # bump when a plan's content changes (rooti.mjs, the soil fetch), so saved plans are computed again


class EngineError(Exception):
    pass


def run(request: dict, timeout: int = 180) -> dict:
    env = {**os.environ, "ROOTI_ENGINE_CACHE": str(config.data_dir() / "engine-cache.json")}
    lot = request.get("lot") or {}
    try:
        # One fetch per spot: a second engine for the same plot (the chat while the warm-up runs) waits for the
        # first and then reads its cache, instead of asking NASA and SoilGrids again.
        with _locked(f"spot:{float(lot.get('lat', 0)):.3f},{float(lot.get('lon', 0)):.3f}"):
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


def _reusable(saved, inputs: dict) -> bool:
    return bool(saved) and saved[0] == inputs and (saved[1].get("soil") is not None
                                                     or time.time() - saved[2] < SOIL_RETRY_S)


def cold(farmer: dict) -> bool:
    """True when the lot's plan is not saved yet, so asking for it means waiting on NASA."""
    inputs = {**store.lot_inputs(farmer), "mode": "auto", "format": PLAN_FORMAT}
    return not _reusable(store.saved_plan(farmer["phone"]), inputs)


def warm(lat: float, lon: float) -> None:
    """Fetches the plot's climate and soil in the background, so the farmer's first question after the website or
    the page does not wait on NASA POWER and SoilGrids (about half a minute for a new spot)."""
    def work():
        try:
            run({"cmd": "warm", "lot": {"lat": lat, "lon": lon}})
        except EngineError as exc:  # the plan will try again when it is asked for
            log.warning("no pude adelantar los datos de %.3f,%.3f: %s", lat, lon, exc)

    threading.Thread(target=work, daemon=True).start()


@contextmanager
def _one_at_a_time(phone: str):
    # The page's save (web.py, the call server) and the chat (the MCP server) can ask for the same new plan at once.
    with _locked(phone):
        yield


@contextmanager
def _locked(name: str):
    path = config.data_dir() / "locks" / f"{hashlib.sha256(name.encode()).hexdigest()[:16]}.lock"
    path.parent.mkdir(exist_ok=True)
    with open(path, "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def plan_for(farmer: dict, *, fresh: bool = False, mode: str = "auto") -> dict:
    """The lot's plan. The first one takes up to a minute (NASA POWER and SoilGrids); after that it is read from
    the database until the lot changes, so an answer never waits on NASA."""
    if farmer.get("lat") is None or not farmer.get("crops"):
        raise EngineError("Todavía no sé dónde está el lote o qué siembra.")
    if fresh or mode != "auto":
        return run({"cmd": "plan", "lot": store.lot_inputs(farmer), "mode": mode})
    inputs = {**store.lot_inputs(farmer), "mode": mode, "format": PLAN_FORMAT}
    with _one_at_a_time(farmer["phone"]):
        saved = store.saved_plan(farmer["phone"])
        if _reusable(saved, inputs):
            return saved[1]
        result = run({"cmd": "plan", "lot": store.lot_inputs(farmer), "mode": mode})
        store.save_plan(farmer["phone"], inputs, result)
    return result


def followed(result: dict, farmer: dict) -> dict | None:
    """The plan the farmer follows: the one picked on the page, else the first the page shows («El más seguro»).
    A plan saved before the named plans (format 3) has only «farm»."""
    plans = result.get("plans") or ([result["farm"]] if result.get("farm") else [])
    key = (farmer.get("chosen") or {}).get("key")
    return next((p for p in plans if p.get("key") == key), plans[0] if plans else None)


def this_year(farmer: dict) -> dict:
    return run({"cmd": "year", "lot": {"lat": farmer["lat"], "lon": farmer["lon"]}})
