"""Genera app/data/<zona>.json a partir de ../fieldshift-data (POWER, ONI, MODIS, SoilGrids, DEM).

Uso (Docker spaceapps-geo):
  docker run --rm -u $(id -u):$(id -g) -v "$HOME/fieldshift-data:/src:ro" -v "$HOME/fieldshift:/proj" \
      spaceapps-geo python /proj/pipeline/build_app_data.py /src /proj/app/data
"""
import json
import pathlib
import sys

import numpy as np
import pandas as pd
import statsmodels.api as sm

SRC = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
zones = json.loads((SRC / "scripts/zones.json").read_text())

MONTHLY_VARS = {
    "rain_mm": "lluvia_mm",
    "et0_mm": "et0_mm",
    "water_balance_mm": "balance_hidrico_mm",
    "tmax_c": "tmax_media_c",
    "tmin_c": "tmin_media_c",
    "heat_days_33c": "dias_calor_33c",
    "heavy_rain_days_20mm": "dias_lluvia_fuerte_20mm",
    "heat_days_35c": "dias_calor_35c",
    "soil_moisture_root": "humedad_suelo_raiz",
    "soil_moisture_top": "humedad_suelo_sup",
    "humidity_pct": "hum_rel_media",
    "radiation_mj": "radiacion_mj",
}


def r(x, n=2):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), n)


def monthly_profile(df):
    g = df.groupby(df.index.month)
    return {k: [r(g[v].mean().get(m)) for m in range(1, 13)] for k, v in MONTHLY_VARS.items()}


def trend(series):
    """OLS lineal sobre valores anuales: pendiente por década, p-valor e IC 95 %."""
    s = series.dropna()
    x = sm.add_constant(s.index.values.astype(float))
    fit = sm.OLS(s.values, x).fit()
    lo, hi = fit.conf_int(alpha=0.05)[1]
    return {"per_decade": r(fit.params[1] * 10, 3), "ci95_per_decade": [r(lo * 10, 3), r(hi * 10, 3)],
            "p_value": r(fit.pvalues[1], 4), "significant_95": bool(fit.pvalues[1] < 0.05),
            "years": [int(s.index.min()), int(s.index.max())]}


def ndvi_block(name):
    f = SRC / f"raw/modis_{name}.csv"
    if not f.exists():
        return {"available": False}
    m = pd.read_csv(f, parse_dates=["date"]).set_index("date").sort_index()
    m = m.loc["2003":"2023"]  # años completos en Planetary Computer
    clean = m.dropna(subset=["ndvi"])
    g = clean.groupby(clean.index.month)
    BARE = 0.35  # NDVI bajo: suelo desnudo o rastrojo (umbral documentado en README)
    return {
        "available": True,
        "source": "MODIS MOD13Q1/MYD13Q1 v061, 250 m, 2003-2023, clean pixels only",
        "ndvi_median": [r(g["ndvi"].median().get(m_), 3) for m_ in range(1, 13)],
        "ndvi_p25": [r(g["ndvi"].quantile(0.25).get(m_), 3) for m_ in range(1, 13)],
        "ndvi_p75": [r(g["ndvi"].quantile(0.75).get(m_), 3) for m_ in range(1, 13)],
        "bare_soil_probability": [r((g["ndvi"].apply(lambda s: (s < BARE).mean())).get(m_), 2) for m_ in range(1, 13)],
        "bare_threshold": BARE,
        "clean_obs_per_month": [int(g.size().get(m_, 0)) for m_ in range(1, 13)],
        "pct_dates_with_clean_data": r(100 * len(clean) / max(len(m), 1), 1),
    }


