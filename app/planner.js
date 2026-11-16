// Rotation planner for any place and any date range, using only the crops the farmer picks.
// Each candidate plan is replayed month by month on real climate: months that already happened use
// what really happened; future months are tried against every real sequence of years since 1981.
import { mkey, FIRST_YEAR } from "./climate.js";

const FAIL_RATIO = 0.2;
// ECOCROP limits are for daily extremes; these are monthly means of daily min/max, so a month is lethal only
// when its average night is 5 °C under the crop's absolute minimum, or its average day 3 °C over the maximum.
const COLD_MARGIN = 5, HEAT_MARGIN = 3;
// Seed, labour and land preparation: a planting is only worth it when it is expected to give more than this share of a full harvest.
const PLANTING_COST = 0.4;           // under 20 % of its water need, a rain-fed crop is lost (same rule as the pilot engine)
const CEREALS = new Set(["rice", "maize", "sorghum", "wheat", "barley"]);
const GREEN_MANURE = new Set(["velvet_bean", "jack_bean"]);
// El Niño events of moderate to very strong size (NOAA CPC ONI peak >= 1.5), by the year whose December starts the
// rainy season they hit on the Pacific coast: 1982-83, 1986-87, 1991-92, 1997-98, 2009-10, 2015-16, 2023-24.
export const NINO_ONSET = [1982, 1991, 1997, 2009, 2015, 2023]; // ONI peak >= 1.5 (1986-87 peaks at 1.21 in data oni.csv)
export const PRIORITY_WEIGHTS = { soil: { water: 1, soil: 3, income: 1 }, water: { water: 3, soil: 1, income: 1 }, income: { water: 1, soil: 1, income: 3 } };

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const num = (v) => (Array.isArray(v) ? (num(v[0]) + num(v[v.length - 1])) / 2 : typeof v === "string" ? parseFloat(v) : v);
const mid = (r) => (r == null ? null : num(r));
const lvl = (v) => ({ low: 0, medium: 0.5, high: 1 }[String(v || "").toLowerCase()] ?? 0.5);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export function monthsBetween(start, end) {
  const [y0, m0] = start.split("-").map(Number), [y1, m1] = end.split("-").map(Number), out = [];
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, m = 1) : m++) out.push({ y, m });
  return out;
}
export const cropMonths = (crop) => Math.max(2, Math.round((mid(crop.cycle_days) ?? 120) / 30.4));

// The climate each sample sees, month by month over the period.
export function samples(clim, period, mode = "all", ninoOffset = 0) {
  const y0 = period[0].y, span = period[period.length - 1].y - y0;
  const observed = (p) => mkey(p.y, p.m) <= clim.last && clim.months[mkey(p.y, p.m)];
  if (period.every(observed)) return [{ base: null, months: period.map((p) => ({ ...clim.months[mkey(p.y, p.m)], obs: true })) }];
  let out = [];
  for (let b = FIRST_YEAR; b + span <= clim.lastFullYear; b++) {
    const months = period.map((p) => (observed(p) ? { ...clim.months[mkey(p.y, p.m)], obs: true } : clim.months[mkey(b + p.y - y0, p.m)]));
    if (months.every((c) => c && c.et0 != null)) out.push({ base: b, months });
  }
  if (mode === "nino") { const n = out.filter((s) => NINO_ONSET.includes(s.base + ninoOffset)); if (n.length >= 3) out = n; }
  else if (mode === "dry" || mode === "wet") {
    const rain = (s) => s.months.reduce((t, c) => t + (c.obs ? 0 : c.rain), 0);
    const sorted = [...out].sort((a, b) => rain(a) - rain(b)), k = Math.max(3, Math.round(out.length / 3));
    out = mode === "dry" ? sorted.slice(0, k) : sorted.slice(-k);
  }
  return out;
}

