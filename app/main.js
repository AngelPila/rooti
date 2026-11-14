import { fetchClimate } from "./climate.js?v=13";
import { plan as runPlanner, cropMonths } from "./planner.js?v=13";
import { COPY } from "./copy.js?v=13";
import { STR } from "./i18n.js?v=13";

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
const RESULTS = ["plan", "probar", "comparar", "pasado", "pasaporte"];

/* ---------------- state ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("rooti:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("rooti:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const firstNextMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1); };
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 0);
const state = {
  lang: store.get("lang", "es"),
  plan: store.get("plan3", null),
  priority: store.get("priority", "soil"),
  mode: "all",
  draft: null, custom: null, customKey: null, undo: null, pastBase: undefined, showAll: false, saved: store.get("saved3", null),
};
const EXAMPLE = () => ({ place: { name: "Daule", admin: "Guayas, Ecuador", lat: -1.86, lon: -79.98 }, start: iso(firstNextMonth()), end: iso(addMonths(firstNextMonth(), 12)), crops: ["maize", "soybean", "mulch"], irrigation: false, area: 5.2, unit: "ha" });
// A plan can come in the link: ?lat=-1.86&lon=-79.98&place=Daule&from=2026-12-01&to=2027-11-30&crops=maize+soybean&area=5
{
  const q = new URLSearchParams(location.search);
  if (q.get("lat") && q.get("crops")) {
    state.plan = { place: { name: q.get("place") || `${(+q.get("lat")).toFixed(2)}, ${(+q.get("lon")).toFixed(2)}`, lat: +q.get("lat"), lon: +q.get("lon") },
      start: q.get("from") || iso(firstNextMonth()), end: q.get("to") || iso(addMonths(firstNextMonth(), 12)),
      crops: q.get("crops").split(/[+ ,]/).filter(Boolean), irrigation: q.get("irr") === "1", area: +(q.get("area") || 1), unit: q.get("unit") || "ha" };
  }
  if (q.get("lang")) state.lang = q.get("lang");
}
const DATA = { crops: null, econ: null, fires: {}, clim: {} };
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
  const [crops, econ] = await Promise.all([fetch("data/crops.json?v=13").then(ok), fetch("data/economics.json").then(ok).catch(() => null)]);
  DATA.crops = crops.crops; DATA.econ = econ;
}
function climate(pl) {
  const k = `${pl.lat.toFixed(2)},${pl.lon.toFixed(2)}`;
  return (DATA.clim[k] ||= fetchClimate(pl.lat, pl.lon).catch((e) => { delete DATA.clim[k]; throw e; }));
}
const memo = new Map();
async function results(P = state.plan, mode = state.mode) {
  const c = await climate(P.place), key = JSON.stringify([P, mode, state.priority]);
  if (!memo.has(key)) memo.set(key, { clim: c, P, ...runPlanner(c, DATA.crops, P.crops, { start: P.start.slice(0, 7), end: P.end.slice(0, 7), irrigation: P.irrigation, priority: state.priority, mode }) });
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

/* ================= landing ================= */
function viewLanding() {
  const c = C();
  const sample = h("div", { class: "l-card" }, h("small", { class: "muted" }, c.sampleCard), h("b", { class: "t" }, c.sampleTitle),
    h("div", { class: "cal", style: { "--lab": "48px" } },
      h("div", { class: "cal-row cal-head" }, h("span"), h("div", { class: "cal-grid", style: { "--n": 12 } }, ...S().months.map((m) => h("span", {}, m)))),
      ...[[S().crops.potato, [[1, 4, "2,6 ha", "good"], [5, 4, "2,4 ha", "good"], [9, 4, "2,6 ha", "good"]]], [S().crops.maize, [[1, 4, "2,4 ha", "good"], [5, 4, "2,6 ha", "care"], [9, 4, "2,4 ha", "good"]]]].map(([n, bars]) =>
        h("div", { class: "cal-row" }, h("span", { class: "cal-name" }, n), h("div", { class: "cal-grid", style: { "--n": 12 } }, ...bars.map(([a, l, t, lv]) => h("div", { class: `bar ${lv}`, style: { gridColumn: `${a} / span ${l}`, height: "26px" } }, h("b", {}, t))))))),
    h("span", { class: "verdict v-good", style: { fontSize: "14px" } }, c.sampleVerdict));
  const start = () => { state.draft = null; go("planear"); };
  const example = () => { setPlan(EXAMPLE()); memo.clear(); go("plan"); };
  put($("#view"), h("div", { class: "landing" },
    h("nav", { class: "l-nav" }, brand(), h("div", { class: "l-links" },
      h("a", { class: "txt", href: "#how" }, c.nav.how), h("a", { class: "txt", href: "#data" }, c.nav.data), langBtn(),
      h("button", { class: "btn dark", onclick: start }, c.cta))),
    h("section", { class: "l-hero" },
      h("div", { class: "l-photo" }, h("img", { src: "img/rice.jpg", alt: es() ? "Arrozal" : "Rice field" }), sample),
      h("div", { class: "l-copy" },
        h("h1", { class: "display" }, c.heroTitle), h("p", { class: "lead" }, c.heroLead),
        h("ul", { class: "l-steps l-steps-phone" }, ...c.steps.map(([ic, t]) => h("li", {}, stepIcon(ic), t))),
        h("div", { class: "l-acts" }, h("button", { class: "btn dark big", onclick: start }, c.cta, icon("i-arrow-r")), h("button", { class: "link", onclick: example }, c.example)),
        h("p", { class: "l-note" }, c.heroNote))),
    h("section", { class: "l-band", id: "how" },
      ...c.steps.map(([ic, t, d]) => h("div", {}, stepIcon(ic), h("span", {}, h("b", {}, t), h("p", {}, d)))),
      h("div", { class: "data", id: "data" }, h("b", {}, c.dataTitle), h("p", {}, c.dataText))),
    h("p", { class: "l-credit" }, "Foto: “Oryza sativa in Kadavoor”, Jeevan Jose, CC BY-SA 4.0")));
}

