import { fetchClimate } from "./climate.js?v=22";
import { plan as runPlanner, cropMonths, NINO_ONSET } from "./planner.js?v=35";
import { COPY } from "./copy.js?v=55";
import { fetchTerrain, describeSoil, waterlogFactor } from "./terrain.js?v=23";
import { STR } from "./i18n.js?v=22";
import { createBootcamp } from "./bootcamp.js?v=3";
import { link, initLink, linked, waUrl, hasWhatsApp, canHandoff, saveLot, choosePlan, handoff } from "./link.js?v=2";
import { createRooti } from "./rooti.js?v=3";

const CESIUM = "https://cdn.jsdelivr.net/npm/cesium@1.123.0/Build/Cesium/";
const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";
const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const REV = "https://nominatim.openstreetmap.org/reverse";
const PILOTS = { daule: [-1.86, -79.98], babahoyo: [-1.80, -79.53], quevedo: [-1.03, -79.46] };
const CROP_ORDER = ["rice", "maize", "soybean", "potato", "common_bean", "peanut", "sorghum", "wheat", "barley", "sunflower", "chickpea", "cowpea", "jack_bean", "velvet_bean", "mulch"];
const UNITS = { ha: 1, cuadra: 0.7056, m2: 0.0001, acre: 0.4047 };
const STEP = { ha: 0.5, cuadra: 1, m2: 100, acre: 1 };
const CEREALS = new Set(["rice", "maize", "sorghum", "wheat", "barley"]);
const GREEN = new Set(["jack_bean", "velvet_bean"]);
const RESULTS = ["plan", "terreno", "probar", "comparar", "pasado", "pasaporte", "vecinos"];

/* ---------------- state ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("rooti:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("rooti:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const iso = (d) => `${String(d.getFullYear()).padStart(4, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const firstNextMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1); };
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 0);
const supportedLang = (lang) => lang === "es" || lang === "en";
const browserLang = (navigator.language || "es").toLowerCase().startsWith("es") ? "es" : "en";
const query = new URLSearchParams(location.search);
const savedLang = store.get("lang", browserLang);
const state = {
  lang: supportedLang(query.get("lang")) ? query.get("lang") : supportedLang(savedLang) ? savedLang : browserLang,
  plan: store.get("plan3", null),
  pick: null,
  mode: "all",
  draft: null, custom: null, customKey: null, undo: null, pastBase: undefined, showAll: false, saved: store.get("saved3", null),
};
// Ready-made examples: their climate and plot data ship with the app, so the demo works even without internet.
const DEMOS = {
  // The Daule example comes with a drawn plot on the fields east of town, so "Su terreno" shows a real plot (≈ 5.2 ha)
  daule: { place: { name: "Daule", admin: "Guayas, Ecuador", lat: -1.86, lon: -79.98 }, crops: ["maize", "soybean", "rice", "mulch"], current: ["rice"], area: 5.2, lot: [[-79.96035, -1.87965], [-79.95825, -1.87975], [-79.95830, -1.88175], [-79.96030, -1.88165]] },
  quevedo: { place: { name: "Quevedo", admin: "Los Ríos, Ecuador", lat: -1.03, lon: -79.46 }, crops: ["maize", "soybean", "peanut", "mulch"], current: ["maize"], area: 3 },
  iowa: { place: { name: "Ames", admin: "Iowa, USA", lat: 42.03, lon: -93.62 }, crops: ["maize", "soybean", "wheat"], current: ["maize"], area: 40, unit: "acre" },
};
const demoKey = (pl) => Object.keys(DEMOS).find((k) => Math.abs(DEMOS[k].place.lat - pl.lat) < 0.01 && Math.abs(DEMOS[k].place.lon - pl.lon) < 0.01);
const demoData = {};
const loadDemo = (k) => (demoData[k] ||= fetch(`data/demo/${k}.json?v=2`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }));
const demoPlan = (k) => { const s = firstNextMonth(), D = DEMOS[k]; return { place: D.place, start: iso(s), end: iso(addMonths(s, 12)), crops: D.crops, current: D.current, irrigation: false, area: D.area, unit: D.unit || "ha", waterlog: null, ...(D.lot ? { lot: D.lot } : {}) }; };
const EXAMPLE = () => ({ place: { name: "Daule", admin: "Guayas, Ecuador", lat: -1.86, lon: -79.98 }, start: iso(firstNextMonth()), end: iso(addMonths(firstNextMonth(), 12)), crops: ["maize", "soybean", "mulch"], irrigation: false, area: 5.2, unit: "ha" });
const DATA = { crops: null, econ: null, outlook: null, fires: {}, clim: {}, terrain: {}, zone: {} };
const desktop = () => matchMedia("(min-width: 1024px)").matches;
const C = () => COPY[state.lang];
const S = () => STR[state.lang];
const es = () => state.lang === "es";
const $ = (s) => document.querySelector(s);

/* ---------------- tiny DOM helpers ---------------- */
function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "style" && typeof v === "object") { for (const [p, val] of Object.entries(v)) p.startsWith("--") ? n.style.setProperty(p, val) : (n.style[p] = val); }
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
}
function svg(tag, attrs = {}, ...kids) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const k of kids.flat(Infinity)) if (k) n.append(k);
  return n;
}
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const FILLED = new Set(["i-neighbors", "i-maize", "i-rice", "i-soybean", "i-straw", "i-rain", "i-sun", "i-sow", "i-harvest", "i-plot", "i-care", "i-water", "i-nino", "i-income", "i-soil", "i-agronomist", "i-month", "i-shield", "i-arrow", "i-info", "i-check", "i-x"]);
const ALIAS = { "i-sprout": "i-sow", "i-drops": "i-water", "i-waves": "i-water", "i-coin": "i-income", "i-alert": "i-care", "i-user": "i-agronomist", "i-wheat": "i-harvest", "i-calendar": "i-month", "i-cloud-sun": "i-sun", "i-leaf": "i-sow" };
function icon(id, cls = "icon") {
  id = ALIAS[id] || id;
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("class", FILLED.has(id) ? `${cls} f` : cls); s.setAttribute("aria-hidden", "true");
  const u = document.createElementNS("http://www.w3.org/2000/svg", "use");
  u.setAttribute("href", "#" + id); s.append(u);
  return s;
}
const ok = (r) => { if (!r.ok) throw new Error(r.status); return r.json(); };
const remoteJSON = (url, ms = 12000) => fetch(url, { signal: AbortSignal.timeout(ms) }).then(ok);
const go = (r) => { location.hash = "#/" + r; };

/* ---------------- words and numbers ---------------- */
const cropName = (id) => (id === "mulch" ? C().straw : S().crops[id] || DATA.crops?.[id]?.[es() ? "name_es" : "name_en"] || id);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const mon = (m) => S().monthsLong[m - 1].slice(0, 3);
const ym = (p) => `${mon(p.m)} ${p.y}`;
const monL = (m) => S().monthsLong[m - 1];
const span = (a, b) => (a.y === b.y ? (a.m === b.m ? `${monL(a.m)} ${a.y}` : `${C().ds.monthsTo(monL(a.m), monL(b.m))} ${a.y}`) : C().ds.monthsTo(`${monL(a.m)} ${a.y}`, `${monL(b.m)} ${b.y}`));
const fmtDate = (s) => new Date(s + "T12:00:00").toLocaleDateString(state.lang, { day: "numeric", month: "short", year: "numeric" });
// A plan's dates as months spelled out: "diciembre 2026 a noviembre 2027"
const fmtSpan = (P) => { const m = (s) => { const d = new Date(s + "T12:00:00"); return `${d.toLocaleDateString(state.lang, { month: "long" })} ${d.getFullYear()}`; }; return `${m(P.start)} ${es() ? "a" : "to"} ${m(P.end)}`; };
const num = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(state.lang);
const fmtArea = (share, P = state.plan) => { const v = share * (P.area || 1); return `${P.unit === "m2" ? Math.round(v).toLocaleString(state.lang) : num(v)} ${C().units[P.unit || "ha"]}`; };
const andList = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${es() ? "y" : "and"} ${xs[xs.length - 1]}`);
function fracParts(x) { let best = [1, 2], err = 1; for (let n = 2; n <= 10; n++) { const k = Math.max(1, Math.round(x * n)); const e = Math.abs(k / n - x); if (e < err - 0.02) { err = e; best = [k, n]; } } return best; }
// 0.83 -> "5 de cada 6": plain fractions instead of percentages.
const frac = (x) => (x <= 0.001 ? C().none : x >= 0.999 ? (es() ? "Todos" : "All") : C().kOf(...fracParts(x)));
const nearPilot = (pl) => Object.entries(PILOTS).find(([, [la, lo]]) => Math.hypot(la - pl.lat, lo - pl.lon) * 111 < 40)?.[0] || null;
function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T12:00:00");
  return date.getFullYear() > 0 && iso(date) === value ? date : null;
}
function monthsIn(P) {
  const start = parseDate(P.start), end = parseDate(P.end);
  if (!start || !end || end < start) return 0;
  return (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1;
}
const hasCrop = (crops) => crops.some((id) => id !== "mulch" && Object.hasOwn(DATA.crops, id));
const validArea = (area) => Number.isFinite(area) && area > 0;

function readSharedPlan() {
  if (!["lat", "lon", "crops"].some((key) => query.has(key))) return;
  state.sharedLink = true;
  const lat = Number(query.get("lat")?.trim() || NaN), lon = Number(query.get("lon")?.trim() || NaN);
  const place = Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { name: query.get("place") || `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon } : null;
  const cropIds = (key) => [...new Set((query.get(key) || "").split(/[+ ,]/).filter(Boolean))];
  const requested = cropIds("crops");
  const crops = requested.filter((id) => id === "mulch" || Object.hasOwn(DATA.crops, id));
  const current = cropIds("now").filter((id) => Object.hasOwn(DATA.crops, id));
  const start = query.get("from") ?? iso(firstNextMonth());
  const startDate = parseDate(start);
  const end = query.get("to") ?? (startDate ? iso(addMonths(startDate, 12)) : "");
  const area = Number(query.get("area") ?? 1), unit = query.get("unit") ?? "ha";
  const waterlog = query.get("wl");
  const plan = {
    place, start: startDate ? start : "", end: parseDate(end) ? end : "", crops, current,
    irrigation: query.get("irr") === "1", area: validArea(area) ? area : 1,
    unit: Object.hasOwn(UNITS, unit) ? unit : "ha",
    waterlog: ["yes", "sometimes", "no"].includes(waterlog) ? waterlog : null,
  };
  if (place && !dateErr(plan) && hasCrop(crops) && crops.length === requested.length && validArea(area) && Object.hasOwn(UNITS, unit)) {
    state.plan = plan;
  } else {
    state.plan = null;
    state.draft = plan;
    state.linkError = true;
    if (!location.hash) history.replaceState(null, "", "#/planear");
  }
}

/* ---------------- data ---------------- */
async function loadBase() {
  const [crops, econ, outlook] = await Promise.all([fetch("data/crops.json?v=21").then(ok), fetch("data/economics.json").then(ok).catch(() => null), fetch("data/outlook.json").then(ok).catch(() => null)]);
  DATA.crops = crops.crops; DATA.econ = econ; DATA.outlook = outlook;
}
function climate(pl) {
  const k = `${pl.lat.toFixed(2)},${pl.lon.toFixed(2)}`, dk = demoKey(pl);
  return (DATA.clim[k] ||= (dk ? loadDemo(dk).then((d) => d.clim) : fetchClimate(pl.lat, pl.lon)).catch((e) => { delete DATA.clim[k]; throw e; }));
}
// Plot data: elevation, slope and soil for any point; in the pilot zones our own soil and satellite water data.
async function terrain(pl) {
  const k = `${pl.lat.toFixed(3)},${pl.lon.toFixed(3)}`, z = nearPilot(pl);
  if (!DATA.terrain[k]) DATA.terrain[k] = (async () => {
    let pilotSoil = null, pilotWater = null;
    if (z) {
      const [zd, sw] = await Promise.all([fetch(`data/${z}.json`).then(ok).catch(() => null), fetch("data/surface_water.json").then(ok).catch(() => null)]);
      const so = zd?.soil; if (so?.clay) pilotSoil = { clay: so.clay.value_0_30cm, sand: so.sand.value_0_30cm, phh2o: so.phh2o.value_0_30cm, soc: so.soc.value_0_30cm, nitrogen: so.nitrogen?.value_0_30cm };
      pilotWater = sw?.zones?.[z]?.waterlogging_index ?? null;
    }
    const dk = demoKey(pl);
    const t = dk ? await loadDemo(dk).then((d) => d.terrain) : await fetchTerrain(pl.lat, pl.lon, pilotSoil).catch(() => ({ soil: null }));
    return { ...t, pilotWater, zone: z };
  })();
  return DATA.terrain[k];
}
function siteOf(t, P) {
  const d = describeSoil(t?.soil);
  return { awc: d?.awc ?? 90, ph: d?.ph ?? null, slope: t?.slopePct ?? 0, wl: waterlogFactor(t, P.waterlog, t?.pilotWater) };
}
const memo = new Map();
async function results(P = state.plan, mode = state.mode, priority = "soil") {
  const [c, tr] = await Promise.all([climate(P.place), terrain(P.place)]), key = JSON.stringify([P, mode, priority]);
  if (!memo.has(key)) {
    const site = siteOf(tr, P);
    const start = P.start.slice(0, 7), end = P.end.slice(0, 7);
    const ninoOffset = ninoNow(P) ? CURRENT_NINO_ONSET - Number(start.slice(0, 4)) : 0;
    memo.set(key, { clim: c, P, terrain: tr, site, ninoOffset, ...runPlanner(c, DATA.crops, P.crops, { start, end, irrigation: P.irrigation, priority, mode, ninoOffset, site, current: P.current || [] }) });
  }
  return memo.get(key);
}
async function fireData(z) { if (!(z in DATA.fires)) DATA.fires[z] = await fetch(`data/fires_${z}.json`).then(ok).catch(() => null); return DATA.fires[z]; }
const setPlan = (P) => {
  state.plan = P;
  store.set("plan3", P);
  state.custom = null;
  state.linkError = false;
  if (state.sharedLink) {
    const url = new URL(location.href);
    for (const key of ["lat", "lon", "place", "from", "to", "crops", "irr", "area", "unit", "now", "wl"]) url.searchParams.delete(key);
    history.replaceState(null, "", url);
    state.sharedLink = false;
  }
};

/* ---------------- voice and sheets ---------------- */
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text), want = es() ? ["es-EC", "es-419", "es-US", "es-MX", "es"] : ["en-US", "en"];
  const voices = speechSynthesis.getVoices();
  u.voice = want.map((l) => voices.find((v) => v.lang.startsWith(l))).find(Boolean) || null;
  u.lang = u.voice?.lang || want[0]; u.rate = 0.95;
  speechSynthesis.speak(u);
  return u;
}
function sheet(...kids) {
  const d = $("#sheet");
  put(d, h("div", { class: "sheet-body" }, ...kids, h("button", { class: "btn block", onclick: () => d.close() }, C().close)));
  d.showModal();
}
const langBtn = () => h("button", { class: "pill", "aria-label": "Idioma / Language", onclick: () => { state.lang = es() ? "en" : "es"; store.set("lang", state.lang); render(); rooti.lang(); } }, es() ? "ES | EN" : "EN | ES");
// The Mosaico mark: four modules, four plots
const MARK = '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="m1" d="M14 0H32V36H50V53H0V14A14 14 0 0 1 14 0Z"/><path class="m2" d="M37 0H86A14 14 0 0 1 100 14V47H74V31H37Z"/><path class="m3" d="M55 52H100V86A14 14 0 0 1 86 100H70V70H55Z"/><path class="m4" d="M0 58H27V75H65V100H14A14 14 0 0 1 0 86Z"/></svg>';
const lockup = (light) => { const mk = h("span", { class: "mk" }); mk.innerHTML = MARK; return h("a", { class: `lockup${light ? " light" : ""}`, href: "#/", "aria-label": "Rooti" }, mk, h("span", { class: "wordmark" }, "rooti")); };
const brand = () => lockup(false);
const loading = (msg) => h("div", { class: "loading" }, msg ? h("p", { class: "small" }, msg) : null, h("div", { class: "skeleton", style: { height: "120px" } }), h("div", { class: "skeleton", style: { height: "280px" } }), h("div", { class: "skeleton", style: { height: "160px" } }));
const errorCard = (msg, retry) => h("div", { class: "errorcard", role: "alert" }, icon("i-wifi-off"), h("b", { class: "grow" }, msg), h("button", { class: "btn", onclick: retry }, C().retry));
const stepIcon = (ic) => icon(ic === "calendar" ? "i-calendar" : ic === "map-pin" ? "i-pin" : "i-sprout");
const bootcamp = createBootcamp({ h, put, icon, tile: (id) => tile(id), store, speak });

function viewBootcamp(section, courseId, lessonNumber) {
  const crops = CROP_ORDER.filter((id) => DATA.crops[id]).map((id) => ({
    id,
    name: cap(cropName(id)),
    months: cropMonths(DATA.crops[id]),
  }));
  put($("#view"), bootcamp(state.lang, crops, C().cta, () => { state.draft = null; }, section, courseId, lessonNumber));
}