def soil_block(name):
    s = pd.read_csv(SRC / "raw/soil.csv")
    s = s[s.zona == name]
    w = {"0-5cm": 5, "5-15cm": 10, "15-30cm": 15}  # media ponderada 0-30 cm
    top = s[s.profundidad.isin(w)].copy()
    top["w"] = top.profundidad.map(w)
    out = {}
    for prop, g in top.groupby("propiedad"):
        g = g.dropna(subset=["valor"])
        if len(g):
            out[prop] = {"value_0_30cm": r((g.valor * g.w).sum() / g.w.sum(), 2), "unit": g.unidad.iloc[0],
                         "pct_valid_pixels": r(g.pct_pixeles_validos.mean(), 1),
                         "low_confidence": bool(g.pct_pixeles_validos.mean() < 25)}
    clay, sand = out.get("clay", {}).get("value_0_30cm"), out.get("sand", {}).get("value_0_30cm")
    out["texture_hint"] = (None if clay is None else
                           "clayey (holds water, risk of waterlogging)" if clay >= 35 else
                           "sandy (drains fast, low water holding)" if sand and sand >= 50 else
                           "loamy (balanced)")
    out["source"] = "ISRIC SoilGrids 2.0, 250 m, median of valid pixels around the zone"
    return out


oni = pd.read_csv(SRC / "processed/oni.csv", parse_dates=["date"]).set_index("date")
index = []
for name, z in zones.items():
    d = pd.read_csv(SRC / f"processed/power_monthly_{name}.csv", parse_dates=["mes"]).set_index("mes")
    base = d.loc["1991":"2020"]
    full = d.loc["1981":"2025"]
    # Año ENSO = jul(y) .. jun(y+1); fase según el ONI máximo/mínimo de ese periodo
    enso_year = d.index.year - (d.index.month < 7)
    peak = d.groupby(enso_year)["oni"].agg(["max", "min"])
    def phase(y):
        mx, mn = peak.loc[y, "max"], peak.loc[y, "min"]
        if pd.isna(mx): return None
        if mx >= 1.5: return "strong_nino"
        if mx >= 0.5: return "nino"
        if mn <= -0.5: return "nina"
        return "neutral"
    d["enso_year"] = enso_year
    d["enso_phase"] = [phase(y) for y in enso_year]
    full = d.loc["1981-07":"2025-06"]
    enso = {}
    for ph in ["nina", "neutral", "nino", "strong_nino"]:
        sub = full[full.enso_phase == ph]
        yrs = sorted(sub.enso_year.unique().tolist())
        enso[ph] = {"n_years": len(yrs), "years": [f"{y}-{y+1}" for y in yrs], **monthly_profile(sub)}
    # Year types the farmer understands: terciles of rainy-season (Jan-May) rain, 1981-2025
    wet_rain = d.loc["1981":"2025"][d.loc["1981":"2025"].index.month <= 5].groupby(lambda t: t.year)["lluvia_mm"].sum()
    q1, q2 = wet_rain.quantile([1 / 3, 2 / 3])
    tercile = {y: ("dry" if v <= q1 else "wet" if v > q2 else "normal") for y, v in wet_rain.items()}
    d["year_type"] = [tercile.get(y) for y in d.index.year]
    year_types = {}
    for t in ["dry", "normal", "wet"]:
        sub = d.loc["1981":"2025"][d.loc["1981":"2025"].year_type == t]
        yrs = sorted({int(y) for y in sub.index.year})
        year_types[t] = {"n_years": len(yrs), "years": yrs, "rainy_season_mm_mean": r(wet_rain[[y for y in yrs]].mean(), 0), **monthly_profile(sub)}
    year_types["definition"] = (f"Terciles of January-May rain 1981-2025 (NASA POWER): dry <= {q1:.0f} mm, "
                                f"wet > {q2:.0f} mm")
    enso["definition"] = ("ENSO year = July..June; strong Nino if max ONI >= 1.5, Nino if >= 0.5, "
                          "Nina if min ONI <= -0.5 (and not Nino), otherwise neutral. Source: NOAA CPC ONI")
    annual = d.loc["1981":"2025"].resample("YS").agg({"lluvia_mm": "sum", "tmax_media_c": "mean",
                                                      "dias_calor_33c": "sum", "humedad_suelo_raiz": "mean"})
    annual.index = annual.index.year
    recent = d.loc["2024-11":].copy()

    t = pd.read_csv(SRC / "raw/terrain.csv").set_index("zona").loc[name]
    data = {
        "zone": name, "lat": z["lat"], "lon": z["lon"], "description": z["desc"],
        "climatology_1991_2020": monthly_profile(base),
        "enso_composites_1981_2025": enso,
        "year_types": year_types,
        "trends_1981_2025": {
            "annual_rain_mm": trend(annual["lluvia_mm"]),
            "mean_tmax_c": trend(annual["tmax_media_c"]),
            "heat_days_33c_per_year": trend(annual["dias_calor_33c"]),
            "root_zone_soil_moisture": trend(annual["humedad_suelo_raiz"]),
        },
        "last_24_months": {
            "months": [m.strftime("%Y-%m") for m in recent.index],
            "rain_mm": [r(x) for x in recent.lluvia_mm], "rain_anomaly_mm": [r(x) for x in recent.lluvia_mm_anom],
            "tmax_anomaly_c": [r(x) for x in recent.tmax_media_c_anom],
            "soil_moisture_root_anomaly": [r(x, 3) for x in recent.humedad_suelo_raiz_anom],
            "oni": [r(x) for x in recent.oni], "enso": [None if pd.isna(x) else x for x in recent.enso],
        },
        "years": {
            str(y): {k: [r(d.loc[f"{y}-{m:02d}", v].iloc[0]) if len(d.loc[f"{y}-{m:02d}"]) else None for m in range(1, 13)]
                     for k, v in MONTHLY_VARS.items()} | {"oni_peak": r(d[d.enso_year == y]["oni"].max())}
            for y in range(2001, 2025)
        },
        "ndvi": ndvi_block(name),
        "soil": soil_block(name),
        "terrain": {"elevation_mean_m": r(t.elev_media_m, 1), "slope_mean_deg": r(t.pendiente_media_grados),
                    "pct_area_slope_gt_8deg": r(t.pct_area_pendiente_mayor_8, 1),
                    "source": "Copernicus DEM GLO-30 (ESA)"},
        "provenance": {
            "climate": "NASA POWER daily (community AG), ~0.5 deg grid; soil moisture is MERRA-2 model output",
            "corrections": json.loads((SRC / "processed/power_corrections.json").read_text())[name],
            "et0_method": "FAO-56 Penman-Monteith reference evapotranspiration from POWER daily Tmax/Tmin (elevation-corrected), RH, 2 m wind and solar radiation",
            "enso": "NOAA CPC Oceanic Nino Index (ONI); Nino >= +0.5, Nina <= -0.5, strong Nino >= +1.5",
            "caveats": ["The POWER grid cell for this zone sits at a different elevation than the fields (Andean foothills for Babahoyo and Quevedo); temperatures were corrected with the standard lapse rate (-6.5 °C/km), rainfall could not be and needs GPM IMERG (0.1°)",
                        "Values describe the region (~50 km), not an individual field",
                        "Corrected daytime maxima may still run 2-3 °C warm (known MERRA-2 bias); "
                        "the engine judges heat by change against normal, not absolute thresholds"],
        },
    }
    (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    index.append({"zone": name, "lat": z["lat"], "lon": z["lon"], "description": z["desc"]})
    tr = data["trends_1981_2025"]
    print(f"{name}: lluvia anual {tr['annual_rain_mm']['per_decade']} mm/década (p={tr['annual_rain_mm']['p_value']}) | "
          f"Tmax {tr['mean_tmax_c']['per_decade']} °C/década (p={tr['mean_tmax_c']['p_value']}) | "
          f"años Niño fuerte: {enso['strong_nino']['years']} | NDVI: {data['ndvi']['available']}")
(OUT / "zones.json").write_text(json.dumps(index, ensure_ascii=False, indent=1))
