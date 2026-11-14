// Field Shift — rotation scoring engine (runs in the browser).
// Inputs: zone data (pipeline/build_app_data.py), crops.json (sourced agronomic parameters),
// farmer choices. Output: ranked rotations with why / evidence / benefits / gaps / risks.
// Design rule: POWER absolute temperatures are biased, so heat is judged by CHANGE vs normal.

export const SEASONS = {
  wet: { key: "wet", label: "Wet season (Jan–May)", noun: "wet season", months: [1, 2, 3, 4, 5] },
  dry: { key: "dry", label: "Dry season (Jun–Oct)", noun: "dry season", months: [6, 7, 8, 9, 10] },
};
const SEASON_ALIAS = { wet: ["invierno", "wet", "rainy"], dry: ["verano", "dry"] };
export const SCENARIOS = {
  dry: { label: "Dry year", key: "yt:dry" },
  normal: { label: "Normal year", key: "yt:normal" },
  wet: { label: "Wet year", key: "yt:wet" },
  climatology: { label: "1991-2020 average", key: "neutral" },
  nina: { label: "La Niña year", key: "nina" },
  nino: { label: "Moderate El Niño", key: "nino" },
  strong_nino: { label: "Strong El Niño", key: "strong_nino" },
};
const FALLOW = { id: "fallow", name_en: "Bare fallow", name_es: "Barbecho", fallow: true };
// Keeping rice straw on the field instead of burning it (FAO Conservation Agriculture: permanent soil cover).
const MULCH = { id: "mulch", name_en: "Rice straw kept on the field", name_es: "Paja de arroz sin quemar", fallow: true, mulch: true };
const FAIL_RATIO = 0.2; // below 20% of its water need a rain-fed crop is treated as failed, whatever its drought tolerance

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sumMonths = (arr, months) => months.reduce((s, m) => s + (arr[m - 1] ?? 0), 0);
const avgMonths = (arr, months) => mean(months.map((m) => arr[m - 1] ?? 0));
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const num = (v) => (Array.isArray(v) ? (num(v[0]) + num(v[v.length - 1])) / 2 : typeof v === "string" ? parseFloat(v) : v);
const mid = (r) => (r == null ? null : num(r));
const GREEN_MANURE = new Set(["jack_bean", "velvet_bean"]);
const level = (v) => ({ low: 0, medium: 0.5, high: 1 }[String(v || "").toLowerCase()] ?? 0.5);
const fmt = (x, d = 0) => (x == null || Number.isNaN(x) ? "n/a" : Number(x).toFixed(d));

export function cropsForSeason(crops, season) {
  return Object.entries(crops)
    .filter(([, c]) => !c.season || c.season.some((s) => SEASON_ALIAS[season].includes(String(s).toLowerCase())))
    .map(([id, c]) => ({ id, ...c }));
}

function climateFor(zone, scenarioKey) {
  if (scenarioKey && typeof scenarioKey === "object") return { sc: scenarioKey, normal: zone.climatology_1991_2020, nYears: 1 };
  const enso = zone.enso_composites_1981_2025;
  if (typeof scenarioKey === "string" && scenarioKey.startsWith("yt:")) {
    const t = zone.year_types[scenarioKey.slice(3)];
    return { sc: t, normal: zone.climatology_1991_2020, nYears: t.n_years };
  }
  const sc = scenarioKey === "neutral" ? zone.climatology_1991_2020 : enso[scenarioKey];
  return { sc, normal: zone.climatology_1991_2020, nYears: scenarioKey === "neutral" ? 30 : enso[scenarioKey]?.n_years };
}