/* ================= landing ================= */
const SVGNS = "http://www.w3.org/2000/svg";
// Smooth path through points (Catmull-Rom as cubic Béziers)
function smooth(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}
// Curves that converge on the headline. Decoration: drawn once, inner lines first, with uneven gaps.
function heroLines(svg, title, animate = true) {
  const art = svg.parentElement;
  if (!art?.isConnected || getComputedStyle(art).display === "none") return;
  const a = art.getBoundingClientRect(), t = title.getBoundingClientRect(), H = a.height, k = H / 860;
  svg.setAttribute("viewBox", `0 0 1440 ${H}`);
  const ex = Math.min(560, t.left - a.left - 28), cy = t.top - a.top + t.height / 2, top = t.top - a.top - 90;
  const L = [[[130, 186 * k], [ex, cy - 36]], [[40, 330 * k], [ex, cy - 12]], [[40, 520 * k], [ex, cy + 12]], [[120, 650 * k], [ex, cy + 36]]];
  const curve = ([p, q]) => `M${p[0]},${p[1]} C${(p[0] + q[0]) / 2},${p[1]} ${(p[0] + q[0]) / 2 + 60},${q[1]} ${q[0]},${q[1]}`;
  const all = [...L, ...L.map(([p, q]) => [[1440 - p[0], p[1]], [1440 - q[0], q[1]]])];
  svg.innerHTML = all.map((l) => `<path d="${curve(l)}"/><circle cx="${l[0][0]}" cy="${l[0][1]}" r="3.5"/><circle cx="${l[1][0]}" cy="${l[1][1]}" r="3"/>`).join("") +
    (top > 140 ? `<path d="M720,110 V${top}"/><circle cx="720" cy="${top}" r="3"/><circle cx="720" cy="110" r="3"/>` : "");
  const geo = { all, top: top > 140 ? top : 0, cy };
  if (!MOTION() || !animate) return geo;
  const AT = [90, 0, 30, 140];
  svg.querySelectorAll("path").forEach((p, i) => {
    const n = p.getTotalLength(); p.style.strokeDasharray = n;
    p.animate([{ strokeDashoffset: n }, { strokeDashoffset: 0 }], { duration: 1100, delay: 200 + (AT[i % 4] ?? 60), easing: "cubic-bezier(.65,0,.35,1)", fill: "both" });
  });
  svg.querySelectorAll("circle").forEach((c) => c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 1150, fill: "backwards" }));
  return geo;
}
// On a computer the hero holds still while the scroll carries the data on the left into one plan and out to the four plans on the right.
// It follows the scroll position and runs backwards with it; nothing plays on its own.
function heroSignals(svg, g, stage, start) {
  if (!g || !MOTION() || !stage.isConnected) return;
  const D = C().ds, art = svg.parentElement, hero = stage.firstElementChild, copy = hero.querySelector(".hero-copy"), src = hero.querySelector(".hero-source");
  const hub = [720, g.cy], R = [56, 112, 176], ring = (r) => 2 * Math.PI * r;
  const mk = (tag, attrs) => { const n = document.createElementNS(SVGNS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.appendChild(n); return n; };
  const drawn = (p) => { p.n = p.getTotalLength(); p.style.strokeDasharray = p.n; return p; };
  const rings = R.map((r) => { const c = mk("circle", { class: "hs-ring", cx: hub[0], cy: hub[1], r, transform: `rotate(-90 ${hub[0]} ${hub[1]})` }); c.n = ring(r); c.style.strokeDasharray = c.n; return c; });
  const left = g.all.slice(0, 4), right = g.all.slice(4), hx = hub[0] - R[0], ox = hub[0] + R[0];
  const ins = left.map(([, q]) => drawn(mk("path", { d: `M${q[0]},${q[1]} C${q[0] + 90},${q[1]} ${hx - 60},${hub[1]} ${hx},${hub[1]}` })));
  if (g.top) ins.push(drawn(mk("path", { d: `M720,${g.top} V${hub[1] - R[0]}` })));
  const outs = right.map(([, q]) => drawn(mk("path", { class: "hs-out", d: `M${ox},${hub[1]} C${ox + 60},${hub[1]} ${q[0] - 90},${q[1]} ${q[0]},${q[1]}` })));
  // The art box is 1440 wide and centered, so on narrower screens its edges are cut off; labels stay inside what shows.
  const vis = Math.max(0, 720 - innerWidth / 2) + 20;
  const lab = (x, y, cls, [b, sub]) => h("div", { class: `hs-lab ${cls}`, style: { left: `${x}px`, top: `${y}px` } }, h("b", {}, b), sub ? h("span", {}, sub) : null);
  const inLabs = left.map(([p], i) => lab(Math.max(p[0], vis), p[1], "", D.signals[i]));
  if (g.top) inLabs.push(lab(720, 110, "side", D.signalTop));
  const outLabs = right.map(([p], i) => lab(Math.min(p[0], 1440 - vis), p[1], "r", [D.names[["safe", "income", "soil", "today"][i]]]));
  const dot = h("div", { class: "hs-hub", style: { left: `${hub[0]}px`, top: `${hub[1]}px` } });
  const hubLab = h("div", { class: "hs-hub-lab", style: { left: `${hub[0]}px`, top: `${hub[1]}px` } }, D.signalHub);
  art.append(...inLabs, ...outLabs, dot, hubLab);
  const end = h("div", { class: "hs-end" }, h("p", {}, D.signalEnd), h("button", { class: "btn lime big", onclick: start }, C().cta, h("span", { class: "dot" }, icon("i-arrow-r"))));
  hero.append(end);

  const S = (p, a, b) => Math.max(0, Math.min(1, (p - a) / (b - a)));
  const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const show = (el, t, clip) => { el.style.visibility = t > 0 ? "visible" : "hidden"; el.style.clipPath = clip(100 - t * 100); };
  const draw = () => {
    const r = stage.getBoundingClientRect(), p = S(-r.top, 0, r.height - hero.offsetHeight);
    const c = ease(S(p, 0, .22));
    copy.style.opacity = src.style.opacity = 1 - c;
    copy.style.transform = `translateY(${-28 * c}px) scale(${1 - .04 * c})`;
    copy.style.visibility = c > .98 ? "hidden" : "";
    inLabs.forEach((el, i) => show(el, ease(S(p, .1 + i * .06, .18 + i * .06)), (v) => `inset(0 ${v}% 0 0)`));
    rings.forEach((el, i) => (el.style.strokeDashoffset = el.n * (1 - ease(S(p, .2 + i * .05, .42 + i * .05)))));
    ins.forEach((el, i) => (el.style.strokeDashoffset = el.n * (1 - ease(S(p, .36 + i * .02, .56 + i * .02)))));
    const k = ease(S(p, .54, .62));
    dot.style.visibility = k > 0 ? "visible" : "hidden";
    dot.style.transform = `scale(${.3 + .7 * k})`;
    show(hubLab, S(p, .58, .66), (v) => `inset(0 ${v / 2}% 0 ${v / 2}%)`);
    outs.forEach((el, i) => (el.style.strokeDashoffset = el.n * (1 - ease(S(p, .6 + i * .03, .74 + i * .03)))));
    outLabs.forEach((el, i) => show(el, ease(S(p, .68 + i * .04, .76 + i * .04)), (v) => `inset(0 0 0 ${v}%)`));
    const e = ease(S(p, .82, .94));
    show(end, e, (v) => `inset(0 0 ${v}% 0)`);
    end.style.transform = `translateY(${16 * (1 - e)}px)`;
  };
  let raf = 0;
  const onScroll = () => {
    if (!stage.isConnected) return removeEventListener("scroll", onScroll);
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
  };
  addEventListener("scroll", onScroll, { passive: true });
  stage.cleanup = () => {
    removeEventListener("scroll", onScroll);
    [...inLabs, ...outLabs, dot, hubLab, end].forEach((el) => el.remove());
    for (const el of [copy, src]) el.style.opacity = el.style.transform = el.style.visibility = "";
  };
  draw();
}
// Geometry depends on the window size and the stage only exists from 721px up, so a resize rebuilds it from scratch.
function mountHero(art, title, start) {
  const stage = $(".hero-stage");
  heroSignals(art, heroLines(art, title), stage, start);
  let t = 0;
  const onResize = () => {
    if (!stage.isConnected) return removeEventListener("resize", onResize);
    clearTimeout(t);
    t = setTimeout(() => { stage.cleanup?.(); stage.cleanup = null; heroSignals(art, heroLines(art, title, false), stage, start); }, 150);
  };
  addEventListener("resize", onResize);
}
const MOTION = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
const ILLU = { daule: "rice", quevedo: "maize", iowa: "soybean" };
function viewLanding() {
  const c = C(), D = c.ds;
  const start = () => { state.draft = null; go("planear"); };
  const openDemo = (k) => { setPlan(demoPlan(k)); state.mode = defaultMode(state.plan); state.pick = null; memo.clear(); go("plan"); };
  const dot = (ic = "i-arrow-r") => h("span", { class: "dot" }, icon(ic));
  const art = document.createElementNS(SVGNS, "svg"), title = h("h1", { class: "display" }, c.heroTitle);
  put($("#view"), h("div", { class: "landing" }, h("div", { class: "hero-stage" },
    h("header", { class: "hero" }, h("div", { class: "hero-img", style: { backgroundImage: "url(img/sat/daule.jpg)" } }), h("div", { class: "hero-art", "aria-hidden": "true" }, art),
      h("nav", { class: "l-nav" }, lockup(true),
        h("div", { class: "l-links" }, langBtn(), h("a", { class: "btn glass desk-only", href: "#/bootcamp" }, c.ctaBootcamp), h("button", { class: "btn lime desk-only", onclick: start }, c.cta, dot()))),
      h("div", { class: "hero-copy" }, h("span", { class: "pill-eyebrow glass mono" }, D.eyebrow), title, h("p", { class: "lead" }, c.heroLead),
        h("div", { class: "hero-actions" }, h("button", { class: "btn lime big", onclick: start }, c.cta, dot()), h("button", { class: "btn glass big", onclick: () => openDemo("daule") }, D.example, dot()))),
      h("p", { class: "hero-source mono" }, D.source))),
    h("section", { class: "l-sheet" }, h("div", { class: "l-wrap" },
      h("div", { class: "l-stats" }, ...D.howStats.map(([n, t]) => h("div", { class: "l-stat" }, h("b", {}, n), h("span", {}, t)))),
      h("div", { class: "l-how-head", id: "how" }, h("span", { class: "eyebrow lime-tag" }, D.howEyebrow), h("h2", { class: "h2" }, D.howTitle)),
      h("div", { class: "l-how" }, ...D.how.map(([img, t, d, alt], i, all) => {
        const agent = i === all.length - 1;
        return h("article", { class: agent ? "how agent" : "how" }, h("span", { class: "how-img" }, h("img", { src: `img/how/${img}.png`, alt, loading: "lazy" })),
          agent ? h("span", { class: "eyebrow lime-tag" }, D.howAgent) : null,
          h("b", {}, h("i", {}, `${i + 1}.`), " ", t), h("p", {}, d));
      })),
      h("h2", { class: "h2" }, D.examplesTitle),
      h("div", { class: "l-demos" }, ...Object.keys(DEMOS).map((k) => h("button", { class: "demo-card", onclick: () => openDemo(k) }, h("img", { src: `img/illu/${ILLU[k]}-clean.png`, alt: "", loading: "lazy" }),
        h("span", { class: "txt" }, h("span", { class: "pill-eyebrow glass mono" }, D.demoTag[k]), h("b", { class: "h3" }, c.demo[k]), h("span", { class: "go" }, D.see, icon("i-arrow-r")))))),
      h("a", { class: "l-boot", href: "#/bootcamp" }, h("span", { class: "tile-i" }, icon("i-agronomist")), h("span", {}, h("b", {}, D.bootTitle), h("p", {}, D.bootLead)), icon("i-arrow-r")),
      h("p", { class: "small", style: { textAlign: "center" } }, c.heroNote))),
    h("footer", { class: "l-foot" }, h("div", { class: "l-wrap" }, lockup(true), h("div", { class: "credits" }, h("p", {}, D.credits), h("p", {}, "NASA Space Apps Challenge 2026 · Field Shift"))))));
  tilt(document.querySelectorAll(".how"));
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => mountHero(art, title, start));
}
// Cards lean toward the pointer on desktop; CSS eases the vars so each move stays short.
function tilt(cards) {
  if (!MOTION() || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  cards.forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      el.style.setProperty("--rx", `${(-y * 5).toFixed(2)}deg`); el.style.setProperty("--ry", `${(x * 6).toFixed(2)}deg`);
      el.style.setProperty("--mx", `${((x + .5) * 100).toFixed(1)}%`); el.style.setProperty("--my", `${((y + .5) * 100).toFixed(1)}%`);
    });
    el.addEventListener("pointerleave", () => { el.style.removeProperty("--rx"); el.style.removeProperty("--ry"); });
  });
}

/* ================= planner ================= */
function draft() {
  if (!state.draft) {
    const P = state.plan, s = firstNextMonth();
    state.draft = P ? JSON.parse(JSON.stringify(P)) : { place: null, start: iso(s), end: iso(addMonths(s, 12)), crops: [], irrigation: false, area: 1, unit: "ha", current: [], waterlog: null };
  }
  return state.draft;
}
const dateErr = (d) => { const n = monthsIn(d); return !(n >= 2) ? C().tooShort : n > 72 ? C().tooLong : null; };
async function placeAt(lat, lon) {
  const base = { name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon };
  try {
    const r = await remoteJSON(`${REV}?lat=${lat}&lon=${lon}&format=json&zoom=10&accept-language=${state.lang}`);
    const a = r.address || {};
    return { ...base, name: a.village || a.town || a.city || a.county || a.state || base.name, admin: [a.state, a.country].filter(Boolean).join(", ") };
  } catch { return base; }
}
function searchBox(onPick) {
  const results = h("div", { class: "geo" }), input = h("input", { type: "search", placeholder: C().search, "aria-label": C().search, autocomplete: "off" });
  let timer, request = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    const current = ++request;
    if (q.length < 2) return put(results);
    timer = setTimeout(async () => {
      try {
        const r = await remoteJSON(`${GEO}?name=${encodeURIComponent(q)}&count=5&language=${state.lang}&format=json`);
        if (current !== request) return;
        put(results, ...(r.results || []).map((x) => h("button", { onclick: () => onPick({ name: x.name, admin: [x.admin1, x.country].filter(Boolean).join(", "), lat: x.latitude, lon: x.longitude }) },
          icon("i-pin"), h("span", {}, h("b", {}, x.name), h("small", {}, [x.admin1, x.country].filter(Boolean).join(", "))))));
        if (!r.results?.length) put(results, h("p", { class: "small", style: { padding: "12px 14px" } }, C().noPlace));
      } catch { if (current === request) put(results, h("p", { class: "small", role: "status", style: { padding: "12px 14px" } }, C().geoError)); }
    }, 300);
  });
  return [h("label", { class: "search" }, icon("i-search"), input), results];
}
const endDraw = () => { state.drawing = false; state.addCorner = null; document.body.classList.remove("drawing"); };
/* ---------- the plot drawn on the map: corners as [lon, lat] ---------- */
// Area on a local flat projection (shoelace): exact enough for a farm, a few metres across
const lotXY = (pts) => { const R = 6371008.8, k = Math.PI / 180, lat0 = pts.reduce((a, p) => a + p[1], 0) / pts.length * k; return pts.map(([lo, la]) => [lo * k * R * Math.cos(lat0), la * k * R]); };
const lotHa = (pts) => { if (!pts || pts.length < 3) return 0; const xy = lotXY(pts); let s = 0; xy.forEach((p, i) => { const q = xy[(i + 1) % xy.length]; s += p[0] * q[1] - q[0] * p[1]; }); return Math.abs(s) / 2 / 1e4; };
const lotCenter = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
const lotSpanM = (pts) => { if (!pts?.length) return 0; const xy = lotXY(pts), xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]); return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); };
const inUnit = (ha, unit) => { const v = ha / UNITS[unit || "ha"]; return unit === "m2" ? Math.round(v) : Math.round(v * 100) / 100; };
const areaText = (ha, unit) => `${inUnit(ha, unit).toLocaleString(state.lang)} ${C().units[unit || "ha"]}`;
// Tap each corner on the map; the area fills itself in. Repaints only its own box and the map, so the map does not reload per tap.
function lotTools(d, after) {
  const box = h("div", { class: "lot-tools" }), L = C().lot;
  let before = null;
  const sync = (fly = false) => { if (d.lot?.length >= 3) d.area = Math.max(d.unit === "m2" ? 1 : 0.01, inUnit(lotHa(d.lot), d.unit)); updateMap(d.place, null, d.lot, fly); paint(); };
  const start = () => { before = { lot: d.lot ? [...d.lot] : null, area: d.area }; state.drawing = true; d.lot = []; sync("draw"); };
  const stop = (keep) => { state.drawing = false; document.body.classList.remove("drawing"); if (!keep) { d.lot = before.lot; d.area = before.area; } state.addCorner = null; after(); };
  const paint = () => {
    const n = d.lot?.length || 0;
    document.body.classList.toggle("drawing", !!state.drawing);
    state.addCorner = state.drawing ? (lon, lat) => { (d.lot ||= []).push([lon, lat]); sync(); } : null;
    put(box, ...(state.drawing ? [
      h("p", { class: "lot-hint" }, icon("i-pointer"), h("span", {}, n < 3 ? L.tap(n) : L.size(areaText(lotHa(d.lot), d.unit)))),
      h("div", { class: "lot-acts" },
        h("button", { class: "btn dark", disabled: n < 3, onclick: () => stop(true) }, icon("i-check"), L.done),
        h("button", { class: "btn light", disabled: !n, onclick: () => { d.lot.pop(); sync(); } }, icon("i-undo"), L.undo),
        h("button", { class: "link", onclick: () => stop(false) }, L.cancel))]
      : n >= 3 ? [h("div", { class: "lot-row" }, icon("i-plot"), h("span", { class: "grow" }, h("b", {}, L.drawn), h("small", {}, L.size(areaText(lotHa(d.lot), d.unit)))), h("button", { class: "link", onclick: start }, L.redraw))]
      : [h("button", { class: "btn light block", onclick: start }, icon("i-plot"), L.draw), h("p", { class: "small" }, L.why)]));
  };
  paint();
  return box;
}
const placeCard = (d, onChange) => h("div", { class: "place" }, icon("i-pin"), h("div", { class: "grow" }, h("b", {}, d.place.name), h("small", {}, d.place.admin || "")), onChange ? h("button", { class: "link", onclick: onChange }, C().change) : null);
const gpsBtn = (onPick) => h("button", { class: "link gps", style: { alignSelf: "flex-start" }, onclick: (e) => { const b = e.currentTarget; b.disabled = true; navigator.geolocation?.getCurrentPosition(async (p) => onPick(await placeAt(p.coords.latitude, p.coords.longitude)), () => { b.disabled = false; }, { timeout: 10000 }); } }, icon("i-locate"), " ", C().useLocation);
function periodStrip(d) {
  const a = new Date(d.start + "T12:00:00"), n = Math.max(0, Math.min(24, monthsIn(d)));
  return h("div", { class: "period", "aria-hidden": "true" }, ...Array.from({ length: n }, (_, i) => h("i", { class: (a.getMonth() + i) % 12 < 5 ? "w" : "s" })));
}
const quickDates = (d, redo) => h("div", { class: "row wrap", style: { gap: "8px" } }, ...C().quick.map(([k, l]) => {
  const start = parseDate(d.start);
  const end = start && iso(addMonths(start, +k));
  return h("button", { class: "chip", disabled: !parseDate(end), "aria-pressed": String(monthsIn(d) === +k), onclick: () => { d.end = end; redo(); } }, l);
}));
const dateFields = (d, redo) => h("div", { class: "dates" }, ...[["start", C().from], ["end", C().to]].map(([k, l]) =>
  h("label", { class: "date" }, h("small", {}, l), h("input", { type: "date", value: d[k], onchange: (e) => { d[k] = e.target.value; redo(); } }))));
const kind = (id) => (id === "mulch" ? C().kindCover : DATA.crops[id]?.n_fixing ? C().kindLegume : C().kindCash);
function cropTiles(d, redo, limit) {
  const all = CROP_ORDER.filter((id) => id === "mulch" || DATA.crops[id]);
  const shown = limit && !state.showAll ? all.filter((id, i) => i < limit || d.crops.includes(id)) : all;
  return [h("div", { class: "crops" }, ...shown.map((id) => {
    const on = d.crops.includes(id);
    return h("button", { class: "crop", "aria-pressed": String(on), onclick: () => { d.crops = on ? d.crops.filter((x) => x !== id) : [...d.crops, id]; redo(); } },
      on ? icon("i-check", "icon tick") : null, tile(id), h("span", {}, h("b", {}, cap(cropName(id))), h("small", {}, kind(id) + (id !== "mulch" ? ` · ${cropMonths(DATA.crops[id])} ${es() ? "meses" : "months"}` : ""))));
  })),
  limit ? h("button", { class: "link", style: { alignSelf: "flex-start" }, onclick: () => { state.showAll = !state.showAll; redo(); } }, state.showAll ? C().fewer : C().more(all.length - shown.length)) : null];
}
function areaBox(d, redo) {
  const set = (v) => { d.area = Math.max(d.unit === "m2" ? 1 : 0.1, +v.toFixed(2)); redo(); };
  return h("div", { class: "area" },
    h("div", { class: "area-num" }, h("button", { class: "round", "aria-label": "−", onclick: () => set(d.area - STEP[d.unit]) }, icon("i-minus")),
      h("input", { type: "number", inputmode: "decimal", min: "0", step: "any", value: String(d.area), "aria-label": C().landQ, onchange: (e) => { const n = parseFloat(e.target.value); if (n > 0) set(n); } }),
      h("button", { class: "round", "aria-label": "+", onclick: () => set(d.area + STEP[d.unit]) }, icon("i-plus"))),
    h("div", { class: "seg" }, ...Object.keys(UNITS).map((u) => h("button", { "aria-pressed": String(d.unit === u), onclick: () => { d.unit = u; if (d.lot?.length >= 3) d.area = inUnit(lotHa(d.lot), u); redo(); } }, C().units[u]))));
}
const currentChips = (d, redo) => h("div", { class: "row wrap", style: { gap: "6px" } }, ...CROP_ORDER.filter((id) => id !== "mulch" && DATA.crops[id]).slice(0, 8).map((id) => {
  const on = (d.current || []).includes(id);
  return h("button", { class: "chip", "aria-pressed": String(on), onclick: () => { d.current = on ? d.current.filter((x) => x !== id) : [...(d.current || []), id]; redo(); } }, cap(cropName(id)));
}));
const waterlogOpts = (d, redo) => h("div", { class: "opts" }, ...[["yes", C().yes], ["sometimes", C().sometimes], ["no", C().no], [null, C().dontKnow]].map(([v, l]) => h("button", { class: "opt", "aria-pressed": String((d.waterlog ?? null) === v), onclick: () => { d.waterlog = v; redo(); } }, l)));
const irrigOpts = (d, redo) => h("div", { class: "opts" }, ...[[false, C().no], [true, C().yes]].map(([v, l]) => h("button", { class: "opt", "aria-pressed": String(d.irrigation === v), onclick: () => { d.irrigation = v; redo(); } }, l)));
const submitPlan = () => { setPlan({ ...state.draft, crops: [...state.draft.crops] }); state.draft = null; state.undo = null; state.mode = defaultMode(state.plan); memo.clear(); syncLot(); go("plan"); };
// Opened from WhatsApp: the lot marked here goes to Rooti, which confirms it in the chat
function syncLot() {
  if (!linked()) return;
  state.lotSync = "saving";
  saveLot(state.plan).then(() => { state.lotSync = "saved"; }, () => { state.lotSync = "error"; }).finally(() => $("#lotSync")?.replaceWith(lotSyncEl()));
}
function lotSyncEl() {
  const W = C().wa, s = state.lotSync;
  if (!s) return h("div", { id: "lotSync", hidden: true });
  return h("div", { id: "lotSync", class: `wa-sync ${s}`, role: "status" }, icon(s === "error" ? "i-wifi-off" : s === "saved" ? "i-check" : "i-chat"),
    h("span", { class: "grow" }, s === "saving" ? W.saving : s === "saved" ? W.lotSaved : W.lotError),
    s === "error" ? h("button", { class: "link", onclick: syncLot }, W.retry) : null);
}

