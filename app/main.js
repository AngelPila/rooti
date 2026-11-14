import { realPast, evaluatePlans, seasonChoices } from "./engine.js?v=6";
import { STR } from "./i18n.js?v=6";

const CESIUM = "https://cdn.jsdelivr.net/npm/cesium@1.123.0/Build/Cesium/";
const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";
const PRIORITY_WEIGHTS = { soil: { water: 1, soil: 3, income: 1 }, water: { water: 3, soil: 1, income: 1 }, income: { water: 1, soil: 1, income: 3 } };
const ZONE_NAMES = { babahoyo: "Babahoyo", daule: "Daule", quevedo: "Quevedo" };
const DEFAULT_LOT = { zone: "daule", name: "", crop: "rice", irrigation: "no", size: 1, unit: "ha" };
const SEASON_MONTHS = { wet: [1, 2, 3, 4, 5], dry: [6, 7, 8, 9, 10, 11, 12] };
const ROUTES = ["inicio", "configurar", "lote", "porque", "pasado", "preguntar", "pasaporte"];
const NAV = [["inicio", "i-search", "plan"], ["lote", "i-sprout", "lot"], ["pasado", "i-history", "past"], ["pasaporte", "i-badge", "passport"]];
const CAUSE_ICON = { water_shortage: "i-drop-off", excess_rain: "i-rain", rain_on_bare: "i-rain", bare_in_sun: "i-sun", waterlogged: "i-waves" };
const WATERLOG_LEVEL = { yes: 0.8, sometimes: 0.4, no: 0.05 };
const LEVEL_ICON = { good: "i-check", care: "i-minus", danger: "i-x" };
const NOW_MONTH = new Date().getMonth();

