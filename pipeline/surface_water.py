"""How often each lot is under water: JRC Global Surface Water v1.4 (Landsat 30 m, 1984-2021) via Planetary Computer.

occurrence  = % of valid Landsat observations with water (0-100)
seasonality = months per year with water (1-12; 12 = permanent water)
For each zone we summarise a ~1.2 km box around the lot and a ~11 km box around it. In rice country, flooded
paddies count as water too, so this is read as "how waterlogged the land gets", which matters for crops that
cannot stand waterlogging (maize, soybean, peanut), not as river-flood damage.

Usage: python pipeline/surface_water.py <app/data dir>
"""
import json
import pathlib
import sys

import numpy as np
import odc.stac
import planetary_computer
import pystac_client

OUT = pathlib.Path(sys.argv[1])
zones = json.loads((OUT / "zones.json").read_text())
cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=planetary_computer.sign_inplace)


def summary(lat, lon, half):
    bbox = [lon - half, lat - half, lon + half, lat + half]
    items = list(cat.search(collections=["jrc-gsw"], bbox=bbox).items())
    ds = odc.stac.load(items, bands=["occurrence", "seasonality"], bbox=bbox, resolution=30, crs="EPSG:32717", dtype="float32").isel(time=0)
    occ, sea = ds.occurrence.values, ds.seasonality.values
    valid = (occ >= 0) & (occ <= 100)
    land = valid & (sea < 12)                       # exclude permanent water bodies (river)
    wet = land & (occ > 0)
    n = land.sum()
    return {"pct_land_ever_wet": round(100 * wet.sum() / n, 1) if n else None,
            "pct_land_wet_often": round(100 * (land & (occ >= 25)).sum() / n, 1) if n else None,  # water >= 25 % of the time
            "pct_permanent_water": round(100 * (valid & (sea == 12)).sum() / max(valid.sum(), 1), 1)}


out = {"source": "JRC Global Surface Water v1.4 (EC JRC / Google), built from NASA/USGS Landsat 5, 7 and 8, 30 m, 1984-2021; Microsoft Planetary Computer",
       "note": "Flooded rice paddies count as water. Read as how waterlogged the land gets.", "zones": {}}
for z in zones:
    lot, area = summary(z["lat"], z["lon"], 0.0055), summary(z["lat"], z["lon"], 0.05)
    # 0..1 waterlogging index for the engine from the ~11 km area: the pilot points sit on town centres,
    # so the 1 km box mixes streets and river. Share of land wet at least a quarter of the time, /50.
    idx = round(min(1.0, (area["pct_land_wet_often"] or 0) / 50), 2)
    out["zones"][z["zone"]] = {"lot_box": lot, "area_box": area, "waterlogging_index": idx}
    print(z["zone"], "lote", lot, "| zona", area, "| índice", idx, flush=True)
(OUT / "surface_water.json").write_text(json.dumps(out, indent=1))
