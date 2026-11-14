"""NASA POWER (comunidad AG): diario 1981-hoy para cada zona -> raw/power_<zona>.csv"""
import json, sys, time, pathlib, requests, pandas as pd
ROOT = pathlib.Path(sys.argv[1])
zones = json.loads((ROOT / "scripts/zones.json").read_text())
PARAMS = ("T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M,ALLSKY_SFC_SW_DWN,WS2M,"
          "GWETTOP,GWETROOT,GWETPROF,EVPTRNS,T2MDEW,PS,QV2M")
for name, z in zones.items():
    url = ("https://power.larc.nasa.gov/api/temporal/daily/point"
           f"?parameters={PARAMS}&community=AG&latitude={z['lat']}&longitude={z['lon']}"
           "&start=19810101&end=20261112&format=JSON")
    for attempt in range(3):
        r = requests.get(url, timeout=300)
        if r.ok: break
        time.sleep(10)
    r.raise_for_status()
    j = r.json()
    df = pd.DataFrame(j["properties"]["parameter"])
    df.index = pd.to_datetime(df.index, format="%Y%m%d"); df.index.name = "date"
    df = df.replace(j["header"].get("fill_value", -999), pd.NA)
    df.to_csv(ROOT / f"raw/power_{name}.csv")
    meta = {k: {"name": v["longname"], "units": v["units"]} for k, v in j["parameters"].items()}
    (ROOT / "raw/power_variables.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))
    print(name, df.shape, df.index.min().date(), df.index.max().date(), "nulos:", int(df.isna().sum().sum()))