const store = {
  get(k, d) { try { const v = localStorage.getItem("rooti:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("rooti:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const state = {
  lang: store.get("lang", matchMedia("(min-width: 1024px)").matches ? "en" : "es"),
  lot: store.get("lot", DEFAULT_LOT),
  plan: store.get("plan", null),
  draft: null,
  priority: store.get("priority", "soil"),
  scenario: "normal",
  saved: store.get("saved", null),
  pastYear: 2017,
  pastRole: "best",
  picked: null,
  savedAt: store.get("savedAt", null),
};
// A plan can come in the link: ?plan=daule,dry,soybean+peanut (shareable, and used for the demo).
{
  const q = new URLSearchParams(location.search).get("plan");
  const [zone, season, list] = (q || "").split(",");
  if (zone && ["wet", "dry"].includes(season) && list) {
    state.plan = { zone, season, crops: list.split(/[+ ]/).filter(Boolean) };
    state.lot = { ...state.lot, zone };
  }
}
const DATA = { zones: null, crops: null, outlook: null, byZone: {}, fires: {} };
const desktop = () => matchMedia("(min-width: 1024px)").matches;
const T = () => STR[state.lang];
const es = () => state.lang === "es";
const $ = (s) => document.querySelector(s);

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
}
const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
function icon(id, cls = "icon") {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("class", cls); s.setAttribute("aria-hidden", "true");
  const u = document.createElementNS("http://www.w3.org/2000/svg", "use");
  u.setAttribute("href", "#" + id); s.append(u);
  return s;
}

/* ---------------- data ---------------- */
function ok(r) { if (!r.ok) throw new Error(r.status); return r.json(); }
async function loadBase() {
  const [zones, crops, outlook, water, econ] = await Promise.all([fetch("data/zones.json").then(ok), fetch("data/crops.json").then(ok), fetch("data/outlook.json").then(ok).catch(() => null), fetch("data/surface_water.json").then(ok).catch(() => null), fetch("data/economics.json").then(ok).catch(() => null)]);
  DATA.zones = zones; DATA.crops = crops.crops; DATA.outlook = outlook; DATA.water = water; DATA.econ = econ;
  // The engine's income score comes from the typical margin per hectare (USD), when we have yield, price and cost.
  for (const [id, c] of Object.entries(DATA.crops)) {
    const e = econ?.crops?.[id], y = e?.yield_t_ha?.typical, pr = e?.price_usd_per_t?.typical, co = e?.cost_usd_ha?.typical;
    if (y && pr && co) c.market_index = Math.max(0, Math.min(1, (y * pr - co + 1000) / 2000));
  }
  const noaa = outlook?.official?.noaa;
  if (noaa?.status?.includes("El Niño") && (noaa.chance_pct ?? 0) >= 70 && !state.scenarioTouched) state.scenario = "strong_nino";
}
async function zoneData(z) { return (DATA.byZone[z] ||= await fetch(`data/${z}.json`).then(ok)); }
async function fireData(z) { if (!(z in DATA.fires)) DATA.fires[z] = await fetch(`data/fires_${z}.json`).then(ok).catch(() => null); return DATA.fires[z]; }
// Satellite answer to "does it get waterlogged?", which the farmer can correct.
function satWaterlog() {
  const idx = DATA.water?.zones?.[state.lot.zone]?.waterlogging_index ?? 0;
  return idx >= 0.4 ? "yes" : idx >= 0.15 ? "sometimes" : "no";
}
const waterlogAnswer = () => state.lot.waterlog || satWaterlog();
function opts() {
  return { scenario: state.scenario, irrigation: state.lot.irrigation === "yes", weights: PRIORITY_WEIGHTS[state.priority], waterlogging: WATERLOG_LEVEL[waterlogAnswer()], current: { wet: state.lot.crop === "other" ? "maize" : state.lot.crop, dry: "fallow" } };
}
const memo = new Map();
const cached = (key, fn) => (memo.has(key) ? memo.get(key) : (memo.set(key, fn()), memo.get(key)));
const baseWet = () => (state.lot.crop === "other" ? "maize" : state.lot.crop || "rice");
const rotationFor = (season, id) => (season === "dry" ? { wet: baseWet(), dry: id } : { wet: id, dry: "fallow" });
const mainCrop = (p) => (p.season === "wet" ? p.rotation.wet : p.rotation.dry);
function runPlans(zone, season, ids) {
  const o = { ...opts(), years: likeYears(zone)?.years };
  return evaluatePlans(zone, DATA.crops, ids.map((id) => rotationFor(season, id)), o).map((r) => ({ ...r, season }));
}
const plans = (zone) => cached(JSON.stringify(["p", state.lot.zone, state.plan, opts()]), () => {
  const { season, crops } = state.plan;
  const mine = runPlans(zone, season, crops).sort((a, b) => b.scores.total - a.scores.total).map((r, i) => ({ ...r, role: i ? `c${i}` : "best" }));
  const today = { ...evaluatePlans(zone, DATA.crops, [opts().current], { ...opts(), years: likeYears(zone)?.years })[0], season, role: "today" };
  return [...mine, today];
});
const alternatives = (zone) => cached(JSON.stringify(["a", state.lot.zone, state.plan, opts()]), () => {
  const { season, crops } = state.plan, today = mainCrop({ season, rotation: opts().current });
  const ids = seasonChoices(DATA.crops, season).filter((id) => !crops.includes(id) && id !== today);
  const rank = { good: 0, care: 1, danger: 2 }, all = runPlans(zone, season, ids).map((r) => ({ ...r, role: "alt" }));
  const mineBest = Math.min(...runPlans(zone, season, crops).map((r) => rank[verdict(r).lvl]));
  const better = all.filter((r) => rank[verdict(r).lvl] < mineBest || (mineBest === 0 && rank[verdict(r).lvl] === 0));
  return (better.length ? better : all.filter((r) => verdict(r).lvl !== "danger")).sort((a, b) => rank[verdict(a).lvl] - rank[verdict(b).lvl] || b.scores.total - a.scores.total).slice(0, 3);
});
// One word for how it would go, from the months of the chosen season and the years it failed.
function verdict(p) {
  const ms = p.calendar.filter((c) => SEASON_MONTHS[p.season].includes(c.month));
  const d = ms.filter((c) => c.level === "danger").length, c = ms.filter((x) => x.level === "care").length, f = p.failShare ?? 0;
  const lvl = f >= 0.5 || d >= 3 ? "danger" : f > 0 || d >= 1 || c >= 3 ? "care" : "good";
  const why = f > 0 && p.nYears ? T().failsIn(Math.round(f * p.nYears), p.nYears) : null;
  return { lvl, text: T().verdict[lvl] + (why ? `: ${why}` : "") };
}
const past = (zone, rotation) => cached(JSON.stringify(["r", state.lot.zone, rotation, opts().irrigation]), () =>
  realPast(zone, DATA.crops, rotation, { irrigation: opts().irrigation, weights: opts().weights })
    .map((y) => ({ ...y, level: y.failed || y.soilLoss === "high" ? "danger" : y.soilLoss === "medium" || y.verdict === "fair" ? "care" : "good" })));
const cropName = (id) => T().crops[id] || id;
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const FEM = new Set(["soybean", "velvet_bean", "jack_bean"]);
const theCrop = (id) => (es() ? `${FEM.has(id) ? "la" : "el"} ${cropName(id).toLowerCase()}` : `the ${cropName(id).toLowerCase()}`);
const planName = (p) => `${cropName(p.rotation.wet)} → ${cropName(p.rotation.dry)}`;
const seasonWord = (s) => (s === "wet" ? T().winter : T().summer).split(" (")[0].toLowerCase();
const isLegume = (id) => !!DATA.crops[id]?.n_fixing;
const roleOf = (ps, role) => ps.find((p) => p.role === role) || ps[0];

function planSummary(p) {
  const dry = mainCrop(p), bare = p.calendar.filter((c) => c.kind === "bare_in_sun" || c.kind === "rain_on_bare").length;
  if (p.role === "today") return es() ? `Así está hoy · suelo pelado ${bare} meses` : `Today · soil bare ${bare} months`;
  if (p.calendar.some((c) => c.failed)) return es() ? `Sin riego, ${cropName(dry).toLowerCase()} se seca` : `Without irrigation, ${cropName(dry).toLowerCase()} dries out`;
  if (dry === "mulch") return es() ? "Suelo cubierto en verano" : "Soil covered in the dry season";
  if (isLegume(dry)) return es() ? "Cubre el suelo y lo abona" : "Covers the soil and feeds it";
  return es() ? "Deja algo para vender" : "Leaves something to sell";
}

// The plan as one instruction, used as the answer's headline.
function actionLine(p) {
  if (p.season === "wet") return es() ? `Sembrar ${cropName(p.rotation.wet).toLowerCase()} en invierno` : `Sow ${cropName(p.rotation.wet).toLowerCase()} in the rainy season`;
  const d = p.rotation.dry, c = cropName(d).toLowerCase(), w = cropName(p.rotation.wet).toLowerCase();
  if (d === "mulch") return es() ? "Deje la paja sobre el lote" : "Leave the straw on the plot";
  if (d === "fallow") return es() ? "Dejar el suelo pelado" : "Leave the soil bare";
  return es() ? `Siembre ${c} después del ${w}` : `Sow ${c} after the ${w}`;
}

/* ---------------- money ---------------- */
const ha = () => state.lot.size * (state.lot.unit === "ha" ? 1 : 0.7056);
const usd = (x) => `${x < 0 ? "−" : "+"}$${Math.abs(Math.round(x / 10) * 10).toLocaleString(state.lang)}`;
const usdAbs = (x) => `$${Math.abs(Math.round(x / 10) * 10).toLocaleString(state.lang)}`;
// Dry-season money for a plan, for the whole plot: range from worst (low yield × low price − high cost) to best.
function seasonMoney(p) {
  const id = mainCrop(p), e = DATA.econ?.crops?.[id], A = ha();
  if (id === "fallow" || id === "mulch") return { kind: "none" };
  if (!e?.yield_t_ha && (id === "velvet_bean" || id === "jack_bean")) return { kind: "nosale" };
  const y = e?.yield_t_ha || {}, pr = e?.price_usd_per_t || {}, co = e?.cost_usd_ha || {};
  const yl = y.low ?? y.typical, yh = y.high ?? y.typical, pl = pr.low ?? pr.typical, ph = pr.high ?? pr.typical;
  if (!y.typical || !pr.typical) return { kind: "unknown" };
  const cl = co.low ?? co.typical, chi = co.high ?? co.typical;
  const qtyKg = y.typical * 1000 * A, unit = id === "rice" ? DATA.econ.units.saca_kg : DATA.econ.units.quintal_kg;
  const out = { kind: "money", incomeLow: yl * pl * A, incomeHigh: yh * ph * A, qty: Math.round(qtyKg / unit), unit: id === "rice" ? "sacas" : "qq",
    weak: (co.year && co.year < 2020) || !co.typical };
  if (co.typical) Object.assign(out, { netLow: out.incomeLow - chi * A, netHigh: out.incomeHigh - cl * A, invest: co.typical * A });
  if ((p.failShare ?? 0) > 0 && co.typical) Object.assign(out, { fails: Math.round(p.failShare * p.nYears), n: p.nYears });
  return out;
}
function moneyLine(p) {
  const m = seasonMoney(p);
  if (m.kind === "none") return T().noExtra;
  if (m.kind === "nosale") return T().noSale;
  if (m.kind === "unknown") return null;
  if (m.fails && m.fails / m.n >= 0.5) return h("span", { class: "lose" }, T().canLose(usdAbs(m.invest)));
  if ((p.failShare ?? 0) >= 0.5) return h("span", { class: "lose" }, T().noHarvest);
  return m.netLow != null ? T().moneyRange(usd(m.netLow), usd(m.netHigh)) : `${T().moneyRange(usd(m.incomeLow), usd(m.incomeHigh))} · ${T().noCost.toLowerCase()}`;
}
function moneyBlock(p) {
  const m = seasonMoney(p), area = `${state.lot.size.toLocaleString(state.lang)} ${state.lot.unit === "ha" ? "ha" : T().unitCuadra}`;
  if (m.kind !== "money") return null;
  const kids = [h("b", {}, T().money)];
  {
    kids.push(h("p", { class: "money-big" }, m.netLow != null ? T().moneyRange(usd(m.netLow), usd(m.netHigh)) : T().moneyRange(usd(m.incomeLow), usd(m.incomeHigh))),
      h("p", { class: "small" }, `${T().perLot(area)} · ${T().harvestQty(m.qty.toLocaleString(state.lang), m.unit)}`));
    if (m.netLow == null) kids.push(h("p", { class: "small" }, T().noCost));
    if (m.fails) kids.push(h("p", { class: "worst" }, icon("i-x"), T().worstCase(usdAbs(m.invest), m.fails, m.n)));
    if (m.weak) kids.push(h("span", { class: "tag-example" }, T().weakData));
  }
  return h("div", { class: "money" }, ...kids);
}

/* ---------------- voice ---------------- */
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text), want = es() ? ["es-EC", "es-419", "es-US", "es-MX", "es"] : ["en-US", "en"];
  const voices = speechSynthesis.getVoices();
  u.voice = want.map((l) => voices.find((v) => v.lang.startsWith(l))).find(Boolean) || null;
  u.lang = u.voice?.lang || want[0]; u.rate = 0.95;
  speechSynthesis.speak(u);
}
const listenBtn = (text, label = true) => ("speechSynthesis" in window ? h("button", { class: label ? "btn listen" : "round", "aria-label": T().listen, onclick: () => speak(text()) }, icon("i-volume"), label ? T().listen : null) : null);

/* ---------------- shared pieces ---------------- */
function route() {
  const [r, arg] = location.hash.replace("#/", "").split("/");
  return { r: ROUTES.includes(r) ? r : (state.plan?.crops?.length ? "lote" : "inicio"), arg };
}
const go = (r) => { location.hash = "#/" + r; };
function renderNav(active) {
  const links = (tab) => NAV.map(([r, ic, k]) => h("a", { href: "#/" + r, "aria-current": active === r ? "page" : null }, tab ? null : icon(ic), T().nav[k]));
  put($("#tabs"), links(true));
  put($("#bottom-nav"), links(false));
  $("#bottom-nav").classList.toggle("hidden", !state.plan?.crops?.length || active === "configurar");
}
function langToggle() {
  return h("button", { class: "pill", "aria-label": "Idioma / Language", onclick: () => { state.lang = es() ? "en" : "es"; store.set("lang", state.lang); memo.clear(); render(); } }, es() ? "ES | EN" : "EN | ES");
}
function skeleton() {
  return [h("div", { class: "skeleton", style: "height:96px" }), h("div", { class: "skeleton", style: "height:48px" }),
    ...[0, 1, 2].map(() => h("div", { class: "card plan" }, h("div", { class: "skeleton", style: "height:20px;width:50%" }), h("div", { class: "months" }, ...Array.from({ length: 12 }, () => h("div", { class: "skeleton", style: "height:40px" })))))];
}
const errorCard = (retry) => h("div", { class: "errorcard", role: "alert" }, icon("i-wifi-off"), h("b", { style: "flex:1" }, T().loadError), h("button", { class: "btn", onclick: retry }, T().retry));

// One month of one plan: the level is the big shape, the cause a small corner icon.
// What is on the field each month, merged into labelled spans; each month keeps its colour and opens its sheet.
const fieldOf = (c) => (c.crop ? c.crop : "bare");
const fieldName = (k) => (k === "bare" ? T().bareShort : k === "mulch" ? T().mulchShort : cropName(k));
function timeline(p) {
  const spans = [];
  p.calendar.forEach((c) => { const k = fieldOf(c), last = spans[spans.length - 1]; if (last && last.k === k) last.ms.push(c); else spans.push({ k, ms: [c] }); });
  return h("div", { class: "tl" }, ...spans.map((sp) => h("div", { class: "tl-span", style: `grid-column: span ${sp.ms.length}` },
    h("div", { class: "tl-fill" }, ...sp.ms.map((c) => h("button", { class: `tl-m ${c.level}${p.season && !SEASON_MONTHS[p.season].includes(c.month) ? " off" : ""}`, "aria-label": `${T().monthsLong[c.month - 1]}: ${fieldName(sp.k)}, ${T().level[c.level]}`, onclick: (e) => { e.stopPropagation(); openMonth(p, c); } }))),
    h("span", { class: `tl-lbl${sp.ms.length < 2 ? " short" : ""}` }, fieldName(sp.k)))));
}
function cell(p, c) {
  return h("button", { class: `cell ${c.level}`, "aria-label": `${T().monthsLong[c.month - 1]}: ${T().level[c.level]}, ${T().cause[c.kind]}`, onclick: (e) => { e.stopPropagation(); openMonth(p, c); } },
    icon(LEVEL_ICON[c.level], "icon lvl"), c.level !== "good" && CAUSE_ICON[c.kind] ? icon(CAUSE_ICON[c.kind], "icon cause") : null);
}
function monthSentence(p, c) {
  const mm = `${c.rain} mm`, crop = c.crop && c.crop !== "mulch" ? cropName(c.crop).toLowerCase() : null;
  const S = es() ? {
    water_shortage: c.failed ? `Llueven ${mm} y ${crop} pide ${c.need} mm: sin riego se pierde.` : `Llueven ${mm} y ${crop} pide ${c.need} mm.`,
    excess_rain: `Llueven ${mm}: más de lo que ${crop} aguanta.`,
    rain_on_bare: `Llueven ${mm} sobre suelo sin cultivo: el agua se lleva el suelo.`,
    bare_in_sun: `Sin cultivo y casi sin lluvia (${mm}): el sol quema el suelo.`,
    covered: `La paja cubre el suelo. Llueven ${mm}.`,
    waterlogged: `Llueven ${mm} y su lote se encharca: ${crop} sufre con el agua estancada.`,
    ok: `${cropName(c.crop)}: la lluvia alcanza (${mm}).`,
  } : {
    water_shortage: c.failed ? `${mm} of rain and ${crop} needs ${c.need} mm: without irrigation it fails.` : `${mm} of rain and ${crop} needs ${c.need} mm.`,
    excess_rain: `${mm} of rain: more than ${crop} can take.`,
    rain_on_bare: `${mm} of rain on bare soil: water washes the soil away.`,
    bare_in_sun: `No crop and little rain (${mm}): the sun burns the soil.`,
    covered: `Straw covers the soil. ${mm} of rain.`,
    waterlogged: `${mm} of rain and your plot gets waterlogged: ${crop} suffers in standing water.`,
    ok: `${cropName(c.crop)}: rain is enough (${mm}).`,
  };
  return S[c.kind] || "";
}
function sheet(...kids) {
  const d = $("#sheet");
  put(d, h("div", { class: "sheet-body" }, ...kids, h("button", { class: "btn block", onclick: () => d.close() }, T().close)));
  d.showModal();
}
function openMonth(p, c) {
  const text = monthSentence(p, c);
  sheet(h("p", { class: "small" }, planName(p)),
    h("div", { class: "row", style: "gap:14px" }, h("span", { class: `cell ${c.level}`, style: "width:56px;height:56px;flex:none" }, icon(LEVEL_ICON[c.level], "icon lvl"), c.level !== "good" && CAUSE_ICON[c.kind] ? icon(CAUSE_ICON[c.kind], "icon cause") : null),
      h("div", {}, h("h2", { class: "h2" }, `${T().monthsLong[c.month - 1][0].toUpperCase()}${T().monthsLong[c.month - 1].slice(1)}: ${T().level[c.level]}`), h("p", { class: "sub" }, T().cause[c.kind]))),
    h("p", { style: "font-size:18px" }, text), listenBtn(() => `${T().monthsLong[c.month - 1]}. ${T().level[c.level]}. ${text}`));
}
function choiceSheet(title, options, current, onPick) {
  sheet(h("h2", { class: "h2" }, title), ...options.map(([v, ic, label]) => h("button", { class: "choice-row", "aria-pressed": String(v === current), onclick: () => { $("#sheet").close(); onPick(v); } }, icon(ic), label, v === current ? icon("i-check") : null)));
}
const refresh = () => { memo.clear(); render(); };
const setLot = (patch) => { state.lot = { ...state.lot, ...patch }; store.set("lot", state.lot); refresh(); };

/* ---------------- views ---------------- */
function viewFind() {
  const v = $("#view"); v.className = "view find";
  const host = h("div", { class: "map-host" });
  const choose = (z) => { state.lot = { ...state.lot, zone: z }; store.set("lot", state.lot); memo.clear(); go("configurar"); };
  const zoneChips = h("div", { class: "row", style: "gap:8px;flex-wrap:wrap" }, ...Object.entries(ZONE_NAMES).map(([z, n]) => h("button", { class: "chip", onclick: () => choose(z) }, icon("i-pin"), n)));
  const note = h("p", { class: "note hidden" }, T().outOfArea);
  const useBtn = h("button", { class: "btn primary block hidden", onclick: () => state.picked && choose(state.picked) }, T().markFirst);
  state.onPick = () => { useBtn.classList.remove("hidden"); useBtn.textContent = `${T().useMarked} · ${ZONE_NAMES[state.picked]}`; };
  put(v, host,
    h("div", { class: "top" },
      h("div", { class: "row between" }, h("div", { class: "row", style: "gap:8px" }, h("span", { class: "logo" }, icon("i-sprout")), h("b", { style: "font-size:22px" }, "Rooti")), langToggle()),
      h("h1", { class: "h1" }, T().findTitle), h("p", { class: "lead" }, T().intro), searchBox(choose, note), note, zoneChips),
    h("div", { class: "hint" }, T().tapMap),
    h("div", { class: "bottom" }, h("button", { class: "btn block", onclick: () => locate(choose, note) }, icon("i-locate"), T().imHere), useBtn));
  initCesium(host, { pick: true, showLot: false });
}
function viewFindDesk() {
  const v = $("#view"); v.className = "view find-desk";
  const choose = (z) => { state.lot = { ...state.lot, zone: z }; store.set("lot", state.lot); memo.clear(); go("configurar"); };
  const note = h("p", { class: "note hidden" }, T().outOfArea);
  const useBtn = h("button", { class: "btn primary block hidden", onclick: () => state.picked && choose(state.picked) }, T().markFirst);
  state.onPick = () => { useBtn.classList.remove("hidden"); useBtn.textContent = `${T().useMarked} · ${ZONE_NAMES[state.picked]}`; };
  put(v,
    h("div", { class: "row between" }, h("div", { class: "row", style: "gap:8px" }, h("span", { class: "logo" }, icon("i-sprout")), h("b", { style: "font-size:22px" }, "Rooti")), langToggle()),
    h("div", { class: "find-copy" }, h("h1", { class: "h1" }, T().findTitle), h("p", { class: "lead" }, T().intro)),
    searchBox(choose, note), note,
    h("div", { class: "find-zones" }, ...DATA.zones.map((z) => h("button", { class: "zone-row", onclick: () => choose(z.zone) },
      icon("i-pin"), h("span", {}, h("b", {}, ZONE_NAMES[z.zone]), h("small", {}, T().zoneLine(z.zone))), icon("i-chev-r")))),
    h("p", { class: "small" }, T().tapMap),
    useBtn);
  initCesium($("#cesium"), { pick: true, showLot: false });
}
function searchBox(onPick, note) {
  const input = h("input", { type: "search", placeholder: T().search, "aria-label": T().search, autocomplete: "off" });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = input.value.trim().toLowerCase();
    const z = Object.keys(ZONE_NAMES).find((k) => q && (k.startsWith(q) || ZONE_NAMES[k].toLowerCase().includes(q)));
    if (z) onPick(z); else note?.classList.remove("hidden");
  });
  return h("label", { class: "search" }, icon("i-search"), input);
}
function nearestZone(lat, lon) {
  let best = null, dist = Infinity;
  for (const z of DATA.zones) { const d = Math.hypot(z.lat - lat, z.lon - lon); if (d < dist) { dist = d; best = z.zone; } }
  return { zone: best, km: dist * 111 };
}
function locate(choose, note) {
  if (!navigator.geolocation) return note.classList.remove("hidden");
  navigator.geolocation.getCurrentPosition((p) => {
    const n = nearestZone(p.coords.latitude, p.coords.longitude);
    if (n.km > 60) note.classList.remove("hidden"); else choose(n.zone);
  }, () => note.classList.remove("hidden"), { timeout: 8000 });
}

