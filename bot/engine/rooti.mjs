// The web app's planner, headless, for the WhatsApp agent: reads one JSON request on stdin, prints one JSON answer.
// climate.js keeps its 7-day NASA POWER cache in localStorage: here a JSON file (ROOTI_ENGINE_CACHE) stands in.
//   {"cmd":"plan","lot":{lat,lon,crops,current,area,unit,irrigation,waterlog,priority},"mode":"auto"}
//   {"cmd":"year","lot":{lat,lon}}
//   {"cmd":"warm","lot":{lat,lon}}   fetches the climate and the soil into the cache, so the plan that follows is instant
import { readFileSync, writeFileSync, renameSync } from "node:fs";

const CACHE = process.env.ROOTI_ENGINE_CACHE;
if (CACHE) {
  const load = () => { try { return JSON.parse(readFileSync(CACHE, "utf8")); } catch { return {}; } };
  const items = load();
  // Several engines run at once (a warm-up, the chat, the page): each change goes onto what is on disk now,
  // so one engine's write does not drop what another one just fetched.
  const save = (change) => {
    change(items);
    const disk = load();
    change(disk);
    writeFileSync(`${CACHE}.${process.pid}.tmp`, JSON.stringify(disk));
    renameSync(`${CACHE}.${process.pid}.tmp`, CACHE);
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (k) => (k in items ? items[k] : null),
    setItem: (k, v) => save((m) => { m[k] = String(v); }),
    removeItem: (k) => save((m) => { delete m[k]; }),
  } });
}
const { fetchClimate } = await import("../../app/climate.js");
const { plan, namedPlans, ninoByDefault, ninoOffsetFor } = await import("../../app/planner.js");
const { fetchTerrain, describeSoil, waterlogFactor, nearPilot, pilotSite } = await import("../../app/terrain.js");
const { COPY } = await import("../../app/copy.js");

const dataFile = (name) => { try { return JSON.parse(readFileSync(new URL(`../../app/data/${name}`, import.meta.url))); } catch { return null; } };
const CROPS = dataFile("crops.json").crops, OUTLOOK = dataFile("outlook.json");
const PLAN_NAMES = COPY.es.ds.names;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const UNIT_HA = { ha: 1, cuadra: 0.7056, m2: 0.0001, acre: 0.4047 };
const UNIT_NAME = { ha: "hectáreas", cuadra: "cuadras", m2: "m²", acre: "acres" };

const pad = (n) => String(n).padStart(2, "0");
const ym = (p) => `${MONTHS[p.m - 1]} ${p.y}`;
const cropName = (id) => (id === "mulch" ? "paja sin quemar" : CROPS[id]?.name_es?.toLowerCase() || id);
// «2 de 7 años», never a percentage (docs/UX_RESEARCH.md, point 7).
const yearsOf = (share, n) => `${Math.round(share * n)} de ${n} años`;
// What the count means for the farmer, so the model can say it in words and keep the count for when it matters.
const riskOf = (share) => (share === 0 ? "en ninguno de esos años le habría ido mal" : share <= 0.2 ? "rara vez le habría ido mal"
  : share <= 0.45 ? "algunos años le habría ido mal" : "muchos años le habría ido mal");
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

function period() {
  const now = new Date(), s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 11, 1));
  return { start: `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}`, end: `${e.getUTCFullYear()}-${pad(e.getUTCMonth() + 1)}` };
}

// The page's site data (app/main.js terrain()): in a pilot zone, its own soil and surface water.
async function terrainOf(lot) {
  const z = nearPilot(lot), { pilotSoil, pilotWater } = pilotSite(z && dataFile(`${z}.json`), dataFile("surface_water.json"), z);
  const t = await fetchTerrain(lot.lat, lot.lon, pilotSoil).catch(() => ({ soil: null }));
  // A point cached with SoilGrids soil before the pilot data was used here still gets the pilot soil
  return { ...t, ...(pilotSoil && { soil: { ...pilotSoil, offsetKm: 0, source: "pilot" } }), pilotWater };
}

function siteOf(t, lot) {
  const d = describeSoil(t?.soil);
  const answer = lot.waterlog === true ? "yes" : lot.waterlog === false ? "no" : null;
  return { awc: d?.awc ?? 90, ph: d?.ph ?? null, slope: t?.slopePct ?? 0, wl: waterlogFactor(t, answer, t?.pilotWater), soil: d };
}