let CURRENT_WATERLOG = 0;
const opts_waterlogging = () => CURRENT_WATERLOG;
function seasonCrop(zone, crop, season, scenarioKey, irrigation) {
  const S = SEASONS[season];
  const { sc, normal } = climateFor(zone, scenarioKey);
  const rain = sumMonths(sc.rain_mm, S.months);
  const rainNormal = sumMonths(normal.rain_mm, S.months);
  const heavy = sumMonths(sc.heavy_rain_days_20mm, S.months);
  const heatDelta = sumMonths(sc.heat_days_35c, S.months) - sumMonths(normal.heat_days_35c, S.months);
  const tmaxDelta = avgMonths(sc.tmax_c, S.months) - avgMonths(normal.tmax_c, S.months);
  const bare = zone.ndvi?.available ? avgMonths(zone.ndvi.bare_soil_probability, S.months) : null;
  const base = { season, crop, rain, rainNormal, heavy, heatDelta, tmaxDelta, bare };

  if (crop.fallow) {
    const cov = crop.mulch ? 0.6 : 0;
    return { ...base, need: 0, supply: rain, ratio: null, water: 1, soil: crop.mulch ? 0.35 : 0.1, flood: 0, drought: 0, heat: 0,
             erosion: clamp01((heavy / 25) * (1 - cov)), failed: false, notes: [] };
  }
  // Water need, FAO-56 method: average crop coefficient × reference ET0 of the season,
  // scaled to the crop's cycle (a 90-day crop does not use the whole 150-day season).
  const et0 = sumMonths(sc.et0_mm, S.months);
  const seasonDays = S.months.length * 30.4;
  const k = crop.kc || {}, kmid = mid(k.mid);
  const kc = kmid != null && !Number.isNaN(kmid) ? ((mid(k.ini) ?? kmid) + 2 * kmid + (mid(k.end) ?? kmid)) / 4 : null;
  const cycle = crop.cycle_days ? Math.min(1, mid(crop.cycle_days) / seasonDays) : 1;
  const ASSUMED_KC = 0.9; // generic legume cover crop; stated as an assumption when FAO gives no value
  const fallbackNeed = mid(crop.water_need_mm);
  const assumedKc = kc == null && (fallbackNeed == null || Number.isNaN(fallbackNeed));
  const need = kc != null ? kc * et0 * cycle : !assumedKc ? fallbackNeed : ASSUMED_KC * et0 * cycle;
  const needMethod = kc != null ? "FAO-56 crop coefficient × reference ET0" : !assumedKc ? "FAO typical seasonal need" : "assumed crop coefficient 0.9 × reference ET0 (no FAO value)";
  const needUnknown = need == null || Number.isNaN(need);
  const supply = needUnknown ? rain : rain + (irrigation ? Math.max(0, need - rain) : 0);
  const ratio = needUnknown || !need ? null : supply / need;
  const dTol = level(crop.drought_tolerance), fTol = level(crop.flood_tolerance);
  const deficit = ratio != null && ratio < 1 ? 1 - ratio : 0;
  const excess = ratio != null && ratio > 1.6 ? Math.min(1, (ratio - 1.6) / 2) : 0;
  const failed = ratio != null && ratio < FAIL_RATIO;
  const drought = failed ? 1 : clamp01(deficit * (1 - 0.7 * dTol));
  // Waterlogging: how often the land stays under water (JRC Global Surface Water, confirmed by the farmer), rainy season only.
  const waterlog = season === "wet" ? (opts_waterlogging(crop) ?? 0) * (1 - fTol) * clamp01(rain / Math.max(rainNormal, 1)) : 0;
  const flood = clamp01((excess + heavy / 40) * (1 - 0.8 * fTol) + waterlog);
  const heatTol = crop.temp_stress_c >= 40 ? 1 : crop.temp_stress_c >= 35 ? 0.5 : 0;
  // Calibrated so a few extra hot days are a caution, not a failure (POWER Tmax runs warm, see provenance).
  const heat = clamp01((Math.max(0, heatDelta) / 40 + Math.max(0, tmaxDelta) / 4) * (1 - 0.7 * heatTol));
  const water = needUnknown ? 0.5 : clamp01(1 - drought - 0.6 * flood) * (irrigation ? 0.85 + 0.15 * (1 - clamp01(need / 1200)) : 1);
  const cover = level(crop.soil_cover);
  const soil = clamp01(0.35 * cover + (crop.n_fixing ? 0.4 : 0) + 0.25 * clamp01(mid(crop.root_depth_m) / 1.5)) * (failed ? 0.2 : 1);
  const erosion = clamp01((heavy / 25) * (1 - 0.8 * cover));
  return { ...base, failed, need: needUnknown ? null : need, needUnknown, assumedKc, needMethod, et0, kc, supply, ratio, water, soil, flood, drought, heat, erosion, notes: [] };
}

