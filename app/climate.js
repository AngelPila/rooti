// Daily NASA POWER weather, grouped into complete months for the planner and its calendar.
const API = "https://power.larc.nasa.gov/api/temporal";
const MONTHLY = "PRECTOTCORR,T2M,T2M_RANGE,RH2M,WS2M,ALLSKY_SFC_SW_DWN";
const DAILY = "PRECTOTCORR,T2M,T2M_MAX,T2M_MIN,RH2M,WS2M,ALLSKY_SFC_SW_DWN";
export const FIRST_YEAR = 1981;
const IMERG_POWER_START = "1998-06-01";
const DAY_MS = 864e5;

const pad = (n) => String(n).padStart(2, "0");
export const mkey = (y, m) => `${y}-${pad(m)}`;
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const es0 = (t) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3));

// Extraterrestrial radiation Ra (MJ/m2/day) for mid-month, FAO-56 eq. 21.
function extraRad(lat, m, dayOfYear) {
  const J = dayOfYear ?? Math.round(30.4 * m - 15), phi = (lat * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * J) / 365), dec = 0.409 * Math.sin((2 * Math.PI * J) / 365 - 1.39);
  const ws_ = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(dec))));
  return ((24 * 60) / Math.PI) * 0.082 * dr * (ws_ * Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.sin(ws_));
}
// Hargreaves ET0 (mm/day, FAO-56 eq. 52): only temperature. Used for 1981-1983, before POWER has solar radiation,
// scaled month by month to match Penman-Monteith over the years that have both (see calibrate below).
export function et0Hargreaves({ t, tmax, tmin }, lat, m, dayOfYear) {
  if ([t, tmax, tmin].some((v) => v == null || Number.isNaN(v))) return null;
  return Math.max(0, 0.0023 * (t + 17.8) * Math.sqrt(Math.max(0, tmax - tmin)) * 0.408 * extraRad(lat, m, dayOfYear));
}
// Months without radiation get Hargreaves ET0 times the Penman-Monteith / Hargreaves ratio of that calendar month.
export function fillMissingEt0(months, lat) {
  const ratio = {};
  for (let m = 1; m <= 12; m++) {
    const both = Object.entries(months).filter(([k, c]) => +k.slice(5) === m && c.et0 != null && c.hg);
    ratio[m] = both.length >= 5 ? both.reduce((s, [, c]) => s + c.et0, 0) / both.reduce((s, [, c]) => s + c.hg, 0) : 1;
  }
  for (const [k, c] of Object.entries(months)) { if (c.et0 == null && c.hg) { c.et0 = c.hg * ratio[+k.slice(5)]; c.et0src = "hargreaves"; } delete c.hg; }
  return months;
}

// FAO-56 Penman-Monteith with G = 0. Radiation input is MJ/m²/day.
export function et0Day({ t, tmax, tmin, rh, ws, rs }, lat, elev, m, dayOfYear) {
  if ([t, tmax, tmin, rh, ws, rs].some((v) => v == null || Number.isNaN(v))) return null;
  const P = 101.3 * ((293 - 0.0065 * elev) / 293) ** 5.26, gamma = 0.000665 * P;
  const es = (es0(tmax) + es0(tmin)) / 2, ea = Math.min(es, (rh / 100) * es);
  const delta = (4098 * es0(t)) / (t + 237.3) ** 2;
  const Ra = extraRad(lat, m, dayOfYear);
  const Rso = Math.max(0.1, (0.75 + 2e-5 * elev) * Ra);
  const Rnl = 4.903e-9 * (((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2) * (0.34 - 0.14 * Math.sqrt(ea)) * (1.35 * Math.min(rs / Rso, 1) - 0.35);
  const Rn = 0.77 * rs - Rnl;
  const et0 = (0.408 * delta * Rn + gamma * (900 / (t + 273)) * ws * (es - ea)) / (delta + gamma * (1 + 0.34 * ws));
  return Math.max(0, et0);
}

async function getJSON(url, timeout = 12000) {
  const response = await fetch(url, { signal: typeof timeout === 'number' ? AbortSignal.timeout(timeout) : timeout });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' from ' + url.split('?')[0]);
  return response.json();
}

async function browserCatalog() {
  const bundled = getJSON('data/earthdata-imerg.json', 3000).catch(() => null);
  const catalog = await getJSON('api/nasa/imerg', 1500).catch(() => null);
  if (catalog?.collections?.length) return catalog;
  return bundled;
}

const valid = (value) => Number.isFinite(value) && value > -900;
const validRain = (value) => Number.isFinite(value) && value >= 0;
const sum = (days, index) => days.reduce((total, day) => total + day[index], 0);
const compactDate = (date) => date.replaceAll('-', '');

function imergCoverage(catalog, lat, lon) {
  return (catalog?.collections || []).flatMap((collection) => {
    if (!['GPM_3IMERGDF', 'GPM_3IMERGDL'].includes(collection.short_name)) return [];
    const [west, south, east, north] = collection.bounding_box || [];
    if (![west, south, east, north].every(Number.isFinite) || lon < west || lon > east || lat < south || lat > north) return [];
    const start = collection.time_start?.slice(0, 10);
    const end = collection.is_ongoing ? null : collection.time_end?.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || (!collection.is_ongoing && !/^\d{4}-\d{2}-\d{2}$/.test(end))) return [];
    return [{ start: start < IMERG_POWER_START ? IMERG_POWER_START : start, end, id: collection.concept_id }];
  });
}

