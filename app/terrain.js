// What we can know about a plot from open data, for any point on Earth:
// elevation and slope (Copernicus DEM 90 m via Open-Meteo) and topsoil 0-30 cm (ISRIC SoilGrids 2.0, 250 m).
// SoilGrids masks towns and water; when the point has no value we look 3 km and then 6 km around it.
const ELEV = "https://api.open-meteo.com/v1/elevation";
const SG = "https://rest.isric.org/soilgrids/v2.0/properties/query";
const PROPS = ["clay", "sand", "phh2o", "soc", "nitrogen"];
const SCALE = { clay: 10, sand: 10, phh2o: 10, soc: 10, nitrogen: 100 }; // mapped units -> %, %, pH, g/kg, g/kg

const getJSON = async (url, ms, signal = AbortSignal.timeout(ms)) => { const r = await fetch(url, { signal }); if (!r.ok) throw new Error(r.status); return r.json(); };

async function elevationAndSlope(lat, lon, signal) {
  const d = 0.0027; // ~300 m
  const la = [lat, lat + d, lat - d, lat, lat], lo = [lon, lon, lon, lon + d, lon - d];
  const r = await getJSON(`${ELEV}?latitude=${la.join(",")}&longitude=${lo.join(",")}`, 10000, signal);
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
  // SoilGrids takes 6-9 s a query and answers parallel ones in a queue (four take ~35 s): 15 s cut most of them off.
  const q = (la, lo) => getJSON(`${SG}?lon=${lo.toFixed(4)}&lat=${la.toFixed(4)}&${PROPS.map((p) => "property=" + p).join("&")}&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean`, 30000, signal).then(parseSoil).catch(() => null);
  const first = await q(lat, lon);
  if (first) return { ...first, offsetKm: 0 };
  for (const km of [3, 6]) {
    if (signal?.aborted) break;
    const d = km / 111;
    const ring = await Promise.all([[d, 0], [-d, 0], [0, d], [0, -d]].map(([a, b]) => q(lat + a, lon + b)));
    const ok = ring.filter(Boolean);
    if (ok.length) { const avg = {}; for (const k of PROPS) avg[k] = ok.reduce((s, x) => s + x[k], 0) / ok.length; return { ...avg, offsetKm: km }; }
  }
  return null;
}

export async function fetchTerrain(lat, lon, pilotSoil = null, { signal } = {}) {
  const key = `rooti:terrain:v2:${lat.toFixed(3)},${lon.toFixed(3)}`;
  try { const c = JSON.parse(localStorage.getItem(key)); if (c) return c; } catch { /* no cache */ }
  const [topo, soil] = await Promise.all([elevationAndSlope(lat, lon, signal).catch(() => null), pilotSoil ? Promise.resolve({ ...pilotSoil, offsetKm: 0, source: "pilot" }) : soilAt(lat, lon, signal)]);
  const t = { ...(topo || {}), soil };
  // Kept only with its soil: a soil query that timed out once would otherwise stay missing for good.
  if (soil) try { localStorage.setItem(key, JSON.stringify(t)); } catch { /* quota */ }
  return t;
}

// Pilot zones: our own soil (data/<zone>.json) and Landsat surface water (data/surface_water.json) replace the open data.
const PILOTS = { daule: [-1.86, -79.98], babahoyo: [-1.80, -79.53], quevedo: [-1.03, -79.46] };
export const nearPilot = (pl) => Object.entries(PILOTS).find(([, [la, lo]]) => Math.hypot(la - pl.lat, lo - pl.lon) * 111 < 40)?.[0] || null;
export function pilotSite(zoneData, surfaceWater, z) {
  const so = zoneData?.soil;
  return {
    pilotSoil: so?.clay ? { clay: so.clay.value_0_30cm, sand: so.sand.value_0_30cm, phh2o: so.phh2o.value_0_30cm, soc: so.soc.value_0_30cm, nitrogen: so.nitrogen?.value_0_30cm } : null,
    pilotWater: surfaceWater?.zones?.[z]?.waterlogging_index ?? null,
  };
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
