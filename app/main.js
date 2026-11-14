import { fetchClimate } from "./climate.js?v=21";
import { plan as runPlanner, cropMonths } from "./planner.js?v=21";
import { COPY } from "./copy.js?v=21";
import { fetchTerrain, describeSoil, waterlogFactor } from "./terrain.js?v=21";
import { STR } from "./i18n.js?v=21";
import { createBootcamp } from "./bootcamp.js?v=2";
import { createBootcamp } from "./bootcamp.js?v=2";

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
  priority: store.get("priority", "soil"),
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
const loadDemo = (k) => (demoData[k] ||= fetch(`data/demo/${k}.json`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }));
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
function icon(id, cls = "icon") {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("class", cls); s.setAttribute("aria-hidden", "true");
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
const spanM = (a, b) => (a.y === b.y && a.m === b.m ? mon(a.m) : `${mon(a.m)}–${mon(b.m)}`);
const span = (a, b) => (a.y === b.y ? (a.m === b.m ? ym(a) : `${mon(a.m)}–${mon(b.m)} ${a.y}`) : `${ym(a)} – ${ym(b)}`);
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
async function results(P = state.plan, mode = state.mode) {
  const [c, tr] = await Promise.all([climate(P.place), terrain(P.place)]), key = JSON.stringify([P, mode, state.priority]);
  if (!memo.has(key)) { const site = siteOf(tr, P); memo.set(key, { clim: c, P, terrain: tr, site, ...runPlanner(c, DATA.crops, P.crops, { start: P.start.slice(0, 7), end: P.end.slice(0, 7), irrigation: P.irrigation, priority: state.priority, mode, site, current: P.current || [] }) }); }
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
const brand = () => h("a", { class: "brand", href: "#/" }, h("span", { class: "logo" }, icon("i-sprout")), h("b", {}, "Rooti"));
const loading = (msg) => h("div", { class: "loading" }, msg ? h("p", { class: "small" }, msg) : null, h("div", { class: "skeleton", style: { height: "120px" } }), h("div", { class: "skeleton", style: { height: "280px" } }), h("div", { class: "skeleton", style: { height: "160px" } }));
const errorCard = (msg, retry) => h("div", { class: "errorcard", role: "alert" }, icon("i-wifi-off"), h("b", { class: "grow" }, msg), h("button", { class: "btn", onclick: retry }, C().retry));
const stepIcon = (ic) => icon(ic === "calendar" ? "i-calendar" : ic === "map-pin" ? "i-pin" : "i-sprout");
const bootcamp = createBootcamp({ h, put, icon, store, speak });

function viewBootcamp() {
  const crops = CROP_ORDER.filter((id) => DATA.crops[id]).map((id) => ({
    id,
    name: cap(cropName(id)),
    months: cropMonths(DATA.crops[id]),
  }));
  put($("#view"), bootcamp(state.lang, crops, C().cta, () => { state.draft = null; }));
}

/* ================= landing ================= */
// The cover is the farmer's plot seen from space, with the year's planting calendar printed on it.
const COVERS = [
  { k: "daule", rows: [["rice", [[1, 4, "good"]]], ["maize", [[1, 4, "good"], [5, 4, "care"]]], ["soybean", [[1, 4, "good"]]], ["mulch", [[5, 8, "straw"]]]] },
  { k: "quevedo", rows: [["maize", [[1, 4, "good"]]], ["soybean", [[5, 4, "good"]]], ["peanut", [[1, 4, "good"]]], ["mulch", [[9, 4, "straw"]]]] },
  { k: "iowa", rows: [["maize", [[5, 4, "good"]]], ["soybean", [[5, 4, "good"]]], ["bare", [[1, 4, "bare"], [9, 4, "bare"]]]] },
];
let coverTimer = null;
function viewLanding() {
  const c = C();
  clearInterval(coverTimer);
  const start = () => { state.draft = null; go("planear"); };
  const openDemo = (k) => { setPlan(demoPlan(k)); state.mode = "all"; memo.clear(); go("plan"); };
  const imgs = COVERS.map((cv, i) => h("img", { class: `cv-img${i === 0 ? " on" : ""}`, src: `img/sat/${cv.k}.jpg`, alt: c.demo[cv.k] }));
  const overlay = h("div", { class: "cv-cal" }), label = h("button", { class: "cv-label" });
  let i = 0;
  const show = (n) => {
    i = n; const cv = COVERS[n], D = DEMOS[cv.k];
    imgs.forEach((im, j) => im.classList.toggle("on", j === n));
    put(label, h("span", { class: "dot" }), h("b", {}, c.demo[cv.k]), h("small", {}, `${D.place.lat.toFixed(2)}, ${D.place.lon.toFixed(2)} · NASA POWER 1981–2026`), icon("i-arrow-r"));
    label.onclick = () => openDemo(cv.k);
    put(overlay, h("div", { class: "cal-row cal-head" }, h("span"), h("div", { class: "cal-grid", style: { "--n": 12 } }, ...S().months.map((mm) => h("span", {}, mm)))),
      ...cv.rows.map(([id, bars]) => h("div", { class: "cal-row" }, h("span", { class: "cal-name" }, id === "bare" ? c.bare : cap(cropName(id))),
        h("div", { class: "cal-grid", style: { "--n": 12 } }, ...bars.map(([a, l, lv], bi) => h("div", { class: `bar grow ${lv}`, style: { gridColumn: `${a} / span ${l}`, animationDelay: `${120 + bi * 140}ms` } }, h("b", {}, "")))))));
  };
  show(0);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) coverTimer = setInterval(() => { if (!document.querySelector(".cover")) return clearInterval(coverTimer); show((i + 1) % COVERS.length); }, 5200);
  put($("#view"), h("div", { class: "landing v2" },
    h("header", { class: "cover" }, ...imgs, h("div", { class: "cv-scrim" }),
      h("nav", { class: "l-nav" }, h("a", { class: "brand light", href: "#/" }, h("span", { class: "logo" }, icon("i-sprout")), h("b", {}, "Rooti")),
        h("div", { class: "l-links" }, h("a", { class: "txt", href: "#how" }, c.nav.how), langBtn(), h("a", { class: "btn light", href: "#/bootcamp" }, c.ctaBootcamp), h("button", { class: "btn dark", onclick: start }, c.cta))),
      h("div", { class: "cv-bottom" }, label, overlay)),
    h("section", { class: "l-body" },
      h("div", { class: "l-facts", id: "how" },
        ...c.facts.map(([n, t]) => h("div", {}, h("b", { class: "display" }, n), h("span", {}, t)))),
      h("div", { class: "l-copy" },
        h("h1", { class: "display" }, c.heroTitle), h("p", { class: "lead" }, c.heroLead),
        h("div", { class: "l-acts" }, h("button", { class: "btn dark big", onclick: start }, c.cta, icon("i-arrow-r")),
          h("a", { class: "btn light big", href: "#/bootcamp" }, icon("i-leaf"), c.ctaBootcamp),
          h("div", { class: "l-examples" }, h("span", { class: "small" }, c.examplesLbl), ...Object.keys(DEMOS).map((k) => h("button", { class: "chip", onclick: () => openDemo(k) }, c.demo[k])))),
        h("p", { class: "l-note" }, c.heroNote, " · ", h("span", { class: "credit" }, "Imagery: Esri World Imagery"))))));
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
      on ? icon("i-check", "icon tick") : null, h("b", {}, cap(cropName(id))), h("small", {}, kind(id) + (id !== "mulch" ? ` · ${cropMonths(DATA.crops[id])} ${es() ? "meses" : "months"}` : "")));
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
const prioOpts = (redo, short) => h("div", { class: "opts" }, ...[["soil", "i-sprout"], ["income", "i-coin"], ["water", "i-drops"]].map(([v, ic]) => h("button", { class: "opt", "aria-pressed": String(state.priority === v), onclick: () => { state.priority = v; store.set("priority", v); memo.clear(); redo(); } }, short ? null : icon(ic), C().prioShort[v])));
const submitPlan = () => { setPlan({ ...state.draft, crops: [...state.draft.crops] }); state.draft = null; state.undo = null; state.mode = "all"; memo.clear(); go("plan"); };

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
    body = [title(c.landQ, c.landHelp), areaBox(d, redo), h("div", { class: "q" }, h("b", {}, c.irrigQ), irrigOpts(d, redo)), h("div", { class: "q" }, h("b", {}, c.wlQ, h("small", { class: "small", style: { fontWeight: 400 } }, " · ", c.optional)), waterlogOpts(d, redo)), h("div", { class: "q" }, h("b", {}, c.todayQ, h("small", { class: "small", style: { fontWeight: 400 } }, " · ", c.optional)), currentChips(d, redo)), h("div", { class: "q" }, h("b", {}, c.prioQ), prioOpts(redo, true)), h("div", { class: "spacer" }),
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
    4: `${(d.area || 1).toLocaleString(state.lang)} ${c.units[d.unit || "ha"]} · ${d.irrigation ? c.irrig.yes : c.irrig.no} · ${c.prioShort[state.priority]}`,
  };
  const body = {
    1: () => [d.place ? placeCard(d, null) : null, ...searchBox(pick), gpsBtn(pick)],
    2: () => [dateFields(d, redo), h("div", { class: "row between wrap" }, quickDates(d, redo), h("span", { class: err ? "err" : "small" }, err || c.months(months))), periodStrip(d)],
    3: () => [h("p", { class: "small" }, c.whatHelp), ...cropTiles(d, redo, 0)],
    4: () => [
      h("div", { class: "row-fields" }, h("input", { class: "num", type: "number", min: "0", step: "any", value: String(d.area), "aria-label": c.landQ, onchange: (e) => { const v = parseFloat(e.target.value); if (v > 0) { d.area = v; redo(); } } }),
        h("div", { class: "seg" }, ...Object.keys(UNITS).map((u) => h("button", { "aria-pressed": String(d.unit === u), onclick: () => { d.unit = u; redo(); } }, c.units[u])))),
      h("div", { class: "q" }, h("b", {}, c.irrigQ), irrigOpts(d, redo)),
      h("div", { class: "q" }, h("b", {}, c.prioQ), prioOpts(redo, true)),
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
function headline(f) {
  const pls = plantingsOf(f), groups = new Map();
  for (const p of pls) { const k = spanM(p.from, p.to); if (!groups.has(k)) groups.set(k, new Set()); groups.get(k).add(cropName(p.crop).toLowerCase()); }
  if (!groups.size) return C().noPlans;
  const straw = f.grid.some((g) => g.mulch?.share > 0.01) ? (es() ? "; paja entre siembras" : "; straw in between") : "";
  if (groups.size > 3) return cap(`${andList([...new Set(pls.map((p) => cropName(p.crop).toLowerCase()))])}${es() ? ", en rotación" : ", rotating"}`) + straw;
  return cap([...groups].map(([k, set]) => `${andList([...set])} ${es() ? "en" : "in"} ${k}`).join("; ")) + straw;
}
function kpis(f, r) {
  const n = f.parcels.reduce((x, p) => x + p.d.steps.length, 0), N = r.period.length;
  return h("div", { class: "kpis" },
    h("div", {}, h("b", {}, String(n)), h("small", {}, C().kPlantings)),
    h("div", {}, h("b", {}, frac(f.anyLoss)), h("small", {}, C().kLoss)),
    h("div", {}, h("b", {}, C().ofMonths(Math.round(f.covered * N), N)), h("small", {}, C().kCovered)));
}
const verdictEl = (v) => h("span", { class: `verdict v-${v}` }, h("i", { class: `sw ${v}` }), C().verdict[v]);
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
          class: `bar ${lv}${compact ? "" : " grow"}`, style: { gridColumn: `${s0 - a + 1} / span ${len}`, animationDelay: `${150 + st.t0 * 20 + k * 80}ms` },
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
const landList = (f) => h("ul", { class: "land" }, ...Object.values(f.byCrop).sort((a, b) => a.plantings[0].t0 - b.plantings[0].t0).map((b) =>
  h("li", { class: b.crop === "mulch" ? "straw" : "" }, h("div", {}, h("b", {}, cap(cropName(b.crop))), h("span", {}, [...b.plantings].sort((x, y) => x.t0 - y.t0).slice(0, 2).map((p) => `${fmtArea(p.share)} · ${span(p.from, p.to)}`).join("; "))),
    h("i", { style: { "--w": `${Math.round(b.area * 100)}%` } }))));
const miniMap = (pl, v) => {
  const d = 0.006, bb = [pl.lon - d * 2.6, pl.lat - d, pl.lon + d * 2.6, pl.lat + d].join(","), dk = demoKey(pl);
  return h("div", { class: "mini-map desk-only" }, h("img", { alt: "", loading: "lazy", src: dk ? `img/sat/${dk}.jpg` : `${ESRI}/export?bbox=${bb}&bboxSR=4326&size=800,300&format=jpg&f=image` }), h("i", { class: v || "" }),
    h("span", { class: "mm-label" }, h("b", {}, pl.name), `${pl.lat.toFixed(2)}, ${pl.lon.toFixed(2)}`));
};
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
function viewPlan() {
  return withResults(async (r) => {
    const f = r.farm, P = state.plan, c = C(), ids = await ideas(r);
    const say = () => `${c.best}: ${headline(f)}. ${c.verdict[f.verdict]}.`;
    const isSaved = state.saved && JSON.stringify(state.saved.plan) === JSON.stringify(P);
    const pilot = nearPilot(P.place);
    put($("#view"), h("div", { class: "res" },
      resHead(P),
      h("div", { class: "col-left" },
        miniMap(P.place, f.verdict),
        h("section", { class: "card answer" },
          h("p", { class: "lbl" }, c.best), h("h2", { class: "display" }, headline(f)), verdictEl(f.verdict), kpis(f, r),
          h("button", { class: "link", style: { alignSelf: "flex-start", fontSize: "15px" }, onclick: () => explainSheet(headline(f), f, r) }, c.whyThis),
          h("div", { class: "desk-only", style: { display: "flex", flexDirection: "column", gap: "10px" } }, h("b", { style: { fontSize: "15px" } }, c.landEach), landList(f)),
          h("div", { class: "desk-only", style: { display: "flex", flexDirection: "column", gap: "8px" } }, h("b", { style: { fontSize: "15px" } }, c.tipsTitle), tipList(tipsFor(r).slice(0, 1)), h("a", { class: "link", href: "#/terreno", style: { fontSize: "14px" } }, c.seePlot)),
          pilot ? h("a", { class: "link desk-only", href: "#/pasaporte", style: { fontSize: "14px" } }, c.passport) : null,
          h("div", { class: "acts desk-only" },
            h("button", { class: "btn dark", onclick: () => { state.saved = { plan: P, at: Date.now() }; store.set("saved3", state.saved); render(); } }, icon(isSaved ? "i-check" : "i-bookmark"), isSaved ? c.saved : c.save),
            h("button", { class: "round", "aria-label": c.listen, title: c.listen, onclick: () => speak(say()) }, icon("i-volume"))))),
      h("div", { class: "col-right" },
        h("section", { class: "card farm-card" },
          h("div", { class: "row between wrap" }, h("b", { style: { fontSize: desktop() ? "18px" : "16px" } }, c.calendar),
            h("div", { class: "legend" }, ...[["good", c.lgGood], ["care", c.lgCare], ["danger", c.lgDanger], ["bare", c.lgBare]].map(([k, l]) => h("span", {}, h("i", { class: `sw ${k}` }), l)))),
          farmCalendar(r, f, { rain: desktop() }),
          desktop() ? h("p", { class: "small" }, c.rainNote(P.place.name)) : null,
          h("p", { class: "small", style: { marginTop: "auto", display: "flex", gap: "8px", alignItems: "flex-start" } }, icon("i-sat"), r.samples.length > 1 ? c.calNote : c.calNoteReal)),
        h("section", { class: "strats-wrap" }, h("div", { class: "row between" }, h("b", { class: "sec-h" }, c.otherStrats), ids.length ? h("a", { class: "link desk-only", href: "#/probar", style: { fontSize: "14px" } }, c.ideasHint(ids.length)) : null),
          h("div", { class: "strats" }, ...strategies(r).map((s) => stratCard(s, r)))),
        h("section", { class: "card phone-only" }, h("b", {}, c.tipsTitle), tipList(tipsFor(r).slice(0, 4)), h("a", { class: "link", href: "#/terreno" }, c.seePlot)),
        ids.length ? h("a", { class: "tip phone-only", href: "#/probar" }, icon("i-bulb"), h("span", { class: "grow" }, c.ideasHint(ids.length)), icon("i-chev-r")) : null)));
  });
}


/* ---------- why, risks, what we don't know, questions for the agronomist ---------- */
const COAST = (pl) => pl.lat > -5 && pl.lat < 2 && pl.lon > -81.5 && pl.lon < -78.5;
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
// Other strategies, judged on the same years: what the farmer does today and single-plot rotations.
function strategies(r) {
  const c = C(), out = [], seen = new Set([sig(r.farm)]);
  if (r.today) { out.push({ label: c.stratToday, f: r.today }); seen.add(sig(r.today)); }
  let n = 1;
  for (const f of r.others) { if (seen.has(sig(f))) continue; seen.add(sig(f)); out.push({ label: c.stratOption(++n), f }); if (out.length >= 3) break; }
  return out;
}
function sig(f) { return f.parcels.map((p) => p.d.steps.map((s) => s.crop + s.t0).join(",")).join("|"); }
function stratCard(s, r) {
  const f = s.f, N = r.period.length;
  return h("button", { class: "strat", onclick: () => explainSheet(`${s.label}: ${headline(f)}`, f, r) },
    h("small", {}, s.label), h("b", {}, headline(f)), verdictEl(f.verdict),
    h("span", { class: "small" }, `${C().kLoss}: ${frac(f.anyLoss).toLowerCase()} · ${C().kCovered}: ${C().ofMonths(Math.round(f.covered * N), N)}`),
    h("span", { class: "more" }, C().seeWhy, icon("i-chev-r")));
}

/* ---------- the plot ---------- */
function viewTerreno() {
  return withResults((r) => {
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
  if (state.mode === "all") out.push({ icon: "i-cloud-sun", title: c.idDry, why: c.idDryWhy, eff: c.idDryEff, apply: () => { state.undo = { plan: P, mode: "all" }; state.mode = "dry"; render(); } });
  else out.unshift({ icon: "i-cloud-sun", title: c.idAll, why: c.idAllWhy, eff: c.yearsLike[state.mode], on: true, apply: () => { state.mode = "all"; state.undo = null; render(); } });
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
    const byWin = new Map(), no = [];
    for (const id of picked) { const top = r.windows[id].windows[0]; if (!top) { no.push(cap(cropName(id))); continue; } const k = span(top.from, top.to); byWin.set(k, [...(byWin.get(k) || []), cropName(id)]); }
    const reads = [...[...byWin].map(([k, cs]) => c.sowRead(andList(cs), k)), ...no.map((x) => c.sowNo(x))];
    put($("#view"), h("div", { class: "res" },
      resHead(P),
      h("div", { class: "col-left wide" },
        h("div", { class: "res-title" }, h("h1", { class: "display" }, c.tryTitle), h("p", {}, c.tryLead)),
        state.undo ? h("button", { class: "link", style: { alignSelf: "flex-start" }, onclick: () => { setPlan(state.undo.plan); state.mode = state.undo.mode; state.undo = null; render(); } }, icon("i-undo"), " ", c.undo) : null,
        list.length ? h("div", { class: "ideas" }, ...list.map((it) => h("div", { class: `idea${it.on ? " on" : ""}` }, h("span", { class: "ic" }, icon(it.icon)), h("div", { class: "grow" }, h("b", {}, it.title), h("p", {}, it.why), h("em", {}, it.eff)),
          h("button", { class: "btn dark", onclick: it.apply }, it.on ? c.undo : c.tryBtn)))) : h("p", {}, c.noIdeas)),
      h("div", { class: "col-right" },
        h("section", { class: "card sow-card" },
          h("div", { class: "row between wrap" }, h("b", { style: { fontSize: desktop() ? "20px" : "16px" } }, c.sowTitle),
            h("div", { class: "legend" }, ...[["good", c.sowGood], ["care", c.sowCare], ["danger", c.sowBad], ["none", c.sowNone]].map(([k, l]) => h("span", {}, h("i", { class: `sw ${k}` }), l)))),
          h("p", { class: "small" }, c.sowLead),
          h("div", { class: "sow" }, head, h("p", { class: "sow-group" }, c.yours), ...picked.map(sowRow), suggested.length ? h("p", { class: "sow-group" }, c.suggested) : null, ...suggested.slice(0, 3).map(sowRow)),
          reads.length ? h("div", { class: "read", style: { marginTop: "auto" } }, icon("i-info"), h("span", {}, reads.join(" "))) : null))));
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
function viewComparar() {
  return withResults((r) => {
    const c = C(), P = state.plan, rec = r.farm, N = r.period.length;
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
        h("div", { class: "cals2" }, calCard(c.recommended, rec), calCard(c.mine, mine)),
        h("section", { class: "card", style: { padding: "6px 20px" } }, h("table", { class: "cmp" },
          h("thead", {}, h("tr", {}, h("th", {}), h("th", { style: { textAlign: "right" } }, c.recommended), h("th", { style: { textAlign: "right" } }, c.mine))),
          h("tbody", {}, ...rows.map(([l, a, b, va, vb, up]) => { const w = better(va, vb, up); return h("tr", {}, h("th", { scope: "row" }, l), h("td", { class: w < 0 ? "win" : "" }, a), h("td", { class: w > 0 ? "win" : "" }, b)); })))),
        h("div", { class: `conclusion ${score < 0 ? "bad" : score > 0 ? "good" : "even"}` }, icon(score < 0 ? "i-alert" : "i-check"), h("span", {}, [why, score < 0 ? c.recBetter : score > 0 ? c.mineBetter : c.tie].filter(Boolean).join(" "))))));
  });
}

/* ---------- what would have happened ---------- */
function viewPasado() {
  return withResults((r) => {
    const c = C(), per = r.farm.per;
    const lvl = (x) => (x.lostShare >= 0.5 ? "danger" : x.lostShare > 0 || x.loss > 2.5 ? "care" : "good");
    const sel = per.find((x) => x.base === state.pastBase) || per[0];
    const soil = sel.loss > 2.5 ? "high" : sel.loss > 1.2 ? "medium" : "low";
    put($("#view"), h("div", { class: "res", style: { flexDirection: "column" } },
      resHead(state.plan),
      h("div", { class: "res-title" }, h("h1", { class: "display" }, c.pastTitle), h("p", {}, per.length > 1 ? c.pastLead(per.length) : c.pastReal)),
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
  const col = verdict ? { good: "#15803D", care: "#B45309", danger: "#B91C1C" }[verdict] : "#111827";
  if (lotEntity) viewer.entities.remove(lotEntity);
  lotEntity = viewer.entities.add({
    polygon: { height: 0, hierarchy: Cz.Cartesian3.fromDegreesArray([pl.lon - d, pl.lat - d, pl.lon + d, pl.lat - d * 0.9, pl.lon + d * 0.95, pl.lat + d, pl.lon - d * 1.05, pl.lat + d * 0.92]), material: Cz.Color.fromCssColorString(col).withAlpha(0.45), outline: true, outlineColor: Cz.Color.WHITE, outlineWidth: 3 },
    position: Cz.Cartesian3.fromDegrees(pl.lon, pl.lat),
    label: { text: pl.name, font: "700 15px Inter, sans-serif", fillColor: Cz.Color.fromCssColorString("#111827"), showBackground: true, backgroundColor: Cz.Color.WHITE, backgroundPadding: new Cz.Cartesian2(10, 6), pixelOffset: new Cz.Cartesian2(0, -36) },
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
  const tabs = [["plan", c.nav.plan, "i-sprout"], ["terreno", c.nav.plot, "i-pin"], ["probar", c.nav.try, "i-bulb"], ["comparar", c.nav.compare, "i-scale"], ["pasado", c.nav.past, "i-history"]];
  put($("#topbar"), h("div", { class: "row", style: { minWidth: 0 } }, brand(), h("span", { class: "crumb" }, isRes ? `/  ${P.place.name} · ${fmtArea(1)} · ${fmtDate(P.start)} – ${fmtDate(P.end)}` : `/  ${r === "bootcamp" ? c.bootcamp : c.planTitle}`)),
    isRes ? h("nav", { class: "tabs" }, ...tabs.map(([k, l]) => h("a", { href: "#/" + k, "aria-current": r === k ? "page" : null }, l))) : null,
    h("div", { class: "row", style: { gap: "8px" } }, isRes ? h("a", { class: "btn light", href: "#/planear", onclick: () => { state.draft = null; state.sec = null; }, style: { minHeight: "40px", fontSize: "15px" } }, c.changeData) : null, langBtn()));
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
  put($("#view"), loading());
  try { await loadBase(); } catch { put($("#view"), errorCard(C().climateError, start)); return; }
  addEventListener("hashchange", () => { render(); scrollTo(0, 0); $("#view").scrollTo?.(0, 0); });
  let w = desktop(); addEventListener("resize", () => { if (desktop() !== w) { w = desktop(); if (viewer) { viewer.destroy(); viewer = null; lotEntity = null; pickBound = false; } render(); } });
  render();
}
start();