function viewSetup() {
  const v = $("#view"); v.className = "view";
  const lot = state.lot;
  const save = (patch) => { state.lot = { ...state.lot, ...patch }; store.set("lot", state.lot); memo.clear(); viewSetup(); };
  const choice = (val, key, label, ph) => h("button", { class: "choice", "aria-pressed": String(lot[key] === val), onclick: () => save({ [key]: val }) }, ph, label);
  const photo = (src) => h("span", { class: "ph", style: src ? `background-image:url(${src})` : null }, src ? null : icon("i-sprout"));
  const step = lot.unit === "ha" ? 0.5 : 1;
  const size = h("input", { class: "size-input", type: "number", inputmode: "decimal", min: "0.1", step: "0.1", value: String(lot.size), "aria-label": T().qSize, onchange: (e) => { const n = parseFloat(e.target.value); if (n > 0) save({ size: +n.toFixed(1) }); } });
  put(v,
    h("div", { class: "row between" }, h("a", { class: "round", href: "#/inicio", "aria-label": es() ? "Atrás" : "Back" }, icon("i-back")), h("a", { class: "link", href: "#/lote" }, T().skip)),
    h("h1", { class: "h1" }, T().setupTitle(ZONE_NAMES[lot.zone])),
    h("div", { class: "plan" }, h("p", { class: "q" }, T().qCrop), h("div", { class: "choices" },
      choice("rice", "crop", T().crops.rice, photo("img/rice.jpg")), choice("maize", "crop", T().crops.maize, photo("img/maize.jpg")), choice("other", "crop", T().other, photo(null)))),
    h("div", { class: "plan" }, h("p", { class: "q" }, T().qIrrigation), h("div", { class: "choices" },
      choice("yes", "irrigation", T().yes), choice("sometimes", "irrigation", T().sometimes), choice("no", "irrigation", T().no))),
    h("div", { class: "plan" }, h("p", { class: "q" }, T().qWaterlog), h("div", { class: "choices" },
      ...["yes", "sometimes", "no"].map((val) => h("button", { class: "choice", "aria-pressed": String(waterlogAnswer() === val), onclick: () => save({ waterlog: val }) }, T()[val]))),
      lot.waterlog ? null : h("p", { class: "note" }, icon("i-sat"), " ", T().satMarked)),
    h("div", { class: "plan" }, h("p", { class: "q" }, T().qSize), h("div", { class: "row" },
      h("div", { class: "stepper" },
        h("button", { "aria-label": "−", onclick: () => save({ size: Math.max(0.1, +(lot.size - step).toFixed(1)) }) }, "−"), size,
        h("button", { "aria-label": "+", onclick: () => save({ size: +(lot.size + step).toFixed(1) }) }, "+")),
      h("div", { class: "seg", style: "flex:none" }, ...["ha", "cuadra"].map((u) => h("button", { "aria-pressed": String(lot.unit === u), onclick: () => save({ unit: u }) }, u === "ha" ? T().unitHa : T().unitCuadra))))),
    h("div", { style: "flex:1" }),
    h("a", { class: "btn primary block", href: "#/lote" }, T().done));
}

