"""POWER diario -> processed/power_monthly_<zona>.csv con climatología 1991-2020 y anomalías.
Añade ONI (NOAA CPC) -> processed/oni.csv y columna enso (nino/nina/neutral)."""
import json, sys, pathlib, io, requests, pandas as pd, numpy as np
ROOT = pathlib.Path(sys.argv[1])
zones = json.loads((ROOT / "scripts/zones.json").read_text())
LAMBDA = 2.45  # MJ/kg: calor latente de vaporización -> EVPTRNS (MJ/m2/día) / 2.45 = mm/día

# ONI (Oceanic Niño Index), NOAA CPC
txt = requests.get("https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt", timeout=60).text
oni = pd.read_csv(io.StringIO(txt), sep=r"\s+")
season_mid = {"DJF":1,"JFM":2,"FMA":3,"MAM":4,"AMJ":5,"MJJ":6,"JJA":7,"JAS":8,"ASO":9,"SON":10,"OND":11,"NDJ":12}
oni["month"] = oni["SEAS"].map(season_mid)
oni["date"] = pd.to_datetime(dict(year=oni["YR"], month=oni["month"], day=1))
oni = oni.set_index("date")[["ANOM"]].rename(columns={"ANOM": "oni"})
oni["enso"] = np.select([oni.oni >= 0.5, oni.oni <= -0.5], ["nino", "nina"], "neutral")
oni.to_csv(ROOT / "processed/oni.csv")
print("ONI", oni.index.min().date(), "->", oni.index.max().date())

LAPSE = -6.5 / 1000  # °C por metro: gradiente estándar de la atmósfera (ICAO)
terrain = pd.read_csv(ROOT / "raw/terrain.csv").set_index("zona")


def et0_fao56(d, lat_deg, z):
    """ET0 diaria (mm) Penman-Monteith FAO-56 (Allen et al. 1998, ec. 6), con Tmax/Tmin corregidas,
    RH2M, WS2M (viento a 2 m) y radiación solar ALLSKY_SFC_SW_DWN (MJ/m2/día)."""
    tmax, tmin = d["tmax_c"], d["tmin_c"]
    tmean = (tmax + tmin) / 2
    P = 101.3 * ((293 - 0.0065 * z) / 293) ** 5.26                        # ec. 7
    gamma = 0.000665 * P                                                  # ec. 8
    es_f = lambda t: 0.6108 * np.exp(17.27 * t / (t + 237.3))             # ec. 11
    es = (es_f(tmax) + es_f(tmin)) / 2                                    # ec. 12
    ea = d["RH2M"] / 100 * es                                             # RH media (aprox. ec. 19)
    delta = 4098 * es_f(tmean) / (tmean + 237.3) ** 2                     # ec. 13
    J = d.index.day_of_year.values
    phi = np.radians(lat_deg)
    dr = 1 + 0.033 * np.cos(2 * np.pi * J / 365)                          # ec. 23
    dec = 0.409 * np.sin(2 * np.pi * J / 365 - 1.39)                      # ec. 24
    ws = np.arccos(-np.tan(phi) * np.tan(dec))                            # ec. 25
    Ra = 24 * 60 / np.pi * 0.0820 * dr * (ws * np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.sin(ws))  # ec. 21
    Rs = d["ALLSKY_SFC_SW_DWN"]
    Rso = (0.75 + 2e-5 * z) * Ra                                          # ec. 37
    Rns = (1 - 0.23) * Rs                                                 # ec. 38
    sigma = 4.903e-9
    Rnl = sigma * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2 * (0.34 - 0.14 * np.sqrt(ea)) * (1.35 * np.clip(Rs / Rso, 0.3, 1.0) - 0.35)  # ec. 39
    Rn = Rns - Rnl
    u2 = d["WS2M"]
    et0 = (0.408 * delta * Rn + gamma * 900 / (tmean + 273) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2))  # ec. 6
    return et0.clip(lower=0)


corr_log = {}
for name in zones:
    d = pd.read_csv(ROOT / f"raw/power_{name}.csv", index_col=0, parse_dates=True)
    d["et_mm"] = d["EVPTRNS"] / LAMBDA
    # Corrección por altura: la celda de POWER (~0.5°) puede incluir estribaciones andinas.
    z_cell = 44330 * (1 - (d["PS"].mean() / 101.325) ** (1 / 5.255))      # altura barométrica de la celda
    z_real = float(terrain.loc[name, "elev_media_m"])
    dT = LAPSE * (z_real - z_cell)
    d["tmax_c"], d["tmin_c"] = d["T2M_MAX"] + dT, d["T2M_MIN"] + dT
    d["et0_mm"] = et0_fao56(d, zones[name]["lat"], z_real)
    corr_log[name] = {"cell_elevation_m": round(z_cell), "zone_elevation_m": z_real, "temperature_shift_c": round(dT, 2)}
    m = pd.DataFrame({
        "lluvia_mm": d["PRECTOTCORR"].resample("MS").sum(min_count=25),
        "dias_lluvia_fuerte_20mm": (d["PRECTOTCORR"] >= 20).resample("MS").sum(),
        "tmax_media_c": d["tmax_c"].resample("MS").mean(),
        "tmin_media_c": d["tmin_c"].resample("MS").mean(),
        "dias_calor_33c": (d["tmax_c"] >= 33).resample("MS").sum(),
        "dias_calor_35c": (d["tmax_c"] >= 35).resample("MS").sum(),
        "et0_mm": d["et0_mm"].resample("MS").sum(min_count=25),
        "hum_rel_media": d["RH2M"].resample("MS").mean(),
        "radiacion_mj": d["ALLSKY_SFC_SW_DWN"].resample("MS").mean(),
        "humedad_suelo_sup": d["GWETTOP"].resample("MS").mean(),
        "humedad_suelo_raiz": d["GWETROOT"].resample("MS").mean(),
        "et_mm": d["et_mm"].resample("MS").sum(min_count=25),
    })
    m["balance_hidrico_mm"] = m["lluvia_mm"] - m["et0_mm"]  # lluvia menos demanda de referencia (FAO-56)
    # Mes incompleto (p. ej. el mes en curso): sin lluvia completa no se cuentan días de calor ni de lluvia fuerte.
    incompleto = m["lluvia_mm"].isna()
    m.loc[incompleto, ["dias_lluvia_fuerte_20mm", "dias_calor_33c", "dias_calor_35c"]] = float("nan")
    base = m.loc["1991":"2020"]
    clim = base.groupby(base.index.month).mean()
    for c in ["lluvia_mm", "tmax_media_c", "humedad_suelo_raiz", "balance_hidrico_mm"]:
        m[c + "_anom"] = m[c] - m.index.month.map(clim[c]).values
    m = m.join(oni, how="left")
    m.index.name = "mes"
    m.round(3).to_csv(ROOT / f"processed/power_monthly_{name}.csv")
    clim.round(2).to_csv(ROOT / f"processed/climatologia_1991_2020_{name}.csv")
    print(name, m.shape, "| lluvia anual 1991-2020:", round(clim["lluvia_mm"].sum()), "mm | ET0 anual:",
          round(clim["et0_mm"].sum()), "mm | Tmax media:", round(clim["tmax_media_c"].mean(), 1),
          "| Tmin media:", round(clim["tmin_media_c"].mean(), 1), "|", corr_log[name])
(ROOT / "processed/power_corrections.json").write_text(json.dumps(corr_log, indent=1))