export function scoreRotation(zone, crops, rotation, opts) {
  const { scenario = "normal", irrigation = false, weights = { water: 1, soil: 1, income: 1 } } = opts;
  CURRENT_WATERLOG = opts.waterlogging ?? 0;
  const key = opts.climate || SCENARIOS[scenario].key;
  const get = (id) => (id === "fallow" ? FALLOW : id === "mulch" ? MULCH : { id, ...crops[id] });
  const wet = seasonCrop(zone, get(rotation.wet), "wet", key, irrigation);
  const dry = seasonCrop(zone, get(rotation.dry), "dry", key, irrigation);
  const parts = [wet, dry];
  const same = rotation.wet === rotation.dry && rotation.wet !== "fallow";

  const water = mean(parts.map((p) => p.water));
  let soil = mean(parts.map((p) => p.soil)) - (same ? 0.2 : 0) - 0.3 * mean(parts.map((p) => p.erosion));
  soil = clamp01(soil + (parts.some((p) => p.crop.n_fixing) && !same ? 0.1 : 0));
  const incomeKnown = parts.filter((p) => p.crop.market_index != null);
  // Prices are not modelled: cash crops are neutral (0.5); a green manure or bare fallow earns nothing that season.
  const seasonIncome = (p) => (p.crop.fallow || GREEN_MANURE.has(p.crop.id) ? 0.1 : p.crop.market_index ?? 0.5);
  const income = mean(parts.map(seasonIncome));
  const risk = clamp01(Math.max(...parts.map((p) => Math.max(p.flood, p.drought, p.heat))));
  const W = weights.water + weights.soil + weights.income || 1;
  // A plan that is likely to fail is not rescued by good averages: risk multiplies the score down.
  const total = clamp01(((weights.water * water + weights.soil * soil + weights.income * income) / W) * (1 - 0.85 * risk));
  return { rotation, parts, same, scores: { water, soil, income, risk, total }, explain: explain(zone, parts, same, scenario, irrigation, incomeKnown.length < 2) };
}