function mapStrip(meta, levelNow) {
  const d = 0.006, b = [meta.lon - d * 2.6, meta.lat - d, meta.lon + d * 2.6, meta.lat + d].join(",");
  return h("a", { class: "map-strip", href: "#/inicio", "aria-label": T().findTitle },
    h("img", { alt: "", loading: "lazy", src: `${ESRI}/export?bbox=${b}&bboxSR=4326&size=780,200&format=jpg&f=image` }),
    h("span", { class: `lot-outline ${levelNow || ""}` }));
}
function seasonCard() {
  const o = DATA.outlook, z = o?.zones?.[state.lot.zone], noaa = o?.official?.noaa;
  if (!z?.last_month || !noaa?.chance_pct) return outlookLine();
  const lm = z.last_month, mon = T().monthsLong[+lm.month.slice(5) - 1];
  return h("p", { class: "season-line", title: `${mon[0].toUpperCase()}${mon.slice(1)} ${T().alreadyFell("", lm.rain_mm, lm.normal_mm).trim()}` }, icon("i-rain"), h("b", {}, T().thisYear), h("span", {}, T().official(noaa.chance_pct)));
}
function outlookLine() {
  const z = DATA.outlook?.zones?.[state.lot.zone];
  if (!z) return null;
  const sst = DATA.outlook.predictors_now.nino12_anom_c, a = z.analogs;
  const sstTxt = `${sst > 0 ? "+" : ""}${sst.toLocaleString(state.lang, { maximumFractionDigits: 1 })}`;
  return h("div", { class: "outlook" }, icon("i-rain", "icon oc-ic"),
    h("p", {}, h("b", {}, T().outlook(sstTxt)), " ", T().outlookLine(a.counts.wet, a.years.length), " ",
      state.scenario !== "wet" ? h("button", { class: "oc-btn", onclick: () => { state.scenario = "wet"; render(); } }, T().seeWet, icon("i-chev-r")) : null));
}
function controls() {
  const yearOpts = [["dry", "i-sun", T().dry], ["normal", "i-check", T().normal], ["wet", "i-rain", T().wet], ["strong_nino", "i-rain", `${T().strong_nino} (${T().likeYear})`, T().strong_nino]];
  const irrOpts = [["no", "i-drop-off", T().irrigation.no], ["yes", "i-rain", T().irrigation.yes]];
  const priOpts = [["water", "i-rain", T().priority.water], ["income", "i-coin", T().priority.income], ["soil", "i-sprout", T().priority.soil]];
  const irr = state.lot.irrigation === "yes" ? "yes" : "no";
  {
    const chip = (opts2, cur, title, onPick) => { const o = opts2.find(([v]) => v === cur); return h("button", { class: "chip big", onclick: () => choiceSheet(title, opts2, cur, onPick) }, icon(o[1]), o[3] || o[2], icon("i-chev-d")); };
    return h("div", { class: "chips" },
      chip(yearOpts, state.scenario, T().yearQ, (v) => { state.scenario = v; state.scenarioTouched = true; render(); }),
      chip(irrOpts, irr, T().qIrrigation, (v) => setLot({ irrigation: v })),
      chip(priOpts, state.priority, T().priorityQ, (v) => { state.priority = v; store.set("priority", v); refresh(); }));
  }
}
function monthsHead(season) {
  return [h("div", { class: `seasons on-${season || "none"}` }, h("span", { class: "w" }, T().winter), h("span", { class: "s" }, T().summer), h("span", { class: "w2" })),
    h("div", { class: "letters" }, ...T().months.map((m, i) => h("span", { class: i === NOW_MONTH ? "now" : null }, m)))];
}
function resultPanel(zone, ps, p, i) {
  const rs = reasons(zone, ps, p.role), r = p.season === "wet" ? rs[rs.length - 1] : rs[0], vd = verdict(p), m = moneyLine(p), name = cropName(mainCrop(p));
  return h("section", { class: "panel answer" },
    h("div", { class: "row between" }, h("p", { class: "label" }, i === 0 && ps.length > 2 && vd.lvl !== "danger" ? T().bestOfYours : `${T().option} ${i + 1}`),
      h("button", { class: "text-btn", onclick: () => removeCrop(mainCrop(p)) }, T().remove)),
    h("h2", { class: "answer-h" }, `${cap(name)} ${T().inSeason} ${seasonWord(p.season)}`),
    h("p", { class: `verdict ${vd.lvl}` }, h("i", { class: `sw-flat ${vd.lvl}` }), vd.text),
    r ? h("p", { class: "evidence" }, h("b", {}, r.big), " ", r.txt) : null,
    h("div", { class: "tl-wrap" }, ...monthsHead(p.season), timeline(p)),
    m ? h("p", { class: "money-line" }, icon("i-coin"), m) : null,
    h("div", { class: "row answer-actions" },
      h("a", { class: "btn", href: `#/porque/${p.role}` }, T().whyLink, icon("i-chev-r")),
      h("a", { class: "link", href: "#/pasado", onclick: () => { state.pastRole = p.role; } }, T().pastTitle)));
}
function altRow(p) {
  const vd = verdict(p), id = mainCrop(p);
  return h("div", { class: "opt" },
    h("div", { class: "row between" },
      h("div", {}, h("span", { class: "name" }, cap(cropName(id))), h("p", { class: `verdict small-v ${vd.lvl}` }, h("i", { class: `sw-flat ${vd.lvl}` }), vd.text)),
      h("button", { class: "btn sim", onclick: () => addCrop(id) }, icon("i-play"), T().simulate)),
    timeline(p));
}
function addCrop(id) { state.plan = { ...state.plan, crops: [...state.plan.crops, id] }; store.set("plan", state.plan); memo.clear(); render(); }
function removeCrop(id) {
  const crops = state.plan.crops.filter((x) => x !== id);
  state.plan = { ...state.plan, crops }; store.set("plan", state.plan); memo.clear();
  if (!crops.length) { state.draft = null; go("inicio"); } else render();
}
function legend() {
  return h("div", { class: "legend" },
    ...["good", "care", "danger"].map((l) => h("span", {}, h("i", { class: `sw-flat ${l}` }), T().level[l])), h("span", { class: "legend-hint" }, T().tapMonth));
}
async function viewLot() {
  const v = $("#view"); v.className = "view";
  if (!state.plan?.crops?.length) return go("inicio");
  put(v, skeleton());
  let zone;
  try { zone = await zoneData(state.lot.zone); } catch { put(v, errorCard(viewLot)); return; }
  const meta = DATA.zones.find((z) => z.zone === state.lot.zone);
  const ps = plans(zone), mine = ps.filter((p) => p.role !== "today"), best = mine[0], alts = alternatives(zone);
  const levelNow = best.calendar[NOW_MONTH].level;
  const say = () => mine.map((p) => `${cropName(mainCrop(p))}: ${verdict(p).text}`).join(". ");
  const title = h("div", { class: "row between" },
    h("div", { style: "min-width:0" }, h("h1", { class: "h1" }, T().resultsTitle), h("p", { class: "sub" }, `${ZONE_NAMES[state.lot.zone]} · ${seasonWord(state.plan.season)} (${state.plan.season === "wet" ? T().monthsWet : T().monthsDry})`)),
    h("div", { class: "row", style: "gap:8px" }, h("a", { class: "btn small-btn", href: "#/inicio", onclick: () => { state.draft = null; } }, T().change), listenBtn(say, desktop()), desktop() ? langToggle() : null));
  const head = desktop() ? title : [mapStrip(meta, levelNow), title];
  put(v, head, controls(), seasonCard(),
    ...mine.map((p, i) => resultPanel(zone, ps, p, i)),
    alts.length ? h("section", { class: "panel options" }, h("h2", { class: "panel-h" }, T().tryAlso), h("p", { class: "small" }, T().tryAlsoSub(seasonWord(state.plan.season))), ...alts.map(altRow)) : null,
    legend());
  updateMap(meta, levelNow, best);
}


