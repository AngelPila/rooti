// The web app's planner, headless, for the WhatsApp agent: reads one JSON request on stdin, prints one JSON answer.
// climate.js keeps its 7-day NASA POWER cache in localStorage: here a JSON file (ROOTI_ENGINE_CACHE) stands in.
//   {"cmd":"plan","lot":{lat,lon,crops,current,area,unit,irrigation,waterlog,priority},"mode":"auto"}
//   {"cmd":"year","lot":{lat,lon}}
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { imergCatalog } from "../../app/earthdata.mjs";

const CACHE = process.env.ROOTI_ENGINE_CACHE;
if (CACHE) {
  let items = {};
  try { items = JSON.parse(readFileSync(CACHE, "utf8")); } catch { /* first run */ }
  const save = () => { writeFileSync(`${CACHE}.tmp`, JSON.stringify(items)); renameSync(`${CACHE}.tmp`, CACHE); };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (k) => (k in items ? items[k] : null),
    setItem: (k, v) => { items[k] = String(v); save(); },
    removeItem: (k) => { delete items[k]; save(); },
  } });
}
const { fetchClimate } = await import("../../app/climate.js");
const { plan } = await import("../../app/planner.js");
const { fetchTerrain, describeSoil, waterlogFactor } = await import("../../app/terrain.js");
const bundledCatalog = JSON.parse(readFileSync(new URL("../../app/data/earthdata-imerg.json", import.meta.url)));
const climateAt = (lot) => fetchClimate(lot.lat, lot.lon, { catalog: () => imergCatalog().catch(() => bundledCatalog) });

const CROPS = JSON.parse(readFileSync(new URL("../../app/data/crops.json", import.meta.url))).crops;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const UNIT_HA = { ha: 1, cuadra: 0.7056, m2: 0.0001, acre: 0.4047 };
const UNIT_NAME = { ha: "hectáreas", cuadra: "cuadras", m2: "m²", acre: "acres" };

const pad = (n) => String(n).padStart(2, "0");
const ym = (p) => `${MONTHS[p.m - 1]} ${p.y}`;
const cropName = (id) => (id === "mulch" ? "paja sin quemar" : CROPS[id]?.name_es?.toLowerCase() || id);
// «2 de 7 años», never a percentage (docs/UX_RESEARCH.md, point 7).
const yearsOf = (share, n) => `${Math.round(share * n)} de ${n} años`;
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

function period() {
  const now = new Date(), s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 11, 1));
  return { start: `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}`, end: `${e.getUTCFullYear()}-${pad(e.getUTCMonth() + 1)}` };
}

// Same rule as the web app: a plot on the Pacific coast of Ecuador or northern Peru, with a plan that starts before
// May 2027, is tested on the rainy seasons after past strong El Niños (NOAA and ERFEN expect one this year).
const ninoByDefault = (lot, start) => lot.lat > -6 && lot.lat < 2 && lot.lon > -81.5 && lot.lon < -78.5 && start < "2027-05";

async function terrainOf(lot) {
  const key = `rooti:terrain:${lot.lat.toFixed(3)},${lot.lon.toFixed(3)}`;
  try { const c = JSON.parse(localStorage.getItem(key)); if (c) return c; } catch { /* no cache */ }
  const t = await fetchTerrain(lot.lat, lot.lon, null).catch(() => ({ soil: null }));
  try { if (t.soil) localStorage.setItem(key, JSON.stringify(t)); } catch { /* no storage */ }
  return t;
}

function siteOf(t, lot) {
  const d = describeSoil(t?.soil);
  const answer = lot.waterlog === true ? "yes" : lot.waterlog === false ? "no" : null;
  return { awc: d?.awc ?? 90, ph: d?.ph ?? null, slope: t?.slopePct ?? 0, wl: waterlogFactor(t, answer, null), soil: d };
}

