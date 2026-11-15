// What we can know about a plot from open data, for any point on Earth:
// elevation and slope (Copernicus DEM 90 m via Open-Meteo) and topsoil 0-30 cm (ISRIC SoilGrids 2.0, 250 m).
// SoilGrids masks towns and water; when the point has no value we look 3 km and then 6 km around it.
const ELEV = "https://api.open-meteo.com/v1/elevation";
const SG = "https://rest.isric.org/soilgrids/v2.0/properties/query";
const PROPS = ["clay", "sand", "phh2o", "soc", "nitrogen"];
const SCALE = { clay: 10, sand: 10, phh2o: 10, soc: 10, nitrogen: 100 }; // mapped units -> %, %, pH, g/kg, g/kg

const getJSON = async (url, signal) => { const r = await fetch(url, { signal }); if (!r.ok) throw new Error(r.status); return r.json(); };

async function elevationAndSlope(lat, lon, signal) {
  const d = 0.0027; // ~300 m
  const la = [lat, lat + d, lat - d, lat, lat], lo = [lon, lon, lon, lon + d, lon - d];
  const r = await getJSON(`${ELEV}?latitude=${la.join(",")}&longitude=${lo.join(",")}`, signal);
  const [z0, zn, zs, ze, zw] = r.elevation, dy = 2 * d * 111320, dx = 2 * d * 111320 * Math.cos((lat * Math.PI) / 180);
  const slope = Math.hypot((zn - zs) / dy, (ze - zw) / dx) * 100;
  return { elevation: Math.round(z0), slopePct: +slope.toFixed(1) };
}

function parseSoil(j) {
  const out = {};
  for (const L of j?.properties?.layers || []) {
    if (!PROPS.includes(L.name)) continue;
    // 0-30 cm, weighted by layer thickness (5, 10, 15 cm)
    const vals = L.depths.map((x) => x.values.mean), w = [5, 10, 15];
    if (vals.some((v) => v == null)) return null;
    out[L.name] = vals.reduce((s, v, i) => s + v * w[i], 0) / 30 / SCALE[L.name];
  }
  return Object.keys(out).length ? out : null;
}
async function soilAt(lat, lon, signal) {
  const q = (la, lo) => getJSON(`${SG}?lon=${lo.toFixed(4)}&lat=${la.toFixed(4)}&${PROPS.map((p) => "property=" + p).join("&")}&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean`, signal).then(parseSoil);
  const first = await q(lat, lon);
  if (first) return { ...first, offsetKm: 0 };
  for (const km of [3, 6]) {
    const d = km / 111;
    if (signal.aborted) break;
    const ring = await Promise.all([[d, 0], [-d, 0], [0, d], [0, -d]].map(([a, b]) => q(lat + a, lon + b).catch(() => null)));
    const ok = ring.filter(Boolean);
    if (ok.length) { const avg = {}; for (const k of PROPS) avg[k] = ok.reduce((s, x) => s + x[k], 0) / ok.length; return { ...avg, offsetKm: km }; }
  }
  return null;
}

export async function fetchTerrain(lat, lon, pilotSoil = null) {
  const key = `rooti:terrain:v2:${lat.toFixed(3)},${lon.toFixed(3)}`;
  try { const c = JSON.parse(localStorage.getItem(key)); if (c && Date.now() - c.at < (c.data.soil && c.data.slopePct != null ? 30 * 864e5 : 300000)) return c.data; } catch { /* no cache */ }
  const signal = AbortSignal.timeout(6000);
  const [topo, soil] = await Promise.all([elevationAndSlope(lat, lon, signal).catch(() => null), pilotSoil ? Promise.resolve({ ...pilotSoil, offsetKm: 0, source: "pilot" }) : soilAt(lat, lon, signal).catch(() => null)]);
  const t = { ...(topo || {}), soil };
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data: t })); } catch { /* quota */ }
  return t;
}

// Words and numbers the planner and the screen use.
export function describeSoil(s) {
  if (!s) return null;
  const texture = s.clay >= 40 ? "clay" : s.clay >= 27 ? "clay_loam" : s.sand >= 65 ? "sand" : s.sand >= 50 ? "sandy_loam" : "loam";
  // Water the top 60 cm can hold for roots (mm), FAO-56 Table 19 ranges by texture.
  const awc = { clay: 110, clay_loam: 100, loam: 90, sandy_loam: 70, sand: 45 }[texture];
  const ph = s.phh2o, phClass = ph < 5.0 ? "very_acid" : ph < 5.5 ? "acid" : ph <= 7.3 ? "good" : ph <= 8.0 ? "alkaline" : "very_alkaline";
  const om = s.soc * 1.72 / 10; // organic matter %, from organic carbon g/kg
  const omClass = om < 2 ? "low" : om < 4 ? "medium" : "high";
  return { texture, awc, ph, phClass, om, omClass, clay: s.clay, sand: s.sand };
}
// 0..1: how readily the plot stays waterlogged after heavy rain (heavy soil, flat ground), or the farmer's answer.
export function waterlogFactor(t, answer, pilotIndex) {
  if (answer === "yes") return 0.85;
  if (answer === "sometimes") return 0.5;
  if (answer === "no") return 0.05;
  const d = describeSoil(t?.soil), clay = d ? d.clay : 30, slope = t?.slopePct ?? 2;
  const soilF = clay >= 40 ? 0.6 : clay >= 30 ? 0.45 : clay >= 20 ? 0.3 : 0.15;
  const flatF = slope < 2 ? 1 : slope < 4 ? 0.7 : slope < 8 ? 0.4 : 0.2;
  const est = soilF * flatF;
  return pilotIndex != null ? Math.max(est, Math.min(0.9, pilotIndex * 1.4)) : est;
}
