"""Seasonal outlook: will next rainy season (Jan-May) be dry, normal or wet?

Predictors: October sea-surface-temperature anomalies of Nino 1+2 (the ocean right off Ecuador)
and Nino 3.4 (ONI region), NOAA CPC. Target: tercile of Jan-May rain for each zone (NASA POWER).
Model: multinomial logistic regression, validated leave-one-year-out against climatology (1/3 each).
Farmer view: the 10 past years whose ocean looked most like this October, and what their rainy
season turned out to be.

Usage (Docker spaceapps-geo):
  python pipeline/outlook.py <fieldshift-data dir> <app/data dir>
"""
import io
import json
import pathlib
import sys

import numpy as np
import pandas as pd
import requests
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

SRC, OUT = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
CLASSES = ["dry", "normal", "wet"]
K_ANALOGS = 10
WARM = 1.5  # degC, October Nino 1+2 anomaly considered "strong coastal warming"

txt = requests.get("https://www.cpc.ncep.noaa.gov/data/indices/sstoi.indices", timeout=60).text
sst = pd.read_csv(io.StringIO(txt), sep=r"\s+")
sst.columns = ["yr", "mon", "n12", "n12_anom", "n3", "n3_anom", "n4", "n4_anom", "n34", "n34_anom"]
octo = sst[sst.mon == 10].set_index("yr")[["n12_anom", "n34_anom"]]
issue_year = int(octo.index.max())                 # latest October available
target_year = issue_year + 1                       # rainy season we forecast
x_now = octo.loc[[issue_year]].values


def rps(probs, obs_idx):
    """Ranked probability score for ordered categories (lower is better)."""
    cp = np.cumsum(probs, axis=1)
    co = np.cumsum(np.eye(3)[obs_idx], axis=1)
    return np.mean(np.sum((cp - co) ** 2, axis=1))


zones = json.loads((SRC / "scripts/zones.json").read_text())
result = {"issued": f"{issue_year}-10", "target_rainy_season": f"Jan-May {target_year}",
          "predictors_now": {"nino12_anom_c": round(float(x_now[0, 0]), 2), "nino34_anom_c": round(float(x_now[0, 1]), 2)},
          "method": ("Analog years: when October Nino 1+2 (NOAA CPC) shows strong coastal warming (>= +1.5 C), all past years "
                     "that warm are counted by their January-May rain tercile (NASA POWER); otherwise the 10 most similar "
                     "Octobers. A multinomial logistic regression on Nino 1+2 and Nino 3.4 was tested leave-one-year-out "
                     "and does NOT beat climatology (skill block), so it is reported but not used for the farmer view."),
          "zones": {}}

for name in zones:
    m = pd.read_csv(SRC / f"processed/power_monthly_{name}.csv", parse_dates=["mes"]).set_index("mes")
    rain = m[m.index.month <= 5].groupby(lambda t: t.year)["lluvia_mm"].agg(["sum", "count"])
    rain = rain[rain["count"] == 5]["sum"]
    years = [y for y in rain.index if (y - 1) in octo.index and y <= issue_year]
    y_rain = rain.loc[years]
    q1, q2 = y_rain.quantile([1 / 3, 2 / 3])
    y_cls = np.array([0 if v <= q1 else 2 if v > q2 else 1 for v in y_rain])
    X = octo.loc[[y - 1 for y in years]].values

    # leave-one-year-out validation
    loo = np.zeros((len(years), 3))
    for i in range(len(years)):
        tr = np.arange(len(years)) != i
        sc = StandardScaler().fit(X[tr])
        clf = LogisticRegression(C=1.0, max_iter=1000).fit(sc.transform(X[tr]), y_cls[tr])
        p = np.zeros(3); p[clf.classes_] = clf.predict_proba(sc.transform(X[[i]]))[0]
        loo[i] = p
    acc = float(np.mean(loo.argmax(1) == y_cls))
    rps_model, rps_clim = rps(loo, y_cls), rps(np.full((len(years), 3), 1 / 3), y_cls)
    wet_hits = int(np.sum((loo.argmax(1) == 2) & (y_cls == 2)))

    sc = StandardScaler().fit(X)
    clf = LogisticRegression(C=1.0, max_iter=1000).fit(sc.transform(X), y_cls)
    probs = np.zeros(3); probs[clf.classes_] = clf.predict_proba(sc.transform(x_now))[0]

    # Coastal Ecuador responds to strong warming right off the coast; below that the signal is noise.
    # When October Nino 1+2 is strongly warm, the analogs are ALL past years at least that warm (>= +1.5 C);
    # otherwise the K most similar years.
    n12_now = float(x_now[0, 0])
    strong = n12_now >= WARM
    if strong:
        idx = np.where(X[:, 0] >= WARM)[0]
    else:
        d = np.linalg.norm(sc.transform(X) - sc.transform(x_now), axis=1)
        idx = np.argsort(d)[:K_ANALOGS]
    analog_years = [int(years[i]) for i in idx]
    counts = {c: int(np.sum(y_cls[idx] == k)) for k, c in enumerate(CLASSES)}

    result["zones"][name] = {
        "probabilities": {c: round(float(probs[k]), 2) for k, c in enumerate(CLASSES)},
        "most_likely": CLASSES[int(probs.argmax())],
        "analogs": {"rule": f"years with October Nino 1+2 >= +{WARM} C" if strong else f"{K_ANALOGS} most similar Octobers",
                    "strong_coastal_warming": bool(strong), "nino12_by_year": {str(int(years[i])): round(float(X[i, 0]), 2) for i in idx},
                    "years": sorted(analog_years), "counts": counts,
                    "rain_mm": {str(y): round(float(y_rain.loc[y])) for y in sorted(analog_years)}},
        "terciles_mm": [round(float(q1)), round(float(q2))],
        "skill": {"years": len(years), "loo_accuracy": round(acc, 2), "chance": 0.33,
                  "rpss_vs_climatology": round(1 - rps_model / rps_clim, 2), "wet_years_caught": wet_hits,
                  "wet_years_total": int(np.sum(y_cls == 2))},
    }
    z = result["zones"][name]
    print(f"{name}: P(seco/normal/lluvioso)={z['probabilities']} | análogos {counts} {sorted(analog_years)} | "
          f"acierto LOO {acc:.0%} (azar 33%) RPSS {z['skill']['rpss_vs_climatology']}")