/* ================= planner ================= */
function draft() {
  if (!state.draft) {
    const P = state.plan, s = firstNextMonth();
    state.draft = P ? JSON.parse(JSON.stringify(P)) : { place: null, start: iso(s), end: iso(addMonths(s, 12)), crops: [], irrigation: false, area: 1, unit: "ha" };
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
const quickDates = (d, redo) => h("div", { class: "row wrap", style: { gap: "8px" } }, ...C().quick.map(([k, l]) => { const s = new Date(d.start + "T12:00:00");
  return h("button", { class: "chip", "aria-pressed": String(monthsIn(d) === +k), onclick: () => { d.end = iso(addMonths(s, +k)); redo(); } }, l); }));
const dateFields = (d, redo) => h("div", { class: "dates" }, ...[["start", C().from], ["end", C().to]].map(([k, l]) =>
  h("label", { class: "date" }, h("small", {}, l), h("input", { type: "date", value: d[k], onchange: (e) => { d[k] = e.target.value; redo(); } }))));
const kind = (id) => (id === "mulch" ? C().kindCover : DATA.crops[id]?.n_fixing ? C().kindLegume : C().kindCash);
function cropTiles(d, redo, limit) {
  const all = CROP_ORDER.filter((id) => id === "mulch" || DATA.crops[id]);
  const shown = limit && !state.showAll ? all.filter((id, i) => i < limit || d.crops.includes(id)) : all;
  return [h("div", { class: "crops" }, ...shown.map((id) => { const on = d.crops.includes(id);
    return h("button", { class: "crop", "aria-pressed": String(on), onclick: () => { d.crops = on ? d.crops.filter((x) => x !== id) : [...d.crops, id]; redo(); } },
      on ? icon("i-check", "icon tick") : null, h("b", {}, cap(cropName(id))), h("small", {}, kind(id) + (id !== "mulch" ? ` · ${cropMonths(DATA.crops[id])} ${es() ? "meses" : "months"}` : ""))); })),
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
const irrigOpts = (d, redo) => h("div", { class: "opts" }, ...[[false, C().no], [true, C().yes]].map(([v, l]) => h("button", { class: "opt", "aria-pressed": String(d.irrigation === v), onclick: () => { d.irrigation = v; redo(); } }, l)));
const prioOpts = (redo, short) => h("div", { class: "opts" }, ...[["soil", "i-sprout"], ["income", "i-coin"], ["water", "i-drops"]].map(([v, ic]) => h("button", { class: "opt", "aria-pressed": String(state.priority === v), onclick: () => { state.priority = v; store.set("priority", v); memo.clear(); redo(); } }, icon(ic), short ? C().prioShort[v] : C().prio[v])));
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
    body = [title(c.landQ, c.landHelp), areaBox(d, redo), h("div", { class: "q" }, h("b", {}, c.irrigQ), irrigOpts(d, redo)), h("div", { class: "q" }, h("b", {}, c.prioQ), prioOpts(redo, true)), h("div", { class: "spacer" }),
      nextBtn(ready ? c.seePlan : !d.place ? c.pickPlace : err || c.pickCrop, true, () => (ready ? submitPlan() : go(!d.place ? "planear/1" : err ? "planear/2" : "planear/3")))];
  }
  put($("#view"), h("div", { class: "step" }, head, ...body));
}
function planDesktop(d) {
  const c = C(), err = dateErr(d), redo = () => planDesktop(d);
  const pick = (pl) => { d.place = pl; redo(); updateMap(pl, null); };
  state.onPick = async (lat, lon) => pick(await placeAt(lat, lon));
  put($("#map-overlay"), h("div", { class: "map-search" }, ...searchBox(pick)), h("div", { class: "map-hint" }, icon("i-pointer"), c.clickMap));
  const okAll = d.place && d.crops.length && !err;
  put($("#view"), h("div", { class: "plan-panel" },
    h("h1", { class: "display" }, c.planTitle),
    h("div", { class: "q" }, h("b", {}, c.where), d.place ? placeCard(d, null) : h("p", { class: "small" }, c.clickMap), gpsBtn(pick)),
    h("div", { class: "q" }, h("b", {}, c.when), dateFields(d, redo), h("div", { class: "row between wrap" }, quickDates(d, redo), h("span", { class: err ? "err" : "small" }, err || c.months(monthsIn(d)))), periodStrip(d)),
    h("div", { class: "q" }, h("b", {}, c.what), ...cropTiles(d, redo, 0)),
    h("div", { class: "q" }, h("b", {}, c.land), h("div", { class: "row-fields" },
      h("input", { class: "num", type: "number", min: "0", step: "any", value: String(d.area), "aria-label": c.landQ, onchange: (e) => { const v = parseFloat(e.target.value); if (v > 0) { d.area = v; redo(); } } }),
      h("div", { class: "seg" }, ...Object.keys(UNITS).map((u) => h("button", { "aria-pressed": String(d.unit === u), onclick: () => { d.unit = u; redo(); } }, c.units[u]))),
      h("div", { class: "seg" }, ...[[false, c.irrig.no], [true, c.irrig.yes]].map(([v, l]) => h("button", { "aria-pressed": String(d.irrigation === v), onclick: () => { d.irrigation = v; redo(); } }, l))))),
    h("div", { class: "q" }, h("b", {}, c.prioQ), prioOpts(redo, false)),
    h("button", { class: "btn dark big block", disabled: !okAll, onclick: submitPlan }, okAll ? [c.seePlan, icon("i-arrow-r")] : !d.place ? c.pickPlace : err || c.pickCrop)));
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
function farmCalendar(r, f, { compact = false, rain = false } = {}) {
  const N = r.period.length, size = desktop() && !compact ? (N <= 24 ? N : 12) : 12, n1 = r.samples.length;
  const pls = plantingsOf(f);
  const keys = [...new Set(f.grid.flatMap((g) => Object.keys(g)))].sort((a, b) => (a === "bare") - (b === "bare") || (a === "mulch") - (b === "mulch") || f.grid.findIndex((g) => g[a]) - f.grid.findIndex((g) => g[b]));
  const mx = Math.max(1, ...Array.from({ length: 12 }, (_, i) => normalRain(r.clim, i + 1)));
  const blocks = [];
  for (let a = 0; a < N; a += size) {
    const b = Math.min(N, a + size), n = b - a, months = r.period.slice(a, b), wide = desktop() && !compact && n <= 14;
    const head = h("div", { class: "cal-row cal-head" }, h("span"), h("div", { class: "cal-grid", style: { "--n": n } }, ...months.map((p, i) =>
      h("span", {}, wide ? (i === 0 || p.m === 1 ? `${mon(p.m)} ${String(p.y).slice(2)}` : mon(p.m)) : S().months[p.m - 1]))));
    const rows = keys.filter((k) => months.some((_, i) => f.grid[a + i][k]?.share > 0.001)).flatMap((k) => {
      let items;
      if (k === "bare" || k === "mulch") {
        // Bare soil and straw: consecutive months merged, labelled with the most land they take.
        items = [];
        for (let t = a; t < b; t++) { const cc = f.grid[t][k]; if (!cc || cc.share < 0.001) continue; const last = items[items.length - 1];
          if (last && last.t1 === t - 1) { last.t1 = t; last.share = Math.max(last.share, cc.share); last.ls.push(...cc.levels); } else items.push({ t0: t, t1: t, share: cc.share, ls: [...cc.levels] }); }
        return [h("div", { class: "cal-row" }, h("span", { class: "cal-name" }, k === "bare" ? C().bare : cap(cropName(k))),
          h("div", { class: "cal-grid", style: { "--n": n } }, ...items.map((s) => h("button", { class: `bar ${k === "bare" ? "bare" : "straw"}`, style: { gridColumn: `${s.t0 - a + 1} / span ${s.t1 - s.t0 + 1}` }, onclick: () => barSheet(r, f, k, s, null) },
            h("b", {}, fmtArea(s.share)), k === "mulch" ? h("small", {}, C().coversSoil) : null))))];
      }
      // Crops: one bar per planting, for its whole duration; plantings of the same crop that overlap go on separate lanes.
      const groups = [];
      for (const p of pls.filter((p) => p.crop === k && p.t1 > a && p.t0 < b)) { const g = groups.find((x) => x.t0 === p.t0 && x.t1 === p.t1); if (g) { g.share += p.share; g.pl.push(p); } else groups.push({ t0: p.t0, t1: p.t1, share: p.share, pl: [p] }); }
      const lanes = [];
      for (const g of groups.sort((x, y) => x.t0 - y.t0)) { let L = lanes.find((ln) => ln[ln.length - 1].t1 <= g.t0); if (!L) lanes.push(L = []); L.push(g); }
      return lanes.map((ln, li) => h("div", { class: "cal-row" }, h("span", { class: "cal-name" }, li === 0 ? cap(cropName(k)) : ""),
        h("div", { class: "cal-grid", style: { "--n": n } }, ...ln.map((g) => {
          const pl = g.pl[0], s0 = Math.max(a, g.t0), s1 = Math.min(b, g.t1) - 1, lv = pl.fail >= 0.5 ? "danger" : pl.fail > 0.15 || pl.yld < 0.6 ? "care" : "good";
          return h("button", { class: `bar ${lv}`, style: { gridColumn: `${s0 - a + 1} / span ${s1 - s0 + 1}` }, title: `${cap(cropName(k))} · ${fmtArea(g.share)} · ${span(r.period[g.t0], r.period[g.t1 - 1])}`, onclick: () => barSheet(r, f, k, { share: g.share, t0: g.t0, t1: g.t1 - 1 }, pl) },
            h("b", {}, fmtArea(g.share)), s0 === g.t0 ? h("small", {}, outcomeShort(pl, n1)) : null);
        }))));
    });
    const rainRow = rain ? h("div", { class: "cal-row rain-row" }, h("span", { class: "cal-name" }, C().rain, h("br"), h("small", { style: { fontWeight: 400, fontSize: "12px", color: "var(--ink2)" } }, C().rainUnit)),
      h("div", { class: "cal-grid", style: { "--n": n } }, ...months.map((p) => { const v = normalRain(r.clim, p.m);
        return h("div", { class: "rain-col" }, h("span", {}, String(Math.round(v))), h("i", { style: { height: `${Math.max(3, (v / mx) * 110)}px` } })); }))) : null;
    blocks.push(h("div", { class: "cal-block" }, head, ...rows, rainRow));
  }
  return h("div", { class: `cal${compact ? " compact" : ""}` }, ...blocks);
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
const miniMap = (pl) => { const d = 0.006, bb = [pl.lon - d * 2.6, pl.lat - d, pl.lon + d * 2.6, pl.lat + d].join(",");
  return h("div", { class: "mini-map desk-only" }, h("img", { alt: "", loading: "lazy", src: `${ESRI}/export?bbox=${bb}&bboxSR=4326&size=800,300&format=jpg&f=image` }), h("i")); };
const resHead = (P) => h("div", { class: "res-head" }, h("div", { class: "grow" }, h("b", {}, `${P.place.name} · ${fmtArea(1)}`), h("small", {}, `${fmtDate(P.start)} – ${fmtDate(P.end)}`)),
  h("a", { class: "btn", href: "#/planear", onclick: () => { state.draft = null; } }, C().change));
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
        miniMap(P.place),
        h("section", { class: "card answer" },
          h("p", { class: "lbl" }, c.best), h("h2", { class: "display" }, headline(f)), verdictEl(f.verdict), kpis(f, r),
          h("div", { class: "desk-only", style: { display: "flex", flexDirection: "column", gap: "10px" } }, h("b", { style: { fontSize: "15px" } }, c.landEach), landList(f)),
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
        ids.length ? h("div", { class: "ideas-row desk-only" }, ...ids.slice(0, 3).map((it) => h("a", { href: "#/probar" }, icon(it.icon), h("div", { class: "grow" }, h("b", {}, it.title), h("small", {}, it.eff)), h("u", {}, c.tryBtn)))) : null,
        ids.length ? h("a", { class: "tip phone-only", href: "#/probar" }, icon("i-bulb"), h("span", { class: "grow" }, c.ideasHint(ids.length)), icon("i-chev-r")) : null)));
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
  if (!P.crops.some((id) => DATA.crops[id]?.n_fixing)) { const leg = Object.values(r.windows).filter((w) => DATA.crops[w.id]?.n_fixing && !GREEN.has(w.id) && !P.crops.includes(w.id)).sort((a, b) => (b.best?.value ?? 0) - (a.best?.value ?? 0))[0];
    if (leg && (leg.best?.value ?? 0) >= 0.5) cand.push({ icon: "i-leaf", title: c.idLegume(cropName(leg.id)), why: c.idLegumeWhy, P2: { ...P, crops: [...P.crops, leg.id] } }); }
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
    const sowRow = (id) => { const w = r.windows[id];
      return h("div", { class: "sow-row", style: { "--lab": lab } }, h("b", { style: { fontSize: desktop() ? "16px" : "13px" } }, cap(cropName(id))),
        h("div", { class: "sow-cells", style: { "--n": N } }, ...w.starts.map((s, t) => h("i", { class: s ? s.level : "none", title: s ? `${ym(r.period[t])}: ${Math.round(s.value * 100)} %` : c.sowNone }, s && w.best && s.t === w.best.t && w.best.level !== "danger" ? "★" : "")))); };
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
    if (!state.custom || state.customKey !== JSON.stringify(P)) { state.custom = customFrom(rec); state.customKey = JSON.stringify(P); }
    const K = state.custom, redo = () => viewComparar();
    const mine = r.evalFarm(K.map((pc) => ({ share: (+pc.area || 0) / (P.area || 1), steps: pc.steps })));
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
          h("button", { class: "link", onclick: () => { state.custom = customFrom(rec); redo(); } }, c.reset)),
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
  return { r: ["", "planear", ...RESULTS].includes(r) ? r : "", arg };
}
function renderChrome(r) {
  const c = C(), P = state.plan, isRes = RESULTS.includes(r);
  document.body.className = [`r-${r || "landing"}`, r ? "app-route" : "", isRes ? "results" : ""].filter(Boolean).join(" ");
  document.documentElement.lang = state.lang;
  const tabs = [["plan", c.nav.plan, "i-sprout"], ["probar", c.nav.try, "i-bulb"], ["comparar", c.nav.compare, "i-scale"], ["pasado", c.nav.past, "i-history"]];
  put($("#topbar"), h("div", { class: "row", style: { minWidth: 0 } }, brand(), h("span", { class: "crumb" }, isRes ? `/  ${P.place.name} · ${fmtArea(1)} · ${fmtDate(P.start)} – ${fmtDate(P.end)}` : `/  ${c.planTitle}`)),
    isRes ? h("nav", { class: "tabs" }, ...tabs.map(([k, l]) => h("a", { href: "#/" + k, "aria-current": r === k ? "page" : null }, l))) : null,
    h("div", { class: "row", style: { gap: "8px" } }, isRes ? h("a", { class: "btn light", href: "#/planear", onclick: () => { state.draft = null; }, style: { minHeight: "40px", fontSize: "15px" } }, c.changeData) : null, langBtn()));
  put($("#bottom-nav"), ...tabs.map(([k, l, ic]) => h("a", { href: "#/" + k, "aria-current": r === k ? "page" : null }, icon(ic), l)));
  if (r !== "planear") put($("#map-overlay"));
}
async function render() {
  const { r, arg } = route();
  renderChrome(r);
  const views = { "": viewLanding, planear: () => viewPlanear(arg), plan: viewPlan, probar: viewProbar, comparar: viewComparar, pasado: viewPasado, pasaporte: viewPasaporte };
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