async function planCmd(lot, mode = "auto") {
  const { start, end } = period();
  const picked = (lot.crops || []).filter((id) => CROPS[id] || id === "mulch");
  if (!picked.length) return { error: "El lote no tiene cultivos registrados." };
  // The page's choices (app/main.js results(), namedPlans()): same El Niño years, both priorities, same three plans.
  const nino = ninoByDefault(lot, start, end, OUTLOOK, new Date().toISOString().slice(0, 10));
  const used = mode === "auto" ? (nino ? "nino" : "all") : mode;
  const [clim, terrain] = await Promise.all([fetchClimate(lot.lat, lot.lon), terrainOf(lot)]);
  const site = siteOf(terrain, lot);
  const opts = { start, end, irrigation: !!lot.irrigation, mode: used, ninoOffset: nino ? ninoOffsetFor(start) : 0, site, current: lot.current || [] };
  const r = plan(clim, CROPS, picked, { ...opts, priority: "soil" }), ri = plan(clim, CROPS, picked, { ...opts, priority: "income" });
  const n = r.samples.length, first = (r.samples[0]?.base ?? 1981) + (used === "nino" ? opts.ninoOffset : 0), area = Number(lot.area) || 0, unit = UNIT_HA[lot.unit] ? lot.unit : "ha";
  const land = (share) => (area ? `${round(share * area)} ${UNIT_NAME[unit]}` : `${Math.round(share * 100)} % del lote`);
  const plans = namedPlans(r, ri).map(({ key, f }) => ({
    key, name: PLAN_NAMES[key],
    plots: f.parcels.filter((p) => p.share > 0.001).sort((a, b) => b.share - a.share).map((p) => ({
      land: land(p.share),
      plantings: p.d.steps.map((s) => ({ crop: cropName(s.crop), from: ym(s.from), to: ym(s.to), risk: riskOf(s.fail), bad_years: yearsOf(s.fail, n), harvest_share: round(s.yld, 2) })),
    })),
    // Counted like the page's plan cards: a month is bare when more than half the land is
    bare_soil_months: f.grid.slice(0, r.period.length).filter((g) => g.bare?.share > 0.5).length,
    risk: riskOf(f.anyLoss),
    bad_years: yearsOf(f.anyLoss, n),
    years_losing_over_half: yearsOf(f.bigLoss, n),
    verdict: f.verdict,
  }));
  const sow = Object.values(r.windows || {}).map((w) => {
    const good = w.starts.filter((s) => s && s.level === "good").map((s) => r.period[s.t]);
    const best = w.starts.filter(Boolean).sort((a, b) => b.value - a.value)[0];
    return { crop: cropName(w.id), best_month: best ? ym(r.period[best.t]) : null, best_harvest_share: best ? round(best.value, 2) : null, good_months: good.map(ym) };
  });
  return {
    from: ym(r.period[0]), to: ym(r.period[r.period.length - 1]),
    tested_on: used === "nino" ? `los ${n} inviernos que vinieron después de otros Niños fuertes, desde ${first}` : `los ${n} años reales desde ${first}`,
    // Why those years, said once: a count of years means nothing to a farmer who does not know which years they are.
    why_these_years: used === "nino"
      ? `Este invierno viene con un Niño fuerte (lo esperan NOAA y el ERFEN), así que el plan se prueba con lo que pasó después de otros Niños fuertes: si lo hubiera sembrado en esos ${n} inviernos, cómo le habría ido.`
      : `El plan se prueba con el clima de cada año desde ${first}: si lo hubiera sembrado en esos ${n} años, cómo le habría ido.`,
    plans, sow,
    soil: site.soil && { texture: site.soil.texture, ph: round(site.soil.ph ?? 0, 1), ph_class: site.soil.phClass, organic_matter: site.soil.omClass },
    slope_pct: site.slope,
    limits: "Clima de NASA POWER: describe unos 50 km alrededor del lote, no el lote mismo. Suelo de SoilGrids (250 m).",
  };
}

// The last months against the 1991-2020 normal of the same months.
async function yearCmd(lot) {
  const clim = await fetchClimate(lot.lat, lot.lon);
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

async function warmCmd(lot) {
  const [, terrain] = await Promise.all([fetchClimate(lot.lat, lot.lon), terrainOf(lot)]);
  return { ok: true, soil: !!terrain?.soil };
}

const req = JSON.parse(readFileSync(0, "utf8") || "{}");
try {
  const out = req.cmd === "plan" ? await planCmd(req.lot, req.mode) : req.cmd === "year" ? await yearCmd(req.lot)
    : req.cmd === "warm" ? await warmCmd(req.lot) : { error: `unknown cmd ${req.cmd}` };
  process.stdout.write(JSON.stringify(out));
} catch (e) {
  process.stdout.write(JSON.stringify({ error: `No pude calcular: ${e.message}` }));
}