// A scroll box without a scrollbar fades at the edge that has more content
function edgeFade(el) {
  if (!el) return;
  const f = () => { el.style.setProperty("--fade-t", el.scrollTop > 4 ? "28px" : "0px"); el.style.setProperty("--fade-b", el.scrollTop + el.clientHeight < el.scrollHeight - 4 ? "40px" : "0px"); };
  el.addEventListener("scroll", f, { passive: true }); new ResizeObserver(f).observe(el); f();
}
// Redrawing the planner after a tap (a crop, a date, a unit) keeps the scroll where the farmer was
function keepScroll(draw) {
  const y = scrollY, els = [".pf-secs", "#view", ".res.cmp > .col-left"].map((q) => [q, document.querySelector(q)?.scrollTop || 0]);
  const back = () => { for (const [q, t] of els) { const el = document.querySelector(q); if (el) el.scrollTop = t; } scrollTo(0, y); };
  const out = draw();
  if (out?.then) return out.then((v) => { back(); return v; });
  back();
  return out;
}
function viewPlanear(stepArg) {
  const d = draft();
  if (desktop()) return planDesktop(d);
  const n = Math.min(4, Math.max(1, +stepArg || 1)), redo = () => keepScroll(() => viewPlanear(n));
  const c = C(), err = dateErr(d);
  const head = h("div", { class: "step-head" },
    h("div", { class: "row between" }, h("button", { class: "round", "aria-label": es() ? "Atrás" : "Back", onclick: () => (n > 1 ? go(`planear/${n - 1}`) : go("")) }, icon("i-back")), h("span", { class: "small", style: { fontWeight: 600 } }, c.stepOf(n))),
    h("div", { class: "progress" }, ...[1, 2, 3, 4].map((i) => h("i", { class: i <= n ? "on" : "" }))));
  const title = (t, help) => h("div", {}, h("h1", { class: "display" }, t), h("p", { class: "help" }, help));
  const nextBtn = (label, okk, to) => h("button", { class: "btn dark big block", disabled: !okk, onclick: to }, label);
  let body;
  if (n === 1) {
    const pick = (pl) => { endDraw(); d.place = pl; d.lot = null; redo(); };
    state.onPick = async (lat, lon) => (state.addCorner ? state.addCorner(lon, lat) : pick(await placeAt(lat, lon)));
    const box = h("div", { class: "mapbox" });
    body = [title(c.whereQ, c.whereHelp), ...(d.place ? [] : searchBox(pick)), box, d.place ? placeCard(d, () => { d.place = null; d.lot = null; state.drawing = false; redo(); }) : h("p", { class: "small" }, c.tapMap), d.place ? lotTools(d, redo) : null, state.drawing ? null : gpsBtn(pick), h("div", { class: "spacer" }), nextBtn(c.next, !!d.place, () => go("planear/2"))];
    setTimeout(() => initCesium(box, { pick: true }).then(() => (d.place ? updateMap(d.place, null, d.lot, state.drawing ? false : d.lot?.length >= 3 ? "lot" : "place") : globeView())), 0);
  } else if (n === 2) {
    body = [title(c.whenQ, c.whenHelp), dateFields(d, redo), quickDates(d, redo), h("div", { class: "card", style: { gap: "8px", padding: "16px" } }, h("b", {}, c.months(Math.max(0, monthsIn(d)))), periodStrip(d)), err ? h("p", { class: "err" }, err) : null, h("div", { class: "spacer" }), nextBtn(c.next, !err, () => go("planear/3"))];
  } else if (n === 3) {
    body = [title(c.whatQ, c.whatHelp), ...cropTiles(d, redo, 6), h("div", { class: "spacer" }), nextBtn(hasCrop(d.crops) ? c.nextCrops(d.crops.length) : c.pickCrop, hasCrop(d.crops), () => go("planear/4"))];
  } else {
    const ready = d.place && hasCrop(d.crops) && !err;
    body = [title(c.landQ, c.landHelp), areaBox(d, redo), h("div", { class: "q" }, h("b", {}, c.irrigQ), irrigOpts(d, redo)), h("div", { class: "q" }, h("b", {}, c.wlQ, h("small", { class: "small", style: { fontWeight: 400 } }, " · ", c.optional)), waterlogOpts(d, redo)), h("div", { class: "q" }, h("b", {}, c.todayQ, h("small", { class: "small", style: { fontWeight: 400 } }, " · ", c.optional)), currentChips(d, redo)), h("div", { class: "spacer" }),
    nextBtn(ready ? c.seePlan : !d.place ? c.pickPlace : err || c.pickCrop, true, () => (ready ? submitPlan() : go(!d.place ? "planear/1" : err ? "planear/2" : "planear/3")))];
  }
  put($("#view"), h("div", { class: "step" }, head, state.linkError ? h("p", { class: "err", role: "status" }, c.invalidPlanLink) : null, ...body));
}
// Computer: the map fills the screen; one floating panel with four sections, one open at a time.
function planDesktop(d) {
  const c = C(), err = dateErr(d), redo = () => keepScroll(() => planDesktop(d));
  const pick = (pl) => { endDraw(); d.place = pl; d.lot = null; redo(); updateMap(pl, null); };
  state.onPick = async (lat, lon) => (state.addCorner ? state.addCorner(lon, lat) : pick(await placeAt(lat, lon)));
  put($("#map-overlay"), state.drawing ? null : h("div", { class: "map-hint" }, icon("i-pointer"), d.place ? c.lot.clickMore : c.clickMap));
  const done = { 1: !!d.place, 2: !err, 3: hasCrop(d.crops), 4: true };
  if (state.sec == null) state.sec = !d.place ? 1 : !d.crops.length ? 3 : 0;
  const months = monthsIn(d);
  const summary = {
    1: d.place ? `${d.place.name}${d.place.admin ? " · " + d.place.admin : ""}` : c.pickPlace,
    2: err || `${fmtDate(d.start)} – ${fmtDate(d.end)} · ${c.months(months)}`,
    3: done[3] ? d.crops.map((id) => cap(cropName(id))).join(", ") : c.pickCrop,
    4: `${(d.area || 1).toLocaleString(state.lang)} ${c.units[d.unit || "ha"]}${d.lot?.length >= 3 ? " · " + c.lot.fromMap : ""} · ${d.irrigation ? c.irrig.yes : c.irrig.no}`,
  };
  const body = {
    1: () => state.drawing ? [lotTools(d, redo)] : [d.place ? placeCard(d, null) : null, d.place ? lotTools(d, redo) : null, ...searchBox(pick), gpsBtn(pick)],
    2: () => [dateFields(d, redo), h("div", { class: "row between wrap" }, quickDates(d, redo), h("span", { class: err ? "err" : "small" }, err || c.months(months))), periodStrip(d)],
    3: () => [h("p", { class: "small" }, c.whatHelp), ...cropTiles(d, redo, 0)],
    4: () => [
      h("div", { class: "row-fields" }, h("input", { class: "num", type: "number", min: "0", step: "any", value: String(d.area), "aria-label": c.landQ, onchange: (e) => { const v = parseFloat(e.target.value); if (v > 0) { d.area = v; redo(); } } }),
        h("div", { class: "seg" }, ...Object.keys(UNITS).map((u) => h("button", { "aria-pressed": String(d.unit === u), onclick: () => { d.unit = u; if (d.lot?.length >= 3) d.area = inUnit(lotHa(d.lot), u); redo(); } }, c.units[u])))),
      h("div", { class: "q" }, h("b", {}, c.irrigQ), irrigOpts(d, redo)),
      h("div", { class: "q" }, h("b", {}, c.wlQ, h("small", { class: "small", style: { fontWeight: 400 } }, " · ", c.optional)), waterlogOpts(d, redo)),
      h("div", { class: "q" }, h("b", {}, c.todayQ, h("small", { class: "small", style: { fontWeight: 400 } }, " · ", c.optional)), currentChips(d, redo))],
  };
  const titles = { 1: c.where, 2: c.when, 3: c.what, 4: c.landShort };
  const okAll = done[1] && done[2] && done[3];
  put($("#view"), h("div", { class: "plan-float" },
    h("div", { class: "pf-head" }, h("h1", { class: "display" }, c.planTitle), h("p", { class: "small" }, c.planLead2), state.linkError ? h("p", { class: "err", role: "status" }, c.invalidPlanLink) : null),
    h("div", { class: "pf-secs" }, ...[1, 2, 3, 4].map((n) => {
      const open = state.sec === n;
      return h("section", { class: `pf-sec${open ? " open" : ""}${done[n] ? " done" : ""}` },
        h("button", { class: "pf-sec-h", "aria-expanded": String(open), onclick: () => { state.sec = open ? 0 : n; redo(); } },
          h("span", { class: "pf-num" }, done[n] && !open ? icon("i-check") : String(n)),
          h("span", { class: "grow" }, h("b", {}, titles[n]), open ? null : h("small", {}, summary[n])),
          icon(open ? "i-chev-d" : "i-chev-r")),
        open ? h("div", { class: "pf-sec-b" }, ...body[n](), n < 4 ? h("button", { class: "btn light pf-next", disabled: !done[n], onclick: () => { state.sec = n + 1; redo(); } }, c.next, icon("i-chev-r")) : null) : null);
    })),
    h("div", { class: "pf-foot" }, h("button", { class: "btn dark big block", disabled: !okAll, onclick: () => { state.sec = null; submitPlan(); } }, okAll ? [c.seePlan, icon("i-arrow-r")] : !d.place ? c.pickPlace : err || c.pickCrop))));
  initCesium($("#cesium"), { pick: true }).then(() => (d.place ? updateMap(d.place, null, d.lot, state.drawing ? false : d.lot?.length >= 3 ? "lot" : "place") : globeView()));
}

/* ================= results ================= */
const outcome = (pl, n) => (n === 1 ? (pl.fail >= 0.5 ? C().wasLost : C().wasHarvested(Math.round(pl.yld * 100)))
  : pl.fail >= 0.5 ? C().lostMost(...fracParts(pl.fail)) : pl.fail <= 0.001 ? C().harvestAll(Math.round(pl.yld * 100)) : pl.fail < 0.1 ? C().harvestAlmost(Math.round(pl.yld * 100)) : C().harvestSome(...fracParts(1 - pl.fail), Math.round(pl.yld * 100)));
const outcomeShort = (pl, n) => (n === 1 ? (pl.fail >= 0.5 ? C().wasLost : `${Math.round(pl.yld * 100)} %`)
  : pl.fail >= 0.5 ? C().lostShortS(...fracParts(pl.fail)) : pl.fail <= 0.001 ? C().allYearsS(Math.round(pl.yld * 100)) : pl.fail < 0.1 ? C().almostS(Math.round(pl.yld * 100)) : C().someYearsS(...fracParts(1 - pl.fail), Math.round(pl.yld * 100)));
const majority = (ls) => { const d = ls.filter((l) => l === "danger").length, c = ls.filter((l) => l === "care").length; return d * 2 >= ls.length ? "danger" : (d + c) * 2 >= ls.length ? "care" : "good"; };
const plantingsOf = (f) => Object.values(f.byCrop).flatMap((b) => b.plantings.map((p) => ({ ...p, crop: b.crop }))).sort((a, b) => a.t0 - b.t0 || a.crop.localeCompare(b.crop));
const verdictEl = (v) => h("span", { class: `verdict v-${v}` }, h("i", { class: `sw ${v}` }), C().verdict[v]);
const level = (st) => (st.fail >= 0.5 ? "danger" : st.fail > 0.15 || st.yld < 0.6 ? "care" : "good");
// Colour and drawing for each crop; bare soil is terracotta
const CROP_LOOK = {
  maize: ["var(--maize)", "i-maize"], soybean: ["var(--soybean)", "i-soybean"], rice: ["var(--rice)", "i-rice", 1], mulch: ["var(--straw)", "i-straw"],
  peanut: ["#C98B5B", "i-sow"], common_bean: ["#9B5C7F", "i-soybean", 1], sorghum: ["#B5542D", "i-harvest", 1], wheat: ["#D9B861", "i-harvest"],
  barley: ["#C8B26A", "i-harvest"], sunflower: ["#F2C230", "i-sun"], chickpea: ["#D7B98E", "i-soybean"], cowpea: ["#A9774E", "i-soybean", 1],
  jack_bean: ["#6E9F5A", "i-sow", 1], velvet_bean: ["#5E8B4E", "i-sow", 1], potato: ["#A88A5C", "i-harvest", 1], bare: ["var(--bare)", "i-soil", 1],
};
const look = (id) => { const [color, ic, light] = CROP_LOOK[id] || ["var(--moss)", "i-sow"]; return { color, icon: ic, light: !!light }; };
const tile = (id) => { const L = look(id); return h("span", { class: "tile-i", style: { background: L.color, color: L.light ? "#fff" : "var(--ink)" } }, icon(L.icon)); };
const cropLabel = (id) => (id === "bare" ? C().ds.bare : cap(cropName(id)));
function normalRain(clim, m) {
  normalRain.c ||= {};
  const k = `${clim.lat},${clim.lon},${m}`;
  if (!(k in normalRain.c)) { const vs = Object.entries(clim.months).filter(([key]) => +key.slice(5) === m && +key.slice(0, 4) >= 1991 && +key.slice(0, 4) <= 2020).map(([, v]) => v.rain); normalRain.c[k] = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0; }
  return normalRain.c[k];
}
// Farm calendar: one row per crop with the land it takes, over the whole period; split in blocks when long.
// Farm calendar: one row per plot, its plantings in order as labelled bars (crop name + how it ends),
// straw where the soil is covered, the grey track is bare soil. Long periods split in blocks.
function farmCalendar(r, f, { compact = false, rain = false } = {}) {
  const N = r.period.length, size = desktop() && !compact ? (N <= 24 ? N : 12) : 12, n1 = r.samples.length;
  const plots = f.parcels.map((pc, k) => ({ pc, k })).filter((x) => x.pc.share > 0.001).sort((a, b) => b.pc.share - a.pc.share);
  const mx = Math.max(1, ...Array.from({ length: 12 }, (_, i) => normalRain(r.clim, i + 1)));
  const lab = compact ? "62px" : desktop() ? "96px" : "70px";
  const blocks = [];
  for (let a = 0; a < N; a += size) {
    const b = Math.min(N, a + size), n = b - a, months = r.period.slice(a, b), wide = desktop() && !compact && n <= 14;
    const head = h("div", { class: "cal-row cal-head", style: { "--lab": lab } }, h("span"), h("div", { class: "cal-grid", style: { "--n": n } }, ...months.map((p, i) =>
      h("span", { class: p.m === 1 && i > 0 ? "yr" : "" }, wide ? (i === 0 || p.m === 1 ? `${mon(p.m)} ${String(p.y).slice(2)}` : mon(p.m)) : (desktop() && !compact && p.m === 1 && i > 0 ? `${S().months[0]}'${String(p.y).slice(2)}` : S().months[p.m - 1])))));
    const rows = plots.map(({ pc, k }) => {
      const bars = [];
      for (const st of pc.d.steps) {
        if (st.t1 <= a || st.t0 >= b) continue;
        const s0 = Math.max(a, st.t0), s1 = Math.min(b, st.t1) - 1, lv = st.fail >= 0.5 ? "danger" : st.fail > 0.15 || st.yld < 0.6 ? "care" : "good", len = s1 - s0 + 1;
        bars.push(h("button", {
          class: `bar ${lv}${look(st.crop).light ? " light" : ""}${st.crop === "mulch" ? " straw" : ""}`, style: { gridColumn: `${s0 - a + 1} / span ${len}`, "--c": look(st.crop).color },
          title: `${cap(cropName(st.crop))} · ${span(r.period[st.t0], r.period[st.t1 - 1])} · ${outcomeShort(st, n1)}`, onclick: () => stepSheet(r, pc, st)
        },
          h("b", {}, cap(cropName(st.crop))), s0 === st.t0 && len >= 3 ? h("small", {}, outcomeShort(st, n1)) : null));
      }
      // straw on the ground between plantings
      let t = a;
      while (t < b) { if (pc.d.months[t]?.crop === "mulch") { let u = t; while (u + 1 < b && pc.d.months[u + 1]?.crop === "mulch") u++; bars.push(h("div", { class: "bar straw", style: { gridColumn: `${t - a + 1} / span ${u - t + 1}` } }, u - t >= 1 ? h("b", {}, C().straw) : null)); t = u + 1; } else t++; }
      return h("div", { class: "cal-row", style: { "--lab": lab } }, h("span", { class: "cal-name" }, h("b", {}, compact ? String.fromCharCode(65 + k) : `${C().plot} ${String.fromCharCode(65 + k)}`), h("small", {}, fmtArea(pc.share))),
        h("div", { class: "cal-grid track", style: { "--n": n } }, ...bars));
    });
    const rainRow = rain ? h("div", { class: "cal-row rain-row", style: { "--lab": lab } }, h("span", { class: "cal-name" }, h("b", {}, C().rain), h("small", {}, C().rainUnit)),
      h("div", { class: "cal-grid", style: { "--n": n } }, ...months.map((p) => {
        const v = normalRain(r.clim, p.m);
        return h("div", { class: "rain-col" }, n <= 14 ? h("span", {}, String(Math.round(v))) : null, h("i", { style: { height: `${Math.max(3, (v / mx) * 100)}%` } }));
      }))) : null;
    blocks.push(h("div", { class: "cal-block" }, head, ...rows, rainRow));
  }
  return h("div", { class: `cal plots${compact ? " compact" : ""}` }, ...blocks);
}
function stepSheet(r, pc, st) {
  sheet(h("h2", { class: "display" }, `${cap(cropName(st.crop))} · ${fmtArea(pc.share)}`), h("p", { class: "small" }, span(r.period[st.t0], r.period[st.t1 - 1])),
    h("p", { style: { fontSize: "18px" } }, cap(outcome(st, r.samples.length))),
    h("p", { class: "small" }, C().rainVsNeed(Math.round(st.rain), Math.round(st.need))),
    h("p", { class: "small" }, C().checkLocal));
}
function barSheet(r, f, k, s, pl) {
  const name = k === "bare" ? C().lgBare : cap(cropName(k));
  const from = r.period[pl ? pl.t0 : s.t0], to = r.period[pl ? pl.t1 - 1 : s.t1];
  const st = pl && f.parcels.flatMap((p) => p.d.steps).find((x) => x.crop === k && x.t0 === pl.t0);
  sheet(h("h2", { class: "display" }, `${name} · ${fmtArea(s.share)}`), h("p", { class: "small" }, span(from, to)),
    h("p", { style: { fontSize: "18px" } }, pl ? cap(outcome(pl, r.samples.length)) : k === "mulch" ? cap(C().coversSoil) : C().lgBare),
    st ? h("p", { class: "small" }, C().rainVsNeed(Math.round(st.rain), Math.round(st.need))) : null,
    h("p", { class: "small" }, C().checkLocal));
}
const resHead = (P) => h("div", { class: "res-head" }, h("div", { class: "grow" }, h("b", {}, `${P.place.name} · ${fmtArea(1)}`), h("small", {}, fmtSpan(P))),
  h("a", { class: "btn", href: "#/planear", onclick: () => { state.draft = null; state.sec = null; } }, C().change));
async function withResults(draw) {
  const v = $("#view");
  put(v, loading(C().loading));
  let r;
  try { r = await results(); } catch (e) { console.error(e); put(v, errorCard(C().climateError, () => withResults(draw))); return; }
  if (!r.farm) { put(v, h("div", { class: "res", style: { flexDirection: "column" } }, resHead(state.plan), h("div", { class: "card" }, h("p", {}, C().noPlans), h("a", { class: "btn dark", href: "#/planear" }, C().changeData)))); return; }
  await draw(r);
}
// Three named plans the farmer compares, plus what they do today. "Safest" is the new plan that loses a harvest in the fewest years.
const NAMED_ICON = { safe: "i-shield", income: "i-income", soil: "i-straw", today: "i-plot" };
async function namedPlans(P = state.plan, mode = state.mode) {
  const [rs, ri] = await Promise.all([results(P, mode, "soil"), results(P, mode, "income")]);
  const today = rs.today, tSig = today ? sig(today) : null;
  const pool = [rs.farm, ri.farm, ...(rs.others || []), ...(ri.others || [])].filter((f) => f && sig(f) !== tSig && f.parcels.some((p) => p.d.steps.length));
  // A plan offered as new must be a rotation: at least two crops, and never the same crop twice in a row on a plot
  const rotates = (f) => new Set(f.parcels.flatMap((p) => p.d.steps.map((s) => s.crop))).size > 1 && f.parcels.every((p) => p.d.steps.every((s, i, a) => !i || s.crop !== a[i - 1].crop));
  const rot = pool.filter(rotates);
  const safe = [...(rot.length ? rot : pool)].sort((a, b) => a.anyLoss - b.anyLoss || b.harvest - a.harvest)[0];
  const out = [], seen = new Set();
  for (const [key, f] of [["safe", safe], ["income", ri.farm], ["soil", rs.farm]]) { if (!f || seen.has(sig(f))) continue; seen.add(sig(f)); out.push({ key, f }); }
  if (today) out.push({ key: "today", f: today });
  return out;
}
const whyOf = (it, plans) => {
  const D = C().ds, today = plans.find((x) => x.key === "today");
  return it.key === "safe" && today && today.f.anyLoss < it.f.anyLoss ? D.why.safeNew : D.why[it.key];
};
// Plots, largest first, named the same way everywhere on the screen
const plotsOf = (f) => f.parcels.map((pc) => ({ pc })).filter((x) => x.pc.share > 0.001).sort((a, b) => b.pc.share - a.pc.share)
  .map((x, i, all) => ({ ...x, name: all.length > 1 ? `${C().plot} ${String.fromCharCode(65 + i)}` : C().ds.wholeFarm }));
// What sits on a plot month by month: a planting, straw, or bare soil. Two plantings of the same crop stay apart.
function runsOf(pc, N) {
  const out = [];
  for (let t = 0; t < N; t++) {
    const st = pc.d.steps.find((x) => x.t0 <= t && t < x.t1), m = pc.d.months[t]?.crop;
    const c = st ? st.crop : m || "bare", key = st ? `${st.crop}@${st.t0}` : c, l = out[out.length - 1];
    if (l && l.key === key) l.t1 = t + 1; else out.push({ c, key, t0: t, t1: t + 1, st });
  }
  return out;
}
function monthsText(r, ru) {
  const D = C().ds, yr = r.period.length > 12, nm = (p) => monL(p.m) + (yr ? ` ${p.y}` : "");
  return ru.t1 - ru.t0 === 1 ? D.onlyMonth(nm(r.period[ru.t0])) : D.monthsTo(nm(r.period[ru.t0]), nm(r.period[ru.t1 - 1]));
}
const yearLv = (x) => (x.lostShare >= 0.5 ? "x" : x.lostShare > 0 ? "c" : "g");
const coveredMonths = (f, N) => f.grid.slice(0, N).map((g) => !(g.bare?.share > 0.5));
function normals(clim) {
  normals.c ||= {};
  return (normals.c[`${clim.lat},${clim.lon}`] ||= Array.from({ length: 12 }, (_, i) => {
    const vs = Object.entries(clim.months).filter(([k]) => +k.slice(5) === i + 1 && +k.slice(0, 4) >= 1991 && +k.slice(0, 4) <= 2020).map(([, v]) => v);
    const avg = (q) => vs.reduce((a, v) => a + v[q], 0) / Math.max(1, vs.length);
    return { rain: avg("rain"), et0: avg("et0") };
  }));
}

// The plan as a route: crop, then the months spelled out
// Plans longer than a year show the first year; the rest opens on request so the route still reads at a glance
function routeEl(r, f) {
  const N = r.period.length, D = C().ds, long = N > 12, all = !long || state.routeAll, vseen = new Set();
  const box = h("div", { class: "route" }, ...plotsOf(f).map(({ pc, name }) => h("div", { class: "rt-plot" }, h("span", { class: "rt-lab" }, `${name} · ${fmtArea(pc.share)}`),
    h("ol", { class: "rt-steps" }, ...runsOf(pc, N).filter((ru) => all || ru.t0 < 12).map((ru) =>
      h("li", { class: ru.c === "bare" ? "bare" : "", style: { "--c": look(ru.c).color }, "data-rooti": `crop-${ru.c}` }, tile(ru.c), h("p", {}, h("b", {}, cropLabel(ru.c)), h("span", {}, monthsText(r, ru)))))),
    vecChips(r, pc, all, vseen))));
  if (long) box.append(h("button", { class: "link", style: { alignSelf: "flex-start" }, onclick: () => { state.routeAll = !all; box.replaceWith(routeEl(r, f)); } },
    all ? D.routeFirst : D.routeAll(Math.ceil(N / 12))));
  return box;
}
const routeWords = (r, f) => plotsOf(f).map(({ pc }) => runsOf(pc, r.period.length).filter((ru) => ru.c !== "bare").map((ru) => `${cropLabel(ru.c)}, ${monthsText(r, ru)}`).join("; ")).join(". ");