/* ---------- plan: where, when, what ---------- */
function viewPlan() {
  const v = $("#view"); v.className = "view plan-view";
  const d = (state.draft ||= { zone: state.plan?.zone || null, season: state.plan?.season || "dry", crops: [...(state.plan?.crops || [])] });
  const redo = () => viewPlan();
  const ok = d.zone && d.crops.length;
  const choices = seasonChoices(DATA.crops, d.season);
  d.crops = d.crops.filter((c) => choices.includes(c));
  const photo = { rice: "img/rice.jpg", maize: "img/maize.jpg" };
  const kind = (id) => (id === "mulch" ? T().kindCover : DATA.crops[id]?.n_fixing ? T().kindLegume : T().kindCash);
  const submit = () => {
    state.plan = { zone: d.zone, season: d.season, crops: [...d.crops] }; store.set("plan", state.plan);
    state.lot = { ...state.lot, zone: d.zone }; store.set("lot", state.lot);
    state.draft = null; state.pastRole = "best"; memo.clear(); go("lote");
  };
  state.onPick = () => { d.zone = state.picked; redo(); };
  put(v,
    h("div", { class: "row between" }, h("div", { class: "row", style: "gap:8px" }, h("span", { class: "logo" }, icon("i-sprout")), h("b", { style: "font-size:22px" }, "Rooti")), langToggle()),
    h("div", { class: "find-copy" }, h("h1", { class: "h1" }, T().planTitle), h("p", { class: "lead" }, T().planLead)),
    h("section", { class: "step" }, h("h2", { class: "step-h" }, T().where),
      h("div", { class: "pick-row" }, ...DATA.zones.map((z) => h("button", { class: "pick", "aria-pressed": String(d.zone === z.zone), onclick: () => { d.zone = z.zone; redo(); } },
        h("b", {}, ZONE_NAMES[z.zone]), h("small", {}, T().province[z.zone]))))),
    h("section", { class: "step" }, h("h2", { class: "step-h" }, T().when),
      h("div", { class: "pick-row two" }, ...["wet", "dry"].map((sn) => h("button", { class: "pick", "aria-pressed": String(d.season === sn), onclick: () => { d.season = sn; redo(); } },
        h("b", {}, sn === "wet" ? T().seasonWet : T().seasonDry), h("small", {}, sn === "wet" ? T().monthsWet : T().monthsDry))))),
    h("section", { class: "step" }, h("h2", { class: "step-h" }, T().what, h("span", { class: "hint" }, T().whatHint)),
      h("div", { class: "crop-grid" }, ...choices.map((id) => h("button", { class: "crop", "aria-pressed": String(d.crops.includes(id)),
        onclick: () => { d.crops = d.crops.includes(id) ? d.crops.filter((x) => x !== id) : [...d.crops, id]; redo(); } },
        h("b", {}, cap(cropName(id))), h("small", {}, kind(id)), d.crops.includes(id) ? icon("i-check", "icon tick") : null)))),
    h("button", { class: "btn primary block go", disabled: !ok, onclick: submit }, ok ? T().seeResults(d.crops.length) : (d.zone ? T().pickCrop : T().pickZone)));
  if (desktop()) initCesium($("#cesium"), { pick: true, showLot: false });
}