async function fetchImerg(query, coverage, end) {
  if (!coverage.length) return null;
  const first = coverage.map((item) => item.start).sort()[0];
  if (first > end) return null;
  const url = API + '/daily/point?parameters=IMERG_PRECTOT&' + query + '&start=' + compactDate(first) + '&end=' + compactDate(end);
  const data = await getJSON(url, 8500);
  if (!data.header?.sources?.includes('IMERG') || data.parameters?.IMERG_PRECTOT?.units !== 'mm/day') {
    throw new Error('Invalid NASA POWER IMERG source or units');
  }
  return data.properties.parameter.IMERG_PRECTOT;
}

// Each daily row holds rain, reference ET, mean/min/max temperature. Missing days remain missing.
function dailyMonths(data, imerg, coverage, lat, endMonth) {
  const P = data.properties.parameter;
  const elev = data.geometry?.coordinates?.[2] ?? 0;
  const byMonth = {};
  for (const key of Object.keys(P.T2M).sort()) {
    const y = +key.slice(0, 4), m = +key.slice(4, 6), d = +key.slice(6);
    const month = mkey(y, m);
    if (month > endMonth || d < 1 || d > daysIn(y, m)) continue;
    const t = P.T2M[key], tmin = P.T2M_MIN[key], tmax = P.T2M_MAX[key];
    if (![t, tmin, tmax].every(valid) || tmin > tmax) continue;
    const rh = P.RH2M?.[key], ws = P.WS2M?.[key], rs = P.ALLSKY_SFC_SW_DWN?.[key];
    const doy = 1 + (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / DAY_MS;
    const weather = { t, tmin, tmax, rh, ws, rs };
    const et0 = [rh, ws, rs].every(valid) ? et0Day(weather, lat, elev, m, doy) : null;
    const hg = et0Hargreaves(weather, lat, m, doy);
    const date = month + '-' + pad(d);
    const satellite = coverage.some((item) => item.start <= date && (!item.end || date <= item.end)) ? imerg?.[key] : null;
    (byMonth[month] ??= []).push([P.PRECTOTCORR?.[key], et0, t, tmin, tmax, hg, satellite]);
  }

  // Scale historical temperature-only ET0 using overlapping daily Penman-Monteith values.
  const calibration = Array.from({ length: 12 }, () => ({ et0: 0, hg: 0, n: 0 }));
  for (const [month, days] of Object.entries(byMonth)) {
    const c = calibration[+month.slice(5) - 1];
    for (const day of days) if (Number.isFinite(day[1]) && day[5] > 0) {
      c.et0 += day[1];
      c.hg += day[5];
      c.n++;
    }
  }

  const months = {};
  for (const [month, days] of Object.entries(byMonth)) {
    const [y, m] = month.split('-').map(Number);
    if (days.length !== daysIn(y, m)) continue;
    const satellite = days.every((day) => validRain(day[6]));
    if (!satellite && !days.every((day) => validRain(day[0]))) continue;
    const c = calibration[m - 1], scale = c.n >= 150 ? c.et0 / c.hg : 1;
    const rows = days.map(([rain, et0, t, tmin, tmax, hg, higherRes]) => [
      satellite ? higherRes : rain, et0 ?? hg * scale, t, tmin, tmax,
    ]);
    months[month] = {
      rain: sum(rows, 0), et0: sum(rows, 1), t: sum(rows, 2) / rows.length,
      tmin: sum(rows, 3) / rows.length, tmax: sum(rows, 4) / rows.length,
      rainPeak: Math.max(...rows.map((day) => day[0])),
      rainSource: satellite ? 'IMERG_PRECTOT' : 'PRECTOTCORR', days: rows,
    };
  }
  return { elev, months };
}

async function monthlyFallback(query, y, lat) {
  const url = API + '/monthly/point?parameters=' + MONTHLY + '&' + query + '&start=' + FIRST_YEAR + '&end=';
  const signal = AbortSignal.timeout(6500);
  const data = await getJSON(url + (y - 1), signal).catch(() => getJSON(url + (y - 2), signal));
  const elev = data.geometry?.coordinates?.[2] ?? 0;
  const months = {}, P = data.properties.parameter;
  for (const key of Object.keys(P.T2M)) {
    const y = +key.slice(0, 4), m = +key.slice(4);
    if (m < 1 || m > 12) continue;
    const t = P.T2M[key], range = P.T2M_RANGE[key], rain = P.PRECTOTCORR[key];
    if (![t, range].every(valid) || !validRain(rain)) continue;
    const weather = { t, tmax: t + range / 2, tmin: t - range / 2, rh: P.RH2M?.[key], ws: P.WS2M?.[key], rs: P.ALLSKY_SFC_SW_DWN?.[key] };
    const days = daysIn(y, m);
    const et0 = [weather.rh, weather.ws, weather.rs].every(valid) ? et0Day(weather, lat, elev, m) * days : null;
    months[mkey(y, m)] = { rain: rain * days, et0, hg: et0Hargreaves(weather, lat, m) * days, dayCount: days,
      t, tmax: weather.tmax, tmin: weather.tmin, rainSource: 'PRECTOTCORR' };
  }
  return { elev, months: fillMissingEt0(months, lat) };
}

export async function fetchClimate(lat, lon, { catalog = browserCatalog } = {}) {
  const la = +lat.toFixed(2), lo = +lon.toFixed(2);
  const cacheKey = 'rooti:clim:v3:' + la + ',' + lo;
  let cached;
  try {
    cached = JSON.parse(localStorage.getItem(cacheKey));
    if (cached && Date.now() - cached.at < (cached.data.reducedCoverage ? 60 * 60 * 1000 : 7 * DAY_MS)) return cached.data;
  } catch { /* storage can be unavailable or full */ }

  const now = new Date(), y = now.getUTCFullYear();
  const end = new Date(Date.UTC(y, now.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const query = 'community=AG&longitude=' + lo + '&latitude=' + la + '&time-standard=UTC&format=JSON';
  const weatherPromise = getJSON(API + '/daily/point?parameters=' + DAILY + '&' + query + '&start=' + FIRST_YEAR + '0101&end=' + compactDate(end)).catch(() => null);
  let monthly;
  const loadMonthly = () => (monthly ??= monthlyFallback(query, y, la).catch(() => null));
  const timer = setTimeout(loadMonthly, 4500);
  const satellite = Promise.resolve().then(catalog).then((data) => imergCoverage(data, la, lo)).catch(() => [])
    .then(async (coverage) => ({ coverage, imerg: await fetchImerg(query, coverage, end).catch(() => null) }));
  const weather = await weatherPromise;
  clearTimeout(timer);
  if (!weather) loadMonthly();
  const { coverage, imerg } = weather ? await satellite : { coverage: [], imerg: null };
  const daily = weather ? dailyMonths(weather, imerg, coverage, la, end.slice(0, 7)) : null;
  const historicalMonths = 12 * (y - FIRST_YEAR);
  const availableHistory = Object.keys(daily?.months || {}).filter((month) => month < mkey(y, 1)).length;
  const fallback = availableHistory < historicalMonths ? await loadMonthly() : null;
  const months = { ...fallback?.months, ...cached?.data.months, ...daily?.months };
  const keys = Object.keys(months).sort();
  if (!keys.length) throw new Error('No usable NASA POWER climate observations');
  const lastFullYear = Number(keys.filter((key) => key.endsWith('-12') && +key.slice(0, 4) < y).at(-1)?.slice(0, 4) || FIRST_YEAR - 1);
  const data = {
    lat: la, lon: lo, elev: daily?.elev ?? cached?.data.elev ?? fallback?.elev ?? 0, months,
    first: keys[0], last: keys.at(-1), lastFullYear,
    imergCollections: imerg ? coverage.map((item) => item.id) : [],
    reducedCoverage: availableHistory < historicalMonths || !imerg,
  };
  try { localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data })); } catch { /* storage can be unavailable or full */ }
  return data;
}
