"""Relieve (Copernicus DEM GLO-30 via Planetary Computer) + suelo (SoilGrids 2.0) por zona.
-> raw/dem_<zona>.tif, raw/terrain.csv, raw/soil.csv"""
import json, sys, pathlib, time, numpy as np, pandas as pd, requests
import planetary_computer, pystac_client, odc.stac
ROOT = pathlib.Path(sys.argv[1]); HALF = 0.025
zones = json.loads((ROOT / "scripts/zones.json").read_text())
cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1",
                                modifier=planetary_computer.sign_inplace)
rows = []
for name, z in zones.items():
    bbox = [z["lon"]-HALF, z["lat"]-HALF, z["lon"]+HALF, z["lat"]+HALF]
    items = list(cat.search(collections=["cop-dem-glo-30"], bbox=bbox).items())
    dem = odc.stac.load(items, bands=["data"], bbox=bbox, crs="EPSG:32717", resolution=30).data.isel(time=0).astype("float32")
    dem.rio.to_raster(ROOT / f"raw/dem_{name}.tif") if hasattr(dem, "rio") else None
    gy, gx = np.gradient(dem.values, 30.0)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    rows.append({"zona": name, "elev_media_m": round(float(np.nanmean(dem)), 1),
                 "elev_min_m": round(float(np.nanmin(dem)), 1), "elev_max_m": round(float(np.nanmax(dem)), 1),
                 "pendiente_media_grados": round(float(np.nanmean(slope)), 2),
                 "pct_area_pendiente_mayor_8": round(float((slope > 8).mean() * 100), 1)})
    print("dem", rows[-1], flush=True)
pd.DataFrame(rows).to_csv(ROOT / "raw/terrain.csv", index=False)

PROPS = ["clay", "sand", "silt", "soc", "phh2o", "nitrogen", "bdod", "cec", "cfvo", "ocd"]
DEPTHS = ["0-5cm", "5-15cm", "15-30cm", "30-60cm"]
soil = []
for name, z in zones.items():
    q = "&".join([f"property={p}" for p in PROPS] + [f"depth={d}" for d in DEPTHS] + ["value=mean", "value=uncertainty"])
    url = f"https://rest.isric.org/soilgrids/v2.0/properties/query?lon={z['lon']}&lat={z['lat']}&{q}"
    j = None
    for attempt in range(4):
        try:
            r = requests.get(url, timeout=90)
            if r.ok and r.headers.get("content-type", "").startswith("application/json"):
                j = r.json(); break
        except requests.RequestException:
            pass
        time.sleep(15)
    if j is None:
        print("soil", name, "SoilGrids API no responde", flush=True); continue
    for layer in j["properties"]["layers"]:
        d = layer["unit_measure"]["d_factor"]
        for dep in layer["depths"]:
            v = dep["values"]
            soil.append({"zona": name, "propiedad": layer["name"], "profundidad": dep["label"],
                         "valor": None if v["mean"] is None else v["mean"] / d,
                         "unidad": layer["unit_measure"]["target_units"],
                         "incertidumbre": v.get("uncertainty")})
    print("soil", name, "ok", flush=True)
if soil:
    pd.DataFrame(soil).to_csv(ROOT / "raw/soil.csv", index=False)