/* ---------- why: one per plan ---------- */
// Evidence uses past years like the chosen scenario (a strong El Niño is judged on very wet years), plus the total.
function likeYears(zone) {
  const t = state.scenario === "strong_nino" ? "wet" : ["dry", "normal", "wet"].includes(state.scenario) ? state.scenario : null;
  if (!t) return null;
  return { years: zone.year_types[t].years.filter((y) => y >= 2001 && y <= 2024), label: es() ? { dry: "secos", normal: "normales", wet: "muy lluviosos" }[t] : { dry: "dry", normal: "normal", wet: "very wet" }[t] };
}
function reasons(zone, ps, role) {
  const p = roleOf(ps, role), best = roleOf(ps, "best"), today = roleOf(ps, "today");
  const yrs = past(zone, p.rotation), n = yrs.length, cnt = (arr, l) => arr.filter((y) => y.level === l).length;
  const like = likeYears(zone), sub = (arr) => (like ? arr.filter((y) => like.years.includes(y.year)) : arr);
  const out = [], s = sub(yrs), ns = s.length, lbl = like ? (es() ? `años ${like.label}` : `${like.label} years`) : (es() ? "años" : "years");
  const dang = cnt(s, "danger"), dangAll = cnt(yrs, "danger"), dangToday = cnt(sub(past(zone, today.rotation)), "danger"), dangBest = cnt(sub(past(zone, best.rotation)), "danger");
  out.push({ lvl: dang <= Math.max(1, ns / 8) ? "good" : dang <= ns / 3 ? "care" : "danger", big: es() ? `${dang} de ${ns}` : `${dang} of ${ns}`,
    txt: (role === "today"
      ? (es() ? `${lbl} con daño fuerte. Con ${cropName(best.rotation.dry).toLowerCase()}: ${dangBest} de ${ns}.` : `${lbl} with heavy damage. With ${cropName(best.rotation.dry).toLowerCase()}: ${dangBest} of ${ns}.`)
      : (es() ? `${lbl} con daño fuerte. Hoy: ${dangToday} de ${ns}.` : `${lbl} with heavy damage. Today: ${dangToday} of ${ns}.`))
      + (like ? (es() ? ` En todos los años: ${dangAll} de ${n}.` : ` In all years: ${dangAll} of ${n}.`) : "") });
  const failedAll = yrs.filter((y) => y.failed), failedLike = s.filter((y) => y.failed).length;
  const failedCrop = theCrop((failedAll.flatMap((y) => y.failedCrops || [])[0]) || mainCrop(p));
  if (failedAll.length) out.push({ lvl: failedLike > ns / 2 ? "danger" : failedLike ? "care" : "good", big: es() ? `${failedLike} de ${ns}` : `${failedLike} of ${ns}`,
    txt: es() ? `${lbl} ${failedCrop} se secó${opts().irrigation ? "" : " sin riego"}.${like ? ` En todos los años: ${failedAll.length} de ${n}; si el verano sale seco, se pierde.` : ""}`
      : `${lbl} ${failedCrop} dried out${opts().irrigation ? "" : " without irrigation"}.${like ? ` In all years: ${failedAll.length} of ${n}; if the dry season turns out dry, it fails.` : ""}` });
  else if (!["fallow", "mulch"].includes(mainCrop(p))) out.push({ lvl: "good", big: es() ? `${n} de ${n}` : `${n} of ${n}`, txt: es() ? `años ${cropName(mainCrop(p)).toLowerCase()} dio cosecha.` : `years ${cropName(mainCrop(p)).toLowerCase()} gave a harvest.` });
  return out;
}
function todoText(p, ps) {
  if (p.season === "wet" && p.role !== "today") return es() ? `Siembre ${cropName(p.rotation.wet).toLowerCase()} con las primeras lluvias de enero y coseche antes de junio.` : `Sow ${cropName(p.rotation.wet).toLowerCase()} with the first January rains and harvest before June.`;
  const dry = p.rotation.dry, wet = cropName(p.rotation.wet).toLowerCase(), best = roleOf(ps, "best");
  if (p.role === "today") return es() ? `Hoy el suelo queda pelado después del ${wet}. Lo que más lo protege: ${planName(best).toLowerCase()}.` : `Today the soil stays bare after the ${wet}. What protects it most: ${planName(best).toLowerCase()}.`;
  if (dry === "mulch") return es() ? "Después de cosechar, no queme la paja. Déjela tendida sobre el lote hasta el próximo invierno." : "After the harvest, don't burn the straw. Leave it spread over the lot until the next rains.";
  if (p.calendar.some((c) => c.failed)) return es() ? `Solo siembre ${cropName(dry).toLowerCase()} si puede regar en verano.` : `Only sow ${cropName(dry).toLowerCase()} if you can irrigate in the dry season.`;
  return es() ? `Siembre ${cropName(dry).toLowerCase()} apenas coseche el ${wet}${opts().irrigation ? ", con riego" : ""}.` : `Sow ${cropName(dry).toLowerCase()} right after the ${wet} harvest${opts().irrigation ? ", with irrigation" : ""}.`;
}
function savePlan(p) { state.saved = { key: JSON.stringify(p.rotation), name: planName(p), date: Date.now() }; store.set("saved", state.saved); render(); }
function whySection(zone, ps, role, compact = false) {
  const p = roleOf(ps, role), rs = reasons(zone, ps, role), isSaved = state.saved?.key === JSON.stringify(p.rotation);
  const say = () => `${planName(p)}. ${planSummary(p)}. ${rs.map((r) => r.big + " " + r.txt).join(". ")}. ${todoText(p, ps)}. ${T().checkLocal}`;
  return h("section", { class: `plan why${compact ? " boxed" : ""}`, style: "gap:16px" },
    compact ? h("h2", { class: "h2" }, `${T().whyLink}: ${planName(p)}`) : null,
    ...rs.map((r) => h("div", { class: `reason ${r.lvl}` }, h("b", {}, r.big), h("span", {}, r.txt))),
    h("div", { class: "todo" }, h("b", {}, T().whatToDo), h("p", {}, todoText(p, ps), p.role !== "today" ? h("span", { class: "try" }, " " + T().tryFirst) : null)),
    moneyBlock(p),
    h("details", { class: "unknown" }, h("summary", {}, T().unknownTitle), h("ul", {}, ...[...T().unknown, T().moneyCheck].map((t) => h("li", {}, t)))),
    h("p", { class: "check" }, icon("i-user"), T().checkLocal),
    compact ? null : h("p", { class: "small" }, T().source),
    h("div", { class: "actions" },
      h("button", { class: "btn primary block", "aria-pressed": String(isSaved), onclick: () => savePlan(p) }, isSaved ? [icon("i-check"), T().saved] : T().save),
      compact ? null : h("a", { class: "btn wa block", href: waLink(es() ? `¿Me conviene ${planName(p).toLowerCase()} en mi lote de ${ZONE_NAMES[state.lot.zone]}?` : `Is ${planName(p).toLowerCase()} right for my lot in ${ZONE_NAMES[state.lot.zone]}?`), target: "_blank", rel: "noopener" }, icon("i-chat"), T().askWa)),
    compact ? null : listenBtn(say));
}
async function viewWhy(role = "best") {
  const v = $("#view"); v.className = "view"; put(v, skeleton());
  const zone = await zoneData(state.lot.zone), ps = plans(zone), p = roleOf(ps, role);
  put(v,
    h("div", { class: "row between" }, h("a", { class: "round", href: "#/lote", "aria-label": es() ? "Atrás" : "Back" }, icon("i-back")), p.role === "best" ? h("span", { class: "badge" }, T().recommended) : null),
    h("div", {}, h("h1", { class: "h1" }, actionLine(p)), h("p", { class: "sub" }, `${planName(p)} · ${planSummary(p)}`)),
    timeline(p),
    whySection(zone, ps, role));
}

