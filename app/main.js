import { fetchClimate } from "./climate.js?v=22";
import { plan as runPlanner, cropMonths, NINO_ONSET } from "./planner.js?v=34";
import { COPY } from "./copy.js?v=35";
import { fetchTerrain, describeSoil, waterlogFactor } from "./terrain.js?v=22";
import { STR } from "./i18n.js?v=22";
import { createBootcamp } from "./bootcamp.js?v=3";

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
const RESULTS = ["plan", "terreno", "probar", "comparar", "pasado", "pasaporte"];

/* ---------------- state ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("rooti:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("rooti:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const firstNextMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1); };
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 0);
const state = {
  lang: store.get("lang", (navigator.language || "es").toLowerCase().startsWith("es") ? "es" : "en"),
  plan: store.get("plan3", null),
  pick: null,
  mode: "all",
  draft: null, custom: null, customKey: null, undo: null, pastBase: undefined, showAll: false, saved: store.get("saved3", null),
};
// Ready-made examples: their climate and plot data ship with the app, so the demo works even without internet.
const DEMOS = {
  daule: { place: { name: "Daule", admin: "Guayas, Ecuador", lat: -1.86, lon: -79.98 }, crops: ["maize", "soybean", "rice", "mulch"], current: ["rice"], area: 5.2 },
  quevedo: { place: { name: "Quevedo", admin: "Los Ríos, Ecuador", lat: -1.03, lon: -79.46 }, crops: ["maize", "soybean", "peanut", "mulch"], current: ["maize"], area: 3 },
  iowa: { place: { name: "Ames", admin: "Iowa, USA", lat: 42.03, lon: -93.62 }, crops: ["maize", "soybean", "wheat"], current: ["maize"], area: 40, unit: "acre" },
};
const demoKey = (pl) => Object.keys(DEMOS).find((k) => Math.abs(DEMOS[k].place.lat - pl.lat) < 0.01 && Math.abs(DEMOS[k].place.lon - pl.lon) < 0.01);
const demoData = {};
const loadDemo = (k) => (demoData[k] ||= fetch(`data/demo/${k}.json?v=2`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }));
const demoPlan = (k) => { const s = firstNextMonth(), D = DEMOS[k]; return { place: D.place, start: iso(s), end: iso(addMonths(s, 12)), crops: D.crops, current: D.current, irrigation: false, area: D.area, unit: D.unit || "ha", waterlog: null }; };
const EXAMPLE = () => ({ place: { name: "Daule", admin: "Guayas, Ecuador", lat: -1.86, lon: -79.98 }, start: iso(firstNextMonth()), end: iso(addMonths(firstNextMonth(), 12)), crops: ["maize", "soybean", "mulch"], irrigation: false, area: 5.2, unit: "ha" });
// A plan can come in the link: ?lat=-1.86&lon=-79.98&place=Daule&from=2026-12-01&to=2027-11-30&crops=maize+soybean&area=5
{
  const q = new URLSearchParams(location.search);
  if (q.get("lat") && q.get("crops")) {
    state.plan = {
      place: { name: q.get("place") || `${(+q.get("lat")).toFixed(2)}, ${(+q.get("lon")).toFixed(2)}`, lat: +q.get("lat"), lon: +q.get("lon") },
      start: q.get("from") || iso(firstNextMonth()), end: q.get("to") || iso(addMonths(firstNextMonth(), 12)),
      crops: q.get("crops").split(/[+ ,]/).filter(Boolean), irrigation: q.get("irr") === "1", area: +(q.get("area") || 1), unit: q.get("unit") || "ha", current: (q.get("now") || "").split(/[+ ,]/).filter(Boolean), waterlog: q.get("wl") || null
    };
  }
  if (q.get("lang")) state.lang = q.get("lang");
}
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
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const FILLED = new Set(["i-maize", "i-rice", "i-soybean", "i-straw", "i-rain", "i-sun", "i-sow", "i-harvest", "i-plot", "i-care", "i-water", "i-nino", "i-income", "i-soil", "i-agronomist", "i-month", "i-shield", "i-arrow", "i-info", "i-check", "i-x"]);
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
const go = (r) => { location.hash = "#/" + r; };

/* ---------------- words and numbers ---------------- */
const cropName = (id) => (id === "mulch" ? C().straw : S().crops[id] || DATA.crops?.[id]?.[es() ? "name_es" : "name_en"] || id);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const mon = (m) => S().monthsLong[m - 1].slice(0, 3);
const ym = (p) => `${mon(p.m)} ${p.y}`;
const monL = (m) => S().monthsLong[m - 1];
const span = (a, b) => (a.y === b.y ? (a.m === b.m ? `${monL(a.m)} ${a.y}` : `${C().ds.monthsTo(monL(a.m), monL(b.m))} ${a.y}`) : C().ds.monthsTo(`${monL(a.m)} ${a.y}`, `${monL(b.m)} ${b.y}`));
const fmtDate = (s) => new Date(s + "T12:00:00").toLocaleDateString(state.lang, { day: "numeric", month: "short", year: "numeric" });
const num = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(state.lang);
const fmtArea = (share, P = state.plan) => { const v = share * (P.area || 1); return `${P.unit === "m2" ? Math.round(v).toLocaleString(state.lang) : num(v)} ${C().units[P.unit || "ha"]}`; };
const andList = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${es() ? "y" : "and"} ${xs[xs.length - 1]}`);
function fracParts(x) { let best = [1, 2], err = 1; for (let n = 2; n <= 10; n++) { const k = Math.max(1, Math.round(x * n)); const e = Math.abs(k / n - x); if (e < err - 0.02) { err = e; best = [k, n]; } } return best; }
// 0.83 -> "5 de cada 6": plain fractions instead of percentages.
const frac = (x) => (x <= 0.001 ? C().none : x >= 0.999 ? (es() ? "Todos" : "All") : C().kOf(...fracParts(x)));
const nearPilot = (pl) => Object.entries(PILOTS).find(([, [la, lo]]) => Math.hypot(la - pl.lat, lo - pl.lon) * 111 < 40)?.[0] || null;
const monthsIn = (P) => Math.round((new Date(P.end) - new Date(P.start)) / (30.44 * 864e5));

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
  if (!memo.has(key)) { const site = siteOf(tr, P); memo.set(key, { clim: c, P, terrain: tr, site, ...runPlanner(c, DATA.crops, P.crops, { start: P.start.slice(0, 7), end: P.end.slice(0, 7), irrigation: P.irrigation, priority, mode, site, current: P.current || [] }) }); }
  return memo.get(key);
}
async function fireData(z) { if (!(z in DATA.fires)) DATA.fires[z] = await fetch(`data/fires_${z}.json`).then(ok).catch(() => null); return DATA.fires[z]; }
const setPlan = (P) => { state.plan = P; store.set("plan3", P); state.custom = null; };

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
const langBtn = () => h("button", { class: "pill", "aria-label": "Idioma / Language", onclick: () => { state.lang = es() ? "en" : "es"; store.set("lang", state.lang); render(); } }, es() ? "ES | EN" : "EN | ES");
// The Mosaico mark: four modules, four plots
const MARK = '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="m1" d="M14 0H32V36H50V53H0V14A14 14 0 0 1 14 0Z"/><path class="m2" d="M37 0H86A14 14 0 0 1 100 14V47H74V31H37Z"/><path class="m3" d="M55 52H100V86A14 14 0 0 1 86 100H70V70H55Z"/><path class="m4" d="M0 58H27V75H65V100H14A14 14 0 0 1 0 86Z"/></svg>';
const lockup = (light) => { const mk = h("span", { class: "mk" }); mk.innerHTML = MARK; return h("a", { class: `lockup${light ? " light" : ""}`, href: "#/", "aria-label": "Rooti" }, mk, h("span", { class: "wordmark" }, "rooti")); };
const brand = () => lockup(false);
const loading = (msg) => h("div", { class: "loading" }, msg ? h("p", { class: "small" }, msg) : null, h("div", { class: "skeleton", style: { height: "120px" } }), h("div", { class: "skeleton", style: { height: "280px" } }), h("div", { class: "skeleton", style: { height: "160px" } }));
const errorCard = (msg, retry) => h("div", { class: "errorcard", role: "alert" }, icon("i-wifi-off"), h("b", { class: "grow" }, msg), h("button", { class: "btn", onclick: retry }, C().retry));
const stepIcon = (ic) => icon(ic === "calendar" ? "i-calendar" : ic === "map-pin" ? "i-pin" : "i-sprout");
const bootcamp = createBootcamp({ h, put, icon, tile: (id) => tile(id), store, speak });

function viewBootcamp() {
  const crops = CROP_ORDER.filter((id) => DATA.crops[id]).map((id) => ({
    id,
    name: cap(cropName(id)),
    months: cropMonths(DATA.crops[id]),
  }));
  put($("#view"), bootcamp(state.lang, crops, C().cta, () => { state.draft = null; }));
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
function heroLines(svg, title) {
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
  if (!MOTION()) return;
  const AT = [90, 0, 30, 140];
  svg.querySelectorAll("path").forEach((p, i) => {
    const n = p.getTotalLength(); p.style.strokeDasharray = n;
    p.animate([{ strokeDashoffset: n }, { strokeDashoffset: 0 }], { duration: 1100, delay: 200 + (AT[i % 4] ?? 60), easing: "cubic-bezier(.65,0,.35,1)", fill: "both" });
  });
  svg.querySelectorAll("circle").forEach((c) => c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 1150, fill: "backwards" }));
}
const MOTION = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
const ILLU = { daule: "rice", quevedo: "maize", iowa: "soybean" };
function viewLanding() {
  const c = C(), D = c.ds;
  const start = () => { state.draft = null; go("planear"); };
  const openDemo = (k) => { setPlan(demoPlan(k)); state.mode = defaultMode(state.plan); state.pick = null; memo.clear(); go("plan"); };
  const dot = (ic = "i-arrow-r") => h("span", { class: "dot" }, icon(ic));
  const art = document.createElementNS(SVGNS, "svg"), title = h("h1", { class: "display" }, c.heroTitle);
  put($("#view"), h("div", { class: "landing" },
    h("header", { class: "hero" }, h("div", { class: "hero-img", style: { backgroundImage: "url(img/sat/daule.jpg)" } }), h("div", { class: "hero-art", "aria-hidden": "true" }, art),
      h("nav", { class: "l-nav" }, lockup(true),
        h("div", { class: "l-links" }, langBtn(), h("a", { class: "btn glass desk-only", href: "#/bootcamp" }, c.ctaBootcamp), h("button", { class: "btn lime desk-only", onclick: start }, c.cta, dot()))),
      h("div", { class: "hero-copy" }, h("span", { class: "pill-eyebrow glass mono" }, D.eyebrow), title, h("p", { class: "lead" }, c.heroLead),
        h("div", { class: "hero-actions" }, h("button", { class: "btn lime big", onclick: start }, c.cta, dot()), h("button", { class: "btn glass big", onclick: () => openDemo("daule") }, D.example, dot()))),
      h("p", { class: "hero-source mono" }, D.source)),
    h("section", { class: "l-sheet" }, h("div", { class: "l-wrap" },
      h("div", { class: "l-how", id: "how" }, ...D.how.map(([ic, t, d]) => h("div", { class: "how" }, h("span", { class: "tile-i dark" }, icon(ic)), h("b", {}, t), h("p", {}, d)))),
      h("h2", { class: "h2" }, D.examplesTitle),
      h("div", { class: "l-demos" }, ...Object.keys(DEMOS).map((k) => h("button", { class: "demo-card", onclick: () => openDemo(k) }, h("img", { src: `img/illu/${ILLU[k]}.jpg`, alt: "", loading: "lazy" }),
        h("span", { class: "txt" }, h("span", { class: "pill-eyebrow glass mono" }, D.demoTag[k]), h("b", { class: "h3" }, c.demo[k]), h("span", { class: "go" }, D.see, icon("i-arrow-r")))))),
      h("a", { class: "l-boot", href: "#/bootcamp" }, h("span", { class: "tile-i" }, icon("i-agronomist")), h("span", {}, h("b", {}, D.bootTitle), h("p", {}, D.bootLead)), icon("i-arrow-r")),
      h("p", { class: "small", style: { textAlign: "center" } }, c.heroNote))),
    h("footer", { class: "l-foot" }, h("div", { class: "l-wrap" }, lockup(true), h("div", { class: "credits" }, h("p", {}, D.credits), h("p", {}, "NASA Space Apps Challenge 2026 · Field Shift"))))));
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => heroLines(art, title));
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
    const r = await fetch(`${REV}?lat=${lat}&lon=${lon}&format=json&zoom=10&accept-language=${state.lang}`).then(ok);
    const a = r.address || {};
    return { ...base, name: a.village || a.town || a.city || a.county || a.state || base.name, admin: [a.state, a.country].filter(Boolean).join(", ") };
  } catch { return base; }
}
function searchBox(onPick) {
  const results = h("div", { class: "geo" }), input = h("input", { type: "search", placeholder: C().search, "aria-label": C().search, autocomplete: "off" });
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return put(results);
    timer = setTimeout(async () => {
      try {
        const r = await fetch(`${GEO}?name=${encodeURIComponent(q)}&count=5&language=${state.lang}&format=json`).then(ok);
        put(results, ...(r.results || []).map((x) => h("button", { onclick: () => onPick({ name: x.name, admin: [x.admin1, x.country].filter(Boolean).join(", "), lat: x.latitude, lon: x.longitude }) },
          icon("i-pin"), h("span", {}, h("b", {}, x.name), h("small", {}, [x.admin1, x.country].filter(Boolean).join(", "))))));
        if (!r.results?.length) put(results, h("p", { class: "small", style: { padding: "12px 14px" } }, C().noPlace));
      } catch { put(results); }
    }, 300);
  });
  return [h("label", { class: "search" }, icon("i-search"), input), results];
}
const placeCard = (d, onChange) => h("div", { class: "place" }, icon("i-pin"), h("div", { class: "grow" }, h("b", {}, d.place.name), h("small", {}, d.place.admin || "")), onChange ? h("button", { class: "link", onclick: onChange }, C().change) : null);
const gpsBtn = (onPick) => h("button", { class: "link", style: { alignSelf: "flex-start" }, onclick: (e) => { const b = e.currentTarget; b.disabled = true; navigator.geolocation?.getCurrentPosition(async (p) => onPick(await placeAt(p.coords.latitude, p.coords.longitude)), () => { b.disabled = false; }, { timeout: 10000 }); } }, icon("i-locate"), " ", C().useLocation);
function periodStrip(d) {
  const a = new Date(d.start + "T12:00:00"), n = Math.max(0, Math.min(24, monthsIn(d)));
  return h("div", { class: "period", "aria-hidden": "true" }, ...Array.from({ length: n }, (_, i) => h("i", { class: (a.getMonth() + i) % 12 < 5 ? "w" : "s" })));
}
const quickDates = (d, redo) => h("div", { class: "row wrap", style: { gap: "8px" } }, ...C().quick.map(([k, l]) => {
  const s = new Date(d.start + "T12:00:00");
  return h("button", { class: "chip", "aria-pressed": String(monthsIn(d) === +k), onclick: () => { d.end = iso(addMonths(s, +k)); redo(); } }, l);
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
    h("div", { class: "seg" }, ...Object.keys(UNITS).map((u) => h("button", { "aria-pressed": String(d.unit === u), onclick: () => { d.unit = u; redo(); } }, C().units[u]))));
}
const currentChips = (d, redo) => h("div", { class: "row wrap", style: { gap: "6px" } }, ...CROP_ORDER.filter((id) => id !== "mulch" && DATA.crops[id]).slice(0, 8).map((id) => {
  const on = (d.current || []).includes(id);
  return h("button", { class: "chip", "aria-pressed": String(on), onclick: () => { d.current = on ? d.current.filter((x) => x !== id) : [...(d.current || []), id]; redo(); } }, cap(cropName(id)));
}));
const waterlogOpts = (d, redo) => h("div", { class: "opts" }, ...[["yes", C().yes], ["sometimes", C().sometimes], ["no", C().no], [null, C().dontKnow]].map(([v, l]) => h("button", { class: "opt", "aria-pressed": String((d.waterlog ?? null) === v), onclick: () => { d.waterlog = v; redo(); } }, l)));
const irrigOpts = (d, redo) => h("div", { class: "opts" }, ...[[false, C().no], [true, C().yes]].map(([v, l]) => h("button", { class: "opt", "aria-pressed": String(d.irrigation === v), onclick: () => { d.irrigation = v; redo(); } }, l)));
const submitPlan = () => { setPlan({ ...state.draft, crops: [...state.draft.crops] }); state.draft = null; state.undo = null; state.mode = defaultMode(state.plan); memo.clear(); go("plan"); };

function viewPlanear(stepArg) {
  const d = draft();
  if (desktop()) return planDesktop(d);
  const n = Math.min(4, Math.max(1, +stepArg || 1)), redo = () => viewPlanear(n);
  const c = C(), err = dateErr(d);
  const head = h("div", { class: "step-head" },
    h("div", { class: "row between" }, h("button", { class: "round", "aria-label": es() ? "Atrás" : "Back", onclick: () => (n > 1 ? go(`planear/${n - 1}`) : go("")) }, icon("i-back")), h("span", { class: "small", style: { fontWeight: 600 } }, c.stepOf(n))),
    h("div", { class: "progress" }, ...[1, 2, 3, 4].map((i) => h("i", { class: i <= n ? "on" : "" }))));
  const title = (t, help) => h("div", {}, h("h1", { class: "display" }, t), h("p", { class: "help" }, help));
  const nextBtn = (label, okk, to) => h("button", { class: "btn dark big block", disabled: !okk, onclick: to }, label);
  let body;
  if (n === 1) {
    const pick = (pl) => { d.place = pl; redo(); };
    state.onPick = async (lat, lon) => pick(await placeAt(lat, lon));
    const box = h("div", { class: "mapbox" });
    body = [title(c.whereQ, c.whereHelp), ...(d.place ? [] : searchBox(pick)), box, d.place ? placeCard(d, () => { d.place = null; redo(); }) : h("p", { class: "small" }, c.tapMap), gpsBtn(pick), h("div", { class: "spacer" }), nextBtn(c.next, !!d.place, () => go("planear/2"))];
    setTimeout(() => initCesium(box, { pick: true }).then(() => (d.place ? updateMap(d.place, null) : globeView())), 0);
  } else if (n === 2) {
    body = [title(c.whenQ, c.whenHelp), dateFields(d, redo), quickDates(d, redo), h("div", { class: "card", style: { gap: "8px", padding: "16px" } }, h("b", {}, c.months(Math.max(0, monthsIn(d)))), periodStrip(d)), err ? h("p", { class: "err" }, err) : null, h("div", { class: "spacer" }), nextBtn(c.next, !err, () => go("planear/3"))];
  } else if (n === 3) {
    body = [title(c.whatQ, c.whatHelp), ...cropTiles(d, redo, 6), h("div", { class: "spacer" }), nextBtn(d.crops.length ? c.nextCrops(d.crops.length) : c.pickCrop, d.crops.length > 0, () => go("planear/4"))];
  } else {
    const ready = d.place && d.crops.length && !err;
    body = [title(c.landQ, c.landHelp), areaBox(d, redo), h("div", { class: "q" }, h("b", {}, c.irrigQ), irrigOpts(d, redo)), h("div", { class: "q" }, h("b", {}, c.wlQ, h("small", { class: "small", style: { fontWeight: 400 } }, " · ", c.optional)), waterlogOpts(d, redo)), h("div", { class: "q" }, h("b", {}, c.todayQ, h("small", { class: "small", style: { fontWeight: 400 } }, " · ", c.optional)), currentChips(d, redo)), h("div", { class: "spacer" }),
    nextBtn(ready ? c.seePlan : !d.place ? c.pickPlace : err || c.pickCrop, true, () => (ready ? submitPlan() : go(!d.place ? "planear/1" : err ? "planear/2" : "planear/3")))];
  }
  put($("#view"), h("div", { class: "step" }, head, ...body));
}
// Computer: the map fills the screen; one floating panel with four sections, one open at a time.
function planDesktop(d) {
  const c = C(), err = dateErr(d), redo = () => planDesktop(d);
  const pick = (pl) => { d.place = pl; if (state.sec === 1) state.sec = 2; redo(); updateMap(pl, null); };
  state.onPick = async (lat, lon) => pick(await placeAt(lat, lon));
  put($("#map-overlay"), h("div", { class: "map-hint" }, icon("i-pointer"), c.clickMap));
  const done = { 1: !!d.place, 2: !err, 3: d.crops.length > 0, 4: true };
  if (state.sec == null) state.sec = !d.place ? 1 : !d.crops.length ? 3 : 0;
  const months = monthsIn(d);
  const summary = {
    1: d.place ? `${d.place.name}${d.place.admin ? " · " + d.place.admin : ""}` : c.pickPlace,
    2: err || `${fmtDate(d.start)} – ${fmtDate(d.end)} · ${c.months(months)}`,
    3: d.crops.length ? d.crops.map((id) => cap(cropName(id))).join(", ") : c.pickCrop,
    4: `${(d.area || 1).toLocaleString(state.lang)} ${c.units[d.unit || "ha"]} · ${d.irrigation ? c.irrig.yes : c.irrig.no}`,
  };
  const body = {
    1: () => [d.place ? placeCard(d, null) : null, ...searchBox(pick), gpsBtn(pick)],
    2: () => [dateFields(d, redo), h("div", { class: "row between wrap" }, quickDates(d, redo), h("span", { class: err ? "err" : "small" }, err || c.months(months))), periodStrip(d)],
    3: () => [h("p", { class: "small" }, c.whatHelp), ...cropTiles(d, redo, 0)],
    4: () => [
      h("div", { class: "row-fields" }, h("input", { class: "num", type: "number", min: "0", step: "any", value: String(d.area), "aria-label": c.landQ, onchange: (e) => { const v = parseFloat(e.target.value); if (v > 0) { d.area = v; redo(); } } }),
        h("div", { class: "seg" }, ...Object.keys(UNITS).map((u) => h("button", { "aria-pressed": String(d.unit === u), onclick: () => { d.unit = u; redo(); } }, c.units[u])))),
      h("div", { class: "q" }, h("b", {}, c.irrigQ), irrigOpts(d, redo)),
      h("div", { class: "q" }, h("b", {}, c.wlQ, h("small", { class: "small", style: { fontWeight: 400 } }, " · ", c.optional)), waterlogOpts(d, redo)),
      h("div", { class: "q" }, h("b", {}, c.todayQ, h("small", { class: "small", style: { fontWeight: 400 } }, " · ", c.optional)), currentChips(d, redo))],
  };
  const titles = { 1: c.where, 2: c.when, 3: c.what, 4: c.landShort };
  const okAll = d.place && d.crops.length && !err;
  put($("#view"), h("div", { class: "plan-float" },
    h("div", { class: "pf-head" }, h("h1", { class: "display" }, c.planTitle), h("p", { class: "small" }, c.planLead2)),
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
  initCesium($("#cesium"), { pick: true }).then(() => (d.place ? updateMap(d.place, null) : globeView()));
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
const resHead = (P) => h("div", { class: "res-head" }, h("div", { class: "grow" }, h("b", {}, `${P.place.name} · ${fmtArea(1)}`), h("small", {}, `${fmtDate(P.start)} – ${fmtDate(P.end)}`)),
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
  const safe = [...pool].sort((a, b) => a.anyLoss - b.anyLoss || b.harvest - a.harvest)[0];
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
  const N = r.period.length, D = C().ds, long = N > 12, all = !long || state.routeAll;
  const box = h("div", { class: "route" }, ...plotsOf(f).map(({ pc, name }) => h("div", { class: "rt-plot" }, h("span", { class: "rt-lab" }, `${name} · ${fmtArea(pc.share)}`),
    h("ol", { class: "rt-steps" }, ...runsOf(pc, N).filter((ru) => all || ru.t0 < 12).flatMap((ru, i) => [i ? icon("i-arrow", "icon rt-arrow") : null,
      h("li", { class: ru.c === "bare" ? "bare" : "" }, tile(ru.c), h("p", {}, h("b", {}, cropLabel(ru.c)), h("span", {}, monthsText(r, ru))))])))));
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
  const cls = (x) => yearLv(x) + (coast && NINO_ONSET.includes(x.base) ? " n" : "");
  el._f = f;
  const dots = el.querySelectorAll("i");
  if (dots.length === per.length) { dots.forEach((d, i) => { d.className = cls(per[i]); }); return; }
  el.style.setProperty("--cols", Math.min(22, Math.max(12, Math.ceil(per.length / 2))));
  const tip = h("span", { class: "dot-tip" });
  put(el, ...per.map((x, i) => h("i", { class: cls(x), "data-i": i })), tip);
  const show = (d) => {
    const i = +d.dataset.i, x = el._f.per[i], y = x.base;
    el.querySelectorAll("i.on").forEach((q) => q.classList.remove("on")); d.classList.add("on");
    put(tip, h("b", {}, `${y}–${String(y + 1).slice(2)}${coast && NINO_ONSET.includes(y) ? ` · ${D.legend.n}` : ""}`), D.yearTip[yearLv(x)]);
    tip.style.left = d.offsetLeft + d.offsetWidth / 2 + "px"; tip.style.top = d.offsetTop + "px"; tip.classList.add("on");
  };
  el.onpointerover = (e) => { if (e.target.dataset.i) show(e.target); };
  el.onclick = (e) => { if (e.target.dataset.i) show(e.target); };
  el.onpointerleave = () => { tip.classList.remove("on"); el.querySelectorAll("i.on").forEach((q) => q.classList.remove("on")); };
}
// Soil cover: a month counts as covered when most of the land has a crop or straw on it
function coverSquares(el, r, f) {
  const N = r.period.length, cov = coveredMonths(f, N), cells = el.querySelectorAll("i"), D = C().ds;
  const title = (t) => `${cap(monL(r.period[t].m))}: ${cov[t] ? cap(es() ? "tierra cubierta" : "soil covered") : D.bare}`;
  if (cells.length === N) { cells.forEach((c, t) => { c.style.transitionDelay = t * 15 + "ms"; c.classList.toggle("bare", !cov[t]); c.title = title(t); }); return; }
  el.style.setProperty("--n", Math.min(N, 12));
  put(el, ...cov.map((c, t) => h("div", {}, h("i", { class: c ? "" : "bare", title: title(t) }), t < 12 ? cap(monL(r.period[t].m)).slice(0, 1) : "")));
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
  for (let a = 0; a < N;) { let b = a; while (b + 1 < N && wet[b + 1] === wet[a]) b++; const w = wet[a]; kids.push(h("div", { class: `pc-season${w ? " w" : ""}${N > 24 || b - a < (N > 12 ? 2 : 1) ? " short" : ""}`, style: { gridRow: String(last), gridColumn: `${a + 1} / ${b + 2}` } }, w ? (coast ? D.wet : D.wetX) : coast ? D.dry : D.dryX)); a = b + 1; }
  const hits = r.period.map((p, t) => h("button", { class: "pc-hit", style: { gridRow: `1 / ${last + 1}`, gridColumn: String(t + 1) }, "aria-label": `${cap(monL(p.m))} ${p.y}`, tabindex: "-1" }));
  const dot = h("div", { class: "pc-dot" }, h("b"), h("span", { class: "pc-pt" }));
  const grid = h("div", { class: "pc-grid", style: { "--n": N } }, ...kids, ...hits, dot);
  const when = h("span", { class: "mono" }), big = h("span", { class: "pc-big" }), mm = h("span", { class: "pc-big" }), now = h("div", { class: "pc-now" });
  put(el, h("div", { class: "pc-head" }, h("div", { class: "pc-when" }, when, big), h("div", { class: "pc-rain" }, mm, h("span", { class: "mono" }, D.normalRain))), now, grid, h("p", { class: "small pc-note" }, D.tapMonth));
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
function planCard(it, r, plans, onPick) {
  const D = C().ds, f = it.f, N = r.period.length, plots = plotsOf(f).map((x) => ({ ...x, runs: runsOf(x.pc, N) }));
  const order = [];
  for (let t = 0; t < N; t++) for (const { runs } of plots) { const c = runs.find((x) => x.t0 <= t && t < x.t1).c; if (!order.includes(c)) order.push(c); }
  const lossYears = f.per.filter((x) => x.lostShare > 0).length, cov = coveredMonths(f, N).filter(Boolean).length;
  return h("button", { class: "strat", role: "radio", "aria-checked": String(it.key === state.pick), "data-id": it.key, onclick: () => onPick(it.key) },
    h("span", { class: "spec mono" }, whyOf(it, plans), h("span", { class: "radio" })),
    h("span", { class: "pname" }, icon(NAMED_ICON[it.key]), D.names[it.key]),
    h("span", { class: "cropline" }, ...order.slice(0, 4).map((c) => { const L = look(c); return h("span", { class: `cl-chip${c === "bare" ? " bare" : ""}` }, h("i", { style: { background: L.color, color: L.light ? "#fff" : "var(--ink)" } }, icon(L.icon)), cropLabel(c)); }),
      order.length > 4 ? h("span", { class: "cl-chip more", title: order.slice(4).map(cropLabel).join(", ") }, `+${order.length - 4}`) : null),
    h("span", { class: "cl-note" }, plots.length > 1 ? D.inPlots(plots.length) : D.wholeFarm),
    h("span", { class: "mini", style: { "--n": N } }, ...plots.map(({ runs }) => h("div", {}, ...runs.flatMap((ru) => Array.from({ length: ru.t1 - ru.t0 }, () => h("i", { class: ru.c === "bare" ? "bare" : "", style: { background: look(ru.c).color } })))))),
    h("span", { class: `badge ${f.verdict}` }, C().verdict[f.verdict]),
    h("span", { class: "facts" }, r.samples.length > 1 ? h("span", {}, icon("i-care"), D.lossYears(lossYears)) : null, h("span", {}, icon("i-straw"), D.coverOf(cov, N))));
}

// What we don't know: a short label each, the sentence opens on tap
function unknownChips(r, f) {
  const c = C(), D = c.ds, tr = r.terrain, d = describeSoil(tr?.soil), crops = new Set(f.parcels.flatMap((p) => p.d.steps.map((s) => s.crop)));
  const items = [["i-rain", D.unk.climate, c.unkClimate], ["i-soil", D.unk.soil, d ? (tr.soil.offsetKm ? c.unkSoilNear(tr.soil.offsetKm) : c.unkSoil) : c.unkNoSoil], ["i-maize", D.unk.variety, c.unkVariety]];
  if ([...crops].some((id) => DATA.crops[id]?.approximate)) items.push(["i-info", D.unk.approx, c.approx]);
  if (!nearPilot(state.plan.place)) items.push(["i-income", D.unk.prices, c.unkPrices]);
  items.push(["i-agronomist", D.unk.local, D.localWhy]);
  const toggle = (e) => { const b = e.currentTarget; b.setAttribute("aria-expanded", String(b.getAttribute("aria-expanded") !== "true")); };
  return h("div", { class: "unk" }, ...items.map(([ic, t, txt]) => h("button", { class: "unk-chip", "aria-expanded": "false", onclick: toggle },
    h("span", { class: "top" }, icon(ic), t, h("span", { class: "plus" })), h("span", { class: "more" }, h("div", {}, h("p", {}, txt))))));
}
function sourceNote(r, f) {
  const D = C().ds, per = f.per, b = h("button", { class: "source", "aria-expanded": "false" }, icon("i-info"), D.source,
    h("span", { class: "pop" }, D.sourcePop(state.plan.place.name, per[0]?.base ?? r.period[0].y, per[per.length - 1]?.base ?? r.period[0].y)));
  b.addEventListener("click", (e) => { e.stopPropagation(); b.setAttribute("aria-expanded", String(b.getAttribute("aria-expanded") !== "true")); });
  return b;
}

function viewPlan() {
  return withResults(async (r) => {
    const c = C(), D = c.ds, P = state.plan, N = r.period.length, multi = r.samples.length > 1;
    const [plans, ids] = await Promise.all([namedPlans(P), ideas(r)]);
    if (!plans.length) { put($("#view"), h("div", { class: "res" }, resHead(P), h("div", { class: "card" }, h("p", {}, c.noPlans), h("a", { class: "btn dark", href: "#/planear" }, c.changeData)))); return; }
    if (!plans.some((x) => x.key === state.pick)) state.pick = plans[0].key;
    const cur = () => plans.find((x) => x.key === state.pick);
    const head = h("div", { class: "pv-block", id: "pvHead" }), routeBox = h("div"), stat = h("div"), dots = h("div", { class: "dots" }), coverLab = h("b"), squares = h("div", { class: "squares" }), cal = h("div", { class: "pcal" });
    const isSaved = () => state.saved && JSON.stringify(state.saved.plan) === JSON.stringify(P);
    const saveBtn = h("button", { class: "round", "aria-label": c.save, title: c.save, onclick: () => { state.saved = { plan: P, at: Date.now() }; store.set("saved3", state.saved); put(saveBtn, icon("i-check")); } }, icon(isSaved() ? "i-check" : "i-bookmark"));
    const show = (anim) => {
      const it = cur(), f = it.f, good = f.per.filter((x) => yearLv(x) === "g").length, cov = coveredMonths(f, N).filter(Boolean).length;
      put(head, h("span", { class: "pill-eyebrow mono" }, whyOf(it, plans)), h("h2", { class: "h3" }, D.names[it.key]), h("span", { class: `badge ${f.verdict}` }, c.verdict[f.verdict]));
      put(routeBox, routeEl(r, f));
      if (multi) {
        const [a, b, z] = D.goodYears(f.per.length), n = h("span", {}, String(good));
        put(stat, h("div", { class: "statbox" }, h("div", { class: "stat" }, n), h("p", {}, a, h("b", {}, b), z)));
        yearDots(dots, r, f);
        if (anim) countUp(n, good, 800);
      }
      coverLab.textContent = D.coverOf(cov, N);
      coverSquares(squares, r, f);
      planCalendar(cal, r, f);
      if (anim) [head, routeBox, stat, cal].forEach((x) => { x.classList.remove("swap"); void x.offsetWidth; x.classList.add("swap"); });
    };
    const cards = h("div", { class: "strats", role: "radiogroup", "aria-label": D.names.safe, style: { "--k": plans.length } });
    const pickPlan = (key) => {
      state.pick = key;
      cards.querySelectorAll(".strat").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.id === key)));
      show(true);
      // On narrow screens the plan sits above the cards: bring it into view so the change is seen
      const rc = head.getBoundingClientRect();
      if (!desktop() && (rc.top < 60 || rc.bottom > innerHeight)) {
        head.scrollIntoView({ behavior: MOTION() ? "smooth" : "auto", block: "start" });
        const badge = head.querySelector(".badge"); badge.classList.add("flash"); setTimeout(() => badge.classList.remove("flash"), 900);
      }
    };
    put(cards, ...plans.map((it) => planCard(it, r, plans, pickPlan)));
    const legend = h("div", { class: "dots-legend" }, ...["g", "c", "x"].map((k) => h("span", {}, h("i", { class: k, style: { background: { g: "var(--good)", c: "var(--care)", x: "var(--danger)" }[k] } }), D.legend[k])),
      COAST(P.place) ? h("span", {}, h("i", { class: "n" }), D.legend.n) : null);
    put($("#view"), h("div", { class: "res pv" },
      resHead(P),
      ninoBanner(r),
      h("section", { class: "pv-panel" },
        h("div", { class: "pv-body" },
          h("div", { class: "pv-left" },
            h("div", { class: "pv-a" }, head, h("div", { class: "pv-block" }, h("b", {}, D.whatWhen), routeBox),
              h("div", { class: "pv-acts" }, h("button", { class: "btn soft", onclick: () => explainSheet(D.names[cur().key], cur().f, r) }, D.whyRisks), saveBtn,
                h("button", { class: "round", "aria-label": c.listen, title: c.listen, onclick: () => speak(`${D.names[cur().key]}. ${routeWords(r, cur().f)}. ${c.verdict[cur().f.verdict]}.`) }, icon("i-volume")))),
            h("div", { class: "pv-b" },
              multi ? [stat, h("div", { class: "pv-block" }, dots, legend)] : h("p", { class: "small" }, D.realOnly),
              h("div", { class: "pv-block" }, coverLab, squares))),
          h("div", { class: "pv-right" }, cal)),
        h("div", { class: "pv-block pv-cards" }, h("b", {}, D.plansTitle(plans.filter((x) => x.key !== "today").length, plans.some((x) => x.key === "today"))), cards),
        h("div", { class: "pv-foot" }, unknownChips(r, plans[0].f), sourceNote(r, plans[0].f))),
      ids.length ? h("a", { class: "hint", href: "#/probar" }, icon("i-bulb"), h("span", { class: "grow" }, c.ideasHint(ids.length)), icon("i-chev-r")) : null,
      h("section", { class: "card" }, h("b", { class: "card-h" }, c.tipsTitle), tipList(tipsFor(r).slice(0, 4)), h("a", { class: "link", href: "#/terreno" }, c.seePlot))));
    show(false);
  });
}


/* ---------- why, risks, what we don't know, questions for the agronomist ---------- */
const COAST = (pl) => pl.lat > -5 && pl.lat < 2 && pl.lon > -81.5 && pl.lon < -78.5;
// A strong El Niño is under way (NOAA/ERFEN, data/outlook.json): on the Pacific coast, a plan for the coming rainy
// season is tested by default on the seasons that followed past strong El Niños, not on all years alike.
const ninoNow = (P) => !!P && DATA.outlook?.official?.noaa?.chance_pct >= 70 && COAST(P.place) && P.start.slice(0, 7) <= "2027-04" && P.end >= iso(new Date());
const defaultMode = (P) => (ninoNow(P) ? "nino" : "all");
const seasonsOf = (r) => r.samples.filter((s) => s.base != null).map((s) => `${s.base}-${String(s.base + 1).slice(2)}`);
function ninoBanner(r) {
  const c = C(), P = state.plan;
  if (state.mode === "nino" && seasonsOf(r).length) return h("div", { class: "read nino-note" }, icon("i-rain"), h("span", { class: "grow" }, h("b", {}, c.ninoOnTitle), " ", c.ninoOn(andList(seasonsOf(r)))), h("button", { class: "link", onclick: () => { state.mode = "all"; render(); } }, c.ninoSeeAll));
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
  return h("section", { class: "plot-map" },
    h("img", { alt: "", src: dk ? `img/sat/${dk}.jpg` : `${ESRI}/export?bbox=${bb}&bboxSR=4326&size=1000,420&format=jpg&f=image` }),
    h("div", { class: "pm-lot" }, ...plots.map(({ pc, name, lead }) => h("div", { class: "pm-plot", style: { flexGrow: String(pc.share), "--c": look(lead).color } },
      h("span", {}, tile(lead), h("b", {}, name), `${cropLabel(lead)} · ${fmtArea(pc.share)}`)))),
    h("div", { class: "pm-cap" }, h("b", {}, D.plotMap), h("span", {}, D.plotMapNote)));
}
function viewTerreno() {
  return withResults(async (r) => {
    const picked = (await chosen(r)).f;
    const c = C(), P = state.plan, tr = r.terrain, d = describeSoil(tr?.soil), wl = r.site.wl;
    const months = Array.from({ length: 12 }, (_, i) => { const vs = Object.entries(r.clim.months).filter(([k]) => +k.slice(5) === i + 1 && +k.slice(0, 4) >= 1991 && +k.slice(0, 4) <= 2020).map(([, v]) => v); const avg = (f) => vs.reduce((a, v) => a + v[f], 0) / Math.max(1, vs.length); return { m: i + 1, rain: avg("rain"), et0: avg("et0"), tmax: avg("tmax"), tmin: avg("tmin") }; });
    const annual = months.reduce((a, x) => a + x.rain, 0), wet = months.filter((x) => x.rain >= x.et0 * 0.8).map((x) => mon(x.m)), dry = months.filter((x) => x.rain < 0.5 * x.et0).map((x) => mon(x.m));
    const tmin = Math.min(...months.map((x) => x.tmin)), tmax = Math.max(...months.map((x) => x.tmax));
    const slope = tr?.slopePct, slopeW = slope == null ? "—" : slope < 2 ? c.flat : slope < 8 ? c.gentle : c.steep;
    const row = (k, v, note) => h("div", { class: "trow" }, h("span", {}, k), h("div", {}, h("b", {}, v), note ? h("small", {}, note) : null));
    const wlW = wl >= 0.6 ? c.high : wl >= 0.35 ? c.medium : c.low;
    const wlWhy = P.waterlog ? c.wlYouSaid : tr?.pilotWater != null ? c.wlSat : c.wlEstimated;
    const mx = Math.max(...months.map((x) => Math.max(x.rain, x.et0)), 1);
    const last = r.clim.last, lm = r.clim.months[last], lmNormal = normalRain(r.clim, +last.slice(5));
    const noaa = DATA.outlook?.official?.noaa, erfen = DATA.outlook?.official?.erfen;
    put($("#view"), h("div", { class: "res terreno" },
      resHead(P),
      plotMap(r, picked),
      h("div", { class: "col-left" },
        h("section", { class: "card" }, h("h2", { class: "card-h" }, c.yourPlot),
          row(c.elevation, tr?.elevation != null ? `${tr.elevation} m` : "—"),
          row(c.slope, slopeW, slope != null ? `${num(slope)} %` : null),
          row(c.soilType, d ? c.texture[d.texture] : c.noData, d ? c.holds(d.awc) : null),
          row(c.acidity, d ? c.phWord[d.phClass] : c.noData, d ? `pH ${num(d.ph)}` : null),
          row(c.organic, d ? c.omWord[d.omClass] : c.noData, d ? `${num(d.om)} %` : null),
          row(c.waterlog, wlW, wlWhy),
          h("div", { class: "q", style: { marginTop: "4px" } }, h("small", { class: "small" }, c.wlFix), waterlogOpts(P, () => { setPlan({ ...P }); memo.clear(); render(); })),
          h("p", { class: "small" }, d && tr.soil.offsetKm ? c.srcTerrainNear(tr.soil.offsetKm) : c.srcTerrain))),
      h("div", { class: "col-right" },
        h("section", { class: "card" }, h("h2", { class: "card-h" }, c.climate),
          h("div", { class: "kpis" }, h("div", {}, h("b", {}, `${Math.round(annual).toLocaleString(state.lang)} mm`), h("small", {}, c.rainYear)), h("div", {}, h("b", {}, `${Math.round(tmin)}–${Math.round(tmax)} °C`), h("small", {}, c.tempRange)), h("div", {}, h("b", {}, String(dry.length)), h("small", {}, c.dryMonths))),
          h("div", { class: "clim-bars" }, ...months.map((x) => h("div", { class: "cb" }, h("span", { class: "v" }, String(Math.round(x.rain))), h("div", { class: "bars" }, h("i", { class: "r", style: { height: `${Math.max(2, (x.rain / mx) * 100)}%` } }), h("i", { class: "e", style: { height: `${Math.max(2, (x.et0 / mx) * 100)}%` } })), h("span", {}, S().months[x.m - 1])))),
          h("div", { class: "legend" }, h("span", {}, h("i", { class: "sw", style: { background: "var(--rain)" } }), c.lgRain), h("span", {}, h("i", { class: "sw", style: { background: "#C7CCD4" } }), c.lgNeed)),
          h("p", { class: "small" }, wet.length ? c.wetMonths(andList(wet)) : "", " ", dry.length ? c.dryList(andList(dry)) : "")),
        h("section", { class: "card" }, h("h2", { class: "card-h" }, c.thisYear),
          lm ? row(`${cap(S().monthsLong[+last.slice(5) - 1])} ${last.slice(0, 4)}`, `${Math.round(lm.rain)} mm`, c.vsNormal(Math.round(lmNormal))) : null,
          noaa ? h("p", {}, c.ninoNow(noaa.chance_pct), h("br"), h("small", { class: "small" }, `NOAA · ${noaa.issued}`)) : null,
          erfen && COAST(P.place) ? h("p", { class: "small" }, `ERFEN (${erfen.issued}): ${es() ? erfen.es : erfen.en}`) : null),
        h("section", { class: "card" }, h("h2", { class: "card-h" }, c.tipsTitle), tipList(tipsFor(r))))));
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
  for (const s of r.substitutes || []) { const a = s.alts[0]; if (a) cand.push({ icon: "i-wheat", title: c.idInstead(cap(cropName(a.id)), cropName(s.id)), why: c.idInsteadWhy(cap(cropName(s.id))), P2: { ...P, crops: [...P.crops.filter((x) => x !== s.id), a.id] } }); }
  if (!P.irrigation) cand.push({ icon: "i-drops", title: c.idIrr, why: c.idIrrWhy, P2: { ...P, irrigation: true } });
  if (!P.crops.some((id) => DATA.crops[id]?.n_fixing)) {
    const leg = Object.values(r.windows).filter((w) => DATA.crops[w.id]?.n_fixing && !GREEN.has(w.id) && !P.crops.includes(w.id)).sort((a, b) => (b.best?.value ?? 0) - (a.best?.value ?? 0))[0];
    if (leg && (leg.best?.value ?? 0) >= 0.5) cand.push({ icon: "i-leaf", title: c.idLegume(cropName(leg.id)), why: c.idLegumeWhy, P2: { ...P, crops: [...P.crops, leg.id] } });
  }
  if (!P.crops.includes("mulch") && P.crops.some((id) => CEREALS.has(id)) && f.covered < 0.85) cand.push({ icon: "i-sprout", title: c.idStraw, why: c.idStrawWhy, P2: { ...P, crops: [...P.crops, "mulch"] } });
  for (const it of cand) { const eff = await effect(it.P2); if (eff) out.push({ ...it, eff, apply: () => { state.undo = { plan: P, mode: state.mode }; setPlan(it.P2); render(); } }); }
  if (state.mode === "all") {
    if (ninoNow(P)) out.unshift({ icon: "i-rain", title: c.idNino, why: c.idNinoWhy, eff: c.yearsLike.nino, apply: () => { state.undo = { plan: P, mode: "all" }; state.mode = "nino"; render(); } });
    out.push({ icon: "i-cloud-sun", title: c.idDry, why: c.idDryWhy, eff: c.idDryEff, apply: () => { state.undo = { plan: P, mode: "all" }; state.mode = "dry"; render(); } });
  } else out.unshift({ icon: "i-cloud-sun", title: c.idAll, why: c.idAllWhyBy[state.mode] || c.idAllWhy, eff: c.yearsLike[state.mode], on: true, apply: () => { state.mode = "all"; state.undo = null; render(); } });
  return out;
}
function viewProbar() {
  return withResults(async (r) => {
    const c = C(), P = state.plan, list = await ideas(r);
    const picked = P.crops.filter((id) => r.windows[id]);
    const suggested = [...new Set(list.flatMap((it) => (it.P2 ? it.P2.crops.filter((x) => !P.crops.includes(x) && r.windows[x]) : [])))];
    const N = r.period.length, lab = desktop() ? "146px" : "64px";
    const head = h("div", { class: "sow-row", style: { "--lab": lab } }, h("span"), h("div", { class: "sow-cells", style: { "--n": N } }, ...r.period.map((p, i) => h("span", { style: { textAlign: "center", fontSize: "12px", fontWeight: 700, color: "var(--ink2)", overflow: "hidden" } }, N <= 14 && desktop() ? mon(p.m) : S().months[p.m - 1]))));
    const sowRow = (id) => {
      const w = r.windows[id];
      return h("div", { class: "sow-row", style: { "--lab": lab } }, h("b", { style: { fontSize: desktop() ? "16px" : "13px" } }, cap(cropName(id))),
        h("div", { class: "sow-cells", style: { "--n": N } }, ...w.starts.map((s, t) => h("i", { class: s ? s.level : "none", title: s ? `${ym(r.period[t])}: ${Math.round(s.value * 100)} %` : c.sowNone }, s && w.best && s.t === w.best.t && w.best.level !== "danger" ? "★" : ""))));
    };
    put($("#view"), h("div", { class: "res stack" },
      resHead(P),
      h("div", { class: "res-title" }, h("h1", { class: "display" }, c.tryTitle), h("p", {}, c.tryLead)),
      state.undo ? h("button", { class: "link", style: { alignSelf: "flex-start" }, onclick: () => { setPlan(state.undo.plan); state.mode = state.undo.mode; state.undo = null; render(); } }, icon("i-undo"), " ", c.undo) : null,
      list.length ? h("div", { class: "ideas row-ideas" }, ...list.map((it) => h("div", { class: `idea${it.on ? " on" : ""}` }, h("span", { class: "ic" }, icon(it.icon)), h("div", { class: "grow" }, h("b", {}, it.title), h("p", {}, it.why), h("em", {}, it.eff)),
        h("button", { class: "btn dark", onclick: it.apply }, it.on ? c.undo : c.tryBtn)))) : h("p", {}, c.noIdeas),
      h("section", { class: "card sow-card" },
        h("div", { class: "row between wrap" }, h("b", { class: "card-h" }, c.sowTitle),
          h("div", { class: "legend" }, ...[["good", c.sowGood], ["care", c.sowCare], ["danger", c.sowBad], ["none", c.sowNone]].map(([k, l]) => h("span", {}, h("i", { class: `sw ${k}` }), l)))),
        h("p", { class: "small" }, c.sowLead),
        h("div", { class: "sow" }, head, h("p", { class: "sow-group" }, c.yours), ...picked.map(sowRow), suggested.length ? h("p", { class: "sow-group" }, c.suggested) : null, ...suggested.slice(0, 3).map(sowRow)))));
  });
}

/* ---------- compare: build your own ---------- */
const customFrom = (f) => f.parcels.map((pc) => ({ area: +(pc.share * (state.plan.area || 1)).toFixed(state.plan.unit === "m2" ? 0 : 1), steps: pc.d.steps.map((s) => ({ crop: s.crop, t0: s.t0 })) }));
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
    const K = state.custom, redo = () => viewComparar();
    const mine = r.evalFarm(K.map((pc) => ({ share: (+pc.area || 0) / (P.area || 1), steps: pc.steps })), { noMulch: !state.customStraw });
    const choices = [...new Set([...P.crops.filter((id) => id !== "mulch"), ...CROP_ORDER.filter((id) => id !== "mulch" && DATA.crops[id])])];
    const used = K.reduce((x, pc) => x + (+pc.area || 0), 0);
    const freeT = (pc) => pc.steps.reduce((e, s) => Math.max(e, s.t0 + r.monthsOf(s.crop)), 0);
    const plots = K.map((pc, k) => {
      const ev = mine.parcels[k];
      return h("div", { class: "card plot" },
        h("div", { class: "plot-head" }, h("b", {}, `${c.plot} ${String.fromCharCode(65 + k)}`),
          h("label", { class: "plot-area" }, h("input", { type: "number", min: "0", step: "any", value: String(pc.area), onchange: (e) => { pc.area = Math.max(0, parseFloat(e.target.value) || 0); redo(); } }), c.units[P.unit || "ha"]),
          K.length > 1 ? h("button", { class: "link", style: { fontSize: "14px" }, onclick: () => { K.splice(k, 1); redo(); } }, c.remove) : null),
        ...pc.steps.map((st, j) => {
          const s = ev?.d.steps.find((x) => x.t0 === st.t0 && x.crop === st.crop), er = ev?.errors.find((x) => x.t0 === st.t0 && x.crop === st.crop);
          const lv = s ? (s.fail >= 0.5 ? "danger" : s.fail > 0.15 || s.yld < 0.6 ? "care" : "good") : "danger";
          return h("div", { class: "pl-step" },
            h("select", { "aria-label": c.what, onchange: (e) => { st.crop = e.target.value; redo(); } }, ...choices.map((id) => h("option", { value: id, selected: id === st.crop || null }, cap(cropName(id))))),
            h("select", { "aria-label": c.when, onchange: (e) => { st.t0 = +e.target.value; redo(); } }, ...r.period.map((p, t) => h("option", { value: t, selected: t === st.t0 || null, disabled: r.monthsOf(st.crop) + t > N || null }, ym(p)))),
            h("span", { class: `res-txt v-${lv}` }, er ? (er.why === "overlap" ? c.overlap : c.noTime) : s ? `→ ${ym(r.period[s.t1 - 1])} · ${outcomeShort({ fail: s.fail, yld: s.yld }, s.n)}` : ""),
            h("button", { class: "x", "aria-label": c.remove, onclick: () => { pc.steps.splice(j, 1); redo(); } }, "✕"));
        }),
        freeT(pc) < N - 1 ? h("button", { class: "link", style: { alignSelf: "flex-start", fontSize: "14px" }, onclick: () => { pc.steps.push({ crop: choices[0], t0: freeT(pc) }); redo(); } }, c.addPlanting) : null);
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
    put($("#view"), h("div", { class: "res" },
      resHead(P),
      h("div", { class: "col-left wide" },
        h("div", { class: "res-title" }, h("h1", { class: "display" }, c.build), h("p", {}, c.buildLead)),
        ...plots,
        h("div", { class: "row wrap", style: { gap: "14px" } },
          h("button", { class: "btn", onclick: () => { K.push({ area: Math.max(0, +((P.area || 1) - used).toFixed(2)), steps: [{ crop: choices[0], t0: 0 }] }); redo(); } }, c.addPlot),
          h("button", { class: "link", onclick: () => { state.custom = customFrom(rec); state.customStraw = P.crops.includes("mulch"); redo(); } }, c.reset)),
        P.crops.includes("mulch") ? h("label", { class: "row", style: { gap: "8px", fontSize: "15px" } }, h("input", { type: "checkbox", checked: state.customStraw || null, onchange: (e) => { state.customStraw = e.target.checked; redo(); } }), c.keepStraw) : null,
        h("p", { class: used > (P.area || 1) + 1e-6 ? "err" : "small" }, c.uses(fmtArea(used / (P.area || 1)), fmtArea(1)))),
      h("div", { class: "col-right" },
        h("h2", { class: "display phone-only", style: { fontSize: "22px" } }, c.cmpTitle),
        h("div", { class: "seg cmp-seg" }, ...[["rec", recName], ["mine", c.mine]].map(([k, l]) => h("button", { "aria-pressed": String((state.cmpView || "rec") === k), onclick: () => { state.cmpView = k; redo(); } }, l))),
        (state.cmpView || "rec") === "rec" ? calCard(recName, rec) : calCard(c.mine, mine),
        h("section", { class: "card cmp-bars" }, h("div", { class: "cmp-key" }, h("span", {}, h("i", { class: "a" }), recName), h("span", {}, h("i", { class: "b" }), c.mine)),
          ...rows.map(([l, a, b, va, vb, up]) => {
            const w = better(va, vb, up), mx = Math.max(Math.abs(va), Math.abs(vb), 1e-9), bars = va >= 0 && vb >= 0;
            const line = (cls, txt, v, win) => h("div", { class: `cb-line ${cls}${win ? " win" : ""}` }, bars ? h("span", { class: "cb-track" }, h("i", { style: { width: `${Math.max(3, (Math.abs(v) / mx) * 100)}%` } })) : h("span", { class: "cb-track empty" }), h("b", {}, txt), win ? icon("i-check") : h("span", { class: "cb-tick" }));
            return h("div", { class: "cb-row" }, h("span", { class: "cb-label" }, l), line("a", a, va, w < 0), line("b", b, vb, w > 0));
          })),
        mR != null && mM != null ? h("p", { class: "small" }, c.moneyNote) : null,
        h("div", { class: `conclusion ${score > 0 ? "good" : "even"}` }, icon(score < 0 ? "i-info" : "i-check"), h("span", {}, score < 0 ? (why || c.recBetter) : score > 0 ? c.mineBetter : c.tie)))));
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
  put($("#view"), h("div", { class: "res", style: { flexDirection: "column", maxWidth: "760px" } },
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
    const s = document.createElement("script"); s.src = CESIUM + "Cesium.js"; s.onload = () => res(window.Cesium); s.onerror = rej; document.head.append(s);
  }));
}
async function initCesium(container, { pick = false } = {}) {
  let Cz;
  try { Cz = await loadCesium(); } catch { return; }
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
function updateMap(pl, verdict) {
  if (!viewer || !window.Cesium || !pl) return;
  const Cz = window.Cesium, d = 0.0012;
  const col = verdict ? { good: "#2F7D4F", care: "#C7860F", danger: "#D2452E" }[verdict] : "#153E32";
  if (lotEntity) viewer.entities.remove(lotEntity);
  lotEntity = viewer.entities.add({
    polygon: { height: 0, hierarchy: Cz.Cartesian3.fromDegreesArray([pl.lon - d, pl.lat - d, pl.lon + d, pl.lat - d * 0.9, pl.lon + d * 0.95, pl.lat + d, pl.lon - d * 1.05, pl.lat + d * 0.92]), material: Cz.Color.fromCssColorString(col).withAlpha(0.25) },
    polyline: { clampToGround: true, width: 3, material: Cz.Color.fromCssColorString("#C8FF9E"), positions: Cz.Cartesian3.fromDegreesArray([pl.lon - d, pl.lat - d, pl.lon + d, pl.lat - d * 0.9, pl.lon + d * 0.95, pl.lat + d, pl.lon - d * 1.05, pl.lat + d * 0.92, pl.lon - d, pl.lat - d]) },
    position: Cz.Cartesian3.fromDegrees(pl.lon, pl.lat),
    point: { pixelSize: 12, color: Cz.Color.fromCssColorString("#C8FF9E"), outlineColor: Cz.Color.fromCssColorString("#153E32"), outlineWidth: 3, heightReference: Cz.HeightReference.CLAMP_TO_GROUND },
    label: { text: pl.name, font: "500 15px Geist, sans-serif", fillColor: Cz.Color.fromCssColorString("#F3F0E5"), showBackground: true, backgroundColor: Cz.Color.fromCssColorString("#153E32"), backgroundPadding: new Cz.Cartesian2(12, 8), pixelOffset: new Cz.Cartesian2(0, -30), heightReference: Cz.HeightReference.CLAMP_TO_GROUND },
  });
  viewer.camera.flyTo({ destination: Cz.Cartesian3.fromDegrees(pl.lon, pl.lat - 0.02, 4500), orientation: { heading: 0, pitch: Cz.Math.toRadians(-55), roll: 0 }, duration: 1.6 });
  viewer.scene.requestRender();
}

/* ================= router ================= */
function route() {
  const [r = "", arg] = location.hash.replace(/^#\/?/, "").split("/");
  if (RESULTS.includes(r) && !state.plan) return { r: "planear" };
  if (r === "pasaporte" && !nearPilot(state.plan.place)) return { r: "plan" };
  return { r: ["", "planear", "bootcamp", ...RESULTS].includes(r) ? r : "", arg };
}
function renderChrome(r) {
  const c = C(), P = state.plan, isRes = RESULTS.includes(r);
  document.body.className = [`r-${r || "landing"}`, r ? "app-route" : "", isRes ? "results" : ""].filter(Boolean).join(" ");
  document.documentElement.lang = state.lang;
  const tabs = [["plan", c.nav.plan, "i-sow"], ["terreno", c.nav.plot, "i-plot"], ["probar", c.nav.try, "i-bulb"], ["comparar", c.nav.compare, "i-scale"]];
  // Off the results there are no tabs, so the bar carries a way back: to the plan when there is one, else home
  const back = isRes ? null : h("a", { class: "round", href: r === "planear" && P ? "#/plan" : "#/", "aria-label": es() ? "Atrás" : "Back", title: es() ? "Atrás" : "Back" }, icon("i-back"));
  put($("#topbar"), h("div", { class: "row", style: { minWidth: 0 } }, back, brand(), h("span", { class: "crumb" }, isRes ? `/  ${P.place.name} · ${fmtArea(1)} · ${fmtDate(P.start)} – ${fmtDate(P.end)}` : `/  ${r === "bootcamp" ? c.ctaBootcamp : c.planTitle}`)),
    isRes ? h("nav", { class: "tabs" }, ...tabs.map(([k, l]) => h("a", { href: "#/" + k, "aria-current": r === k ? "page" : null }, l))) : null,
    h("div", { class: "row", style: { gap: "8px" } }, isRes ? h("a", { class: "btn light", href: "#/planear", onclick: () => { state.draft = null; state.sec = null; }, style: { minHeight: "40px", fontSize: "12px" } }, c.changeData) : null, langBtn()));
  put($("#bottom-nav"), ...tabs.map(([k, l, ic]) => h("a", { href: "#/" + k, "aria-current": r === k ? "page" : null }, icon(ic), l)));
  if (r !== "planear") put($("#map-overlay"));
}
async function render() {
  const { r, arg } = route();
  if (document.body.classList.contains("r-bootcamp")) window.speechSynthesis?.cancel();
  renderChrome(r);
  const views = { "": viewLanding, planear: () => viewPlanear(arg), bootcamp: viewBootcamp, plan: viewPlan, terreno: viewTerreno, probar: viewProbar, comparar: viewComparar, pasado: viewPasado, pasaporte: viewPasaporte };
  try { await views[r](); } catch (e) { console.error(e); put($("#view"), errorCard(C().climateError, render)); }
}
async function start() {
  document.documentElement.classList.toggle("motion", MOTION());
  // Source notes open on tap; a tap anywhere else closes them
  document.addEventListener("click", () => document.querySelectorAll('.source[aria-expanded="true"]').forEach((b) => b.setAttribute("aria-expanded", "false")));
  put($("#view"), loading());
  try { await loadBase(); } catch { put($("#view"), errorCard(C().climateError, start)); return; }
  if (state.plan) state.mode = defaultMode(state.plan);
  addEventListener("hashchange", () => { render(); scrollTo(0, 0); $("#view").scrollTo?.(0, 0); });
  let w = desktop(); addEventListener("resize", () => { if (desktop() !== w) { w = desktop(); if (viewer) { viewer.destroy(); viewer = null; lotEntity = null; pickBound = false; } render(); } });
  render();
}
start();