function countUp(el, to, ms) {
  if (!MOTION()) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = (now) => { const p = Math.min(1, (now - t0) / ms); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 4))); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
// One dot per real year; same plan size recolours the dots in place so the change is visible
function yearDots(el, r, f) {
  const coast = COAST(state.plan.place), D = C().ds, per = f.per;
  const isNino = (base) => coast && NINO_ONSET.includes(base + r.ninoOffset);
  const cls = (x) => yearLv(x) + (isNino(x.base) ? " n" : "");
  el._f = f;
  const dots = el.querySelectorAll("i");
  if (dots.length === per.length) { dots.forEach((d, i) => { d.className = cls(per[i]); }); return; }
  el.style.setProperty("--cols", Math.min(22, Math.max(12, Math.ceil(per.length / 2))));
  const tip = h("span", { class: "dot-tip" });
  put(el, ...per.map((x, i) => h("i", { class: cls(x), "data-i": i })), tip);
  const show = (d) => {
    const i = +d.dataset.i, x = el._f.per[i], y = x.base;
    el.querySelectorAll("i.on").forEach((q) => q.classList.remove("on")); d.classList.add("on");
    const end = y + r.period.at(-1).y - r.period[0].y;
    const period = y === end ? String(y) : `${y}–${String(end).slice(2)}`;
    put(tip, h("b", {}, period + (isNino(y) ? ` · ${D.legend.n}` : "")), D.yearTip[yearLv(x)]);
    tip.style.left = d.offsetLeft + d.offsetWidth / 2 + "px"; tip.style.top = d.offsetTop + "px"; tip.classList.add("on");
  };
  el.onpointerover = (e) => { if (e.target.dataset.i) show(e.target); };
  el.onclick = (e) => { if (e.target.dataset.i) show(e.target); };
  el.onpointerleave = () => { tip.classList.remove("on"); el.querySelectorAll("i.on").forEach((q) => q.classList.remove("on")); };
}
// Calendar: rain of a normal year, one lane per plot, a playhead moved by tap, drag or arrow keys
function planCalendar(el, r, f) {
  const c = C(), D = c.ds, N = r.period.length, nm = normals(r.clim), coast = COAST(state.plan.place);
  const rain = r.period.map((p) => Math.round(nm[p.m - 1].rain)), wet = r.period.map((p) => nm[p.m - 1].rain >= 0.8 * nm[p.m - 1].et0);
  const max = Math.max(1, ...rain), Y = (v) => 100 - (v / max) * 86 - 4;
  const pts = rain.map((v, t) => [((t + 0.5) / N) * 1200, Y(v)]), line = smooth([[0, pts[0][1]], ...pts, [1200, pts[N - 1][1]]]);
  const plots = plotsOf(f).map((x) => ({ ...x, runs: runsOf(x.pc, N) })), last = 2 + plots.length * 2 + 2;
  const first12 = rain.slice(0, 12);
  let sel = Math.min(N - 1, el.dataset.sel != null ? +el.dataset.sel : first12.indexOf(Math.max(...first12)));
  const kids = [];
  const area = document.createElementNS(SVGNS, "svg");
  area.setAttribute("class", "pc-area"); area.setAttribute("viewBox", "0 0 1200 100"); area.setAttribute("preserveAspectRatio", "none"); area.setAttribute("aria-hidden", "true");
  area.innerHTML = `<defs><linearGradient id="pcRain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4A7FC1" stop-opacity=".5"/><stop offset="1" stop-color="#4A7FC1" stop-opacity=".08"/></linearGradient></defs><path class="fill" d="${line} L1200,100 L0,100 Z"/><path class="line" d="${line}" vector-effect="non-scaling-stroke"/>`;
  kids.push(area);
  plots.forEach(({ pc, name, runs }, k) => {
    const row = 2 + k * 2;
    kids.push(h("div", { class: "pc-lab", style: { gridRow: String(row) } }, h("b", {}, name), fmtArea(pc.share)));
    kids.push(h("div", { class: "pc-track", style: { gridRow: String(row + 1) } }));
    for (const ru of runs) {
      const L = look(ru.c), lv = ru.st ? level(ru.st) : "good";
      kids.push(h("div", { class: ["pc-run", ru.c === "bare" ? "bare" : ru.c === "mulch" ? "straw" : "", L.light ? "light" : "", lv !== "good" ? lv : ""].filter(Boolean).join(" "),
        style: { gridRow: String(row + 1), gridColumn: `${ru.t0 + 1} / ${ru.t1 + 1}`, background: L.color }, title: `${cropLabel(ru.c)} · ${monthsText(r, ru)}` }, h("span", {}, ru.t1 - ru.t0 > (N > 12 ? 3 : 1) ? cropLabel(ru.c) : "")));
    }
  });
  const short = (p) => (N <= 12 ? cap(monL(p.m)).slice(0, 3) : cap(monL(p.m)).slice(0, 1));
  r.period.forEach((p, t) => kids.push(h("div", { class: "pc-month", style: { gridRow: String(last - 1), gridColumn: String(t + 1) } }, N > 24 ? (p.m === 1 ? `'${String(p.y).slice(2)}` : "") : short(p))));
  for (let a = 0; a < N;) { let b = a; while (b + 1 < N && wet[b + 1] === wet[a]) b++; const w = wet[a]; kids.push(h("div", { class: `pc-season${w ? " w" : ""}${N > 24 ? " tiny" : b - a < (N > 12 ? 2 : 1) ? " short" : ""}`, style: { gridRow: String(last), gridColumn: `${a + 1} / ${b + 2}` } }, w ? (coast ? D.wet : D.wetX) : coast ? D.dry : D.dryX)); a = b + 1; }
  const hits = r.period.map((p, t) => h("button", { class: "pc-hit", style: { gridRow: `1 / ${last + 1}`, gridColumn: String(t + 1) }, "aria-label": `${cap(monL(p.m))} ${p.y}`, tabindex: "-1" }));
  const dot = h("div", { class: "pc-dot" }, h("b"), h("span", { class: "pc-pt" }));
  const grid = h("div", { class: plots.length > 1 ? "pc-grid" : "pc-grid one", style: { "--n": N } }, ...kids, ...hits, dot);
  const when = h("span", { class: "mono" }), big = h("span", { class: "pc-big" }), mm = h("span", { class: "pc-big" }), now = h("div", { class: "pc-now" });
  put(el, h("div", { class: "pc-head" }, h("div", { class: "pc-when" }, when, big), h("div", { class: "pc-rain" }, mm, h("span", { class: "mono" }, D.normalRain))), now, grid, h("p", { class: "small pc-note" }, D.tapMonth));
  // A season name that does not fit its months is hidden instead of cut mid-word; the line stays.
  new ResizeObserver(() => grid.querySelectorAll(".pc-season").forEach((x) => { x.classList.remove("nofit"); if (x.scrollWidth > x.clientWidth + 1) x.classList.add("nofit"); })).observe(grid);
  const place = () => {
    const g = grid.getBoundingClientRect(), hr = hits[sel].getBoundingClientRect(), lanes = grid.querySelectorAll(".pc-track");
    if (!g.width || !lanes.length) return;
    dot.style.height = lanes[lanes.length - 1].getBoundingClientRect().bottom - g.top + "px";
    dot.style.transform = `translateX(${hr.left - g.left + hr.width / 2}px)`;
    dot.querySelector(".pc-pt").style.top = (Y(rain[sel]) / 100) * area.getBoundingClientRect().height + "px";
  };
  const pick = (t, focus) => {
    sel = Math.max(0, Math.min(N - 1, t)); el.dataset.sel = sel;
    const p = r.period[sel];
    hits.forEach((b, i) => { b.tabIndex = i === sel ? 0 : -1; });
    grid.querySelectorAll(".pc-month").forEach((b, i) => b.classList.toggle("on", i === sel));
    when.textContent = `${wet[sel] ? (coast ? D.wet : D.wetX) : coast ? D.dry : D.dryX} · ${p.y}`;
    big.textContent = cap(monL(p.m));
    put(mm, String(rain[sel]), h("small", {}, "mm"));
    dot.querySelector("b").textContent = cap(monL(p.m)).slice(0, 3);
    put(now, ...plots.map(({ pc, name, runs }) => { const ru = runs.find((x) => x.t0 <= sel && sel < x.t1); return h("button", { onclick: () => (ru.st ? stepSheet(r, pc, ru.st) : null) }, tile(ru.c), h("p", {}, h("span", {}, name), cropLabel(ru.c))); }));
    place();
    if (focus) hits[sel].focus();
  };
  hits.forEach((b, t) => {
    b.addEventListener("click", () => pick(t));
    b.addEventListener("keydown", (e) => { const d = { ArrowRight: 1, ArrowLeft: -1, Home: -999, End: 999 }[e.key]; if (d !== undefined) { e.preventDefault(); pick(sel + d, true); } });
  });
  let drag = false;
  const at = (x) => { const rs = hits.map((b) => b.getBoundingClientRect()), i = rs.findIndex((q) => x >= q.left - 2 && x <= q.right + 2); return i < 0 ? (x < rs[0].left ? 0 : N - 1) : i; };
  grid.addEventListener("pointerdown", (e) => { drag = true; grid.classList.add("dragging"); pick(at(e.clientX)); });
  grid.addEventListener("pointermove", (e) => { if (drag) pick(at(e.clientX)); });
  const end = () => { drag = false; grid.classList.remove("dragging"); };
  grid.addEventListener("pointerup", end); grid.addEventListener("pointercancel", end); grid.addEventListener("pointerleave", end);
  el._ro?.disconnect(); el._ro = new ResizeObserver(place); el._ro.observe(grid);
  pick(sel);
}

// A card per plan: why it is suggested, its crops in order, how it would have gone
function planCard(it, r, plans, onPick, best, choose) {
  const D = C().ds, f = it.f, N = r.period.length, plots = plotsOf(f).map((x) => ({ ...x, runs: runsOf(x.pc, N) }));
  const order = [];
  for (let t = 0; t < N; t++) for (const { runs } of plots) { const c = runs.find((x) => x.t0 <= t && t < x.t1).c; if (!order.includes(c)) order.push(c); }
  const lossYears = f.per.filter((x) => x.lostShare > 0).length, cov = coveredMonths(f, N).filter(Boolean).length;
  return h("button", { class: ["strat", best ? "best" : "", choose ? "choose" : ""].filter(Boolean).join(" "), ...(choose ? {} : { role: "radio", "aria-checked": String(it.key === state.pick) }), "data-id": it.key, onclick: () => onPick(it.key) },
    h("span", { class: "spec mono" }, whyOf(it, plans), choose ? null : h("span", { class: "radio" })),
    h("span", { class: "pname" }, icon(NAMED_ICON[it.key]), D.names[it.key]),
    h("span", { class: "cropline" }, ...order.slice(0, 4).map((c) => { const L = look(c); return h("span", { class: `cl-chip${c === "bare" ? " bare" : ""}` }, h("i", { style: { background: L.color, color: L.light ? "#fff" : "var(--ink)" } }, icon(L.icon)), cropLabel(c)); }),
      order.length > 4 ? h("span", { class: "cl-chip more", title: order.slice(4).map(cropLabel).join(", ") }, `+${order.length - 4}`) : null),
    plots.length > 1 ? h("span", { class: "cl-note" }, D.inPlots(plots.length)) : null,
    h("span", { class: `badge ${f.verdict}` }, C().verdict[f.verdict]),
    h("span", { class: "facts" }, r.samples.length > 1 ? h("span", {}, icon("i-care"), D.lossYears(lossYears)) : null, h("span", {}, icon("i-straw"), D.coverOf(cov, N))),
    choose ? h("span", { class: "go" }, D.seePlan, icon("i-arrow-r")) : null);
}

// What we don't know: a short label each, the sentence opens on tap
function unknownChips(r, f) {
  const c = C(), D = c.ds, tr = r.terrain, d = describeSoil(tr?.soil), crops = new Set(f.parcels.flatMap((p) => p.d.steps.map((s) => s.crop)));
  const items = [["i-rain", D.unk.climate, c.unkClimate], ["i-soil", D.unk.soil, d ? (tr.soil.offsetKm ? c.unkSoilNear(tr.soil.offsetKm) : c.unkSoil) : c.unkNoSoil], ["i-maize", D.unk.variety, c.unkVariety]];
  if ([...crops].some((id) => DATA.crops[id]?.approximate)) items.push(["i-info", D.unk.approx, c.approx]);
  if (!nearPilot(state.plan.place)) items.push(["i-income", D.unk.prices, c.unkPrices]);
  items.push(["i-agronomist", D.unk.local, D.localWhy]);
  const toggle = (e) => { const b = e.currentTarget; b.setAttribute("aria-expanded", String(b.getAttribute("aria-expanded") !== "true")); };
  return h("div", { class: "unk", "data-rooti": "unknowns" }, ...items.map(([ic, t, txt]) => h("button", { class: "unk-chip", "aria-expanded": "false", onclick: toggle },
    h("span", { class: "top" }, icon(ic), t, h("span", { class: "plus" })), h("span", { class: "more" }, h("div", {}, h("p", {}, txt))))));
}
function sourceNote(r, f) {
  const D = C().ds, per = f.per, b = h("button", { class: "source", "aria-expanded": "false" }, icon("i-info"), D.source,
    h("span", { class: "pop" }, D.sourcePop(state.plan.place.name, per[0]?.base ?? r.period[0].y, per[per.length - 1]?.base ?? r.period[0].y)));
  b.addEventListener("click", (e) => { e.stopPropagation(); b.setAttribute("aria-expanded", String(b.getAttribute("aria-expanded") !== "true")); });
  return b;
}

// Two screens: first the farmer picks a plan from the cards, then that plan opens on its own (#/plan/<key>),
// with a selector to switch plans without going back.
function viewPlan(arg) {
  return withResults(async (r) => {
    const c = C(), D = c.ds, P = state.plan, N = r.period.length, multi = r.samples.length > 1;
    const [plans, ids] = await Promise.all([namedPlans(P), ideas(r), loadVecinos()]);
    if (!plans.length) { put($("#view"), h("div", { class: "res" }, resHead(P), h("div", { class: "card" }, h("p", {}, c.noPlans), h("a", { class: "btn dark", href: "#/planear" }, c.changeData)))); return; }
    // When what the farmer does today loses a harvest in fewer years than any new plan, say so plainly
    const today = plans.find((x) => x.key === "today"), newBest = plans.filter((x) => x.key !== "today").reduce((a, b) => (!a || b.f.anyLoss < a.f.anyLoss ? b : a), null);
    const lossN = (f) => f.per.filter((x) => x.lostShare > 0).length, covN = (f) => coveredMonths(f, N).filter(Boolean).length;
    const todayWins = multi && today && newBest && lossN(today.f) < lossN(newBest.f);
    const honest = todayWins ? h("p", { class: "pv-honest" }, icon("i-info"), h("span", {}, D.todaySafer(lossN(today.f), lossN(newBest.f), covN(newBest.f) > covN(today.f) ? [covN(newBest.f), covN(today.f), N] : null))) : null;
    // Rooti asks for "auto": the plan on screen, or the first one, opened directly
    if (arg === "auto") { arg = plans.some((x) => x.key === state.pick) ? state.pick : plans[0].key; history.replaceState(null, "", `#/plan/${arg}`); }
    if (!plans.some((x) => x.key === arg)) {
      const cards = h("div", { class: "strats", "data-rooti": "plans", style: { "--k": plans.length } }, ...plans.map((it) => planCard(it, r, plans, (key) => go(`plan/${key}`), todayWins && it.key === "today", true)));
      put($("#view"), h("div", { class: "res pv" }, resHead(P), linked() ? lotSyncEl() : null, tagged(ninoBanner(r), "nino"),
        h("section", { class: "pv-panel" },
          h("div", { class: "pv-block pv-cards pv-choose" }, h("div", { class: "pv-title" }, h("h1", { class: "h3" }, D.plansTitle(plans.filter((x) => x.key !== "today").length, plans.some((x) => x.key === "today"))), h("p", { class: "small" }, D.chooseHint)), cards, honest),
          h("div", { class: "pv-foot" }, unknownChips(r, plans[0].f), sourceNote(r, plans[0].f)))));
      return;
    }
    state.pick = arg;
    const cur = () => plans.find((x) => x.key === state.pick);
    const verdictBox = h("div"), head = h("div", { class: "pv-block", id: "pvHead" }), routeBox = h("div", { "data-rooti": "route" }), stat = h("div", { "data-rooti": "years" }), dots = h("div", { class: "dots", "data-rooti": "years" }), risks = h("div", { class: "pv-block pv-risks" }), cal = h("div", { class: "pcal", "data-rooti": "calendar" });
    const isSaved = () => state.saved && JSON.stringify(state.saved.plan) === JSON.stringify(P);
    const saveBtn = h("button", { class: "round", "aria-label": c.save, title: c.save, onclick: () => { state.saved = { plan: P, at: Date.now() }; store.set("saved3", state.saved); put(saveBtn, icon("i-check")); } }, icon(isSaved() ? "i-check" : "i-bookmark"));
    const show = (anim) => {
      const it = cur(), f = it.f, good = f.per.filter((x) => yearLv(x) === "g").length, cov = coveredMonths(f, N).filter(Boolean).length;
      put(verdictBox, h("span", { class: `badge ${f.verdict}` }, c.verdict[f.verdict]));
      put(routeBox, routeEl(r, f));
      // The risks the challenge asks for sit in view, not behind a button; the full reasoning opens on request
      const e = explain(f, r), rk = e.risks.length ? [c.riskTitle, e.risks, "bad"] : [c.whyTitle, e.why, "good"];
      put(risks, h("b", {}, rk[0]), h("ul", { class: `bul ${rk[2]}` }, ...rk[1].slice(0, 3).map((x) => h("li", {}, x))));
      if (multi) {
        const [a, b, z] = D.goodYears(f.per.length), n = h("span", {}, String(good));
        put(stat, h("div", { class: "statbox" }, h("div", { class: "stat" }, n), h("p", {}, a, h("b", {}, b), z)));
        yearDots(dots, r, f);
        if (anim) countUp(n, good, 800);
      }
      planCalendar(cal, r, f);
      if (anim) [verdictBox, routeBox, risks, stat, cal].forEach((x) => { x.classList.remove("swap"); void x.offsetWidth; x.classList.add("swap"); });
      bar?.redraw();
    };
    // Switch plans in place: the address follows without a new history entry, so Back still returns to the choice
    // The plan's name is the title and the selector at once
    const sel = h("select", { class: "pv-select", "aria-label": D.planLabel, onchange: (e) => { state.pick = e.target.value; history.replaceState(null, "", `#/plan/${state.pick}`); show(true); } },
      ...plans.map((it) => h("option", { value: it.key, selected: it.key === state.pick ? "" : null }, D.names[it.key])));
    put(head, sel, verdictBox);
    head.setAttribute("data-rooti", "plans");
    // Opened from WhatsApp: choosing here tells Rooti in the chat
    const bar = linked() ? pickBar(r, cur) : null;
    const switcher = h("div", { class: "pv-switch" }, h("a", { class: "pv-back", href: "#/plan" }, icon("i-back"), D.allPlans));
    const legend = h("div", { class: "dots-legend" }, ...["g", "c", "x"].map((k) => h("span", {}, h("i", { class: k, style: { background: { g: "var(--good)", c: "var(--care)", x: "var(--danger)" }[k] } }), D.legend[k])),
      COAST(P.place) ? h("span", {}, h("i", { class: "n" }), D.legend.n) : null);
    put($("#view"), h("div", { class: "res pv" },
      resHead(P),
      switcher,
      linked() ? lotSyncEl() : null,
      tagged(ninoBanner(r), "nino"),
      h("section", { class: "pv-panel" },
        h("div", { class: "pv-body" },
          h("div", { class: "pv-left" },
            h("div", { class: "pv-a" }, head, h("div", { class: "pv-block" }, h("b", {}, D.whatWhen), routeBox), risks,
              h("div", { class: "pv-acts" }, h("button", { class: "btn soft", onclick: () => explainSheet(D.names[cur().key], cur().f, r) }, D.whyAll), saveBtn,
                h("button", { class: "round", "aria-label": c.listen, title: c.listen, onclick: () => speak(`${D.names[cur().key]}. ${routeWords(r, cur().f)}. ${c.verdict[cur().f.verdict]}.`) }, icon("i-volume")))),
            h("div", { class: "pv-b" },
              multi ? [stat, h("div", { class: "pv-block" }, dots, legend, h("a", { class: "link", href: "#/pasado", style: { alignSelf: "flex-start" } }, c.vec.pastLink, icon("i-chev-r")))] : h("p", { class: "small" }, D.realOnly))),
          // Rooti still marks "cover": the calendar is where bare and covered months show now
          h("div", { class: "pv-right", "data-rooti": "cover" }, cal)),
        bar,
        h("div", { class: "pv-foot" }, unknownChips(r, plans[0].f), sourceNote(r, plans[0].f))),
      ids.length ? h("a", { class: "hint", href: "#/probar" }, icon("i-bulb"), h("span", { class: "grow" }, c.ideasHint(ids.length)), icon("i-chev-r")) : null,
      h("section", { class: "card" }, h("b", { class: "card-h" }, c.tipsTitle), tipList(tipsFor(r).slice(0, 4)), h("a", { class: "link", href: "#/terreno" }, c.seePlot)),
      canHandoff() ? handoffCard(P) : null));
    show(false);
  });
}