/* ---------- real past ---------- */
function yearLabel(zone, y) {
  const yt = zone.year_types, oni = zone.years[String(y)]?.oni_peak ?? 0;
  const rain = yt.wet.years.includes(y) ? (es() ? "invierno muy lluvioso" : "very wet rainy season") : yt.dry.years.includes(y) ? (es() ? "invierno seco" : "dry rainy season") : (es() ? "invierno normal" : "normal rainy season");
  const enso = oni >= 1.5 ? (es() ? "Niño fuerte" : "strong El Niño") : oni >= 0.5 ? (es() ? "Niño" : "El Niño") : oni <= -0.5 ? (es() ? "Niña" : "La Niña") : null;
  return [enso, rain].filter(Boolean).join(" · ");
}
function outcomeText(p, y) {
  const c = cropName((y.failedCrops || [])[0] || p.rotation.dry).toLowerCase();
  if (y.failed) return es() ? `${c} se secó` : `${c} dried out`;
  if (y.soilLoss === "high") return es() ? "mucho daño al suelo" : "heavy soil damage";
  if (y.soilLoss === "medium") return es() ? "algo de daño al suelo" : "some soil damage";
  return es() ? "sin problema" : "no problem";
}
async function pastSection(zone, ps, standalone = false) {
  const p = roleOf(ps, state.pastRole), ys = past(zone, p.rotation), cnt = (l) => ys.filter((y) => y.level === l).length;
  const y = state.pastYear, all = ys.map((x) => x.year), i = all.indexOf(y);
  const step = (d) => { state.pastYear = all[Math.min(all.length - 1, Math.max(0, i + d))]; render(); };
  return h("section", { class: "plan", style: "gap:16px" },
    h("div", {}, h(standalone ? "h1" : "h2", { class: standalone ? "h1" : "h2" }, T().pastTitle), h("p", { class: "sub" }, T().pastSub)),
    h("div", { class: "seg plan-tabs" }, ...ps.map((q) => h("button", { "aria-pressed": String(q.role === p.role), onclick: () => { state.pastRole = q.role; render(); } }, q.role === "today" ? `${T().usual}: ${cropName(mainCrop(q)).toLowerCase()}` : cropName(mainCrop(q))))),
    h("div", { class: "counts" }, ...["good", "care", "danger"].map((l) => h("span", {}, h("i", { class: `sw-flat ${l}` }), `${cnt(l)} ${T().level[l].toLowerCase()}`))),
    h("div", { class: "years" }, ...ys.map((x) => h("button", { class: x.level, "aria-label": `${x.year}: ${T().level[x.level]}`, "aria-pressed": String(x.year === y), onclick: () => { state.pastYear = x.year; render(); } },
      h("span", {}, `'${String(x.year).slice(2)}`)))),
    h("div", { class: "yeardetail" },
      h("div", { class: "row between" }, h("button", { class: "round white", "aria-label": es() ? "Año anterior" : "Previous year", onclick: () => step(-1) }, icon("i-chev-l")),
        h("div", {}, h("p", { class: "y" }, String(y)), h("p", { class: "ys" }, yearLabel(zone, y))),
        h("button", { class: "round white", "aria-label": es() ? "Año siguiente" : "Next year", onclick: () => step(1) }, icon("i-chev-r"))),
      ...ps.map((q) => { const yy = past(zone, q.rotation).find((x) => x.year === y); return h("div", { class: "outcome" }, h("i", { class: `sw-flat ${yy.level}` }), h("span", {}, h("b", {}, planName(q)), ": ", outcomeText(q, yy))); })));
}
async function viewPast() {
  const v = $("#view"); v.className = "view"; put(v, skeleton());
  const zone = await zoneData(state.lot.zone);
  put(v, await pastSection(zone, plans(zone), true));
}

/* ---------- ask ---------- */
const waLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
async function viewAsk() {
  const v = $("#view"); v.className = "view";
  const zone = await zoneData(state.lot.zone), ps = plans(zone), best = roleOf(ps, "best");
  const cash = ps.find((p) => p.role === "cash"), rc = cash ? reasons(zone, ps, "cash").find((r) => r.txt.includes(cropName(cash.rotation.dry).toLowerCase())) : null;
  const q1 = es() ? `¿Qué siembro después del ${cropName(best.rotation.wet).toLowerCase()}?` : `What should I plant after the ${cropName(best.rotation.wet).toLowerCase()}?`;
  const answer = `${es() ? "Para su" : "For your"} ${state.lot.name}: ${todoText(best, ps)}${rc ? ` ${rc.big} ${rc.txt}` : ""}`;
  const audio = (d) => h("div", { class: "audio" }, icon("i-play"), h("span", { class: "wave" }), d);
  put(v,
    h("div", { class: "row between" }, h("div", {}, h("h1", { class: "h1" }, T().askTitle), h("p", { class: "sub" }, T().askSub)), h("span", { class: "tag-example" }, T().example)),
    h("div", { class: "chat" },
      h("div", { class: "bubble me" }, audio("0:12"), q1),
      h("div", { class: "bubble" }, answer, audio("0:20")),
      h("div", { class: "bubble" }, es() ? "¿Le aviso cuando empiecen las lluvias?" : "Shall I tell you when the rains start?",
        h("div", { class: "row", style: "gap:8px" }, ...(es() ? ["Sí, avíseme", "No"] : ["Yes, tell me", "No"]).map((l) => h("span", { class: "btn wa quick" }, l))))),
    h("div", { class: "plan", style: "gap:8px" }, ...(es() ? ["¿Cuándo siembro el arroz?", "¿Va a llover este mes?"] : ["When should I sow the rice?", "Will it rain this month?"]).map((q) => h("a", { class: "suggest", href: waLink(q), target: "_blank", rel: "noopener" }, icon("i-chat"), q))),
    h("a", { class: "btn wa-fill block", href: waLink(q1), target: "_blank", rel: "noopener" }, icon("i-mic"), T().sendAudio));
}