// One planting of one crop starting at month t of one sample.
// site: { awc: mm the root zone holds, wl: 0..1 how readily the plot stays waterlogged, ph: topsoil pH or null }
function planting(crop, id, t, sample, irrigation, site, store0) {
  const L = cropMonths(crop), k = crop.kc || {}, kmid = mid(k.mid) ?? 0.9;
  const kin = mid(k.ini) ?? kmid, kend = mid(k.end) ?? kmid;
  const ms = sample.months.slice(t, t + L);
  const kcs = ms.map((_, i) => (i === 0 ? kin : i === L - 1 ? kend : kmid));
  const need = ms.reduce((s, c, i) => s + kcs[i] * c.et0, 0), rain = ms.reduce((s, c) => s + c.rain, 0);
  // Water left in the soil from earlier months counts too (the "humedad residual" farmers sow on after the rains).
  const carry = store0 ?? 0;
  const supply = rain + carry + (irrigation ? Math.max(0, need - rain - carry) : 0), ratio = need > 0 ? supply / need : 1;
  const [tlo, thi] = (crop.temp_abs_c || [-50, 60]).map(Number), [olo, ohi] = (crop.temp_opt_c || [tlo, thi]).map(Number);
  const coldM = ms.findIndex((c) => c.tmin < tlo - COLD_MARGIN), hotM = ms.findIndex((c) => c.tmax > thi + HEAT_MARGIN);
  const tMean = mean(ms.map((c) => c.t));
  const fTol = lvl(crop.flood_tolerance), dTol = lvl(crop.drought_tolerance), ky = mid(crop.ky) ?? 1;
  // Waterlogging: months whose rain far exceeds what evaporates and what the plot can drain. Rice is grown flooded.
  // A plot that drains well (wl near 0) takes ~500 mm of surplus in a month; a flat, heavy one (wl ~0.5) about 215 mm.
  // So an extreme month (El Niño 1983, 1998: 500-700 mm) floods a flat clay plot even where it "rarely" floods.
  const drainCap = 60 + 440 * (1 - (site?.wl ?? 0.25)) ** 1.5;
  const wlSev = ms.map((c) => (id === "rice" ? 0 : clamp01((c.rain - c.et0 - drainCap) / 200) * (1 - 0.7 * fTol)));
  const wlMax = Math.max(0, ...wlSev), drowned = wlSev.filter((x) => x >= 0.5).length >= 2 || wlMax >= 0.75;
  const waterFail = !irrigation && ratio < FAIL_RATIO, failed = waterFail || coldM >= 0 || hotM >= 0 || drowned;
  const tempF = tMean < olo - 3 || tMean > ohi + 3 ? 0.6 : tMean < olo || tMean > ohi ? 0.85 : 1;
  // Soil pH outside what the crop takes lowers the harvest (FAO ECOCROP ranges).
  const [plo, phi] = (crop.ph || [0, 14]).map(Number), [palo, pahi] = (crop.ph_abs || [0, 14]).map(Number), ph = site?.ph;
  const phF = ph == null ? 1 : ph < palo || ph > pahi ? 0.6 : ph < plo - 0.5 || ph > phi + 0.5 ? 0.85 : 1;
  const yieldShare = failed ? 0 : clamp01(1 - ky * (1 - Math.min(1, ratio))) * tempF * phF * (1 - 0.6 * wlMax);
  let st = carry;
  const cells = ms.map((c, i) => {
    const n = kcs[i] * c.et0, sup = c.rain + Math.min(st, n) + (irrigation ? Math.max(0, n - c.rain - st) : 0);
    st = Math.max(0, Math.min(site?.awc ?? 90, st + c.rain - n));
    let kind = "ok", sev = 0;
    if (sup < n) { sev = clamp01((1 - sup / n) * (1 - 0.6 * dTol)); kind = sev > 0.15 ? "water_shortage" : "ok"; }
    if (wlSev[i] > 0.2) { kind = "waterlogged"; sev = clamp01(wlSev[i] * 1.3); }
    if (c.tmin < tlo - COLD_MARGIN) { kind = "too_cold"; sev = 1; } else if (c.tmax > thi + HEAT_MARGIN) { kind = "too_hot"; sev = 1; }
    else if (c.t < olo - 3 || c.t > ohi + 3) { kind = c.t < olo ? "cool" : "warm"; sev = Math.max(sev, 0.5); }
    if (waterFail) { kind = "water_shortage"; sev = 1; }
    if (drowned && wlSev[i] > 0.2) { kind = "waterlogged"; sev = 1; }
    return { crop: id, kind, sev, rain: c.rain, need: n, obs: !!c.obs };
  });
  return { failed, yieldShare, ratio, rain, need, tMean, cold: coldM >= 0, hot: hotM >= 0, coldAt: coldM, hotAt: hotM, wetAt: wlMax > 0.2 ? wlSev.indexOf(wlMax) : -1, waterFail, drowned, phF, tempF, wlMax, cells };
}
const bareCell = (c) => (c.rain >= 40
  ? { crop: null, kind: "rain_on_bare", sev: clamp01(c.rain / 200), rain: c.rain, need: 0, obs: !!c.obs }
  : { crop: null, kind: "bare_in_sun", sev: c.t < 8 ? 0.1 : clamp01(c.et0 / 180), rain: c.rain, need: 0, obs: !!c.obs });