# Official forecasts: NOAA CPC ENSO discussion (fetched) and ERFEN Ecuador (entered by hand with its source).
import html as _html, re as _re
try:
    page = requests.get("https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml", timeout=60).text
    txt2 = _re.sub(r"\s+", " ", _html.unescape(_re.sub(r"<[^>]+>", " ", page)))
    issued = _re.search(r"issued by CLIMATE PREDICTION CENTER/NCEP/NWS (\d{1,2} \w+ \d{4})", txt2)
    status = _re.search(r"ENSO Alert System Status: ([^:]+?) Synopsis", txt2)
    synopsis = _re.search(r"Synopsis: (.+?\))\.", txt2)
    chance = _re.search(r"greater than a (\d+)% chance", txt2)
    result["official"] = {"noaa": {"issued": issued.group(1) if issued else None, "status": status.group(1).strip() if status else None,
                                   "synopsis": synopsis.group(1) if synopsis else None, "chance_pct": int(chance.group(1)) if chance else None,
                                   "url": "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml"}}
except Exception as e:  # noqa: BLE001
    result["official"] = {"noaa": {"error": str(e)[:100]}}
result["official"]["erfen"] = {"issued": "2026-11-06", "es": "El Niño muy fuerte o extraordinario, comparable con 1982-83 y 1997-98",
                               "en": "Very strong or extraordinary El Niño, comparable with 1982-83 and 1997-98",
                               "url": "https://www.primicias.ec/sociedad/fenomeno-elnino-ecuador-informe-erfen-intensidad-efectos-pronosticos-lluvias-136596/"}

# What already fell: last complete month vs its 1991-2020 normal, per zone (NASA POWER).
for name in zones:
    m = pd.read_csv(SRC / f"processed/power_monthly_{name}.csv", parse_dates=["mes"]).set_index("mes")
    last = m["lluvia_mm"].dropna().index.max()
    normal = m.loc["1991":"2020"]
    normal = normal[normal.index.month == last.month]["lluvia_mm"].mean()
    record = m[(m.index.month == last.month) & (m.index < last)]["lluvia_mm"].max()
    result["zones"][name]["last_month"] = {"month": last.strftime("%Y-%m"), "rain_mm": round(float(m.loc[last, "lluvia_mm"])),
                                           "normal_mm": round(float(normal)), "previous_record_mm": round(float(record)), "source": "NASA POWER"}
    print(name, "último mes", result["zones"][name]["last_month"])
print("NOAA", result["official"]["noaa"])
(OUT / "outlook.json").write_text(json.dumps(result, indent=1, ensure_ascii=False))
print("Octubre", issue_year, result["predictors_now"])