/* ---------- passport: a dated record, no score ---------- */
async function viewPassport() {
  const v = $("#view"); v.className = "view";
  const f = await fireData(state.lot.zone);
  const yrs = f ? Object.entries(f.years).filter(([, x]) => x.lot_fires_by_month) : [];
  const seasonFire = (x) => x.lot_fires_by_month.slice(4).findIndex((n) => n > 0);
  const zoneBurn = yrs.filter(([, x]) => x.zone_fires_by_month.slice(4).some((n) => n > 0)).length;
  const last = yrs[yrs.length - 1], lastM = last ? seasonFire(last[1]) : -1;
  const head = last ? h("div", { class: `pp-answer ${lastM < 0 ? "good" : "danger"}` }, h("p", { class: "pp-q" }, T().burnQ(last[0])),
    h("p", { class: "pp-a" }, lastM < 0 ? T().noBurn : T().burnIn(T().monthsLong[lastM + 4])), h("small", {}, icon("i-sat"), T().viaSat)) : null;
  const list = h("ul", { class: "pp-years" }, ...yrs.slice(-5, -1).reverse().map(([y, x]) => { const m = seasonFire(x);
    return h("li", {}, h("b", {}, y), h("span", { class: m < 0 ? "ok" : "bad" }, m < 0 ? T().noBurnShort : T().burnShort(T().monthsLong[m + 4]))); }));
  put(v,
    h("div", {}, h("h1", { class: "h1" }, T().passportTitle), h("p", { class: "sub" }, ZONE_NAMES[state.lot.zone])),
    head, list,
    state.saved ? h("p", { class: "small" }, icon("i-check"), " ", T().savedPlan(state.saved.name)) : null,
    yrs.length ? h("p", { class: "small" }, T().zoneFires(zoneBurn, yrs.length)) : null,
    h("div", { class: "row", style: "gap:10px" },
      h("button", { class: "btn primary", style: "flex:1", onclick: () => navigator.share ? navigator.share({ title: T().passportTitle, url: location.href }).catch(() => {}) : null }, icon("i-share"), T().share),
      h("button", { class: "btn" }, icon("i-qr"), T().qr)));
}

/* ---------------- CesiumJS ---------------- */
let cesiumLoading = null, viewer = null, lotEntity = null;
function loadCesium() {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  return (cesiumLoading ||= new Promise((res, rej) => {
    window.CESIUM_BASE_URL = CESIUM;
    const s = document.createElement("script"); s.src = CESIUM + "Cesium.js"; s.onload = () => res(window.Cesium); s.onerror = rej; document.head.append(s);
  }));
}
async function initCesium(container, { pick = false, showLot = true } = {}) {
  let C;
  try { C = await loadCesium(); } catch { return; }
  if (viewer && viewer.container !== container) { viewer.destroy(); viewer = null; lotEntity = null; }
  if (!viewer) {
    viewer = new C.Viewer(container, { baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, requestRenderMode: true });
    try { viewer.imageryLayers.addImageryProvider(await C.ArcGisMapServerImageryProvider.fromUrl(ESRI)); }
    catch { viewer.imageryLayers.addImageryProvider(new C.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" })); }
    for (const z of DATA.zones) viewer.entities.add({ id: "zone-" + z.zone, position: C.Cartesian3.fromDegrees(z.lon, z.lat), point: { pixelSize: 10, color: C.Color.WHITE, outlineColor: C.Color.fromCssColorString("#006B77"), outlineWidth: 3 }, label: { text: ZONE_NAMES[z.zone], font: "600 14px Inter, sans-serif", fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -18) } });
  }
  if (pick) {
    new C.ScreenSpaceEventHandler(viewer.scene.canvas).setInputAction((e) => {
      const cart = viewer.camera.pickEllipsoid(e.position, viewer.scene.globe.ellipsoid); if (!cart) return;
      const g = C.Cartographic.fromCartesian(cart);
      state.picked = nearestZone(C.Math.toDegrees(g.latitude), C.Math.toDegrees(g.longitude)).zone;
      viewer.entities.removeById("picked");
      viewer.entities.add({ id: "picked", position: cart, point: { pixelSize: 20, color: C.Color.fromCssColorString("#006B77"), outlineColor: C.Color.WHITE, outlineWidth: 4 } });
      viewer.scene.requestRender(); state.onPick?.();
    }, C.ScreenSpaceEventType.LEFT_CLICK);
    viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(-79.7, -1.55, 120000), duration: 1.2 });
  }
  if (showLot) updateMap(DATA.zones.find((z) => z.zone === state.lot.zone));
}
function updateMap(meta, levelNow = "good", best = null) {
  if (!viewer || !window.Cesium || !meta) return;
  const C = window.Cesium, half = Math.sqrt(state.lot.size * (state.lot.unit === "ha" ? 10000 : 7056)) / 2;
  const dLat = half / 111320, dLon = half / (111320 * Math.cos(meta.lat * Math.PI / 180));
  const col = { good: "#15803D", care: "#B45309", danger: "#B91C1C" }[levelNow];
  if (lotEntity) viewer.entities.remove(lotEntity);
  for (const z of DATA.zones) { const e = viewer.entities.getById("zone-" + z.zone); if (e) e.show = z.zone !== state.lot.zone; }
  const label = best ? `${ZONE_NAMES[state.lot.zone]} · ${T().monthsLong[NOW_MONTH]}: ${T().level[levelNow]}` : ZONE_NAMES[state.lot.zone];
  lotEntity = viewer.entities.add({
    polygon: { height: 0, hierarchy: C.Cartesian3.fromDegreesArray([meta.lon - dLon, meta.lat - dLat, meta.lon + dLon, meta.lat - dLat * 0.9, meta.lon + dLon * 0.95, meta.lat + dLat, meta.lon - dLon * 1.05, meta.lat + dLat * 0.92]), material: C.Color.fromCssColorString(col).withAlpha(0.45), outline: true, outlineColor: C.Color.WHITE, outlineWidth: 3 },
    position: C.Cartesian3.fromDegrees(meta.lon, meta.lat),
    label: { text: label, font: "700 15px Inter, sans-serif", fillColor: C.Color.fromCssColorString("#111827"), showBackground: true, backgroundColor: C.Color.WHITE, backgroundPadding: new C.Cartesian2(10, 6), pixelOffset: new C.Cartesian2(0, -36) },
  });
  viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(meta.lon, meta.lat - 0.011, 1400), orientation: { heading: 0, pitch: C.Math.toRadians(-48), roll: 0 }, duration: 1.6 });
  viewer.scene.requestRender();
}

/* ---------------- app ---------------- */
function offlineBanner() {
  const b = $("#offline"), off = !navigator.onLine;
  b.classList.toggle("hidden", !off);
  if (off) b.querySelector("span").textContent = T().offline(state.savedAt ? new Date(state.savedAt).toLocaleDateString(state.lang, { day: "numeric", month: "short" }) : "—");
}
async function render() {
  const { r, arg } = route();
  document.documentElement.lang = state.lang;
  renderNav(r); offlineBanner();
  document.body.classList.toggle("first", !state.plan?.crops?.length);
  $("#search-desk").placeholder = T().search;
  if (r !== "inicio" && desktop() && (!viewer || viewer.container !== $("#cesium"))) initCesium($("#cesium"));
  const views = { inicio: viewPlan, configurar: viewSetup, lote: viewLot, porque: () => viewWhy(arg || "best"), pasado: viewPast, preguntar: viewAsk, pasaporte: viewPassport };
  try { await views[r](); } catch (e) { console.error(e); put($("#view"), errorCard(render)); }
}
async function start() {
  put($("#view"), skeleton());
  try { await loadBase(); } catch { put($("#view"), errorCard(start)); return; }
  state.savedAt = Date.now(); store.set("savedAt", state.savedAt);
  $("#search-desk").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = e.target.value.trim().toLowerCase(), z = Object.keys(ZONE_NAMES).find((k) => q && k.startsWith(q));
    if (z) setLot({ zone: z });
  });
  addEventListener("hashchange", () => { render(); $(".content").scrollTo?.(0, 0); scrollTo(0, 0); });
  addEventListener("online", offlineBanner); addEventListener("offline", offlineBanner);
  let w = innerWidth; addEventListener("resize", () => { if ((innerWidth >= 1024) !== (w >= 1024)) { w = innerWidth; if (viewer) { viewer.destroy(); viewer = null; lotEntity = null; } render(); } });
  render();
}
start();