async function planCmd(lot, mode = "auto") {
  const { start, end } = period();
  const picked = (lot.crops || []).filter((id) => CROPS[id] || id === "mulch");
  if (!picked.length) return { error: "El lote no tiene cultivos registrados." };
  const used = mode === "auto" ? (ninoByDefault(lot, start) ? "nino" : "all") : mode;
  const [clim, terrain] = await Promise.all([climateAt(lot), terrainOf(lot)]);
  const site = siteOf(terrain, lot);
  const r = plan(clim, CROPS, picked, { start, end, irrigation: !!lot.irrigation, priority: lot.priority || "soil", mode: used, site, current: lot.current || [] });
  const n = r.samples.length, area = Number(lot.area) || 0, unit = UNIT_HA[lot.unit] ? lot.unit : "ha";
  const land = (share) => (area ? `${round(share * area)} ${UNIT_NAME[unit]}` : `${Math.round(share * 100)} % del lote`);
  const farm = r.farm && {
    plots: r.farm.parcels.filter((p) => p.share > 0.001).sort((a, b) => b.share - a.share).map((p) => ({
      land: land(p.share),
      plantings: p.d.steps.map((s) => ({ crop: cropName(s.crop), from: ym(s.from), to: ym(s.to), lost: yearsOf(s.fail, n), harvest_share: round(s.yld, 2) })),
    })),
    bare_soil_months: Math.round((1 - r.farm.covered) * r.period.length),
    years_with_some_loss: yearsOf(r.farm.anyLoss, n),
    years_losing_over_half: yearsOf(r.farm.bigLoss, n),
    verdict: r.farm.verdict,
    ...(r.farm.issue && { issue: r.farm.issue }),
  };
  const today = r.today && { years_with_some_loss: yearsOf(r.today.anyLoss, n), bare_soil_months: Math.round((1 - r.today.covered) * r.period.length), verdict: r.today.verdict,
    ...(r.today.issue && { issue: r.today.issue }) };
  const sow = Object.values(r.windows || {}).map((w) => {
    const good = w.starts.filter((s) => s && s.level === "good").map((s) => r.period[s.t]);
    const best = w.starts.filter(Boolean).sort((a, b) => b.value - a.value)[0];
    return { crop: cropName(w.id), best_month: best ? ym(r.period[best.t]) : null, best_harvest_share: best ? round(best.value, 2) : null, good_months: good.map(ym) };
  });
  return {
    from: ym(r.period[0]), to: ym(r.period[r.period.length - 1]),
    tested_on: used === "nino" ? `los ${n} inviernos que siguieron a un El Niño fuerte (1982-83, 1997-98, 2015-16…)` : `${n} series de años reales desde 1981`,
    farm, today, sow,
    soil: site.soil && { texture: site.soil.texture, ph: round(site.soil.ph ?? 0, 1), ph_class: site.soil.phClass, organic_matter: site.soil.omClass },
    slope_pct: site.slope,
    limits: "Clima de NASA POWER: describe unos 50 km alrededor del lote, no el lote mismo. Suelo de SoilGrids (250 m).",
  };
}

// The last months against the 1991-2020 normal of the same months.
async function yearCmd(lot) {
  const clim = await climateAt(lot);
  const keys = Object.keys(clim.months).sort().slice(-3);
  const normal = (m) => {
    const vals = [];
    for (let y = 1991; y <= 2020; y++) { const c = clim.months[`${y}-${pad(m)}`]; if (c) vals.push(c.rain); }
    return vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
  };
  return {
    months: keys.map((k) => { const m = +k.slice(5), c = clim.months[k], n = normal(m); return { month: `${MONTHS[m - 1]} ${k.slice(0, 4)}`, rain_mm: Math.round(c.rain), normal_mm: Math.round(n), vs_normal: n ? round(c.rain / n, 1) : null }; }),
    source: "NASA POWER (lluvia mensual corregida, ~50 km)",
  };
}

const req = JSON.parse(readFileSync(0, "utf8") || "{}");
try {
  const out = req.cmd === "plan" ? await planCmd(req.lot, req.mode)
    : req.cmd === "year" ? await yearCmd(req.lot)
    : req.cmd === "imerg_catalog" ? await imergCatalog() : { error: `unknown cmd ${req.cmd}` };
  process.stdout.write(JSON.stringify(out));
} catch (e) {
  process.stdout.write(JSON.stringify({ error: `No pude calcular: ${e.message}` }));
}