// Opened from WhatsApp: the farmer picks a plan here and Rooti hears about it in the chat
function pickBar(r, cur) {
  const W = C().wa, box = h("div", { class: "wa-bar" });
  const draw = (status) => {
    const it = cur(), name = C().ds.names[it.key];
    if (link.chosen?.key === it.key) return put(box, h("p", { class: "wa-done" }, icon("i-check"), h("span", {}, W.chosen(name))), hasWhatsApp() ? h("a", { class: "btn big block", href: waUrl() }, icon("i-chat"), W.back) : null);
    put(box, h("button", { class: "btn lime big block", disabled: status === "saving", onclick: async () => {
      draw("saving");
      try { await choosePlan({ key: it.key, name, route: routeWords(r, it.f) }); draw(); } catch { draw("error"); }
    } }, status === "saving" ? W.saving : W.choose(name)), h("p", { class: status === "error" ? "err" : "small" }, status === "error" ? W.chooseError : W.chooseHelp));
  };
  box.redraw = () => draw();
  draw();
  return box;
}
// The public website: the plan goes on to Rooti on WhatsApp as a short code the farmer sends
function handoffCard(P) {
  const W = C().wa, msg = h("p", { class: "small" }, W.goText);
  return h("section", { class: "card wa-go" }, h("b", { class: "card-h" }, W.goTitle), msg,
    h("button", { class: "btn dark big", onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { location.href = waUrl(W.goMsg(await handoff(P))); } catch { msg.textContent = W.goError; msg.className = "err"; b.disabled = false; }
    } }, icon("i-chat"), W.go));
}

/* ================= Aviso: the page behind an alert's «Ver el aviso» ================= */
const HEAVY_MM = 40; // the same threshold as bot/src/rooti_bot/alerts.py
async function forecastDays(pl) {
  const q = new URLSearchParams({ latitude: pl.lat, longitude: pl.lon, daily: "precipitation_sum", timezone: "America/Guayaquil", forecast_days: 7 });
  const d = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`).then(ok);
  return d.daily.time.map((day, i) => ({ day, mm: d.daily.precipitation_sum[i] || 0 }));
}
const weekday = (day, style = "long") => new Date(day + "T12:00:00").toLocaleDateString(state.lang, { weekday: style });
function rainChart(days) {
  const W = C().wa, wd = 340, ht = 180, top = 28, bot = 40, max = Math.max(HEAVY_MM * 1.3, ...days.map((d) => d.mm));
  const x = (i) => (i + 0.5) * (wd / days.length), y = (v) => top + (ht - top - bot) * (1 - v / max);
  const line = days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.mm).toFixed(1)}`).join("");
  return svg("svg", { viewBox: `0 0 ${wd} ${ht}`, class: "rain-chart", role: "img", "aria-label": days.map((d) => `${weekday(d.day)} ${Math.round(d.mm)} ${W.mm}`).join(", ") },
    svg("path", { d: `${line}L${x(days.length - 1)},${y(0)}L${x(0)},${y(0)}Z`, class: "ra" }),
    svg("line", { x1: 0, x2: wd, y1: y(HEAVY_MM), y2: y(HEAVY_MM), class: "rh" }),
    svg("text", { x: wd - 2, y: y(HEAVY_MM) - 6, "text-anchor": "end", class: "rht" }, `${W.heavy} · ${HEAVY_MM} ${W.mm}`),
    svg("path", { d: line, class: "rl" }),
    ...days.flatMap((d, i) => [
      svg("circle", { cx: x(i), cy: y(d.mm), r: d.mm >= HEAVY_MM ? 5 : 3.5, class: d.mm >= HEAVY_MM ? "rp heavy" : "rp" }),
      svg("text", { x: x(i), y: y(d.mm) - 10, "text-anchor": "middle", class: d.mm >= HEAVY_MM ? "rv heavy" : "rv" }, String(Math.round(d.mm))),
      svg("text", { x: x(i), y: ht - 20, "text-anchor": "middle", class: "rd" }, cap(weekday(d.day, "short").replace(".", ""))),
      svg("text", { x: x(i), y: ht - 6, "text-anchor": "middle", class: "rdn" }, String(+d.day.slice(8))),
    ]));
}
function alertTitle(A, days) {
  const W = C().wa;
  if (A.kind === "heavy_rain") {
    // The millimetres Rooti said in the voice note, so the page never contradicts it; the forecast may have moved since
    const said = A.text.match(/unos (\d+) mil/)?.[1], mm = said ? +said : days?.find((d) => d.day === A.key)?.mm ?? 0;
    return W.rainTitle(weekday(A.key), Math.round(mm));
  }
  const [crop, month = ""] = A.key.split("@"), [mName, year] = month.split(" ");
  const id = Object.keys(DATA.crops).find((k) => DATA.crops[k].name_es.split(" / ")[0].toLowerCase() === crop);
  const m = STR.es.monthsLong.indexOf(mName);
  return W.sowTitle(id ? cropName(id).toLowerCase() : crop, m >= 0 ? `${monL(m + 1)} ${year}` : month);
}
async function viewAviso() {
  const W = C().wa, A = link.alert, P = state.plan;
  put($("#view"), loading());
  const days = await forecastDays(P.place).catch(() => null);
  put($("#view"), h("div", { class: "res aviso" },
    h("section", { class: "av-hero" }, h("span", { class: "pill-eyebrow glass mono" }, W.kind[A.kind] || W.crumb), h("h1", { class: "h2" }, alertTitle(A, days)), es() ? h("p", {}, A.text) : null),
    h("section", { class: "card" }, h("b", { class: "card-h" }, W.nextDays), days ? rainChart(days) : h("p", { class: "small" }, W.noForecast), h("p", { class: "small" }, W.forecastSrc)),
    h("section", { class: "card" }, h("b", { class: "card-h" }, W.todo), tipList(W.tips[A.kind] || [])),
    h("div", { class: "av-acts" }, h("a", { class: "btn lime big block", href: link.call }, icon("i-mic"), W.call), h("a", { class: "btn big block", href: "#/plan" }, icon("i-month"), W.seePlan))));
}

/* ---------- why, risks, what we don't know, questions for the agronomist ---------- */
const COAST = (pl) => pl.lat > -5 && pl.lat < 2 && pl.lon > -81.5 && pl.lon < -78.5;
const CURRENT_NINO_ONSET = 2026;
// A strong El Niño is under way (NOAA/ERFEN, data/outlook.json): on the Pacific coast, a plan for the coming rainy
// season is tested by default on the seasons that followed past strong El Niños, not on all years alike.
const ninoNow = (P) => !!P && DATA.outlook?.official?.noaa?.chance_pct >= 70 && COAST(P.place) && P.start.slice(0, 7) <= `${CURRENT_NINO_ONSET + 1}-04` && P.end >= iso(new Date());
const defaultMode = (P) => (ninoNow(P) ? "nino" : "all");
const seasonsOf = (r) => r.samples.filter((s) => s.base != null).map((s) => s.base + r.ninoOffset);
function ninoBanner(r) {
  const c = C(), P = state.plan;
  if (state.mode === "nino") {
    const years = seasonsOf(r);
    if (!years.length || !years.every((year) => NINO_ONSET.includes(year))) return null;
    const seasons = years.map((year) => `${year}-${String(year + 1).slice(2)}`);
    return h("div", { class: "read nino-note" }, icon("i-rain"), h("span", { class: "grow" }, h("b", {}, c.ninoOnTitle), " ", c.ninoOn(seasons)), h("button", { class: "link", onclick: () => { state.mode = "all"; render(); } }, c.ninoSeeAll));
  }
  if (ninoNow(P)) return h("div", { class: "read nino-note" }, icon("i-rain"), h("span", { class: "grow" }, c.ninoOff), h("button", { class: "link", onclick: () => { state.mode = "nino"; render(); } }, c.ninoTest));
  return null;
}
function explain(f, r) {
  const c = C(), N = r.period.length, steps = f.parcels.flatMap((p) => p.d.steps), crops = [...new Set(steps.map((s) => s.crop))];
  const why = [], risks = [], unknown = [], ask = [];
  if (f.anyLoss <= 0.1) why.push(c.whyFewLoss(r.samples.length > 1 ? r.samples.length : null));
  if (f.covered >= 0.8) why.push(c.whyCovered(Math.round(f.covered * N), N));
  if (crops.some((id) => DATA.crops[id]?.n_fixing)) why.push(c.whyLegume(andList(crops.filter((id) => DATA.crops[id]?.n_fixing).map((id) => cropName(id).toLowerCase()))));
  if (f.parcels.length > 1) why.push(c.whySpread);
  if (crops.length > 1 && steps.every((s, i) => i === 0 || s.crop !== steps[i - 1].crop)) why.push(c.whyRotate);
  const byCrop = {};
  for (const s of steps) (byCrop[s.crop] ||= []).push(s);
  for (const [id, ss] of Object.entries(byCrop)) {
    const n = ss[0].n, nm = cap(cropName(id));
    const dr = Math.max(...ss.map((s) => s.drowned || 0)), dy = Math.max(...ss.map((s) => s.dry || 0)), ht = Math.max(...ss.map((s) => s.hot || 0)), cd = Math.max(...ss.map((s) => s.cold || 0));
    if (dr / n >= 0.1) risks.push(c.riskDrown(nm, ...fracParts(dr / n)));
    if (dy / n >= 0.1) risks.push(c.riskDry(nm, ...fracParts(dy / n)));
    if (ht / n >= 0.1) risks.push(c.riskHot(nm));
    if (cd / n >= 0.1) risks.push(c.riskCold(nm));
    if (ss[0].phF < 1) risks.push(c.riskPh(nm));
    if (!["rice", "maize", "mulch"].includes(id)) ask.push(c.askBuyer(cropName(id).toLowerCase()));
  }
  const bareRain = f.grid.filter((g, i) => g.bare?.share > 0.2 && normalRain(r.clim, r.period[i].m) > 80).length;
  if (bareRain) risks.push(c.riskBare(bareRain));
  const tr = r.terrain, d = describeSoil(tr?.soil);
  unknown.push(c.unkClimate);
  unknown.push(d ? (tr.soil.offsetKm ? c.unkSoilNear(tr.soil.offsetKm) : c.unkSoil) : c.unkNoSoil);
  unknown.push(c.unkVariety);
  if (crops.some((id) => DATA.crops[id]?.approximate)) unknown.push(c.approx);
  if (!nearPilot(state.plan.place)) unknown.push(c.unkPrices);
  ask.unshift(c.askVariety(cropName(crops[0] || "maize").toLowerCase()));
  if (r.site.wl >= 0.5) ask.push(c.askDrain);
  if (d && (d.phClass === "acid" || d.phClass === "very_acid")) ask.push(c.askLime);
  return { why: why.slice(0, 4), risks: risks.slice(0, 4), unknown, ask: [...new Set(ask)].slice(0, 4) };
}
function explainSheet(title, f, r) {
  const e = explain(f, r), c = C();
  const list = (head, items, cls) => (items.length ? [h("b", { style: { marginTop: "6px" } }, head), h("ul", { class: `bul ${cls || ""}` }, ...items.map((x) => h("li", {}, x)))] : []);
  sheet(h("h2", { class: "display" }, title), verdictEl(f.verdict), farmCalendar(r, f, { compact: true }),
    ...list(c.whyTitle, e.why, "good"), ...list(c.riskTitle, e.risks, "bad"), ...list(c.unknownTitle, e.unknown), ...list(c.askTitle, e.ask));
}
// Short, practical advice from the plot, the climate and the plan.
function tipsFor(r) {
  const c = C(), out = [], tr = r.terrain, d = describeSoil(tr?.soil), P = state.plan, N = r.period.length;
  const months = Array.from({ length: 12 }, (_, i) => { const vs = Object.entries(r.clim.months).filter(([k]) => +k.slice(5) === i + 1 && +k.slice(0, 4) >= 1991 && +k.slice(0, 4) <= 2020).map(([, v]) => v); const avg = (f) => vs.reduce((a, v) => a + v[f], 0) / Math.max(1, vs.length); return { m: i + 1, rain: avg("rain"), et0: avg("et0"), tmax: avg("tmax"), tmin: avg("tmin") }; });
  if (r.site.wl >= 0.5) out.push(["i-waves", c.tipDrain]);
  if (DATA.outlook?.official?.noaa?.chance_pct >= 70 && COAST(P.place)) out.push(["i-rain", c.tipNino]);
  const bareRain = r.farm ? r.farm.grid.filter((g, i) => g.bare?.share > 0.2 && normalRain(r.clim, r.period[i].m) > 80).length : 0;
  if (bareRain >= 2) out.push(["i-leaf", c.tipCover(bareRain)]);
  if (d?.texture === "clay" || d?.texture === "clay_loam") out.push(["i-info", c.tipClay]);
  if (d?.texture === "sand" || d?.texture === "sandy_loam") out.push(["i-drops", c.tipSand]);
  if (d && (d.phClass === "acid" || d.phClass === "very_acid")) out.push(["i-alert", c.tipAcid(num(d.ph))]);
  if (d && (d.phClass === "alkaline" || d.phClass === "very_alkaline")) out.push(["i-alert", c.tipAlkaline(num(d.ph))]);
  if (d?.omClass === "low") out.push(["i-sprout", c.tipLowOM]);
  if ((tr?.slopePct ?? 0) >= 8) out.push(["i-info", c.tipSlope]);
  const dry = months.filter((x) => x.rain < 0.5 * x.et0).length;
  if (dry >= 3 && !P.irrigation) out.push(["i-sun", c.tipDry(dry)]);
  const hot = months.filter((x) => x.tmax >= 34).map((x) => mon(x.m));
  if (hot.length) out.push(["i-sun", c.tipHot(andList(hot.slice(0, 4)))]);
  const frost = months.filter((x) => x.tmin <= 3).map((x) => mon(x.m));
  if (frost.length) out.push(["i-alert", c.tipFrost(andList(frost.slice(0, 4)))]);
  if (P.crops.some((id) => CEREALS.has(id))) out.push(["i-sprout", c.tipBurn]);
  out.push(["i-user", c.checkLocal]);
  return out;
}
const tipList = (items) => h("ul", { class: "tips" }, ...items.map(([ic, tx]) => h("li", {}, h("span", { class: "ic" }, icon(ic)), h("span", {}, tx))));
function sig(f) { return f.parcels.map((p) => p.d.steps.map((s) => s.crop + s.t0).join(",")).join("|"); }

/* ---------- the plot ---------- */
// The plot from the satellite with the picked plan's plots drawn on it. The split is illustrative, and says so.
function plotMap(r, f) {
  const P = state.plan, pl = P.place, D = C().ds, dk = demoKey(pl), d = 0.006, N = r.period.length;
  const bb = [pl.lon - d * 2.6, pl.lat - d, pl.lon + d * 2.6, pl.lat + d].join(",");
  const plots = plotsOf(f).map((x) => ({ ...x, lead: runsOf(x.pc, N).find((ru) => ru.c !== "bare" && ru.c !== "mulch")?.c || "bare" }));
  const label = ({ name, lead, pc }) => h("span", {}, tile(lead), h("b", {}, name), `${cropLabel(lead)} · ${fmtArea(pc.share)}`);
  if (P.lot?.length >= 3) {
    // The drawn plot on the image, split in strips by share. Image and SVG share the same box in degrees (EPSG:4326, W:H = 1000:420).
    const lo = P.lot.map((p) => p[0]), la = P.lot.map((p) => p[1]), cx = (Math.min(...lo) + Math.max(...lo)) / 2, cy = (Math.min(...la) + Math.max(...la)) / 2;
    let hh = Math.max(Math.max(...la) - Math.min(...la), (Math.max(...lo) - Math.min(...lo)) * 420 / 1000) * 1.9; hh = Math.max(hh, 0.0012);
    const ww = hh * 1000 / 420, x0 = cx - ww / 2, y1 = cy + hh / 2;
    const X = (v) => ((v - x0) / ww) * 1000, Y = (v) => ((y1 - v) / hh) * 420, pts = P.lot.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
    const xa = X(Math.min(...lo)), xb = X(Math.max(...lo)), tot = plots.reduce((a, x) => a + x.pc.share, 0) || 1;
    let acc = xa;
    const strips = plots.map(({ pc, lead }) => { const w = ((xb - xa) * pc.share) / tot, r = svg("rect", { x: acc, y: 0, width: w, height: 420, fill: look(lead).color, "fill-opacity": 0.38 }); acc += w; return r; });
    const cuts = strips.slice(1).map((r) => svg("line", { x1: r.getAttribute("x"), x2: r.getAttribute("x"), y1: 0, y2: 420, stroke: "#F3F0E5", "stroke-width": 2, "stroke-dasharray": "6 5" }));
    return h("section", { class: "plot-map" },
      h("img", { alt: "", src: `${ESRI}/export?bbox=${[x0, cy - hh / 2, x0 + ww, y1].join(",")}&bboxSR=4326&imageSR=4326&size=1000,420&format=jpg&f=image` }),
      svg("svg", { class: "pm-shape", viewBox: "0 0 1000 420", preserveAspectRatio: "xMidYMid slice", "aria-hidden": "true" },
        svg("defs", {}, svg("clipPath", { id: "pmClip" }, svg("polygon", { points: pts }))),
        svg("g", { "clip-path": "url(#pmClip)" }, ...strips, ...cuts),
        svg("polygon", { points: pts, fill: "none", stroke: "#C8FF9E", "stroke-width": 3, "stroke-linejoin": "round" })),
      h("div", { class: "pm-keys" }, ...plots.map((x) => h("div", { class: "pm-key", style: { "--c": look(x.lead).color } }, label(x)))),
      h("div", { class: "pm-cap" }, h("b", {}, D.plotMap), h("span", {}, D.plotMapNote)));
  }
  return h("section", { class: "plot-map" },
    h("img", { alt: "", src: dk ? `img/sat/${dk}.jpg` : `${ESRI}/export?bbox=${bb}&bboxSR=4326&size=1000,420&format=jpg&f=image` }),
    h("div", { class: "pm-lot" }, ...plots.map(({ pc, name, lead }) => h("div", { class: "pm-plot", style: { flexGrow: String(pc.share), "--c": look(lead).color } },
      h("span", {}, tile(lead), h("b", {}, name), `${cropLabel(lead)} · ${fmtArea(pc.share)}`)))),
    h("div", { class: "pm-cap" }, h("b", {}, D.plotMap), h("span", {}, D.plotMapNote)));
}
/* ---------- the plot in 3D: the satellite photo in relief, the plot lifted out of it with its soil ---------- */
// The plot's corners: the drawn ones, or a rectangle of the plot's real size centred on the pin
function lotOf(P) {
  if (P.lot?.length >= 3) return { pts: P.lot, drawn: true };
  const ha = (P.area || 1) * UNITS[P.unit || "ha"], w = Math.sqrt(ha * 1e4 * 2), R = 6371008.8, k = 180 / Math.PI, { lon, lat } = P.place;
  const dLat = (w / 4 / R) * k, dLon = (w / 2 / (R * Math.cos(lat / k))) * k;
  return { pts: [[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat]], drawn: false };
}
function viewTerreno() {
  return withResults(async (r) => {
    const picked = (await chosen(r)).f;
    const c = C(), T = c.s3, P = state.plan, tr = r.terrain, d = describeSoil(tr?.soil), wl = r.site.wl, { pts, drawn } = lotOf(P);
    const months = Array.from({ length: 12 }, (_, i) => { const vs = Object.entries(r.clim.months).filter(([k]) => +k.slice(5) === i + 1 && +k.slice(0, 4) >= 1991 && +k.slice(0, 4) <= 2020).map(([, v]) => v); const avg = (f) => vs.reduce((a, v) => a + v[f], 0) / Math.max(1, vs.length); return { m: i + 1, rain: avg("rain"), et0: avg("et0"), tmax: avg("tmax"), tmin: avg("tmin") }; });
    const annual = months.reduce((a, x) => a + x.rain, 0), wet = months.filter((x) => x.rain >= x.et0 * 0.8).map((x) => mon(x.m)), dry = months.filter((x) => x.rain < 0.5 * x.et0).map((x) => mon(x.m));
    const tmin = Math.min(...months.map((x) => x.tmin)), tmax = Math.max(...months.map((x) => x.tmax));
    const slope = tr?.slopePct, slopeW = slope == null ? "—" : slope < 2 ? c.flat : slope < 8 ? c.gentle : c.steep;
    const row = (k, v, note, key) => h("div", { class: "trow", "data-k": key, onmouseenter: key && (() => hi(key)), onmouseleave: key && (() => hi(null)) }, h("span", {}, k, key ? h("i", { class: "pin" }) : null), h("div", {}, h("b", {}, v), note ? h("small", {}, note) : null));
    const wlW = wl >= 0.6 ? c.high : wl >= 0.35 ? c.medium : c.low;
    const wlWhy = P.waterlog ? c.wlYouSaid : tr?.pilotWater != null ? c.wlSat : c.wlEstimated;
    const mx = Math.max(...months.map((x) => Math.max(x.rain, x.et0)), 1);
    const last = r.clim.last, lm = r.clim.months[last], lmNormal = normalRain(r.clim, +last.slice(5));
    const noaa = DATA.outlook?.official?.noaa, erfen = DATA.outlook?.official?.erfen;
    // Month by month from the area's normal rain and evaporation (NASA POWER): how wet the soil is, how much low ground holds water
    const bal = (m) => months[m].rain - months[m].et0;
    const wetOf = (m) => Math.max(0, Math.min(1, (bal(m) + 170) / 310)), floodOf = (m) => Math.max(0, Math.min(0.24, (bal(m) / 134) * 0.22 * (0.6 + 0.8 * wl)));
    const soilWord = (m) => (wetOf(m) >= 0.75 ? T.soilWet : wetOf(m) >= 0.4 ? T.soilMoist : T.soilDry);
    const st = { m: months.reduce((b, x, i) => (x.rain > months[b].rain ? i : b), 0), mode: "foto", water: true, roofs: true, lifted: true };
    let scene = null;
    const hi = (key) => { scene?.highlight(key); document.querySelectorAll(".terreno .trow[data-k]").forEach((x) => x.classList.toggle("on", x.dataset.k === key)); };

    const hMonth = h("h2", {}), hSub = h("p", {}), labelsEl = h("div", { class: "s3-labels" }), note = h("div", { class: "s3-note", hidden: true });
    const segBtn = (lab, on, fn, dot) => h("button", { "aria-pressed": String(on), onclick: fn }, dot ? h("span", { class: "dot", style: { background: dot } }) : null, lab);
    const tools = h("div", { class: "s3-seg", role: "group" });
    const strip = h("div", { class: "s3-months" }), bars = h("div", { class: "clim-bars" });
    const stage = h("section", { class: "s3", "aria-label": T.from },
      labelsEl,
      h("div", { class: "s3-head" }, h("div", { class: "mono" }, T.from), hMonth, hSub),
      h("div", { class: "s3-ctrl" }, tools),
      drawn ? null : h("div", { class: "s3-example" }, icon("i-info"), T.example),
      h("div", { class: "s3-src" }, T.src),
      h("div", { class: "s3-foot" }, strip, h("div", { class: "s3-unk" }, ...T.unk.map(([lab, tx]) => h("button", { "aria-expanded": "false", onclick: (e) => {
        const b = e.currentTarget, open = b.getAttribute("aria-expanded") !== "true";
        b.parentNode.querySelectorAll("button").forEach((x) => x.setAttribute("aria-expanded", "false"));
        b.setAttribute("aria-expanded", String(open)); note.hidden = !open; note.textContent = tx;
      } }, lab)))),
      note,
      h("div", { class: "s3-loading" }, T.loading));
    const labels = () => {
      const f = st.water ? floodOf(st.m) : 0;
      return { lot: T.lot, lotSub: T.lotSub, cut: T.cut, soil: d ? c.texture[d.texture] : c.noData, waterK: f > 0 ? T.lows : T.lowsK, waterV: f > 0 ? T.lowsPct(Math.round(floodOf(st.m) * 100)) : T.noLows, roofsK: T.roofsK, roofsV: T.roofsV };
    };
    const paint = (rebuild = true) => {
      const m = st.m, x = months[m];
      hMonth.textContent = cap(S().monthsLong[m]);
      hSub.textContent = `${x.rain >= x.et0 * 0.8 ? T.rainy : x.rain < 0.5 * x.et0 ? T.drySeason : T.between} · ${soilWord(m)}`;
      put(tools, segBtn(T.photo, st.mode === "foto", () => { st.mode = "foto"; paint(); }),
        segBtn(T.green, st.mode === "verdor", () => { st.mode = "verdor"; paint(); }, "linear-gradient(90deg,#CDBF8C,#549A5C,#C8FF9E)"),
        segBtn(T.water, st.water, () => { st.water = !st.water; paint(); }, "var(--rain)"),
        segBtn(T.roofs, st.roofs, () => { st.roofs = !st.roofs; paint(); }, "#E9E3D3"),
        segBtn(T.lift, st.lifted, () => { st.lifted = !st.lifted; scene?.lift(st.lifted); paint(false); }));
      put(strip, ...months.map((y, i) => h("button", { "aria-pressed": String(i === m), "aria-label": cap(S().monthsLong[i]), onclick: () => { st.m = i; paint(); } }, h("i", { class: y.rain >= y.et0 * 0.8 ? "wet" : y.rain >= 0.5 * y.et0 ? "mid" : "" }), mon(i + 1))));
      bars.querySelectorAll(".cb").forEach((b, i) => b.setAttribute("aria-pressed", String(i === m)));
      if (rebuild) scene?.update({ mode: st.mode, water: st.water, roofs: st.roofs, lifted: st.lifted, wet: wetOf(m), flood: floodOf(m) });
    };
    put(bars, ...months.map((x, i) => h("button", { class: "cb", "aria-label": cap(S().monthsLong[i]), onclick: () => { st.m = i; paint(); stage.scrollIntoView({ behavior: "smooth", block: "nearest" }); } },
      h("span", { class: "v" }, String(Math.round(x.rain))), h("div", { class: "bars" }, h("i", { class: "r", style: { height: `${Math.max(2, (x.rain / mx) * 100)}%` } }), h("i", { class: "e", style: { height: `${Math.max(2, (x.et0 / mx) * 100)}%` } })), h("span", {}, S().months[x.m - 1]))));
    paint();

    put($("#view"), h("div", { class: "terreno" }, stage, h("div", { class: "res terreno-cards" }, resHead(P),
      h("div", { class: "col-left" },
        h("section", { class: "card" }, h("h2", { class: "card-h" }, c.yourPlot),
          h("div", {},
            row(c.elevation, tr?.elevation != null ? `${tr.elevation} m` : "—"),
            row(c.slope, slopeW, slope != null ? `${num(slope)} %` : null),
            row(c.soilType, d ? c.texture[d.texture] : c.noData, d ? c.holds(d.awc) : null, "soil"),
            row(c.acidity, d ? c.phWord[d.phClass] : c.noData, d ? `pH ${num(d.ph)}` : null),
            row(c.organic, d ? c.omWord[d.omClass] : c.noData, d ? `${num(d.om)} %` : null),
            row(c.waterlog, wlW, wlWhy, "water")),
          h("div", { class: "q" }, h("small", { class: "small" }, c.wlFix), waterlogOpts(P, () => { setPlan({ ...P }); memo.clear(); syncLot(); render(); })),
          h("p", { class: "small" }, d && tr.soil.offsetKm ? c.srcTerrainNear(tr.soil.offsetKm) : c.srcTerrain))),
      h("div", { class: "col-right" },
        h("section", { class: "card" }, h("h2", { class: "card-h" }, c.climate),
          h("div", { class: "kpis" }, h("div", {}, h("b", {}, `${Math.round(annual).toLocaleString(state.lang)} mm`), h("small", {}, c.rainYear)), h("div", {}, h("b", {}, `${Math.round(tmin)}–${Math.round(tmax)} °C`), h("small", {}, c.tempRange)), h("div", {}, h("b", {}, String(dry.length)), h("small", {}, c.dryMonths))),
          bars,
          h("div", { class: "legend" }, h("span", {}, h("i", { class: "sw", style: { background: "var(--rain)" } }), c.lgRain), h("span", {}, h("i", { class: "sw", style: { background: "#C7CCD4" } }), c.lgNeed), h("span", {}, T.tapMonth)),
          h("p", { class: "small" }, wet.length ? c.wetMonths(andList(wet)) : "", " ", dry.length ? c.dryList(andList(dry)) : "")),
        h("section", { class: "card" }, h("h2", { class: "card-h" }, c.thisYear),
          lm ? row(`${cap(S().monthsLong[+last.slice(5) - 1])} ${last.slice(0, 4)}`, `${Math.round(lm.rain)} mm`, c.vsNormal(Math.round(lmNormal))) : null,
          noaa ? h("p", {}, c.ninoNow(noaa.chance_pct), h("br"), h("small", { class: "small" }, `NOAA · ${noaa.issued}`)) : null,
          erfen && COAST(P.place) ? h("p", { class: "small" }, `ERFEN (${erfen.issued}): ${es() ? erfen.es : erfen.en}`) : null),
        h("section", { class: "card" }, h("h2", { class: "card-h" }, c.tipsTitle), tipList(tipsFor(r)))))));

    // The 3D loads after the page; without WebGL or the network the flat satellite map stays
    const [lon, lat] = lotCenter(pts);
    import("./soil3d.js?v=2").then((m) => m.mountSoil3d(stage, labelsEl, { lat, lon, lot: pts, labels })).then((s) => {
      if (!s) return;
      scene = s; stage.classList.add("ready"); paint();
    }).catch(() => { if (stage.isConnected) stage.replaceWith(plotMap(r, picked)); });
  });
}