function explain(zone, parts, same, scenario, irrigation, incomeUnknown) {
  const [wet, dry] = parts;
  const name = (p) => p.crop.name_en || p.crop.id;
  const scen = SCENARIOS[scenario].label;
  const why = [], evidence = [], benefits = [], gaps = [], risks = [];

  for (const p of parts) {
    const sLabel = SEASONS[p.season].label, sNoun = SEASONS[p.season].noun;
    if (p.crop.fallow) {
      risks.push(`${sLabel}: field left bare — ${fmt(p.heavy, 1)} days with ≥20 mm rain can wash soil away.`);
      continue;
    }
    evidence.push(p.needUnknown
      ? `${sLabel} (${scen}): ${fmt(p.rain)} mm of rain expected vs ${fmt(p.rainNormal)} mm in a normal year (NASA POWER, 1981–2025).`
      : `${sLabel} (${scen}): ${fmt(p.rain)} mm of rain expected vs ${fmt(p.rainNormal)} mm in a normal year (NASA POWER, 1981–2025); ${name(p)} needs about ${fmt(p.need)} mm (${p.needMethod}; ET0 ${fmt(p.et0)} mm from NASA POWER).`);
    if (p.needUnknown) gaps.push(`FAO publishes no water-need figures for ${name(p)}; its water fit is not scored.`);
    if (p.assumedKc) gaps.push(`FAO publishes no crop coefficient for ${name(p)}; its water need assumes a generic cover-crop value (0.9).`);
    if (GREEN_MANURE.has(p.crop.id)) benefits.push(`${name(p)} is a green manure: it is ploughed in to feed the soil, not sold.`);
    if (p.ratio != null && p.ratio >= 0.9 && p.ratio <= 1.6) why.push(`${name(p)} fits the ${sNoun} water supply (${fmt(p.ratio * 100)}% of its need${irrigation ? ", with irrigation" : ""}).`);
    if (p.failed) risks.push(`${name(p)} would likely fail: rain covers only ${fmt(p.ratio * 100)}% of its water need${irrigation ? "" : " and you can't irrigate"}.`);
    else if (p.drought > 0.25) risks.push(`${name(p)} may run short of water in the ${sNoun} (only ${fmt(p.ratio * 100)}% of its need${irrigation ? "" : " without irrigation"}).`);
    if (p.flood > 0.25) risks.push(`${name(p)} is sensitive to waterlogging; ${scen.toLowerCase()} brings ${fmt(p.heavy, 1)} heavy-rain days in the ${sNoun}.`);
    if (p.heat > 0.25) risks.push(`${scen} is hotter than normal in the ${sNoun} (+${fmt(p.tmaxDelta, 1)} °C max temperature); ${name(p)} has limited heat tolerance.`);
    if (p.crop.n_fixing) benefits.push(`${name(p)} fixes nitrogen from the air${p.crop.n_fixed_kg_ha ? ` (≈${fmt(mid(p.crop.n_fixed_kg_ha))} kg N/ha)` : ""}, so the next crop needs less fertilizer.`);
    if (level(p.crop.soil_cover) >= 1) benefits.push(`${name(p)} covers the soil well, protecting it from heavy rain.`);
    if (p.crop.breaks_pest_cycle) benefits.push(`${name(p)}: ${p.crop.breaks_pest_cycle}`);
    if (p.bare != null && p.bare > 0.4) why.push(`Satellite greenness (MODIS NDVI) shows fields here are often bare in the ${sNoun} (${fmt(p.bare * 100)}% of observations) — a chance to grow something that protects the soil.`);
  }
  if (same) risks.push(`Planting ${name(wet)} twice in a row keeps pests and diseases in the field and doesn't rest the soil.`);
  else if (!wet.crop.fallow && !dry.crop.fallow) benefits.push(`Alternating ${name(wet)} and ${name(dry)} interrupts pest and disease cycles.`);

  const tr = zone.trends_1981_2025;
  if (tr?.mean_tmax_c?.significant_95) evidence.push(`Daytime maximum temperature here has risen ${fmt(tr.mean_tmax_c.per_decade, 2)} °C per decade since 1981 (statistically significant, p${tr.mean_tmax_c.p_value < 0.001 ? "<0.001" : "=" + fmt(tr.mean_tmax_c.p_value, 3)}).`);
  gaps.push("Climate data describe a ~50 km area, not your specific field.");
  if (incomeUnknown) gaps.push("Local prices and market access are not modelled — check with buyers or your cooperative.");
  if (Object.values(zone.soil || {}).some((v) => v && v.low_confidence)) gaps.push("Soil data for this area have low confidence (few valid satellite-model pixels).");
  if (!zone.ndvi?.available) gaps.push("Satellite greenness (NDVI) for this zone is still being processed.");
  risks.push("Review with a local agronomist (e.g. INIAP or MAG extension officer) before changing your rotation.");
  return { why, evidence, benefits, gaps, risks };
}

