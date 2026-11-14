// Monthly climate for any point on Earth from NASA POWER (community AG), 1981 to last month.
// Rain is POWER's corrected precipitation; reference evapotranspiration (ET0) is FAO-56 Penman-Monteith
// computed here from POWER's monthly means, the same method the pilot-zone pipeline uses on daily data.
const API = "https://power.larc.nasa.gov/api/temporal";
const MONTHLY = "PRECTOTCORR,T2M,T2M_RANGE,RH2M,WS2M,ALLSKY_SFC_SW_DWN";
const DAILY = "PRECTOTCORR,T2M,T2M_MAX,T2M_MIN,RH2M,WS2M,ALLSKY_SFC_SW_DWN";
export const FIRST_YEAR = 1981;

const pad = (n) => String(n).padStart(2, "0");
export const mkey = (y, m) => `${y}-${pad(m)}`;
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const es0 = (t) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3));

// FAO-56 Penman-Monteith, mm/day, from monthly means (G = 0 at monthly step).
export function et0Day({ t, tmax, tmin, rh, ws, rs }, lat, elev, m) {
  if ([t, tmax, tmin, rh, ws, rs].some((v) => v == null || Number.isNaN(v))) return null;
  const P = 101.3 * ((293 - 0.0065 * elev) / 293) ** 5.26, gamma = 0.000665 * P;
  const es = (es0(tmax) + es0(tmin)) / 2, ea = Math.min(es, (rh / 100) * es);
  const delta = (4098 * es0(t)) / (t + 237.3) ** 2;
  const J = Math.round(30.4 * m - 15), phi = (lat * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * J) / 365), dec = 0.409 * Math.sin((2 * Math.PI * J) / 365 - 1.39);
  const ws_ = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(dec))));
  const Ra = ((24 * 60) / Math.PI) * 0.082 * dr * (ws_ * Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.sin(ws_));
  const Rso = Math.max(0.1, (0.75 + 2e-5 * elev) * Ra);
  const Rnl = 4.903e-9 * (((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2) * (0.34 - 0.14 * Math.sqrt(ea)) * (1.35 * Math.min(rs / Rso, 1) - 0.35);
  const Rn = 0.77 * rs - Rnl;
  const et0 = (0.408 * delta * Rn + gamma * (900 / (t + 273)) * ws * (es - ea)) / (delta + gamma * (1 + 0.34 * ws));
  return Math.max(0, et0);
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`POWER ${r.status}`);
  return r.json();
}

export async function fetchClimate(lat, lon) {
  const la = +lat.toFixed(2), lo = +lon.toFixed(2);
  const cacheKey = `rooti:clim:v1:${(Math.round(la * 4) / 4).toFixed(2)},${(Math.round(lo * 4) / 4).toFixed(2)}`;
  try { const c = JSON.parse(localStorage.getItem(cacheKey)); if (c && Date.now() - c.at < 7 * 864e5) return c.data; } catch { /* no cache */ }

  const now = new Date(), y = now.getUTCFullYear();
  const yest = new Date(now - 864e5), ymd = `${yest.getUTCFullYear()}${pad(yest.getUTCMonth() + 1)}${pad(yest.getUTCDate())}`;
  const q = `community=AG&longitude=${lo}&latitude=${la}&format=JSON`;
  let monthly, lastFull = y - 1;
  try { monthly = await getJSON(`${API}/monthly/point?parameters=${MONTHLY}&${q}&start=${FIRST_YEAR}&end=${lastFull}`); }
  catch { lastFull = y - 2; monthly = await getJSON(`${API}/monthly/point?parameters=${MONTHLY}&${q}&start=${FIRST_YEAR}&end=${lastFull}`); }
  const daily = await getJSON(`${API}/daily/point?parameters=${DAILY}&${q}&start=${lastFull + 1}0101&end=${ymd}`).catch(() => null);

  const elev = monthly.geometry?.coordinates?.[2] ?? 0, months = {};
  const P = monthly.properties.parameter, ok = (v) => v != null && v > -900;
  for (const k of Object.keys(P.T2M)) {
    const yy = +k.slice(0, 4), mm = +k.slice(4);
    if (mm > 12) continue;
    const t = P.T2M[k], rng = P.T2M_RANGE[k], c = { t, tmax: t + rng / 2, tmin: t - rng / 2, rh: P.RH2M[k], ws: P.WS2M[k], rs: P.ALLSKY_SFC_SW_DWN[k] };
    if (![t, rng, c.rh, c.ws, c.rs, P.PRECTOTCORR[k]].every(ok)) continue;
    const d = daysIn(yy, mm), e = et0Day(c, la, elev, mm);
    months[mkey(yy, mm)] = { rain: P.PRECTOTCORR[k] * d, et0: e == null ? null : e * d, t, tmax: c.tmax, tmin: c.tmin };
  }
  // Recent months from daily data: a month counts only when it is (nearly) complete.
  if (daily) {
    const D = daily.properties.parameter, byM = {};
    for (const k of Object.keys(D.T2M)) {
      const vals = { rain: D.PRECTOTCORR[k], t: D.T2M[k], tmax: D.T2M_MAX[k], tmin: D.T2M_MIN[k], rh: D.RH2M[k], ws: D.WS2M[k], rs: D.ALLSKY_SFC_SW_DWN[k] };
      if (!Object.values(vals).every(ok)) continue;
      (byM[k.slice(0, 6)] ||= []).push(vals);
    }
    for (const [k, arr] of Object.entries(byM)) {
      const yy = +k.slice(0, 4), mm = +k.slice(4), d = daysIn(yy, mm);
      if (arr.length < d - 2) continue;
      const avg = (f) => arr.reduce((s, v) => s + v[f], 0) / arr.length;
      const c = { t: avg("t"), tmax: avg("tmax"), tmin: avg("tmin"), rh: avg("rh"), ws: avg("ws"), rs: avg("rs") };
      const e = et0Day(c, la, elev, mm);
      months[mkey(yy, mm)] = { rain: avg("rain") * d, et0: e == null ? null : e * d, t: c.t, tmax: c.tmax, tmin: c.tmin };
    }
  }
  const keys = Object.keys(months).sort();
  const data = { lat: la, lon: lo, elev, months, first: keys[0], last: keys[keys.length - 1], lastFullYear: lastFull };
  try { localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data })); } catch { /* quota */ }
  return data;
}