/* ---------- ideas: changes that should do better, each checked by running the planner again ---------- */
async function ideas(r) {
  const P = state.plan, c = C(), f = r.farm, N = r.period.length, out = [];
  const effect = async (P2) => {
    try {
      const v = await results(P2, state.mode), g = v.farm; if (!g) return null;
      const parts = [], dh = g.harvest - f.harvest;
      if (dh > 0.03) parts.push(c.effMore(fmtArea(dh, P2)));
      if (g.anyLoss < f.anyLoss - 0.05) parts.push(c.effLess);
      const dc = Math.round((g.covered - f.covered) * N); if (dc > 0) parts.push(c.effCover(dc));
      return parts.length ? parts.slice(0, 2).join(" · ") : null;
    } catch { return null; }
  };
  const cand = [];
  for (const s of r.substitutes || []) { const a = s.alts[0]; if (a) cand.push({ kind: "instead", icon: "i-wheat", title: c.idInstead(cap(cropName(a.id)), cropName(s.id)), why: c.idInsteadWhy(cap(cropName(s.id))), P2: { ...P, crops: [...P.crops.filter((x) => x !== s.id), a.id] } }); }
  if (!P.irrigation) cand.push({ kind: "irrigation", icon: "i-drops", title: c.idIrr, why: c.idIrrWhy, P2: { ...P, irrigation: true } });
  if (!P.crops.some((id) => DATA.crops[id]?.n_fixing)) {
    const leg = Object.values(r.windows).filter((w) => DATA.crops[w.id]?.n_fixing && !GREEN.has(w.id) && !P.crops.includes(w.id)).sort((a, b) => (b.best?.value ?? 0) - (a.best?.value ?? 0))[0];
    if (leg && (leg.best?.value ?? 0) >= 0.5) cand.push({ kind: "legume", icon: "i-leaf", title: c.idLegume(cropName(leg.id)), why: c.idLegumeWhy, P2: { ...P, crops: [...P.crops, leg.id] } });
  }
  if (!P.crops.includes("mulch") && P.crops.some((id) => CEREALS.has(id)) && f.covered < 0.85) cand.push({ kind: "straw", icon: "i-sprout", title: c.idStraw, why: c.idStrawWhy, P2: { ...P, crops: [...P.crops, "mulch"] } });
  for (const it of cand) { const eff = await effect(it.P2); if (eff) out.push({ ...it, eff, apply: () => { state.undo = { plan: P, mode: state.mode }; setPlan(it.P2); render(); } }); }
  if (state.mode === "all") {
    if (ninoNow(P)) out.unshift({ kind: "nino", icon: "i-rain", title: c.idNino, why: c.idNinoWhy, eff: c.yearsLike.nino, apply: () => { state.undo = { plan: P, mode: "all" }; state.mode = "nino"; render(); } });
    out.push({ kind: "dry", icon: "i-cloud-sun", title: c.idDry, why: c.idDryWhy, eff: c.idDryEff, apply: () => { state.undo = { plan: P, mode: "all" }; state.mode = "dry"; render(); } });
  } else out.unshift({ kind: "all", icon: "i-cloud-sun", title: c.idAll, why: c.idAllWhyBy[state.mode] || c.idAllWhy, eff: c.yearsLike[state.mode], apply: () => { state.mode = "all"; state.undo = null; render(); } });
  return out;
}
function viewProbar() {
  return withResults(async (r) => {
    const c = C(), P = state.plan, list = await ideas(r);
    const picked = P.crops.filter((id) => r.windows[id]);
    const suggested = [...new Set(list.flatMap((it) => (it.P2 ? it.P2.crops.filter((x) => !P.crops.includes(x) && r.windows[x]) : [])))];
    const N = r.period.length, lab = desktop() ? "146px" : "64px";
    const head = h("div", { class: "sow-row", style: { "--lab": lab } }, h("span"), h("div", { class: "sow-cells", style: { "--n": N } }, ...r.period.map((p, i) => N > 24
      ? h("span", { style: { fontSize: "12px", fontWeight: 700, color: "var(--ink2)", whiteSpace: "nowrap" } }, p.m === 1 ? `'${String(p.y).slice(2)}` : "")
      : h("span", { style: { textAlign: "center", fontSize: "12px", fontWeight: 700, color: "var(--ink2)", overflow: "hidden" } }, N <= 14 && desktop() ? mon(p.m) : S().months[p.m - 1]))));
    const sowRow = (id) => {
      const w = r.windows[id];
      return h("div", { class: "sow-row", style: { "--lab": lab } }, h("b", { style: { fontSize: desktop() ? "16px" : "13px" } }, cap(cropName(id))),
        h("div", { class: "sow-cells", style: { "--n": N } }, ...w.starts.map((s, t) => h("i", { class: s ? s.level : "none", title: s ? `${ym(r.period[t])}: ${Math.round(s.value * 100)} %` : c.sowNone }, s && w.best && s.t === w.best.t && w.best.level !== "danger" ? "★" : ""))));
    };
    put($("#view"), h("div", { class: "res stack" },
      resHead(P),
      h("div", { class: "res-title" }, h("h1", { class: "display" }, c.tryTitle), h("p", {}, c.tryLead)),
      state.undo ? h("button", { class: "link", style: { alignSelf: "flex-start" }, onclick: () => { setPlan(state.undo.plan); state.mode = state.undo.mode; state.undo = null; render(); } }, icon("i-undo"), " ", c.undo) : null,
      list.length ? h("div", { class: "ideas row-ideas" }, ...list.map((it) => h("div", { class: `idea${it.on ? " on" : ""}`, "data-rooti": `idea-${it.kind}` }, h("span", { class: "ic" }, icon(it.icon)), h("div", { class: "grow" }, h("b", {}, it.title), h("p", {}, it.why), h("em", {}, it.eff)),
        h("button", { class: "btn dark", onclick: it.apply }, it.on ? c.undo : c.tryBtn)))) : h("p", {}, c.noIdeas),
      h("section", { class: "card sow-card", "data-rooti": "sow" },
        h("div", { class: "row between wrap" }, h("b", { class: "card-h" }, c.sowTitle),
          h("div", { class: "legend" }, ...[["good", c.sowGood], ["care", c.sowCare], ["danger", c.sowBad], ["none", c.sowNone]].map(([k, l]) => h("span", {}, h("i", { class: `sw ${k}` }), l)))),
        h("p", { class: "small" }, c.sowLead),
        h("div", { class: "sow" }, head, h("p", { class: "sow-group" }, c.yours), ...picked.map(sowRow), suggested.length ? h("p", { class: "sow-group" }, c.suggested) : null, ...suggested.slice(0, 3).map(sowRow)))));
  });
}

/* ---------- compare: build your own ---------- */
const customFrom = (f) => f.parcels.map((pc) => ({ area: +(pc.share * state.plan.area).toPrecision(8), steps: pc.d.steps.map((s) => ({ crop: s.crop, t0: s.t0 })) }));
function money(f) {
  if (!nearPilot(state.plan.place) || !DATA.econ) return null;
  const A = (state.plan.area || 1) * UNITS[state.plan.unit || "ha"];
  let total = 0, known = false;
  for (const b of Object.values(f.byCrop)) for (const p of b.plantings) { const e = DATA.econ.crops?.[b.crop], y = e?.yield_t_ha?.typical, pr = e?.price_usd_per_t?.typical, co = e?.cost_usd_ha?.typical; if (!y || !pr || !co) continue; known = true; total += p.share * A * (y * pr * p.yld - co); }
  return known ? Math.round(total / 10) * 10 : null;
}
// The plan the farmer picked on the plan screen; compare and "what if" follow it
async function chosen(r) {
  const plans = await namedPlans(), it = plans.find((x) => x.key === state.pick) || plans[0];
  return it ? { f: it.f, name: C().ds.names[it.key] } : { f: r.farm, name: C().recommended };
}
function viewComparar() {
  return withResults(async (r) => {
    const c = C(), P = state.plan, { f: rec, name: recName } = await chosen(r), N = r.period.length;
    if (!state.custom || state.customKey !== JSON.stringify(P)) { state.custom = customFrom(r.today || rec); state.customKey = JSON.stringify(P); state.customStraw = !r.today && P.crops.includes("mulch"); }
    const K = state.custom, redo = () => keepScroll(() => viewComparar());
    const mine = r.evalFarm(K.map((pc) => ({ share: (+pc.area || 0) / (P.area || 1), steps: pc.steps })), { noMulch: !state.customStraw });
    const choices = [...new Set([...P.crops.filter((id) => id !== "mulch"), ...CROP_ORDER.filter((id) => id !== "mulch" && DATA.crops[id])])];
    const used = K.reduce((x, pc) => x + (+pc.area || 0), 0);
    const exceedsArea = used > P.area * (1 + 1e-7);
    const hasPlanting = mine.parcels.some((pc) => pc.share > 0 && pc.d.steps.length);
    const compareError = exceedsArea ? c.compareAreaError : mine.errors.length ? c.comparePlantingError : !hasPlanting ? c.compareEmpty : null;
    const freeT = (pc) => pc.steps.reduce((e, s) => Math.max(e, s.t0 + r.monthsOf(s.crop)), 0);
    const fittingCrop = (t) => choices.find((id) => r.monthsOf(id) + t <= N);
    const plots = K.map((pc, k) => {
      const ev = mine.parcels[k], next = freeT(pc), nextCrop = fittingCrop(next);
      return h("div", { class: "card plot" },
        h("div", { class: "plot-head" }, h("b", {}, `${c.plot} ${String.fromCharCode(65 + k)}`),
          h("label", { class: "plot-area" }, h("input", { type: "number", min: "0", step: "any", value: String(pc.area), onchange: (e) => { const area = e.target.valueAsNumber; pc.area = validArea(area) ? area : 0; redo(); } }), c.units[P.unit || "ha"]),
          K.length > 1 ? h("button", { class: "link", style: { fontSize: "14px" }, onclick: () => { K.splice(k, 1); redo(); } }, c.remove) : null),
        ...pc.steps.map((st, j) => {
          const s = ev?.d.steps.find((x) => x.t0 === st.t0 && x.crop === st.crop), er = ev?.errors.find((x) => x.index === j);
          const lv = s ? (s.fail >= 0.5 ? "danger" : s.fail > 0.15 || s.yld < 0.6 ? "care" : "good") : "danger";
          return h("div", { class: "pl-step" },
            h("select", { "aria-label": c.what, onchange: (e) => { st.crop = e.target.value; redo(); } }, ...choices.map((id) => h("option", { value: id, selected: id === st.crop || null }, cap(cropName(id))))),
            h("select", { "aria-label": c.when, onchange: (e) => { st.t0 = +e.target.value; redo(); } }, ...r.period.map((p, t) => h("option", { value: t, selected: t === st.t0 || null, disabled: r.monthsOf(st.crop) + t > N || null }, ym(p)))),
            h("span", { class: `res-txt v-${lv}` }, er ? (er.why === "overlap" ? c.overlap : c.noTime) : s ? `→ ${ym(r.period[s.t1 - 1])} · ${outcomeShort({ fail: s.fail, yld: s.yld }, s.n)}` : ""),
            h("button", { class: "x", "aria-label": c.remove, title: c.remove, onclick: () => { pc.steps.splice(j, 1); redo(); } }, icon("i-x")));
        }),
        nextCrop ? h("button", { class: "link", style: { alignSelf: "flex-start", fontSize: "14px" }, onclick: () => { pc.steps.push({ crop: nextCrop, t0: next }); redo(); } }, c.addPlanting) : null);
    });
    const mR = money(rec), mM = money(mine), $$ = (x) => `${x < 0 ? "−" : "+"}$${Math.abs(x).toLocaleString(state.lang)}`;
    const rows = [
      [c.rHarvest, fmtArea(rec.harvest), fmtArea(mine.harvest), rec.harvest, mine.harvest, true],
      [c.rAnyLoss, frac(rec.anyLoss), frac(mine.anyLoss), rec.anyLoss, mine.anyLoss, false],
      [c.rBigLoss, frac(rec.bigLoss), frac(mine.bigLoss), rec.bigLoss, mine.bigLoss, false],
      [c.rCovered, c.ofMonths(Math.round(rec.covered * N), N), c.ofMonths(Math.round(mine.covered * N), N), rec.covered, mine.covered, true],
      ...(mR != null && mM != null ? [[c.rMoney, $$(mR), $$(mM), mR, mM, true]] : []),
    ];
    const better = (a, b, up) => (Math.abs(a - b) <= 0.02 * Math.max(Math.abs(a), Math.abs(b), 0.05) ? 0 : (up ? b > a : b < a) ? 1 : -1);
    const score = rows.reduce((x, rw) => x + better(rw[3], rw[4], rw[5]), 0);
    const why = score >= 0 ? "" : mine.anyLoss > rec.anyLoss + 0.1
      ? (es() ? `Su plan pierde cosecha ${frac(mine.anyLoss).toLowerCase()} años; el recomendado, ${frac(rec.anyLoss).toLowerCase()}.` : `Your plan loses a harvest ${frac(mine.anyLoss).toLowerCase()} years; the recommended one, ${frac(rec.anyLoss).toLowerCase()}.`)
      : rec.harvest > mine.harvest ? (es() ? `Con el recomendado llega a cosecha ${fmtArea(rec.harvest - mine.harvest)} más.` : `The recommended plan brings ${fmtArea(rec.harvest - mine.harvest)} more to harvest.`) : "";
    const calCard = (title, f) => h("section", { class: "card" }, h("div", { class: "row between" }, h("b", {}, title), verdictEl(f.verdict)), f.parcels.some((p) => p.d.steps.length) ? farmCalendar(r, f, { compact: true }) : h("p", { class: "small" }, c.noPlans));
    put($("#view"), h("div", { class: "res cmp" },
      resHead(P),
      h("div", { class: "col-left wide" },
        h("div", { class: "res-title" }, h("h1", { class: "display" }, c.build), h("p", {}, c.buildLead)),
        ...plots,
        h("div", { class: "row wrap", style: { gap: "14px" } },
          h("button", { class: "btn", onclick: () => { K.push({ area: Math.max(0, +(P.area - used).toPrecision(8)), steps: [{ crop: fittingCrop(0), t0: 0 }] }); redo(); } }, c.addPlot),
          h("button", { class: "link", onclick: () => { state.custom = customFrom(rec); state.customStraw = P.crops.includes("mulch"); redo(); } }, c.reset)),
        P.crops.includes("mulch") ? h("label", { class: "row", style: { gap: "8px", fontSize: "15px" } }, h("input", { type: "checkbox", checked: state.customStraw || null, onchange: (e) => { state.customStraw = e.target.checked; redo(); } }), c.keepStraw) : null,
        h("p", { class: exceedsArea ? "err" : "small" }, c.uses(fmtArea(used / P.area), fmtArea(1)))),
      h("div", { class: "col-right" },
        h("h2", { class: "display phone-only", style: { fontSize: "22px" } }, c.cmpTitle),
        compareError ? [
          h("p", { class: "err", role: "status" }, compareError),
          calCard(recName, rec),
        ] : [
          // Swaps only the calendar so the pressed button keeps keyboard focus.
          h("div", { class: "seg cmp-seg" }, ...[["rec", recName], ["mine", c.mine]].map(([k, l]) => h("button", { "aria-pressed": String((state.cmpView || "rec") === k), onclick: (e) => {
            const seg = e.currentTarget.parentElement, from = activeRect(seg, '[aria-pressed="true"]'), d = k === "rec" ? -1 : 1;
            state.cmpView = k;
            for (const bt of seg.querySelectorAll("button")) bt.setAttribute("aria-pressed", String(bt === e.currentTarget));
            slidePill(seg, from, '[aria-pressed="true"]');
            put($("#cmpCal"), k === "rec" ? calCard(recName, rec) : calCard(c.mine, mine));
            if (MOTION()) $("#cmpCal").animate([{ opacity: 0, transform: `translateX(${d * 12}px)` }, { opacity: 1, transform: "none" }], { duration: 200, easing: EASE_OUT });
          } }, l))),
          h("div", { id: "cmpCal" }, (state.cmpView || "rec") === "rec" ? calCard(recName, rec) : calCard(c.mine, mine)),
          h("section", { class: "card cmp-bars" }, h("div", { class: "cmp-key" }, h("span", {}, h("i", { class: "a" }), recName), h("span", {}, h("i", { class: "b" }), c.mine)),
            ...rows.map(([l, a, b, va, vb, up]) => {
              const w = better(va, vb, up), mx = Math.max(Math.abs(va), Math.abs(vb), 1e-9), bars = va >= 0 && vb >= 0;
              const line = (cls, who, txt, v, win) => h("div", { class: `cb-line ${cls}${win ? " win" : ""}` }, h("span", { class: `cb-track${bars ? "" : " empty"}`, "aria-hidden": "true" }, bars ? h("i", { style: { width: `${Math.max(3, (Math.abs(v) / mx) * 100)}%` } }) : null),
                h("b", {}, h("span", { class: "sr-only" }, `${who}: `), txt, win ? h("span", { class: "sr-only" }, es() ? " (mejor)" : " (better)") : null), win ? icon("i-check") : h("span", { class: "cb-tick" }));
              return h("div", { class: "cb-row", role: "group", "aria-label": l }, h("span", { class: "cb-label", "aria-hidden": "true" }, l), line("a", recName, a, va, w < 0), line("b", c.mine, b, vb, w > 0));
            })),
          mR != null && mM != null ? h("p", { class: "small" }, c.moneyNote) : null,
          h("div", { class: `conclusion ${score > 0 ? "good" : "even"}` }, icon(score < 0 ? "i-info" : "i-check"), h("span", {}, score < 0 ? (why || c.recBetter) : score > 0 ? c.mineBetter : c.tie)),
        ])));
    edgeFade($(".res.cmp > .col-left"));
  });
}

