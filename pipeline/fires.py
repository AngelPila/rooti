"""Fires seen from space around each pilot zone: MODIS MOD14A2/MYD14A2 v061 (8-day, 1 km) via Planetary Computer.

FireMask >= 7 = fire (7 low, 8 nominal, 9 high confidence). For each zone we count fire pixels per month
in a ~11 km box (where the neighbours burn) and in a ~2 km box around the lot (post-harvest season May-Dec),
2003 to today. Used for the soil passport stamp "no burning seen by satellite" and for "when people burn here".

Usage: python pipeline/fires.py <app/data dir> <zone> [year_from] [year_to]
"""
import datetime as dt
import json
import pathlib
import sys
import time

import numpy as np
import odc.stac
import planetary_computer
import pystac_client

OUT, ZONE = pathlib.Path(sys.argv[1]), sys.argv[2]
Y0 = int(sys.argv[3]) if len(sys.argv) > 3 else 2003
Y1 = int(sys.argv[4]) if len(sys.argv) > 4 else dt.date.today().year
zone = next(z for z in json.loads((OUT / "zones.json").read_text()) if z["zone"] == ZONE)
lat, lon = zone["lat"], zone["lon"]
BIG, LOT = 0.05, 0.01  # half-sizes in degrees: ~11 km and ~2 km boxes
box = lambda h: [lon - h, lat - h, lon + h, lat + h]


def year_counts(year):
    cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1",
                                    modifier=planetary_computer.sign_inplace)  # fresh signature per year
    items = list(cat.search(collections=["modis-14A2-061"], bbox=box(BIG), datetime=f"{year}-01-01/{year}-12-31").items())
    if not items:
        return None
    ds = odc.stac.load(items, bands=["FireMask"], bbox=box(BIG), resolution=1000,
                       groupby="solar_day", dtype="uint8", fail_on_error=True, chunks={})
    ds = ds.compute(scheduler="threads", num_workers=16)
    fire = ds.FireMask >= 7
    months_big = np.zeros(12, int)
    months_lot = np.zeros(12, int)
    xs, ys = ds.x.values, ds.y.values
    # lot box in the dataset's projection: use nearest pixels to the lot center within ~2 km
    cx = np.argmin(np.abs(xs - np.median(xs))); cy = np.argmin(np.abs(ys - np.median(ys)))
    for t in range(fire.sizes["time"]):
        m = int(str(fire.time.values[t])[5:7]) - 1
        f = fire.isel(time=t).values
        months_big[m] += int(f.sum())
        months_lot[m] += int(f[max(0, cy - 1):cy + 2, max(0, cx - 1):cx + 2].sum())
    return months_big.tolist(), months_lot.tolist()


out = {"zone": ZONE, "source": "NASA MODIS MOD14A2/MYD14A2 v061 thermal anomalies (8-day, 1 km), Microsoft Planetary Computer",
       "fire_rule": "FireMask >= 7", "zone_box_km": 11, "lot_box_km": 3, "years": {}}
for y in range(Y0, Y1 + 1):
    for attempt in range(3):
        try:
            r = year_counts(y); break
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {str(e)[:100]}"; r = "ERR"; time.sleep(10 * (attempt + 1))
    if r == "ERR":
        out["years"][str(y)] = {"error": err}; print(ZONE, y, "FALLO", err, flush=True); continue
    if r is None:
        continue
    big, lot = r
    out["years"][str(y)] = {"zone_fires_by_month": big, "lot_fires_by_month": lot}
    print(ZONE, y, "zona", sum(big), "lote", sum(lot), flush=True)
(OUT / f"fires_{ZONE}.json").write_text(json.dumps(out, separators=(",", ":")))
print("FIN", ZONE, flush=True)
