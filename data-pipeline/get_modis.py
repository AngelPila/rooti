"""MODIS 13Q1 v061 (NDVI/EVI 250 m, 16 días), Terra + Aqua, vía Microsoft Planetary Computer.

Robusto ante el vencimiento de los links firmados (~1 h): busca y firma AÑO POR AÑO,
lee con fail_on_error=True y reintenta. Distingue "sin pixeles limpios" (nubes) de "falló la lectura".

Uso: python get_modis.py /data [zona1,zona2] [año_ini] [año_fin]
Salida: raw/modis_<zona>.csv  (columnas: date, platform, ndvi, evi, pct_pixeles_confiables)
        raw/modis_fallos.csv  (años/plataformas que no se pudieron leer, si hay)
"""
import json
import sys
import time
import pathlib

import numpy as np
import odc.stac
import pandas as pd
import planetary_computer
import pystac_client

ROOT = pathlib.Path(sys.argv[1])
zones = json.loads((ROOT / "scripts/zones.json").read_text())
if len(sys.argv) > 2 and sys.argv[2]:
    zones = {k: v for k, v in zones.items() if k in sys.argv[2].split(",")}
Y0 = int(sys.argv[3]) if len(sys.argv) > 3 else 2000
Y1 = int(sys.argv[4]) if len(sys.argv) > 4 else 2026
HALF = 0.025  # caja de ~5.5 km
BANDS = ["250m_16_days_NDVI", "250m_16_days_EVI", "250m_16_days_pixel_reliability"]


def load_year(bbox, platform, year):
    cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1",
                                    modifier=planetary_computer.sign_inplace)  # firma fresca
    items = list(cat.search(collections=["modis-13Q1-061"], bbox=bbox,
                            datetime=f"{year}-01-01/{year}-12-31",
                            query={"platform": {"eq": platform}}).items())
    if not items:
        return None
    ds = odc.stac.load(items, bands=BANDS, bbox=bbox, resolution=250, groupby="solar_day",
                       dtype="float32", fail_on_error=True, chunks={})
    ds = ds.compute(scheduler="threads", num_workers=24)
    ok = ds["250m_16_days_pixel_reliability"].isin([0, 1])
    return pd.DataFrame({
        "date": pd.to_datetime(ds.time.values).date,
        "platform": platform,
        "ndvi": (ds["250m_16_days_NDVI"].where(ok) * 0.0001).mean(["x", "y"]).values,
        "evi": (ds["250m_16_days_EVI"].where(ok) * 0.0001).mean(["x", "y"]).values,
        "pct_pixeles_confiables": (ok.mean(["x", "y"]) * 100).round(1).values,
    })


fails = []
for name, z in zones.items():
    bbox = [z["lon"] - HALF, z["lat"] - HALF, z["lon"] + HALF, z["lat"] + HALF]
    parts = []
    for platform in ["terra", "aqua"]:
        for year in range(Y0, Y1 + 1):
            df = None
            for attempt in range(3):
                try:
                    df = load_year(bbox, platform, year)
                    break
                except Exception as e:  # noqa: BLE001 - registrar y reintentar
                    err = f"{type(e).__name__}: {str(e)[:120]}"
                    time.sleep(10 * (attempt + 1))
            else:
                fails.append({"zona": name, "platform": platform, "year": year, "error": err})
                print(f"  FALLO {name} {platform} {year}: {err}", flush=True)
            if df is not None:
                parts.append(df)
        print(f"{name} {platform} listo", flush=True)
    out = pd.concat(parts).drop_duplicates(["date", "platform"]).sort_values(["date", "platform"])
    out.to_csv(ROOT / f"raw/modis_{name}.csv", index=False)
    print(f"{name}: {len(out)} imágenes | con dato limpio: {int(out.ndvi.notna().sum())} "
          f"| {out.date.min()} -> {out.date.max()}", flush=True)

if fails:
    pd.DataFrame(fails).to_csv(ROOT / f"raw/modis_fallos_{'_'.join(zones)}.csv", index=False)
print("FIN. Fallos:", len(fails), flush=True)