// Risk calendar: what can go wrong in each month of the year for this plan.
// Kinds: "water_shortage" | "excess_rain" | "rain_on_bare" | "bare_in_sun" | "ok"
export function riskCalendar(zone, crops, rotation, opts) {
  const key = opts.climate || SCENARIOS[opts.scenario || "normal"].key;
  const { sc } = climateFor(zone, key);
  const cell = Array(12).fill(null);
  for (const season of ["wet", "dry"]) {
    const id = rotation[season];
    const S = SEASONS[season];
    if (id === "fallow" || id === "mulch") { if (id === "mulch") [...S.months, 11, 12].forEach((m) => { cell[m - 1] = { month: m, crop: "mulch", kind: "covered", severity: 0, rain: Math.round(sc.rain_mm[m - 1]), need: 0 }; }); continue; }
    const crop = crops[id];
    const days = mid(crop.cycle_days) ?? S.months.length * 30.4;
    const nMonths = Math.max(1, Math.min(S.months.length, Math.round(days / 30.4)));
    const k = crop.kc || {}, kmid = mid(k.mid) ?? 0.9;
    const months = S.months.slice(0, nMonths);
    const seasonNeed = months.reduce((t, m, i) => t + (i === 0 ? (mid(k.ini) ?? kmid) : i === nMonths - 1 ? (mid(k.end) ?? kmid) : kmid) * sc.et0_mm[m - 1], 0);
    const seasonRain = months.reduce((t, m) => t + sc.rain_mm[m - 1], 0);
    const seasonFails = !(opts.irrigation && season === "dry") && seasonNeed > 0 && seasonRain / seasonNeed < FAIL_RATIO;
    months.forEach((m, i) => {
      const kcM = i === 0 ? (mid(k.ini) ?? kmid) : i === nMonths - 1 ? (mid(k.end) ?? kmid) : kmid;
      const need = kcM * sc.et0_mm[m - 1];
      const supply = sc.rain_mm[m - 1] + (opts.irrigation && season === "dry" ? need : 0);
      const fTol = level(crop.flood_tolerance), dTol = level(crop.drought_tolerance);
      let kind = "ok", severity = 0;
      if (supply < need) { severity = clamp01((1 - supply / need) * (1 - 0.6 * dTol)); kind = severity > 0.15 ? "water_shortage" : "ok"; }
      if (sc.rain_mm[m - 1] > 1.8 * need && fTol < 1) { kind = "excess_rain"; severity = clamp01((sc.rain_mm[m - 1] / need - 1.8) / 2 * (1 - fTol)); }
      const wl = (opts.waterlogging ?? 0) * (1 - fTol) * (season === "wet" ? clamp01(sc.rain_mm[m - 1] / 150) : 0);
      if (wl > Math.max(0.15, severity)) { kind = "waterlogged"; severity = clamp01(wl); }
      if (seasonFails) { kind = "water_shortage"; severity = 1; }
      cell[m - 1] = { month: m, crop: id, kind, severity: +severity.toFixed(2), rain: Math.round(sc.rain_mm[m - 1]), need: Math.round(need), failed: seasonFails };
    });
  }
  return cell.map((c, i) => c ?? {
    month: i + 1, crop: null,
    kind: sc.rain_mm[i] >= 40 ? "rain_on_bare" : "bare_in_sun",
    severity: sc.rain_mm[i] >= 40 ? clamp01(sc.rain_mm[i] / 200) : clamp01(sc.et0_mm[i] / 180),
    rain: Math.round(sc.rain_mm[i]), need: 0,
  });
}

// Real past: the same plan replayed on each real year's climate (NASA POWER), 2001-2024.
export function realPast(zone, crops, rotation, opts = {}) {
  return Object.entries(zone.years || {}).map(([year, climate]) => {
    const x = scoreRotation(zone, crops, rotation, { ...opts, climate });
    const failed = x.parts.some((p) => p.failed);
    const verdict = failed || x.scores.risk > 0.6 ? "bad" : x.scores.risk > 0.3 ? "fair" : "good";
    // Soil loss that year: rain falling on bare soil (erosion) plus months of bare soil in the sun (organic matter).
    const cal = riskCalendar(zone, crops, rotation, { ...opts, climate });
    const loss = cal.reduce((t, c) => t + (c.kind === "rain_on_bare" ? c.rain / 100 : c.kind === "bare_in_sun" ? 0.15 : 0), 0);
    const soil = loss > 2.5 ? "high" : loss > 1.2 ? "medium" : "low";
    const failedCrops = x.parts.filter((p) => p.failed).map((p) => p.crop.id);
    return { year: +year, verdict, soilLoss: soil, failedCrops, lossIndex: +loss.toFixed(2), score: Math.round(x.scores.total * 100), risk: +x.scores.risk.toFixed(2), failed, oniPeak: climate.oni_peak };
  });
}

// Traffic light for one calendar cell: "good" | "care" | "danger"
export function trafficLight(cell) {
  if (cell.kind === "ok" || cell.kind === "covered") return "good";
  return cell.severity >= 0.8 ? "danger" : "care";
}