/* ---------- what would have happened ---------- */
function viewPasado() {
  return withResults(async (r) => {
    const c = C(), per = (await chosen(r)).f.per;
    const lvl = (x) => (x.lostShare >= 0.5 ? "danger" : x.lostShare > 0 || x.loss > 2.5 ? "care" : "good");
    const sel = per.find((x) => x.base === state.pastBase) || per[0];
    const soil = sel.loss > 2.5 ? "high" : sel.loss > 1.2 ? "medium" : "low";
    put($("#view"), h("div", { class: "res", style: { flexDirection: "column" } },
      resHead(state.plan),
      h("div", { class: "res-title" }, h("h1", { class: "display" }, c.pastTitle), h("p", {}, per.length > 1 ? c.pastLead(per.length) : c.pastReal)),
      ninoBanner(r),
      h("div", { class: "legend" }, ...[["good", c.lgGood], ["care", c.lgCare], ["danger", c.lgDanger]].map(([k, l]) => h("span", {}, h("i", { class: `sw ${k}` }), l))),
      per.length > 1 ? h("div", { class: "years" }, ...per.map((x) => h("button", { class: lvl(x), "aria-pressed": String(x === sel), onclick: () => { state.pastBase = x.base; viewPasado(); } }, String(x.base)))) : null,
      h("section", { class: "card", style: { maxWidth: "720px" } },
        h("b", { style: { fontSize: "20px" } }, sel.base == null ? c.realClimate : c.ifLike(sel.base)),
        h("p", {}, c.harvestedLand(fmtArea(sel.harvest))),
        h("p", { class: sel.lostShare > 0 ? "v-danger" : "v-good", style: { fontWeight: 600 } }, sel.lostShare > 0 ? c.lostLand(Math.round(sel.lostShare * 100)) : c.noLoss),
        h("p", { class: "small" }, c.soilDamage[soil]))));
  });
}

/* ---------- soil passport: pilot zones only (MODIS fires around the plot) ---------- */
async function viewPasaporte() {
  const z = nearPilot(state.plan.place), f = z ? await fireData(z) : null, s = S();
  const yrs = f ? Object.entries(f.years).filter(([, x]) => x.lot_fires_by_month) : [];
  const seasonFire = (x) => x.lot_fires_by_month.slice(4).findIndex((n) => n > 0);
  const zoneBurn = yrs.filter(([, x]) => x.zone_fires_by_month.slice(4).some((n) => n > 0)).length;
  const last = yrs[yrs.length - 1], lastM = last ? seasonFire(last[1]) : -1;
  put($("#view"), h("div", { class: "res", style: { flexDirection: "column" } },
    resHead(state.plan),
    h("div", { class: "res-title" }, h("h1", { class: "display" }, s.passportTitle), h("p", {}, state.plan.place.name)),
    last ? h("div", { class: `pp-answer ${lastM < 0 ? "good" : "danger"}` }, h("p", { class: "small" }, s.burnQ(last[0])), h("b", {}, lastM < 0 ? s.noBurn : s.burnIn(s.monthsLong[lastM + 4])), h("small", { class: "small" }, s.viaSat)) : h("p", {}, "—"),
    h("ul", { class: "pp-years" }, ...yrs.slice(-5, -1).reverse().map(([y, x]) => { const m = seasonFire(x); return h("li", {}, h("b", {}, y), h("span", { class: m < 0 ? "v-good" : "v-danger" }, m < 0 ? s.noBurnShort : s.burnShort(s.monthsLong[m + 4]))); })),
    yrs.length ? h("p", { class: "small" }, s.zoneFires(zoneBurn, yrs.length)) : null));
}