const coverCell = (c) => ({ crop: "mulch", kind: "covered", sev: 0, rain: c.rain, need: 0, obs: !!c.obs });
const levelOf = (k, sev) => (k === "ok" || k === "covered" ? "good" : sev >= 0.8 ? "danger" : "care");

export function plan(clim, crops, picked, { start, end, irrigation = false, priority = "soil", mode = "all", ninoOffset = 0, site = null, current = null }) {
  const period = monthsBetween(start, end), N = period.length;
  const S = samples(clim, period, mode, ninoOffset);
  if (!S.length) return { period, samples: S, plans: [] };
  const W = PRIORITY_WEIGHTS[priority], Wsum = W.water + W.soil + W.income;
  const useMulch = picked.includes("mulch"), ids = picked.filter((id) => id !== "mulch" && crops[id]);

  // Planting table: every crop at every start month, over every sample.
  const awc = site?.awc ?? 90;
  const storeAt = S.map((s) => { let st = 0; const out = []; for (const c of s.months) { out.push(st); st = Math.max(0, Math.min(awc, st + c.rain - 0.7 * c.et0)); } return out; });
  const tab = {};
  const all = Object.keys(crops).filter((id) => crops[id].cycle_days);
  for (const id of all) {
    const L = cropMonths(crops[id]);
    tab[id] = [];
    for (let t = 0; t + L <= N; t++) {
      const runs = S.map((s, si) => planting(crops[id], id, t, s, irrigation, site, storeAt[si][t]));
      tab[id][t] = { L, runs, fail: mean(runs.map((r) => (r.failed ? 1 : 0))), yld: mean(runs.map((r) => r.yieldShare)), deficit: mean(runs.map((r) => clamp01(1 - r.ratio))) };
    }
  }
  const slopeF = 1 + Math.min(1, (site?.slope ?? 0) / 12);
  const bareSev = period.map((_, t) => mean(S.map((s) => Math.min(1, bareCell(s.months[t]).sev * slopeF))));

  // Best sequence by dynamic programming over (month, previous crop, straw on the ground).
  function best(allowed, firstForced) {
    const memo = new Map();
    const go = (t, prev, cover, started) => {
      if (t >= N) return { v: 0, steps: [] };
      const key = `${t}|${prev}|${cover}|${started}`;
      if (memo.has(key)) return memo.get(key);
      const idle = go(t + 1, prev, cover, started);
      let bestR = { v: idle.v + (cover ? 0.02 : -0.6 * W.soil * bareSev[t]) / Wsum, steps: idle.steps };
      for (const id of allowed) {
        if (!started && firstForced && id !== firstForced) continue;
        if (id === prev && allowed.length > 1) continue; // never the same crop back to back when there is another one
        const row = tab[id]?.[t];
        if (!row) continue;
        const c = crops[id];
        const income = GREEN_MANURE.has(id) ? 0.2 : 1;
        // Rotation rules: the same crop back to back carries its pests and diseases over; a legume after a cereal
        // gives nitrogen back; two cereals in a row draw on the same nutrients.
        const soil = (c.n_fixing ? 0.3 : 0) + (c.n_fixing && CEREALS.has(prev) ? 0.25 : 0) - (id === prev ? 1.0 : 0) - (CEREALS.has(id) && CEREALS.has(prev) ? 0.15 : 0) + 0.15 * lvl(c.soil_cover);
        let bareIfLost = 0;
        for (let u = t; u < t + row.L; u++) bareIfLost += 0.6 * W.soil * bareSev[u];
        const gain = (W.income * income * row.yld + W.soil * soil * (1 - row.fail) - W.water * row.deficit - row.fail * bareIfLost - W.income * PLANTING_COST) / Wsum - 2.5 * row.fail;
        const rest = go(t + row.L, id, useMulch && CEREALS.has(id), true);
        if (gain + rest.v > bestR.v) bestR = { v: gain + rest.v, steps: [{ crop: id, t0: t, t1: t + row.L }, ...rest.steps] };
      }
      memo.set(key, bestR);
      return bestR;
    };
    return go(0, null, false, false);
  }

  const raw = [best(ids), ...ids.map((id) => best([id])), ...ids.map((id) => best(ids, id))];
  const seen = new Set(), uniq = [];
  for (const r of raw.sort((a, b) => b.v - a.v)) {
    const sig = r.steps.map((s) => `${s.crop}@${s.t0}`).join(",");
    if (seen.has(sig)) continue;
    seen.add(sig); uniq.push(r);
  }
  const planted = uniq.filter((r) => r.steps.length);
  const plans = (planted.length ? planted : uniq).slice(0, 6).map((r, i) => describe(r, i));
  // When to sow each crop: the expected share of a full harvest for every possible sowing month.
  // Each month also says why, from the same runs: how many years were lost to dry spells, cold, heat or standing water,
  // in which calendar month that happened most, and how much of the crop's water the rain covered.
  const monthOf = (t, idx) => (idx >= 0 ? period[t + idx]?.m ?? null : null);
  const most = (xs) => { const n = {}; let b = null; for (const x of xs) if (x != null) { n[x] = (n[x] || 0) + 1; if (b == null || n[x] > n[b]) b = x; } return b == null ? null : +b; };
  const whyOf = (runs, t) => ({
    n: runs.length, dry: runs.filter((x) => x.waterFail).length, cold: runs.filter((x) => x.cold).length, hot: runs.filter((x) => x.hot).length, drowned: runs.filter((x) => x.drowned).length,
    coldM: most(runs.map((x) => monthOf(t, x.coldAt))), hotM: most(runs.map((x) => monthOf(t, x.hotAt))), wetM: most(runs.map((x) => monthOf(t, x.wetAt))),
    cover: Math.round(Math.min(1.5, mean(runs.map((x) => x.ratio))) * 100), phF: runs[0]?.phF ?? 1, tempF: mean(runs.map((x) => x.tempF ?? 1)), wl: mean(runs.map((x) => x.wlMax ?? 0)),
  });
  const windows = {};
  for (const id of all) {
    const starts = period.map((_, t) => { const row = tab[id][t]; if (!row) return null; const value = (1 - row.fail) * row.yld; return { t, value, fail: row.fail, yld: row.yld, level: value >= 0.65 ? "good" : value >= 0.35 ? "care" : "danger", why: whyOf(row.runs, t) }; });
    const ok = starts.filter(Boolean), best = ok.reduce((a, b) => (b.value > (a?.value ?? -1) ? b : a), null);
    const want = ok.some((x) => x.level === "good") ? "good" : "care", wins = [];
    for (const x of ok) {
      if (x.level !== want) continue;
      const w = wins[wins.length - 1];
      if (w && w.t1 === x.t - 1) { w.t1 = x.t; w.vals.push(x.value); } else wins.push({ t0: x.t, t1: x.t, vals: [x.value] });
    }
    windows[id] = { id, starts, best, level: best?.level || "danger", L: cropMonths(crops[id]),
                    windows: ok.some((x) => x.level !== "danger") ? wins.map((w) => ({ from: period[w.t0], to: period[w.t1], t0: w.t0, t1: w.t1, value: Math.max(...w.vals) })).sort((a, b) => b.value - a.value) : [] };
  }
  // Better crops for the dates, when a picked crop does not suit them.
  const substitutes = ids.filter((id) => (windows[id].best?.value ?? 0) < 0.5).map((id) => {
    const mine = windows[id].best?.value ?? 0, legume = !!crops[id].n_fixing;
    const alts = all.filter((x) => !picked.includes(x) && (windows[x].best?.value ?? 0) >= Math.max(0.6, mine + 0.15))
      .sort((a, b) => (+!!crops[b].n_fixing === +legume) - (+!!crops[a].n_fixing === +legume) || windows[b].best.value - windows[a].best.value).slice(0, 3);
    return { id, best: windows[id].best, alts: alts.map((x) => windows[x]) };
  }).filter((x) => x.alts.length || (x.best?.value ?? 0) < 0.35);

  // ---------- the farm: land split into plots that run side by side ----------
  // Any arrangement (the recommended one or the farmer's own) is judged the same way, on the same years.
  function evalFarm(parcelsIn, opt = {}) {
    const tot = Math.max(1, parcelsIn.reduce((x, p) => x + (p.share || 0), 0));
    const parcels = parcelsIn.map((pc, k) => {
      const steps = [], errors = [];
      let end = 0;
      const ordered = pc.steps.map((step, index) => ({ step, index })).sort((a, b) => a.step.t0 - b.step.t0);
      for (const { step: st, index } of ordered) {
        const row = tab[st.crop]?.[st.t0];
        if (!row) { errors.push({ ...st, index, why: "no_time" }); continue; }
        if (st.t0 < end) { errors.push({ ...st, index, why: "overlap" }); continue; }
        steps.push({ crop: st.crop, t0: st.t0, t1: st.t0 + row.L }); end = st.t0 + row.L;
      }
      return { share: (pc.share || 0) / tot, d: describe({ steps, v: 0 }, k, opt.noMulch), errors };
    });
    const per = S.map((_, si) => {
      let harvest = 0, planted = 0, lost = 0, loss = 0;
      for (const pc of parcels) {
        for (const st of pc.d.steps) { const run = tab[st.crop][st.t0].runs[si]; planted += pc.share; harvest += pc.share * run.yieldShare; if (run.failed) lost += pc.share; }
        loss += pc.share * pc.d.perSample[si].loss;
      }
      return { base: S[si].base, harvest, lostShare: planted ? lost / planted : 0, loss };
    });
    const byCrop = {}, onPlot = new Set();
    for (const pc of parcels) for (const st of pc.d.steps) {
      const row = tab[st.crop][st.t0], b = (byCrop[st.crop] ||= { crop: st.crop, area: 0, harvest: 0, plantings: [] });
      if (!onPlot.has(st.crop + "|" + parcels.indexOf(pc))) { onPlot.add(st.crop + "|" + parcels.indexOf(pc)); b.area += pc.share; } b.harvest += pc.share * row.yld * (1 - 0) ; b.plantings.push({ share: pc.share, t0: st.t0, t1: st.t1, from: period[st.t0], to: period[st.t1 - 1], fail: row.fail, yld: row.yld });
    }
    const covered = parcels.reduce((x, pc) => x + pc.share * pc.d.covered, 0) / N;
    const anyLoss = mean(per.map((x) => (x.lostShare > 0 ? 1 : 0))), bigLoss = mean(per.map((x) => (x.lostShare >= 0.5 ? 1 : 0)));
    const harvest = mean(per.map((x) => x.harvest)), loss = mean(per.map((x) => x.loss));
    const verdict = !parcels.some((pc) => pc.d.steps.length) || bigLoss >= 0.3 ? "danger" : anyLoss >= 0.3 || loss > 2.5 ? "care" : "good"; // bare soil only counts when it actually loses soil (cold winters do not)
    // Month by month, which crop is on how much of the land, for the farm calendar.
    const grid = period.map((pp, t) => {
      const here = {};
      for (const pc of parcels) {
        const m = pc.d.months[t], k = m.crop || "bare", st = pc.d.steps.find((x) => t >= x.t0 && t < x.t1);
        // A crop month takes the colour of how that planting ends (harvest share), not of one month's stress.
        const lv = st ? (st.fail >= 0.5 ? "danger" : st.fail > 0.15 || st.yld < 0.6 ? "care" : "good") : m.level;
        const c = (here[k] ||= { share: 0, levels: [] }); c.share += pc.share; c.levels.push(lv);
      }
      return here;
    });
    return { parcels, per, byCrop, covered, anyLoss, bigLoss, harvest, loss, verdict, grid, errors: parcels.flatMap((pc) => pc.errors) };
  }
  // Recommended farm: one plot per crop that holds up, each plot led by that crop and rotated with the others;
  // more land to the plots that yield more, at least 15 % each so no crop carries the whole farm.
// At most three plots: with many crops picked, one plot each split a small farm into slivers nobody would farm.
  const MAX_PLOTS = 3;
  const viable = ids.filter((id) => (windows[id].best?.value ?? 0) >= 0.35);
  const leads = (viable.length ? viable : ids).map((id) => best(ids, id)).filter((r) => r.steps.length);
  const seenL = new Set(), uniqL = leads.filter((r) => { const k = r.steps.map((x) => `${x.crop}@${x.t0}`).join(","); if (seenL.has(k)) return false; seenL.add(k); return true; })
    .sort((a, b) => b.v - a.v).slice(0, MAX_PLOTS);
  let farm = null;
  if (uniqL.length) {
    const w = uniqL.map((r) => Math.exp(1.5 * r.v)), ws = w.reduce((a, b) => a + b, 0);
    const sh = w.map((x) => 0.15 + (1 - 0.15 * w.length) * (x / ws));
    farm = evalFarm(uniqL.map((r, k) => ({ share: sh[k], steps: r.steps.map((x) => ({ crop: x.crop, t0: x.t0 })) })));
  }
  const asFarm = (r) => evalFarm([{ share: 1, steps: r.steps.map((x) => ({ crop: x.crop, t0: x.t0 })) }]);
  const todayIds = (current || []).filter((id) => crops[id]);
  // What the farmer does today: their crops only, and no straw cover (most burn or leave the field bare).
  const today = todayIds.length ? evalFarm([{ share: 1, steps: best(todayIds).steps.map((x) => ({ crop: x.crop, t0: x.t0 })) }], { noMulch: true }) : null;
  const others = uniq.filter((r) => r.steps.length).slice(0, 4).map(asFarm);
  return { period, samples: S, plans, windows, substitutes, farm, today, others, evalFarm, monthsOf: (id) => cropMonths(crops[id]) };

  // Month-by-month picture and outcome of one plan.
  function describe(r, i, noMulch = false) {
    const perSample = S.map((s, si) => {
      const cells = [];
      let cover = false, t = 0;
      for (const st of r.steps) {
        for (; t < st.t0; t++) cells.push(cover ? coverCell(s.months[t]) : bareCell(s.months[t]));
        cells.push(...tab[st.crop][st.t0].runs[si].cells);
        t = st.t1; cover = !noMulch && useMulch && CEREALS.has(st.crop);
      }
      for (; t < N; t++) cells.push(cover ? coverCell(s.months[t]) : bareCell(s.months[t]));
      const outcomes = r.steps.map((st) => tab[st.crop][st.t0].runs[si]);
      const failed = outcomes.filter((o) => o.failed).length;
      const loss = cells.reduce((x, c) => x + (c.kind === "rain_on_bare" ? c.rain / 100 : c.kind === "bare_in_sun" ? c.sev * 0.2 : 0), 0) / (N / 12);
      const level = failed ? "danger" : outcomes.some((o) => o.yieldShare < 0.6) || loss > 2.5 ? "care" : "good";
      return { base: s.base, cells, failed, level, loss };
    });
    const months = period.map((p, t) => {
      const cs = perSample.map((x) => x.cells[t]), n = cs.length;
      const share = (l) => cs.filter((c) => levelOf(c.kind, c.sev) === l).length / n;
      const level = share("danger") >= 0.5 ? "danger" : share("danger") + share("care") >= 0.5 ? "care" : "good";
      const bad = cs.filter((c) => levelOf(c.kind, c.sev) !== "good").map((c) => c.kind);
      const kind = level === "good" ? cs[0].kind : bad.sort((a, b) => bad.filter((k) => k === b).length - bad.filter((k) => k === a).length)[0];
      return { ...p, t, crop: cs[0].crop, level, kind, rain: Math.round(mean(cs.map((c) => c.rain))), need: Math.round(mean(cs.map((c) => c.need))), obs: cs[0].obs, badShare: 1 - share("good") };
    });
    const steps = r.steps.map((st) => {
      const row = tab[st.crop][st.t0], rs = row.runs;
      return { ...st, from: period[st.t0], to: period[st.t1 - 1], fail: row.fail, yld: row.yld, n: rs.length, obs: rs[0].cells.every((c) => c.obs),
               lost: rs.filter((x) => x.failed).length, cold: rs.filter((x) => x.cold).length, hot: rs.filter((x) => x.hot).length,
               dry: rs.filter((x) => x.waterFail).length, drowned: rs.filter((x) => x.drowned).length, phF: rs[0].phF, ratio: mean(rs.map((x) => x.ratio)), rain: mean(rs.map((x) => x.rain)), need: mean(rs.map((x) => x.need)) };
    });
    const bare = months.filter((m) => !m.crop).length, covered = months.filter((m) => m.crop).length;
    const worst = Math.max(0, ...steps.map((s) => s.fail));
    const dangerBare = months.filter((m) => !m.crop && m.level === "danger").length;
    const verdict = !steps.length || worst >= 0.5 ? "danger" : worst > 0.15 || dangerBare >= 3 || steps.some((s) => s.yld < 0.6) ? "care" : "good";
    return { i, score: r.v, steps, months, perSample, bare, covered, verdict, harvests: steps.reduce((x, s) => x + (1 - s.fail), 0),
             crops: [...new Set(r.steps.map((s) => s.crop))] };
  }
}