const CASH = new Set(["soybean", "maize", "peanut", "common_bean", "sorghum", "rice"]);
// The three plans the farmer sees: what they do today, the best dry-season choice keeping their
// rainy-season crop, and the best cash crop (shown even when risky, so the risk is visible).
// Score a rotation over an ensemble of real years (opts.years) instead of an averaged year: an average of a few
// extreme years (1983, 1998) can look fine while the plan fails in most real years like it.
function scoreOverYears(zone, crops, rotation, opts) {
  const runs = opts.years.map((y) => scoreRotation(zone, crops, rotation, { ...opts, climate: zone.years[String(y)] }));
  const avg = (k) => mean(runs.map((r) => r.scores[k]));
  const base = runs[0];
  return { ...base, scores: { water: avg("water"), soil: avg("soil"), income: avg("income"), risk: avg("risk"), total: avg("total") },
           failShare: mean(runs.map((r) => (r.parts.some((p) => p.failed) ? 1 : 0))), nYears: runs.length };
}
// Calendar as frequencies over the same real years: danger if it went badly in half of them or more.
function calendarOverYears(zone, crops, rotation, opts) {
  const cals = opts.years.map((y) => riskCalendar(zone, crops, rotation, { ...opts, climate: zone.years[String(y)] }).map((c) => ({ ...c, level: trafficLight(c) })));
  return cals[0].map((_, m) => {
    const cells = cals.map((c) => c[m]), n = cells.length;
    const share = (l) => cells.filter((c) => c.level === l).length / n;
    const level = share("danger") >= 0.5 ? "danger" : share("danger") + share("care") >= 0.5 ? "care" : "good";
    const bad = cells.filter((c) => c.level !== "good");
    const kinds = bad.map((c) => c.kind), kind = level === "good" ? (cells[0].kind === "covered" ? "covered" : "ok")
      : kinds.sort((a, b) => kinds.filter((k) => k === b).length - kinds.filter((k) => k === a).length)[0];
    return { month: m + 1, crop: cells[0].crop, kind, level, severity: +mean(cells.map((c) => c.severity)).toFixed(2),
             rain: Math.round(mean(cells.map((c) => c.rain))), need: Math.round(mean(cells.map((c) => c.need))),
             failed: cells.filter((c) => c.failed).length / n >= 0.5, badYears: bad.length, nYears: n };
  });
}

export function recommendPlans(zone, crops, opts) {
  const wet = opts.current.wet;
  const ensemble = Array.isArray(opts.years) && opts.years.length >= 3;
  const score = (rot) => (ensemble ? scoreOverYears(zone, crops, rot, opts) : scoreRotation(zone, crops, rot, opts));
  const cal = (rot) => (ensemble ? calendarOverYears(zone, crops, rot, opts) : riskCalendar(zone, crops, rot, opts).map((c) => ({ ...c, level: trafficLight(c) })));
  const options = [...cropsForSeason(crops, "dry").map((c) => c.id), "fallow", "mulch"]
    .filter((id) => id !== wet || opts.irrigation);
  const scored = options.map((dry) => score({ wet, dry })).sort((a, b) => b.scores.total - a.scores.total);
  const today = score(opts.current);
  const best = scored.find((r) => r.rotation.dry !== opts.current.dry) || scored[0];
  const cash = scored.find((r) => CASH.has(r.rotation.dry) && r !== best && r.rotation.dry !== opts.current.dry);
  const withCal = (r, role) => r && { ...r, role, calendar: cal(r.rotation) };
  return [withCal(best, "best"), withCal(today, "today"), withCal(cash, "cash")].filter(Boolean);
}

export function recommend(zone, crops, opts) {
  const wetCrops = [...cropsForSeason(crops, "wet").map((c) => c.id), "fallow"];
  const dryCrops = [...cropsForSeason(crops, "dry").map((c) => c.id), "fallow", "mulch"];
  const all = [];
  for (const w of wetCrops) for (const d of dryCrops) {
    if (w === "fallow" && d === "fallow") continue;
    all.push(scoreRotation(zone, crops, { wet: w, dry: d }, opts));
  }
  all.sort((a, b) => b.scores.total - a.scores.total);
  const cur = opts.current;
  const current = scoreRotation(zone, crops, cur, opts);
  const alternatives = all.filter((r) => !(r.rotation.wet === cur.wet && r.rotation.dry === cur.dry));
  // second alternative must differ in at least one season from the first, for variety
  const first = alternatives[0];
  const second = alternatives.find((r) => r !== first && (r.rotation.wet !== first.rotation.wet || r.rotation.dry !== first.rotation.dry)
    && (r.rotation.dry !== first.rotation.dry));
  return { current, suggestions: [first, second || alternatives[1]].filter(Boolean), ranked: all };
}