/* ================= CesiumJS ================= */
let cesiumLoading = null, viewer = null, lotEntity = null, pickBound = false;
function loadCesium() {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  return (cesiumLoading ||= new Promise((res, rej) => {
    window.CESIUM_BASE_URL = CESIUM;
    const s = document.createElement("script"); s.src = CESIUM + "Cesium.js"; s.onload = () => window.Cesium ? res(window.Cesium) : rej(new Error("Cesium unavailable")); s.onerror = () => rej(new Error("Cesium failed to load")); document.head.append(s);
  }));
}
async function initCesium(container, { pick = false } = {}) {
  let Cz;
  try { Cz = await Promise.race([loadCesium(), new Promise((_, reject) => setTimeout(() => reject(new Error("Cesium load timed out")), 15000))]); }
  catch {
    const overlay = $("#map-overlay");
    if (overlay && !overlay.querySelector(".map-unavailable")) overlay.append(h("p", { class: "map-unavailable", role: "status" }, C().mapUnavailable));
    return;
  }
  if (!container.isConnected) return;
  if (viewer && viewer.container !== container) { viewer.destroy(); viewer = null; lotEntity = null; pickBound = false; }
  if (!viewer) {
    viewer = new Cz.Viewer(container, { baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, requestRenderMode: true });
    try { viewer.imageryLayers.addImageryProvider(await Cz.ArcGisMapServerImageryProvider.fromUrl(ESRI)); }
    catch { viewer.imageryLayers.addImageryProvider(new Cz.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" })); }
  }
  if (pick && !pickBound) {
    pickBound = true;
    new Cz.ScreenSpaceEventHandler(viewer.scene.canvas).setInputAction((e) => {
      if (!location.hash.startsWith("#/planear")) return;
      const cart = viewer.camera.pickEllipsoid(e.position, viewer.scene.globe.ellipsoid); if (!cart) return;
      const g = Cz.Cartographic.fromCartesian(cart);
      state.onPick?.(Cz.Math.toDegrees(g.latitude), Cz.Math.toDegrees(g.longitude));
    }, Cz.ScreenSpaceEventType.LEFT_CLICK);
  }
}
function globeView() { if (viewer && window.Cesium) viewer.camera.flyTo({ destination: window.Cesium.Cartesian3.fromDegrees(-70, -5, 14e6), duration: 1.2 }); }
// The plot on the globe: the pin alone until the farmer draws the plot's corners; then the real shape.
// fly: "place" (oblique view of the area), "draw" (straight down, close, to tap corners), "lot" (straight down, framing the plot), false (stay)
let lotDots = [];
function updateMap(pl, verdict, lot, fly = "place") {
  if (!viewer || !window.Cesium || !pl) return;
  const Cz = window.Cesium, col = (s) => Cz.Color.fromCssColorString(s);
  const fill = verdict ? { good: "#2F7D4F", care: "#C7860F", danger: "#D2452E" }[verdict] : "#C8FF9E";
  if (lotEntity) viewer.entities.remove(lotEntity);
  lotDots.forEach((e) => viewer.entities.remove(e)); lotDots = [];
  const pts = lot || [], closed = pts.length >= 3 && !state.drawing, c = pts.length >= 3 ? lotCenter(pts) : [pl.lon, pl.lat];
  const flat = (ps) => Cz.Cartesian3.fromDegreesArray(ps.flat());
  lotEntity = viewer.entities.add({
    polygon: pts.length >= 3 ? { height: 0, hierarchy: flat(pts), material: col(fill).withAlpha(closed ? 0.22 : 0.15) } : undefined,
    polyline: pts.length >= 2 ? { clampToGround: true, width: 3, material: col("#C8FF9E"), positions: flat(pts.length >= 3 ? [...pts, pts[0]] : pts) } : undefined,
    position: Cz.Cartesian3.fromDegrees(c[0], c[1]),
    point: state.drawing ? undefined : { pixelSize: 12, color: col("#C8FF9E"), outlineColor: col("#153E32"), outlineWidth: 3, heightReference: Cz.HeightReference.CLAMP_TO_GROUND },
    label: state.drawing ? undefined : { text: pl.name, font: "500 15px Geist, sans-serif", fillColor: col("#F3F0E5"), showBackground: true, backgroundColor: col("#153E32"), backgroundPadding: new Cz.Cartesian2(12, 8), pixelOffset: new Cz.Cartesian2(0, -30), heightReference: Cz.HeightReference.CLAMP_TO_GROUND },
  });
  if (state.drawing) lotDots = pts.map((p, i) => viewer.entities.add({ position: Cz.Cartesian3.fromDegrees(p[0], p[1]), point: { pixelSize: i === pts.length - 1 ? 14 : 10, color: col("#C8FF9E"), outlineColor: col("#153E32"), outlineWidth: 2 } }));
  const down = { heading: 0, pitch: Cz.Math.toRadians(-90), roll: 0 };
  if (fly === "place") viewer.camera.flyTo({ destination: Cz.Cartesian3.fromDegrees(c[0], c[1] - 0.02, 4500), orientation: { heading: 0, pitch: Cz.Math.toRadians(-55), roll: 0 }, duration: 1.6 });
  else if (fly === "draw") viewer.camera.flyTo({ destination: Cz.Cartesian3.fromDegrees(c[0], c[1], 1100), orientation: down, duration: 1.2 });
  else if (fly === "lot") { const span = lotSpanM(pts); viewer.camera.flyTo({ destination: Cz.Cartesian3.fromDegrees(c[0], c[1], Math.min(8000, Math.max(600, span * 5))), orientation: down, duration: 1.2 }); }
  // Ground shapes are built off the main thread; with requestRenderMode they only show on a later frame
  [0, 150, 400, 900].forEach((t) => setTimeout(() => viewer?.scene.requestRender(), t));
}

/* ================= Vecinos: what farmers nearby saw, next to the satellite data ================= */
// Demo: example posts ship in data/vecinos.json (marked example), the farmer's own posts and replies stay in localStorage.
// The post shape is the one the WhatsApp bot will store in rooti.db, so the feed can switch to a server without changes.
// With the server (Coolify: server/server.mjs + Postgres) posts are shared; without it (static host, no signal)
// the app falls back to the example posts and this phone's storage, so the feed and the plan chips always work.
const VEC = { posts: null, server: false, zone: null, load: null };
const vecDevice = () => { let d = store.get("vecDevice1", null); if (!d) { d = globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2); store.set("vecDevice1", d); } return d; };
async function vecApi(path, body) {
  const t = (ms) => (AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
  const r = await fetch("api/vecinos" + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: t(8000) } : { signal: t(4000) });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
function loadVecinos(pl = state.plan?.place, fresh = false) {
  const z = pl ? zoneKey(pl) : null;
  if (!fresh && VEC.load && VEC.zone === z) return VEC.load;
  VEC.zone = z;
  return (VEC.load = (async () => {
    if (z) try { const d = await vecApi(`?zone=${encodeURIComponent(z)}`); VEC.posts = d.posts || []; VEC.server = true; return; } catch { /* no server: examples and this phone */ }
    VEC.server = false;
    try { const d = await fetch("data/vecinos.json?v=1").then(ok); VEC.posts = (d.posts || []).map((p) => ({ ...p, example: true })); } catch { VEC.posts = []; }
  })());
}
const zoneKey = (pl) => nearPilot(pl) || `pt:${pl.lat.toFixed(1)},${pl.lon.toFixed(1)}`;
const vecText = (x) => x.text ?? (es() ? x.text_es : x.text_en) ?? "";
const maskName = (n) => { const w = (n || "").trim().split(/\s+/).filter(Boolean); return !w.length ? C().vec.anon : w.length === 1 ? cap(w[0]) : `${cap(w[0])} ${w[w.length - 1][0].toUpperCase()}.`; };
const monthGap = (a, b) => { const d = Math.abs(a - b) % 12; return Math.min(d, 12 - d); };
function vecPosts(pl) {
  const z = zoneKey(pl), hidden = new Set(store.get("vecHidden1", [])), extra = store.get("vecReplies1", {});
  return [...store.get("vecMine1", []).map((p) => ({ ...p, local: true })), ...(VEC.posts || [])].filter((p) => p.zone === z)
    .map((p) => ({ ...p, hidden: hidden.has(p.id), replies: [...(p.replies || []), ...(extra[p.id] || [])] }))
    .sort((a, b) => (b.ts || b.date).localeCompare(a.ts || a.date));
}
// Reports of the same crop sown within a month of the plan's month, in the plot's zone
const vecMatch = (pl, crop, m) => vecPosts(pl).filter((p) => p.type === "asi_me_fue" && !p.hidden && p.crop === crop && p.sowMonth && monthGap(p.sowMonth, m) <= 1);
// Never lets a problem with the neighbours' data break the plan screen
function vecChips(r, pc, all, seen) {
  try { return vecChipsOf(r, pc, all, seen); } catch (e) { console.error(e); return null; }
}
function vecChipsOf(r, pc, all, seen = new Set()) {
  if (!VEC.posts) return null;
  const V = C().vec, out = [];
  for (const ru of runsOf(pc, r.period.length)) {
    if (ru.c === "bare" || ru.c === "mulch" || (!all && ru.t0 >= 12)) continue;
    const m = r.period[ru.t0].m, k = `${ru.c}@${m}`;
    if (seen.has(k)) continue; seen.add(k);
    const rep = vecMatch(state.plan.place, ru.c, m);
    if (!rep.length) continue;
    const n = { bien: 0, regular: 0, perdio: 0 }; rep.forEach((p) => { n[p.result] = (n[p.result] || 0) + 1; });
    const lv = ru.st && ru.st.fail != null ? level(ru.st) : null, check = n.perdio / rep.length >= 1 / 3 && lv !== "danger";
    out.push(h("a", { class: `vec-chip${check ? " check" : ""}`, href: `#/vecinos/${ru.c}` }, icon("i-neighbors"),
      h("span", {}, h("b", {}, V.chip(rep.length, cropName(ru.c).toLowerCase(), monL(m))), " · ", ["bien", "regular", "perdio"].filter((x) => n[x]).map((x) => V.chipCount[x](n[x])).join(", "),
        check ? h("em", {}, V.chipCheck) : null), icon("i-chev-r")));
  }
  return out.length ? h("div", { class: "vec-chips" }, ...out) : null;
}
const VEC_BADGE = { bien: "good", regular: "care", perdio: "danger" };
function vecAuthor(x, V) {
  return h("p", { class: "vp-by" }, h("b", {}, x.author), x.role === "tecnico" ? h("span", { class: "vp-tech" }, icon("i-agronomist"), V.tech) : null, h("span", {}, fmtDate(x.date)));
}
function vecCard(p, redraw) {
  const c = C(), V = c.vec;
  if (p.hidden) return h("article", { class: "vp hidden" }, h("p", { class: "small" }, V.reported), h("button", { class: "link", onclick: () => { store.set("vecHidden1", store.get("vecHidden1", []).filter((x) => x !== p.id)); redraw(); } }, V.undoReport));
  const replyBox = h("div", { class: "vp-reply" });
  const openReply = () => {
    const input = h("textarea", { rows: 2, maxlength: 280, placeholder: V.replyPh, "aria-label": V.reply });
    put(replyBox, input, h("div", { class: "row", style: { gap: "8px" } },
      h("button", { class: "btn lime", onclick: async (e) => { const t = input.value.trim(); if (!t) { input.focus(); return; }
        e.currentTarget.disabled = true;
        if (VEC.server && !p.local) try { await vecApi(`/${encodeURIComponent(p.id)}/replies`, { author: state.vecName, text: t }); await loadVecinos(state.plan.place, true); redraw(); return; } catch { /* keep it on this phone */ }
        const all = store.get("vecReplies1", {}); (all[p.id] ||= []).push({ author: maskName(state.vecName), text: t, date: iso(new Date()), mine: true }); store.set("vecReplies1", all); redraw(); } }, V.send),
      h("button", { class: "btn soft", onclick: () => put(replyBox) }, V.fCancel)));
    input.focus();
  };
  return h("article", { class: `vp t-${p.type}` },
    h("div", { class: "vp-head" }, h("span", { class: "mono vp-type" }, V.type1[p.type]), p.example || p.local ? h("span", { class: `vp-tag${p.example ? "" : " mine"}` }, p.example ? V.example : V.local) : null),
    p.crop ? h("div", { class: "vp-crop" }, tile(p.crop), h("b", {}, V.sown(cropLabel(p.crop), monL(p.sowMonth), p.sowYear)), p.area ? h("span", { class: "small" }, `${num(p.area)} ${c.units[p.unit] || p.unit || ""}`) : null) : null,
    p.result ? h("span", { class: `badge ${VEC_BADGE[p.result]}` }, V.results[p.result]) : null,
    vecText(p) ? h("p", { class: "vp-text" }, vecText(p)) : null,
    vecAuthor(p, V),
    p.replies.length ? h("ul", { class: "vp-replies", "aria-label": V.replies(p.replies.length) }, ...p.replies.map((x) => h("li", { class: x.role === "tecnico" ? "tech" : "" }, vecAuthor(x, V), h("p", {}, vecText(x))))) : null,
    h("div", { class: "vp-acts" }, h("button", { class: "link", onclick: openReply }, icon("i-chat"), V.reply),
      h("button", { class: "link quiet", onclick: () => { store.set("vecHidden1", [...store.get("vecHidden1", []), p.id]); if (VEC.server && !p.local) vecApi(`/${encodeURIComponent(p.id)}/report`, { device: vecDevice() }).catch(() => {}); redraw(); } }, V.report)),
    replyBox);
}
function vecForm(P, done) {
  const c = C(), V = c.vec, d = (state.vecDraft ||= { type: "asi_me_fue", crop: null, sowMonth: new Date(P.start + "T12:00:00").getMonth() + 1, result: null, text: "" });
  const box = h("section", { class: "card vec-form", "aria-label": V.publish }), msg = h("p", { class: "err", role: "status" });
  const crops = [...new Set([...(P.current || []), ...P.crops])].filter((x) => x !== "mulch");
  const draw = () => {
    const text = h("textarea", { id: "vecText", rows: 3, maxlength: 280, placeholder: V.fPh[d.type], oninput: (e) => { d.text = e.target.value; } }); text.value = d.text;
    const name = h("input", { id: "vecName", autocomplete: "given-name", oninput: (e) => { state.vecName = e.target.value; store.set("vecName1", state.vecName); } }); name.value = state.vecName || "";
    put(box,
      h("b", { class: "card-h" }, V.fType),
      h("div", { class: "seg vec-seg" }, ...["asi_me_fue", "aviso", "pregunta"].map((k) => h("button", { "aria-pressed": String(d.type === k), onclick: () => { d.type = k; draw(); } }, V.type1[k]))),
      d.type === "asi_me_fue" ? [
        h("b", {}, V.fCrop), h("div", { class: "row wrap", style: { gap: "8px" } }, ...crops.map((id) => h("button", { class: "chip", "aria-pressed": String(d.crop === id), onclick: () => { d.crop = id; draw(); } }, tile(id), cropLabel(id)))),
        h("label", { class: "vec-field" }, h("b", {}, V.fMonth), h("select", { onchange: (e) => { d.sowMonth = +e.target.value; } }, ...S().monthsLong.map((m, i) => h("option", { value: i + 1, selected: d.sowMonth === i + 1 || null }, cap(m))))),
        h("b", {}, V.fResult), h("div", { class: "opts" }, ...["bien", "regular", "perdio"].map((k) => h("button", { class: "opt", "aria-pressed": String(d.result === k), onclick: () => { d.result = k; draw(); } }, V.results[k])))] : null,
      h("label", { class: "vec-field", for: "vecText" }, h("b", {}, V.fText[d.type])), text,
      h("label", { class: "vec-field", for: "vecName" }, h("b", {}, V.fName)), name, h("p", { class: "small" }, V.fNameHelp),
      msg,
      h("div", { class: "row wrap", style: { gap: "10px" } },
        h("button", { class: "btn lime", onclick: async (e) => {
          const t = d.text.trim();
          if (d.type === "asi_me_fue" ? !(d.crop && d.result) : !t) { msg.textContent = d.type === "asi_me_fue" ? `${V.fCrop} ${V.fResult}` : V.fNeed; return; }
          const now = new Date(), y = d.sowMonth > now.getMonth() + 1 ? now.getFullYear() - 1 : now.getFullYear();
          const post = { id: "u" + now.getTime(), type: d.type, zone: zoneKey(P.place), text: t, author: maskName(state.vecName), date: iso(now), replies: [],
            ...(d.type === "asi_me_fue" ? { crop: d.crop, sowMonth: d.sowMonth, sowYear: y, result: d.result } : {}) };
          const btn = e.currentTarget; btn.disabled = true;
          if (VEC.server) try { await vecApi("", { ...post, author: state.vecName }); state.vecDraft = null; done("server"); return; } catch { /* keep it on this phone */ }
          btn.disabled = false;
          store.set("vecMine1", [post, ...store.get("vecMine1", [])]); state.vecDraft = null; done("local");
        } }, V.fSubmit),
        h("button", { class: "btn soft", onclick: () => { state.vecDraft = null; done(null); } }, V.fCancel)));
  };
  draw();
  return box;
}
async function viewVecinos(arg) {
  await loadVecinos(state.plan.place);
  const c = C(), V = c.vec, P = state.plan, z = nearPilot(P.place);
  state.vecName ??= store.get("vecName1", "");
  if (arg && arg !== state.vecArg) { state.vecArg = arg; state.vecCrop = CROP_LOOK[arg] ? arg : null; state.vecType = "asi_me_fue"; }
  state.vecType ||= "all";
  const feed = h("div", { class: "vec-feed" }), side = h("div", { class: "vec-side" }), note = h("p", { class: "vec-saved", role: "status" });
  const draw = () => {
    const all = vecPosts(P.place), cropsIn = [...new Set(all.filter((p) => p.crop).map((p) => p.crop))];
    const list = all.filter((p) => (state.vecType === "all" || p.type === state.vecType) && (!state.vecCrop || p.crop === state.vecCrop));
    put(side,
      h("div", { class: "res-title" }, h("h1", { class: "display" }, V.title), h("p", {}, z ? V.lead(cap(z)) : V.leadFar)),
      state.vecForm ? vecForm(P, async (saved) => { state.vecForm = false; if (saved === "server") await loadVecinos(P.place, true); note.textContent = saved === "server" ? V.savedServer : saved ? V.saved : ""; draw(); })
        : h("button", { class: "btn lime big", onclick: () => { state.vecForm = true; note.textContent = ""; draw(); } }, icon("i-plus"), V.publish),
      note,
      h("div", { class: "vec-filters" },
        h("div", { class: "seg", role: "group", "aria-label": V.title }, ...["all", "asi_me_fue", "aviso", "pregunta"].map((k) => h("button", { "aria-pressed": String(state.vecType === k), onclick: () => { state.vecType = k; draw(); } }, V.types[k]))),
        cropsIn.length > 1 ? h("div", { class: "row wrap", style: { gap: "6px" } },
          h("button", { class: "chip", "aria-pressed": String(!state.vecCrop), onclick: () => { state.vecCrop = null; draw(); } }, V.allCrops),
          ...cropsIn.map((id) => h("button", { class: "chip", "aria-pressed": String(state.vecCrop === id), onclick: () => { state.vecCrop = id; draw(); } }, tile(id), cropLabel(id)))) : null),
      h("p", { class: "vec-note" }, icon("i-agronomist"), h("span", {}, V.peer)),
      h("p", { class: "vec-note" }, icon("i-info"), h("span", {}, VEC.server ? V.demoServer : V.demo)));
    put(feed, ...(list.length ? list.map((p) => vecCard(p, draw)) : [h("div", { class: "card vec-empty" }, h("p", {}, all.length ? V.emptyFilter : V.empty))]));
  };
  draw();
  put($("#view"), h("div", { class: "res vec" }, resHead(P), h("div", { class: "vec-grid" }, side, feed)));
}

/* ================= Rooti, the in-app assistant ================= */
const tagged = (el, key) => { el?.setAttribute("data-rooti", key); return el; };
const ROOTI_SCREENS = { plan: "plan", plot: "terreno", try: "probar", compare: "comparar", past: "pasado", neighbors: "vecinos", planner: "planear", course: "bootcamp" };
const MODE_WORDS = { all: "every real run of years since 1981", nino: "only the rainy seasons after strong El Niños", dry: "only dry years", wet: "only wet years" };
// Opening a screen it is already on does not change the address, so it draws again instead
const goOrRender = (r) => (route().r === r ? render() : go(r));
function rootiName(r) {
  const n = C().nav, name = { "": es() ? "la portada" : "the home page", planear: es() ? "Planear" : "the planner", bootcamp: C().ctaBootcamp, plan: n.plan, terreno: n.plot, probar: n.try,
    comparar: n.compare, pasado: n.past, vecinos: n.neighbors, pasaporte: es() ? "el pasaporte del suelo" : "the soil passport", aviso: es() ? "el aviso" : "the alert" }[r ?? ""] || r;
  return es() ? `«${name}»` : `“${name}”`;
}
const rootiPlot = (P) => `${P.place ? `${P.place.name}${P.place.admin ? `, ${P.place.admin}` : ""}` : "place not given yet"}; ${P.area} ${C().units[P.unit || "ha"]}; from ${P.start} to ${P.end}; crops the plan may use: ${P.crops.map(cropName).join(", ") || "none yet"}; grows today: ${(P.current || []).map(cropName).join(", ") || "not said"}; irrigation: ${P.irrigation ? "yes" : "no"}; floods: ${P.waterlog || "not said"}.`;
// What the farmer has on screen, in words the model can answer from
async function rootiContext() {
  const { r: scr } = route(), P = state.plan;
  const out = [`Screen: ${scr || "landing"} (${rootiName(scr)}). Today: ${iso(new Date())}.`,
    `Crop ids: ${CROP_ORDER.filter((id) => id === "mulch" || DATA.crops?.[id]).map((id) => `${id} = ${cropName(id)}`).join(", ")}.`];
  if (!P) { out.push(state.draft ? `The farmer is filling in the plot, no plan yet: ${rootiPlot(state.draft)}` : "No plot yet."); return out.join("\n"); }
  out.push(`Plot: ${rootiPlot(P)}`, `The plan is tested on ${MODE_WORDS[state.mode] || MODE_WORDS.all}.`);
  if (ninoNow(P)) out.push("A strong El Niño is expected this rainy season (NOAA, ERFEN).");
  try {
    const res = await results();
    if (!res.farm) { out.push("No plan works for these dates and crops."); return out.join("\n"); }
    const plans = await namedPlans(), N = res.period.length;
    out.push(`Plan months: ${ym(res.period[0])} to ${ym(res.period[N - 1])}.`);
    for (const it of plans) {
      const f = it.f, good = f.per.filter((x) => yearLv(x) === "g").length, lost = f.per.filter((x) => yearLv(x) === "x").length;
      out.push(`Plan "${C().ds.names[it.key]}"${it.key === state.pick ? " (the one on screen)" : ""}: ${routeWords(res, f)}. Of ${f.per.length} real runs of years it went well in ${good} and lost more than half the harvest in ${lost}. Soil covered ${coveredMonths(f, N).filter(Boolean).length} of ${N} months.`);
    }
    const win = P.crops.filter((id) => res.windows[id]?.best).map((id) => `${cropName(id)}: ${ym(res.period[res.windows[id].best.t])}`);
    if (win.length) out.push(`Best month to sow each crop: ${win.join("; ")}.`);
    const soil = describeSoil(res.terrain?.soil), slope = res.terrain?.slopePct;
    out.push(`The land: ${soil ? `${C().texture[soil.texture]}, pH ${num(soil.ph)}` : "soil unknown"}; slope ${slope != null ? `${num(slope)} %` : "unknown"}; floods ${res.site.wl >= 0.6 ? "often" : res.site.wl >= 0.35 ? "sometimes" : "rarely"}.`);
    const ids = await ideas(res);
    if (ids.length) out.push(`Ideas on the Try screen (kind: idea, effect): ${ids.map((x) => `${x.kind}: ${x.title}, ${x.eff}`).join("; ")}.`);
  } catch { out.push("The plan could not be computed right now."); }
  return out.join("\n");
}
async function rootiChangePlot(a) {
  const before = { plan: state.plan, mode: state.mode, draft: state.draft && JSON.parse(JSON.stringify(state.draft)) };
  const P = JSON.parse(JSON.stringify(state.plan || draft())), U = C().units, said = [];
  const L = es() ? { place: "Lugar", area: "Tierra", crops: "Cultivos", current: "Siembra hoy", irr: "Riego", floods: "Se encharca", dates: "Fechas", yes: "sí", no: "no", sometimes: "a veces" }
    : { place: "Place", area: "Land", crops: "Crops", current: "Grows today", irr: "Irrigation", floods: "Floods", dates: "Dates", yes: "yes", no: "no", sometimes: "sometimes" };
  const crops = (list) => [...new Set((list || []).filter((id) => id === "mulch" || DATA.crops[id]))];
  if (a.place) {
    const r = await fetch(`${GEO}?name=${encodeURIComponent(a.place)}&count=5&language=${state.lang}&format=json`).then(ok).catch(() => null);
    // Rooti's farmers are on the coast of Ecuador: a town with the same name elsewhere comes second
    const x = (r?.results || []).sort((p, q) => (q.country_code === "EC") - (p.country_code === "EC"))[0];
    if (!x) return { error: `No place called "${a.place}" was found; ask for a nearby town or to mark it on the map` };
    P.place = { name: x.name, admin: [x.admin1, x.country].filter(Boolean).join(", "), lat: x.latitude, lon: x.longitude };
    delete P.lot;
    said.push(`${L.place}: ${x.name}`);
  }
  if (a.area > 0) {
    const unit = UNITS[a.unit] ? a.unit : P.unit || "ha", from = `${num(P.area)} ${U[P.unit || "ha"]}`;
    P.area = +(+a.area).toFixed(2); P.unit = unit;
    said.push(`${L.area}: ${state.plan ? `${from} → ` : ""}${num(P.area)} ${U[unit]}`);
  }
  if (a.crops) { const c = crops(a.crops); if (!c.length) return { error: "None of those crop ids exist; use the ids in the page context" }; P.crops = c; said.push(`${L.crops}: ${c.map(cropName).join(", ")}`); }
  if (a.current) { P.current = crops(a.current); said.push(`${L.current}: ${P.current.map(cropName).join(", ") || "—"}`); }
  if (typeof a.irrigation === "boolean") { P.irrigation = a.irrigation; said.push(`${L.irr}: ${a.irrigation ? L.yes : L.no}`); }
  if (["yes", "sometimes", "no"].includes(a.floods)) { P.waterlog = a.floods; said.push(`${L.floods}: ${L[a.floods]}`); }
  const month = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v || "");
  if (month(a.start)) P.start = `${a.start}-01`;
  if (month(a.end)) { const [y, m] = a.end.split("-").map(Number); P.end = iso(new Date(y, m, 0)); }
  if (month(a.start) || month(a.end)) said.push(`${L.dates}: ${fmtDate(P.start)} – ${fmtDate(P.end)}`);
  if (!said.length) return { error: "Nothing to change: pass only what the farmer said" };
  const err = dateErr(P);
  if (P.place && P.crops.length && !err) {
    setPlan(P); state.draft = null; state.undo = null; state.mode = defaultMode(P); memo.clear(); syncLot();
    goOrRender("plan");
  } else {
    state.draft = P;
    goOrRender("planear");
  }
  const missing = [!P.place && "where the plot is", !P.crops.length && "which crops", err].filter(Boolean);
  return {
    changed: said.join(" · "), mark: state.plan === P ? "route" : null,
    now: missing.length ? `Saved. Still missing before the plan: ${missing.join(", ")}.` : `Plan recomputed for: ${rootiPlot(P)}`,
    undo: () => {
      if (before.plan) { setPlan(before.plan); syncLot(); } else { state.plan = null; store.set("plan3", null); }
      state.mode = before.mode; state.draft = before.draft; state.undo = null; memo.clear(); render();
    },
  };
}
async function rootiTryIdea(kind) {
  if (!state.plan) return { error: "There is no plan yet" };
  const res = await results();
  if (!res.farm) return { error: "No plan works for these dates" };
  const it = (await ideas(res)).find((x) => x.kind === kind);
  if (!it) return { error: `That idea does not apply to this plan or would not do better (${kind})` };
  goOrRender("probar");
  return { title: it.title, why: it.why, effect: it.eff, label: `${es() ? "Aplicar" : "Apply"}: ${it.title}`,
    apply: () => {
      const b = { plan: state.plan, mode: state.mode };
      it.apply();
      return () => { setPlan(b.plan); state.mode = b.mode; state.undo = null; memo.clear(); render(); };
    } };
}
function rootiWhatsApp() {
  const W = C().wa;
  if (linked() && hasWhatsApp()) return { label: W.back, go: () => { location.href = waUrl(); } };
  if (canHandoff() && state.plan) return { label: W.go, go: async () => { try { location.href = waUrl(W.goMsg(await handoff(state.plan))); } catch { /* the card on the plan screen offers it again */ } } };
  return null;
}
const rooti = createRooti({
  h, icon, motion: MOTION, lang: () => state.lang, screenName: rootiName, context: rootiContext,
  speak, stopSpeaking: () => window.speechSynthesis?.cancel(),
  show(screen) {
    const r = ROOTI_SCREENS[screen];
    if (!r) return `Unknown screen ${screen}`;
    if (RESULTS.includes(r) && !state.plan) return "There is no plan yet: the farmer has to give the plot first";
    const target = r === "plan" ? "plan/auto" : r;
    if (location.hash === `#/${target}` || (r !== "plan" && route().r === r)) render(); else go(target);
    return null;
  },
  changePlot: rootiChangePlot, tryIdea: rootiTryIdea, whatsapp: rootiWhatsApp,
});

/* ================= router ================= */
function route() {
  const [r = "", arg, courseId, lessonNumber] = location.hash.replace(/^#\/?/, "").split("/");
  if (RESULTS.includes(r) && !state.plan) return { r: "planear", arg: state.linkError && state.draft.place && dateErr(state.draft) ? "2" : undefined };
  if (r === "pasaporte" && !nearPilot(state.plan.place)) return { r: "plan" };
  if (r === "aviso" && !(link.alert && state.plan)) return { r: state.plan ? "plan" : "planear" };
  return { r: ["", "planear", "bootcamp", "aviso", ...RESULTS].includes(r) ? r : "", arg, courseId, lessonNumber };
}
const TAB_ORDER = ["plan", "terreno", "probar", "comparar", "vecinos"];
const tabIx = (r) => TAB_ORDER.indexOf(r === "pasado" ? "plan" : r);
const EASE_OUT = "cubic-bezier(.16, 1, .3, 1)";
const activeRect = (box, sel) => box?.querySelector(sel)?.getBoundingClientRect();
// The active background travels from the previous choice instead of jumping; navs are rebuilt on every route.
function slidePill(nav, from, sel = '[aria-current="page"]') {
  const to = nav?.querySelector(sel);
  if (!from || !to || !MOTION()) return;
  const n = nav.getBoundingClientRect(), b = to.getBoundingClientRect();
  if (Math.abs(from.left - b.left) < 1) return;
  const ghost = h("span", { class: "tab-ghost", "aria-hidden": "true", style: { left: `${b.left - n.left}px`, top: `${b.top - n.top}px`, width: `${b.width}px`, height: `${b.height}px` } });
  nav.prepend(ghost);
  to.classList.add("sliding", "dim");
  // The label turns active halfway, when the pill is under it, so it never sits light-on-light
  setTimeout(() => to.classList.remove("dim"), 140);
  ghost.animate([{ transform: `translateX(${from.left - b.left}px)`, width: `${from.width}px` }, { transform: "none", width: `${b.width}px` }], { duration: 320, easing: EASE_OUT })
    // The ghost leaves only after the tab's own background has faded back in under it
    .finished.then(() => { to.classList.remove("sliding"); setTimeout(() => ghost.remove(), 200); });
}
function renderChrome(r) {
  const c = C(), P = state.plan, isRes = RESULTS.includes(r);
  const fromTop = activeRect($("#topbar .tabs"), '[aria-current="page"]'), fromBottom = activeRect($("#bottom-nav"), '[aria-current="page"]');
  document.body.className = [`r-${r || "landing"}`, r ? "app-route" : "", isRes ? "results" : ""].filter(Boolean).join(" ");
  document.documentElement.lang = state.lang;
  const tabs = [["plan", c.nav.plan, "i-sow"], ["terreno", c.nav.plot, "i-plot"], ["probar", c.nav.try, "i-bulb"], ["comparar", c.nav.compare, "i-scale"], ["vecinos", c.nav.neighbors, "i-neighbors"]];
  // Off the results there are no tabs, so the bar carries a way back: to the plan when there is one, else home
  const back = isRes ? null : h("a", { class: "round", href: (r === "planear" || r === "aviso") && P ? "#/plan" : "#/", "aria-label": es() ? "Atrás" : "Back", title: es() ? "Atrás" : "Back" }, icon("i-back"));
  put($("#topbar"), h("div", { class: "row", style: { minWidth: 0 } }, back, brand(), h("span", { class: "crumb" }, isRes ? `/  ${P.place.name} · ${fmtArea(1)} · ${fmtSpan(P)}` : `/  ${r === "bootcamp" ? c.ctaBootcamp : r === "aviso" ? c.wa.crumb : c.planTitle}`)),
    isRes ? h("nav", { class: "tabs" }, ...tabs.map(([k, l]) => h("a", { href: "#/" + k, "aria-current": r === k || (k === "plan" && r === "pasado") ? "page" : null }, l))) : null,
    h("div", { class: "row", style: { gap: "8px" } }, isRes ? h("a", { class: "btn light", href: "#/planear", onclick: () => { state.draft = null; state.sec = null; }, style: { minHeight: "40px", fontSize: "12px" } }, c.changeData) : null,
      linked() && hasWhatsApp() ? h("a", { class: "round", href: waUrl(), "aria-label": c.wa.back, title: c.wa.back }, icon("i-chat")) : null, langBtn()));
  put($("#bottom-nav"), ...tabs.map(([k, l, ic]) => h("a", { href: "#/" + k, "aria-current": r === k || (k === "plan" && r === "pasado") ? "page" : null }, icon(ic), l)));
  slidePill($("#topbar .tabs"), fromTop);
  slidePill($("#bottom-nav"), fromBottom);
  if (r !== "planear") put($("#map-overlay"));
}
let shownRoute = null;
// Between tabs the new screen enters from the side of the tab that was pressed; the year-by-year view rises from the plan.
function enterView(prev, r) {
  if (MOTION() && (prev === "planear" || prev === "") && r === "plan") return revealPlan();
  if (!MOTION() || prev === r || !RESULTS.includes(prev) || !RESULTS.includes(r) || tabIx(prev) < 0 || tabIx(r) < 0) return;
  const d = Math.sign(tabIx(r) - tabIx(prev)), v = $("#view");
  v.getAnimations().forEach((a) => a.cancel());
  v.animate([{ opacity: 0, transform: d ? `translateX(${d * 28}px)` : "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: EASE_OUT });
}
// Arriving at a new plan is rare and is what the farmer came for: its parts come in one after another.
function revealPlan() {
  const parts = document.querySelectorAll("#view .res-head, #view .nino-note, #view .pv-a, #view .pv-right, #view .pv-b, #view .pv-cards .strat, #view .pv-foot, #view .res.pv > .hint, #view .res.pv > .card");
  parts.forEach((el, i) => el.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 480, delay: Math.min(i, 8) * 55, easing: EASE_OUT, fill: "backwards" }));
}
async function render() {
  const { r, arg, courseId, lessonNumber } = route();
  const prev = shownRoute;
  shownRoute = r;
  if (document.body.classList.contains("r-bootcamp")) window.speechSynthesis?.cancel();
  renderChrome(r);
  rooti.route(r);
  const views = { "": viewLanding, planear: () => viewPlanear(arg), bootcamp: () => viewBootcamp(arg, courseId, lessonNumber), plan: () => viewPlan(arg), terreno: viewTerreno, probar: viewProbar, comparar: viewComparar, pasado: viewPasado, pasaporte: viewPasaporte, vecinos: () => viewVecinos(arg), aviso: viewAviso };
  try { await views[r](); if (shownRoute === r) enterView(prev, r); } catch (e) { console.error(e); put($("#view"), errorCard(C().climateError, render)); }
}
async function start() {
  document.documentElement.classList.toggle("motion", MOTION());
  // Source notes open on tap; a tap anywhere else closes them
  document.addEventListener("click", () => document.querySelectorAll('.source[aria-expanded="true"]').forEach((b) => b.setAttribute("aria-expanded", "false")));
  put($("#view"), loading());
  try { await loadBase(); } catch { put($("#view"), errorCard(C().climateError, start)); return; }
  readSharedPlan();
  try {
    if (await initLink()) {
      // A farmer from WhatsApp: their lot from Rooti, in Spanish unless they switched, on the page the button named
      if (store.get("lang", null) == null) state.lang = "es";
      state.plan = link.plan; state.custom = null; state.draft = null;
      if (!location.hash.replace(/^#\/?/, "")) history.replaceState(null, "", "#/" + (link.alert && link.plan ? "aviso" : link.plan ? "plan" : "planear/1"));
    }
  } catch (e) {
    const W = C().wa;
    put($("#view"), e.status === 403
      ? h("div", { class: "res" }, brand(), h("section", { class: "card" }, h("b", { class: "card-h" }, W.expiredTitle), h("p", {}, W.expiredText), hasWhatsApp() ? h("a", { class: "btn dark big", href: waUrl() }, icon("i-chat"), W.back) : null))
      : errorCard(C().climateError, start));
    return;
  }
  if (state.plan) state.mode = defaultMode(state.plan);
  // A new signed link on an open page (another WhatsApp button, same tab) only changes the fragment: start over with it
  addEventListener("hashchange", () => { if (location.hash.startsWith("#t=")) return location.reload(); state.drawing = false; document.body.classList.remove("drawing"); state.addCorner = null; render(); scrollTo(0, 0); $("#view").scrollTo?.(0, 0); });
  let w = desktop(); addEventListener("resize", () => { if (desktop() !== w) { w = desktop(); if (viewer) { viewer.destroy(); viewer = null; lotEntity = null; pickBound = false; } render(); } });
  render();
  rooti.start();
}
start();
