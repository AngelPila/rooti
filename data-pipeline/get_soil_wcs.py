"""SoilGrids 2.0 via WCS (maps.isric.org): raster de la caja ~5 km, mediana de pixeles válidos.
-> raw/soilgrids/<zona>_<prop>_<prof>.tif y raw/soil.csv (unidades convencionales)."""
import json, sys, pathlib, time, numpy as np, pandas as pd, requests, rasterio
from rasterio.io import MemoryFile
import os
ROOT = pathlib.Path(sys.argv[1]); HALF = float(os.environ.get("HALF", "0.025"))
zones = json.loads((ROOT / "scripts/zones.json").read_text())
if len(sys.argv) > 2: zones = {k: v for k, v in zones.items() if k in sys.argv[2].split(",")}
if len(sys.argv) > 3: PROPS_ONLY = sys.argv[3].split(",")
else: PROPS_ONLY = None
# propiedad: (factor para convertir a unidad convencional, unidad)
PROPS = {"clay": (10, "%"), "sand": (10, "%"), "silt": (10, "%"), "soc": (10, "g/kg"),
         "phh2o": (10, "pH"), "nitrogen": (100, "g/kg"), "bdod": (100, "g/cm3"), "cec": (10, "cmol(c)/kg")}
DEPTHS = ["0-5cm", "5-15cm", "15-30cm", "30-60cm"]
out_dir = ROOT / "raw/soilgrids"; out_dir.mkdir(parents=True, exist_ok=True)
rows = []
for name, z in zones.items():
    for prop, (fac, unit) in PROPS.items():
        if PROPS_ONLY and prop not in PROPS_ONLY: continue
        for dep in DEPTHS:
            url = ("https://maps.isric.org/mapserv?map=/map/{p}.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage"
                   "&COVERAGEID={p}_{d}_mean&FORMAT=image/tiff"
                   "&SUBSET=long({x0},{x1})&SUBSET=lat({y0},{y1})"
                   "&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326"
                   "&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326").format(
                p=prop, d=dep, x0=z["lon"]-HALF, x1=z["lon"]+HALF, y0=z["lat"]-HALF, y1=z["lat"]+HALF)
            data = None
            for attempt in range(3):
                try:
                    r = requests.get(url, timeout=120)
                    if r.ok and r.content[:2] in (b"II", b"MM"):
                        data = r.content; break
                except requests.RequestException:
                    pass
                time.sleep(5)
            if data is None:
                rows.append({"zona": name, "propiedad": prop, "profundidad": dep, "valor": None, "unidad": unit, "pct_pixeles_validos": 0}); continue
            (out_dir / f"{name}_{prop}_{dep}.tif").write_bytes(data)
            with MemoryFile(data) as mf, mf.open() as src:
                a = src.read(1).astype("float64"); nd = src.nodata
            valid = a[(a != nd) & (a > 0)] if nd is not None else a[a > 0]
            rows.append({"zona": name, "propiedad": prop, "profundidad": dep,
                         "valor": round(float(np.median(valid)) / fac, 3) if valid.size else None,
                         "unidad": unit, "pct_pixeles_validos": round(100 * valid.size / a.size, 1)})
        print(name, prop, "ok", flush=True)
new = pd.DataFrame(rows)
old = pd.read_csv(ROOT / "raw/soil.csv") if (ROOT / "raw/soil.csv").exists() and PROPS_ONLY else None
if old is not None:
    key = ["zona", "propiedad", "profundidad"]
    new = pd.concat([old.set_index(key).drop(new.set_index(key).index, errors="ignore").reset_index(), new])
new.to_csv(ROOT / "raw/soil.csv", index=False)
