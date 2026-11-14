import { fetchClimate } from "./climate.js?v=8";
import { plan as runPlanner, cropMonths } from "./planner.js?v=8";
import { STR } from "./i18n.js?v=8";

const CESIUM = "https://cdn.jsdelivr.net/npm/cesium@1.123.0/Build/Cesium/";
const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";
const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const REV = "https://nominatim.openstreetmap.org/reverse";
const ROUTES = ["inicio", "resultado", "porque", "pasado", "pasaporte"];
const PILOTS = { daule: [-1.86, -79.98], babahoyo: [-1.80, -79.53], quevedo: [-1.03, -79.46] };
const EXAMPLES = [
  { name: "Daule", admin: "Guayas, Ecuador", lat: -1.86, lon: -79.98 },
  { name: "Quevedo", admin: "Los Ríos, Ecuador", lat: -1.03, lon: -79.46 },
  { name: "Madrid", admin: "España", lat: 40.42, lon: -3.70 },
];
const CROP_ORDER = ["rice", "maize", "soybean", "peanut", "common_bean", "cowpea", "sorghum", "wheat", "barley", "potato", "sunflower", "chickpea", "jack_bean", "velvet_bean", "mulch"];
const LEVEL_ICON = { good: "i-check", care: "i-minus", danger: "i-x" };

const store = {
  get(k, d) { try { const v = localStorage.getItem("rooti:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("rooti:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const state = {
  lang: store.get("lang", matchMedia("(min-width: 1024px)").matches ? "en" : "es"),
  plan: store.get("plan2", null),
  draft: null,
  mode: "all",
  priority: store.get("priority", "soil"),
  pastPlan: 0, pastSample: null,
  saved: store.get("saved2", null),
};
// A plan can come in the link: ?lat=-1.86&lon=-79.98&from=2026-12-01&to=2028-06-30&crops=maize+soybean+mulch&place=Daule
{
  const q = new URLSearchParams(location.search);
  if (q.get("lat") && q.get("crops")) {
    state.plan = { place: { name: q.get("place") || `${(+q.get("lat")).toFixed(2)}, ${(+q.get("lon")).toFixed(2)}`, lat: +q.get("lat"), lon: +q.get("lon") },
      start: q.get("from") || iso(today), end: q.get("to") || iso(new Date(today.getFullYear() + 1, today.getMonth(), 28)),
      crops: q.get("crops").split(/[+ ,]/).filter(Boolean), irrigation: q.get("irr") === "1" };
  }
}
const DATA = { crops: null, econ: null, fires: {}, clim: {} };
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
function ok(r) { if (!r.ok) throw new Error(r.status); return r.json(); }

/* ---------------- words ---------------- */
const cropName = (id) => T().crops[id] || DATA.crops?.[id]?.[es() ? "name_es" : "name_en"] || id;
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const monShort = (m) => T().monthsLong[m - 1].slice(0, 3);
const ym = (p) => `${monShort(p.m)} ${p.y}`;
const span = (a, b) => (a.y === b.y ? `${monShort(a.m)}–${monShort(b.m)} ${a.y}` : `${ym(a)} – ${ym(b)}`);
const fmtDate = (s) => new Date(s + "T12:00:00").toLocaleDateString(state.lang, { day: "numeric", month: "short", year: "numeric" });
const planName = (p) => {
  if (!p.steps.length) return T().nothing;
  if (p.steps.length <= 3) return p.steps.map((s) => cropName(s.crop)).join(" → ");
  return `${p.crops.map(cropName).join(" · ")} (${T().plantings(p.steps.length)})`;
};
const nearPilot = (pl) => Object.entries(PILOTS).find(([, [la, lo]]) => Math.hypot(la - pl.lat, lo - pl.lon) * 111 < 40)?.[0] || null;

/* ---------------- data ---------------- */
async function loadBase() {
  const [crops, econ] = await Promise.all([fetch("data/crops.json?v=8").then(ok), fetch("data/economics.json").then(ok).catch(() => null)]);
  DATA.crops = crops.crops; DATA.econ = econ;
}
async function climate(pl) {
  const k = `${pl.lat.toFixed(2)},${pl.lon.toFixed(2)}`;
  return (DATA.clim[k] ||= fetchClimate(pl.lat, pl.lon).catch((e) => { delete DATA.clim[k]; throw e; }));
}
const memo = new Map();
async function results() {
  const P = state.plan, c = await climate(P.place);
  const key = JSON.stringify([P, state.mode, state.priority]);
  if (!memo.has(key)) memo.set(key, { clim: c, ...runPlanner(c, DATA.crops, P.crops, { start: P.start.slice(0, 7), end: P.end.slice(0, 7), irrigation: P.irrigation, priority: state.priority, mode: state.mode }) });
  return memo.get(key);
}
async function fireData(z) { if (!(z in DATA.fires)) DATA.fires[z] = await fetch(`data/fires_${z}.json`).then(ok).catch(() => null); return DATA.fires[z]; }

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
const listenBtn = (text) => ("speechSynthesis" in window ? h("button", { class: "round", "aria-label": T().listen, onclick: () => speak(text()) }, icon("i-volume")) : null);

/* ---------------- shell ---------------- */
function route() {
  const [r, arg] = location.hash.replace("#/", "").split("/");
  return { r: ROUTES.includes(r) && (r === "inicio" || state.plan) ? r : state.plan ? "resultado" : "inicio", arg };
}
const go = (r) => { location.hash = "#/" + r; };
function renderNav(active) {
  const nav = [["inicio", "i-search", "plan"], ["resultado", "i-sprout", "result"], ["pasado", "i-history", "past"]];
  if (state.plan && nearPilot(state.plan.place)) nav.push(["pasaporte", "i-badge", "passport"]);
  const links = (tab) => nav.map(([r, ic, k]) => h("a", { href: "#/" + r, "aria-current": active === r ? "page" : null }, tab ? null : icon(ic), T().nav[k]));
  put($("#tabs"), links(true));
  put($("#bottom-nav"), links(false));
  $("#bottom-nav").style.gridTemplateColumns = `repeat(${nav.length}, 1fr)`;
  document.body.classList.toggle("first", !state.plan);
  $("#bottom-nav").classList.toggle("hidden", !state.plan);
}
function langToggle() {
  return h("button", { class: "pill", "aria-label": "Idioma / Language", onclick: () => { state.lang = es() ? "en" : "es"; store.set("lang", state.lang); render(); } }, es() ? "ES | EN" : "EN | ES");
}
function sheet(...kids) {
  const d = $("#sheet");
  put(d, h("div", { class: "sheet-body" }, ...kids, h("button", { class: "btn block", onclick: () => d.close() }, T().close)));
  d.showModal();
}
function choiceSheet(title, options, current, onPick) {
  sheet(h("h2", { class: "h2" }, title), ...options.map(([v, label]) => h("button", { class: "choice-row", "aria-pressed": String(v === current), onclick: () => { $("#sheet").close(); onPick(v); } }, label, v === current ? icon("i-check") : null)));
}
const skeleton = (msg) => [h("p", { class: "small loading-msg" }, msg || ""), h("div", { class: "skeleton", style: "height:120px" }), h("div", { class: "skeleton", style: "height:260px" }), h("div", { class: "skeleton", style: "height:200px" })];
const errorCard = (retry, msg) => h("div", { class: "errorcard", role: "alert" }, icon("i-wifi-off"), h("b", { style: "flex:1" }, msg || T().loadError), h("button", { class: "btn", onclick: retry }, T().retry));

/* ---------------- plan: where, when, what ---------------- */
function viewPlan() {
  const v = $("#view"); v.className = "view plan-view";
  const P = state.plan;
  const d = (state.draft ||= { place: P?.place || null, start: P?.start || iso(today), end: P?.end || iso(new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())), crops: [...(P?.crops || [])], irrigation: !!P?.irrigation });
  const redo = () => viewPlan();
  const months = Math.round((new Date(d.end) - new Date(d.start)) / (30.44 * 864e5));
  const dateErr = !(months >= 2) ? T().tooShort : months > 72 ? T().tooLong : null;
  const okAll = d.place && d.crops.length && !dateErr;
  const kind = (id) => (id === "mulch" ? T().kindCover : DATA.crops[id]?.n_fixing ? T().kindLegume : T().kindCash);
  const pick = (pl) => { d.place = pl; redo(); updateMap(pl, null); };
  const submit = () => {
    state.plan = { ...d, crops: [...d.crops] }; store.set("plan2", state.plan);
    state.draft = null; state.pastPlan = 0; state.pastSample = null; memo.clear(); go("resultado");
  };

  // where
  const results = h("div", { class: "geo-results" });
  const input = h("input", { type: "search", placeholder: T().searchAny, "aria-label": T().searchAny, autocomplete: "off" });
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return put(results);
    timer = setTimeout(async () => {
      try {
        const r = await fetch(`${GEO}?name=${encodeURIComponent(q)}&count=6&language=${state.lang}&format=json`).then(ok);
        put(results, ...(r.results || []).map((x) => h("button", { class: "geo-row", onclick: () => pick({ name: x.name, admin: [x.admin1, x.country].filter(Boolean).join(", "), lat: x.latitude, lon: x.longitude }) },
          icon("i-pin"), h("span", {}, h("b", {}, x.name), h("small", {}, [x.admin1, x.country].filter(Boolean).join(", "))))));
        if (!r.results?.length) put(results, h("p", { class: "small" }, T().noPlace));
      } catch { put(results, h("p", { class: "small" }, T().loadError)); }
    }, 300);
  });
  const gps = h("button", { class: "btn", onclick: () => {
    if (!navigator.geolocation) return;
    gps.disabled = true;
    navigator.geolocation.getCurrentPosition(async (p) => { pick(await placeAt(p.coords.latitude, p.coords.longitude)); }, () => { gps.disabled = false; }, { timeout: 10000 });
  } }, icon("i-locate"), T().imHere);
  state.onPick = async (lat, lon) => pick(await placeAt(lat, lon));

  const where = d.place
    ? h("div", { class: "place-row" }, icon("i-pin"), h("span", {}, h("b", {}, d.place.name), h("small", {}, [d.place.admin, `${d.place.lat.toFixed(2)}, ${d.place.lon.toFixed(2)}`].filter(Boolean).join(" · "))),
        h("button", { class: "text-btn", onclick: () => { d.place = null; redo(); } }, T().change))
    : h("div", { class: "where-pick" }, h("label", { class: "search" }, icon("i-search"), input), results,
        h("div", { class: "row wrap", style: "gap:8px" }, gps, desktop() ? h("span", { class: "small" }, T().tapMapAny) : null),
        h("p", { class: "small" }, T().examples, " ", ...EXAMPLES.flatMap((x, i) => [i ? " · " : "", h("button", { class: "text-btn", onclick: () => pick(x) }, x.name)])));

  const dateIn = (key) => h("label", { class: "date" }, h("small", {}, key === "start" ? T().from : T().to),
    h("input", { type: "date", value: d[key], onchange: (e) => { d[key] = e.target.value; redo(); } }));

  put(v,
    h("div", { class: "row between" }, h("div", { class: "row", style: "gap:8px" }, h("span", { class: "logo" }, icon("i-sprout")), h("b", { style: "font-size:22px" }, "Rooti")), langToggle()),
    h("div", { class: "find-copy" }, h("h1", { class: "h1" }, T().planTitle), h("p", { class: "lead" }, T().planLead)),
    h("section", { class: "step" }, h("h2", { class: "step-h" }, T().where), where),
    h("section", { class: "step" }, h("h2", { class: "step-h" }, T().when),
      h("div", { class: "dates" }, dateIn("start"), dateIn("end")),
      h("p", { class: `small${dateErr ? " err" : ""}` }, dateErr || T().monthsCount(months))),
    h("section", { class: "step" }, h("h2", { class: "step-h" }, T().what, h("span", { class: "hint" }, T().whatHint)),
      h("div", { class: "crop-grid" }, ...CROP_ORDER.filter((id) => id === "mulch" || DATA.crops[id]).map((id) => h("button", { class: "crop", "aria-pressed": String(d.crops.includes(id)),
        onclick: () => { d.crops = d.crops.includes(id) ? d.crops.filter((x) => x !== id) : [...d.crops, id]; redo(); } },
        h("b", {}, cap(cropName(id))), h("small", {}, kind(id) + (id !== "mulch" ? ` · ${cropMonths(DATA.crops[id])} ${T().mo}` : "")), d.crops.includes(id) ? icon("i-check", "icon tick") : null)))),
    h("section", { class: "step" }, h("h2", { class: "step-h" }, T().qIrrigation),
      h("div", { class: "pick-row two" }, ...[[false, T().no], [true, T().yes]].map(([val, l]) => h("button", { class: "pick", "aria-pressed": String(d.irrigation === val), onclick: () => { d.irrigation = val; redo(); } }, h("b", {}, l))))),
    h("button", { class: "btn primary block go", disabled: !okAll, onclick: submit },
      okAll ? T().seeResults(d.crops.length) : !d.place ? T().pickPlace : dateErr ? dateErr : T().pickCrop));
  if (desktop()) { initCesium($("#cesium"), { pick: true }); if (d.place) updateMap(d.place, null); }
}
async function placeAt(lat, lon) {
  const base = { name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon };
  try {
    const r = await fetch(`${REV}?lat=${lat}&lon=${lon}&format=json&zoom=10&accept-language=${state.lang}`).then(ok);
    const a = r.address || {};
    return { ...base, name: a.village || a.town || a.city || a.county || a.state || base.name, admin: [a.state, a.country].filter(Boolean).join(", ") };
  } catch { return base; }
}

/* ---------------- results ---------------- */
function controls() {
  const modes = [["all", T().modeAll], ["dry", T().modeDry], ["wet", T().modeWet], ["nino", T().modeNino]];
  const pri = [["soil", T().priority.soil], ["water", T().priority.water], ["income", T().priority.income]];
  const chip = (opts, cur, title, onPick) => h("button", { class: "chip big", onclick: () => choiceSheet(title, opts, cur, onPick) }, opts.find(([v]) => v === cur)[1], icon("i-chev-d"));
  return h("div", { class: "chips" },
    chip(modes, state.mode, T().yearQ, (v) => { state.mode = v; render(); }),
    chip([[false, T().irrigation.no], [true, T().irrigation.yes]], state.plan.irrigation, T().qIrrigation, (v) => { state.plan = { ...state.plan, irrigation: v }; store.set("plan2", state.plan); render(); }),
    chip(pri, state.priority, T().priorityQ, (v) => { state.priority = v; store.set("priority", v); render(); }));
}
// Calendar as one row per year, so a plan of any length reads like a wall calendar.
function yearRows(p, compact = false) {
  const byY = {};
  for (const m of p.months) (byY[m.y] ||= []).push(m);
  return h("div", { class: `yr-cal${compact ? " compact" : ""}` },
    compact ? null : h("div", { class: "yr-row head" }, h("span", { class: "yr-y" }), h("div", { class: "yr-m letters" }, ...T().months.map((l) => h("span", {}, l)))),
    ...Object.entries(byY).map(([y, ms]) => {
      const spans = [];
      for (const m of ms) { const k = m.crop || "bare", last = spans[spans.length - 1]; if (last && last.k === k && last.ms[last.ms.length - 1].m === m.m - 1) last.ms.push(m); else spans.push({ k, ms: [m] }); }
      return h("div", { class: "yr-row" }, h("span", { class: "yr-y" }, y),
        h("div", { class: "yr-m" }, ...spans.map((sp) => h("div", { class: "tl-span", style: `grid-column: ${sp.ms[0].m} / span ${sp.ms.length}` },
          h("div", { class: "tl-fill" }, ...sp.ms.map((m) => h("button", { class: `tl-m ${m.level}${m.obs ? " obs" : ""}`, "aria-label": `${T().monthsLong[m.m - 1]} ${m.y}: ${fieldName(sp.k)}, ${T().level[m.level]}`, onclick: (e) => { e.stopPropagation(); openMonth(p, m); } }))),
          h("span", { class: `tl-lbl${sp.ms.length < 2 ? " short" : ""}` }, fieldName(sp.k))))));
    }));
}
const fieldName = (k) => (k === "bare" ? T().bareShort : k === "mulch" ? T().mulchShort : cropName(k));
function openMonth(p, m) {
  const what = m.crop ? fieldName(m.crop) : T().bareShort;
  sheet(h("p", { class: "small" }, planName(p)),
    h("h2", { class: "h2" }, `${cap(T().monthsLong[m.m - 1])} ${m.y}: ${T().level[m.level]}`),
    h("p", { style: "font-size:18px" }, `${what}. ${T().cause[m.kind] || ""}.`),
    h("p", { class: "small" }, m.crop && m.crop !== "mulch" ? T().rainVsNeed(m.rain, m.need) : T().rainOnly(m.rain)),
    h("p", { class: "small" }, m.obs ? T().realMonth : T().simMonth(Math.round(m.badShare * 100))));
}
const stepLevel = (s) => (s.fail >= 0.5 ? "danger" : s.fail > 0.15 || s.yld < 0.6 ? "care" : "good");
const stepOutcome = (s) => (s.obs || s.n === 1 ? (s.lost ? T().wasLost : T().wasHarvested(Math.round(s.yld * 100))) : T().harvestIn(s.n - s.lost, s.n, Math.round(s.yld * 100)));
function stepLine(s) {
  return h("li", { class: "step-line compact" }, h("i", { class: `sw-flat ${stepLevel(s)}` }),
    h("b", {}, `${cap(cropName(s.crop))}`), h("span", { class: "when" }, span(s.from, s.to)),
    h("span", { class: "res" }, s.obs ? T().shortReal(s.lost, Math.round(s.yld * 100)) : T().shortSim(s.n - s.lost, s.n, Math.round(s.yld * 100))));
}
function verdictLine(p) {
  const v = p.verdict;
  return h("p", { class: `verdict ${v}` }, h("i", { class: `sw-flat ${v}` }), T().verdictPlan[v]);
}
function planPanel(p, i, big) {
  return h("section", { class: `panel answer${big ? "" : " other"}` },
    h("p", { class: "label" }, big ? T().recommended : `${T().option} ${i + 1}`),
    h("h2", { class: big ? "answer-h" : "panel-h" }, planName(p)),
    verdictLine(p),
    h("p", { class: "facts" }, T().facts(Math.round(p.harvests * 10) / 10, p.covered, p.months.length)),
    big && p.steps.length ? h("ul", { class: "steps" }, ...p.steps.map(stepLine)) : null,
    yearRows(p, !big),
    h("div", { class: "row answer-actions" },
      h("a", { class: "btn", href: `#/porque/${p.i}` }, T().whyLink, icon("i-chev-r")),
      h("a", { class: "link", href: "#/pasado", onclick: () => { state.pastPlan = p.i; state.pastSample = null; } }, T().pastTitle),
      big ? h("button", { class: "text-btn", onclick: () => { state.saved = { name: planName(p), place: state.plan.place.name, at: Date.now() }; store.set("saved2", state.saved); render(); } }, state.saved?.name === planName(p) ? T().saved : T().save) : null));
}
function dataNote(r) {
  const s = r.samples, obsTo = r.clim.last, fut = s.length > 1 || s[0]?.base != null;
  const [ly, lm] = obsTo.split("-").map(Number);
  return h("p", { class: "small data-note" }, icon("i-sat"), " ",
    fut ? T().noteMixed(ym({ y: ly, m: lm }), s.length) : T().noteReal, " ", T().notePower);
}
async function viewResult() {
  const v = $("#view"); v.className = "view";
  const P = state.plan;
  put(v, skeleton(T().fetching));
  let r;
  try { r = await results(); } catch (e) { console.error(e); put(v, errorCard(viewResult, T().climateError)); return; }
  if (!r.plans.length) { put(v, errorCard(() => go("inicio"), T().noPlans)); return; }
  const [best, ...rest] = r.plans;
  const say = () => `${T().recommended}: ${planName(best)}. ${T().verdictPlan[best.verdict]}.`;
  put(v,
    h("div", { class: "row between" },
      h("div", { style: "min-width:0" }, h("h1", { class: "h1" }, P.place.name), h("p", { class: "sub" }, `${fmtDate(P.start)} – ${fmtDate(P.end)} · ${P.crops.map(cropName).join(", ")}`)),
      h("div", { class: "row", style: "gap:8px" }, h("a", { class: "btn small-btn", href: "#/inicio", onclick: () => { state.draft = null; } }, T().change), listenBtn(say), desktop() ? langToggle() : null)),
    controls(), dataNote(r),
    planPanel(best, 0, true),
    rest.length ? h("h2", { class: "section-h" }, T().otherOptions) : null,
    ...rest.map((p, i) => planPanel(p, i + 1, false)),
    legend());
  updateMap(P.place, best);
}
function legend() {
  return h("div", { class: "legend" }, ...["good", "care", "danger"].map((l) => h("span", {}, h("i", { class: `sw-flat ${l}` }), T().level[l])), h("span", { class: "legend-hint" }, T().tapMonth));
}

/* ---------------- why ---------------- */
async function viewWhy(i) {
  const v = $("#view"); v.className = "view"; put(v, skeleton());
  const r = await results(), p = r.plans[+i] || r.plans[0], P = state.plan;
  const pilot = nearPilot(P.place);
  const notes = [];
  for (let k = 1; k < p.steps.length; k++) {
    const a = p.steps[k - 1].crop, b = p.steps[k].crop;
    if (a === b) notes.push(T().sameTwice(cropName(a)));
    else if (DATA.crops[b]?.n_fixing && !DATA.crops[a]?.n_fixing) notes.push(T().legumeAfter(cropName(b), cropName(a)));
  }
  const bareRain = p.months.filter((m) => !m.crop && m.kind === "rain_on_bare").length;
  const bareSun = p.months.filter((m) => !m.crop && m.kind === "bare_in_sun" && m.level !== "good").length;
  const money = pilot ? p.steps.map((s) => { const e = DATA.econ?.crops?.[s.crop]; if (!e?.yield_t_ha?.typical || !e?.price_usd_per_t?.typical) return null;
    const inc = e.yield_t_ha.typical * e.price_usd_per_t.typical * s.yld, cost = e.cost_usd_ha?.typical;
    return h("li", {}, `${cap(cropName(s.crop))}: ${T().moneyHa(Math.round(inc), cost ? Math.round(inc - cost) : null)}`); }).filter(Boolean) : [];
  const approx = p.crops.filter((c) => DATA.crops[c]?.approximate);
  put(v,
    h("div", { class: "row between" }, h("a", { class: "round", href: "#/resultado", "aria-label": es() ? "Atrás" : "Back" }, icon("i-back")), p.i === 0 ? h("span", { class: "badge" }, T().recommended) : null),
    h("div", {}, h("h1", { class: "h1" }, planName(p)), h("p", { class: "sub" }, `${P.place.name} · ${fmtDate(P.start)} – ${fmtDate(P.end)}`)),
    verdictLine(p),
    h("section", { class: "panel" }, h("h2", { class: "panel-h" }, T().eachPlanting),
      p.steps.length ? h("ul", { class: "steps" }, ...p.steps.map((s) => h("li", { class: "step-line" }, h("i", { class: `sw-flat ${stepLevel(s)}` }),
        h("div", {}, h("b", {}, `${cap(cropName(s.crop))} · ${span(s.from, s.to)}`),
          h("span", {}, T().waterLine(Math.round(s.rain), Math.round(s.need))),
          h("span", {}, stepOutcome(s)),
          s.cold ? h("span", {}, T().lostCold(s.cold)) : null, s.hot ? h("span", {}, T().lostHot(s.hot)) : null)))) : h("p", {}, T().nothingWhy)),
    h("section", { class: "panel" }, h("h2", { class: "panel-h" }, T().soilTitle),
      h("p", {}, T().soilLine(p.covered, p.months.length)),
      bareRain ? h("p", { class: "small" }, T().bareRain(bareRain)) : null,
      bareSun ? h("p", { class: "small" }, T().bareSun(bareSun)) : null,
      ...notes.map((n) => h("p", { class: "small" }, n))),
    money.length ? h("section", { class: "panel" }, h("h2", { class: "panel-h" }, T().moneyTitle), h("ul", { class: "plain" }, ...money), h("p", { class: "small" }, T().moneyCheck)) : null,
    h("details", { class: "unknown" }, h("summary", {}, T().unknownTitle),
      h("ul", {}, ...T().unknownGlobal.map((t) => h("li", {}, t)), approx.length ? h("li", {}, T().approxCrops(approx.map(cropName).join(", "))) : null)),
    h("p", { class: "check" }, icon("i-user"), T().checkLocal),
    h("p", { class: "small" }, T().sourceGlobal));
}

/* ---------------- what would have happened ---------------- */
async function viewPast() {
  const v = $("#view"); v.className = "view"; put(v, skeleton(T().fetching));
  let r;
  try { r = await results(); } catch { put(v, errorCard(viewPast, T().climateError)); return; }
  const p = r.plans[state.pastPlan] || r.plans[0], ss = p.perSample;
  const cnt = (l) => ss.filter((s) => s.level === l).length;
  const sel = ss.find((s) => s.base === state.pastSample) || ss[0];
  const label = (s) => (s.base == null ? T().realClimate : T().ifLike(s.base));
  put(v,
    h("div", {}, h("h1", { class: "h1" }, T().pastTitle), h("p", { class: "sub" }, ss.length > 1 ? T().pastSubGlobal(ss.length) : T().pastReal)),
    h("div", { class: "seg plan-tabs" }, ...r.plans.slice(0, 4).map((q) => h("button", { "aria-pressed": String(q.i === p.i), onclick: () => { state.pastPlan = q.i; render(); } }, q.i === 0 ? icon("i-star") : null, q.steps.length ? q.steps.map((s) => cropName(s.crop)).filter((x, k, a) => a.indexOf(x) === k).join("+") : T().nothing))),
    h("div", { class: "counts" }, ...["good", "care", "danger"].map((l) => h("span", {}, h("i", { class: `sw-flat ${l}` }), `${cnt(l)} ${T().level[l].toLowerCase()}`))),
    ss.length > 1 ? h("div", { class: "years" }, ...ss.map((s) => h("button", { class: s.level, "aria-pressed": String(s === sel), "aria-label": `${label(s)}: ${T().level[s.level]}`, onclick: () => { state.pastSample = s.base; render(); } }, h("span", {}, `'${String(s.base).slice(2)}`)))) : null,
    h("div", { class: "yeardetail" },
      h("p", { class: "y" }, label(sel)),
      ...p.steps.map((st, k) => { const o = r.samples.length ? null : null; const run = sel.cells.slice(st.t0, st.t1); const lost = run.some((c) => c.sev >= 1 && ["water_shortage", "too_cold", "too_hot"].includes(c.kind));
        return h("div", { class: "outcome" }, h("i", { class: `sw-flat ${lost ? "danger" : run.some((c) => c.sev >= 0.5) ? "care" : "good"}` }), h("span", {}, h("b", {}, `${cap(cropName(st.crop))} · ${span(st.from, st.to)}`), ": ", lost ? T().lostShort : T().okShort)); }),
      h("div", { class: "outcome" }, h("i", { class: `sw-flat ${sel.loss > 2.5 ? "danger" : sel.loss > 1.2 ? "care" : "good"}` }), h("span", {}, h("b", {}, T().soilWord), ": ", sel.loss > 2.5 ? T().soilHigh : sel.loss > 1.2 ? T().soilMed : T().soilLow))),
    yearRowsFor(p, sel));
}
function yearRowsFor(p, s) {
  const months = p.months.map((m, t) => { const c = s.cells[t]; return { ...m, crop: c.crop, kind: c.kind, level: c.kind === "ok" || c.kind === "covered" ? "good" : c.sev >= 0.8 ? "danger" : "care", rain: Math.round(c.rain), need: Math.round(c.need), badShare: 0, obs: c.obs }; });
  return yearRows({ ...p, months });
}

/* ---------------- passport (pilot zones only: MODIS fires around the lot) ---------------- */
async function viewPassport() {
  const v = $("#view"); v.className = "view";
  const z = nearPilot(state.plan.place);
  const f = z ? await fireData(z) : null;
  const yrs = f ? Object.entries(f.years).filter(([, x]) => x.lot_fires_by_month) : [];
  const seasonFire = (x) => x.lot_fires_by_month.slice(4).findIndex((n) => n > 0);
  const zoneBurn = yrs.filter(([, x]) => x.zone_fires_by_month.slice(4).some((n) => n > 0)).length;
  const last = yrs[yrs.length - 1], lastM = last ? seasonFire(last[1]) : -1;
  put(v,
    h("div", {}, h("h1", { class: "h1" }, T().passportTitle), h("p", { class: "sub" }, state.plan.place.name)),
    last ? h("div", { class: `pp-answer ${lastM < 0 ? "good" : "danger"}` }, h("p", { class: "pp-q" }, T().burnQ(last[0])),
      h("p", { class: "pp-a" }, lastM < 0 ? T().noBurn : T().burnIn(T().monthsLong[lastM + 4])), h("small", {}, icon("i-sat"), T().viaSat)) : h("p", {}, T().noFireData),
    h("ul", { class: "pp-years" }, ...yrs.slice(-5, -1).reverse().map(([y, x]) => { const m = seasonFire(x);
      return h("li", {}, h("b", {}, y), h("span", { class: m < 0 ? "ok" : "bad" }, m < 0 ? T().noBurnShort : T().burnShort(T().monthsLong[m + 4]))); })),
    state.saved ? h("p", { class: "small" }, icon("i-check"), " ", T().savedPlan(state.saved.name)) : null,
    yrs.length ? h("p", { class: "small" }, T().zoneFires(zoneBurn, yrs.length)) : null);
}

/* ---------------- CesiumJS ---------------- */
let cesiumLoading = null, viewer = null, lotEntity = null, pickBound = false;
function loadCesium() {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  return (cesiumLoading ||= new Promise((res, rej) => {
    window.CESIUM_BASE_URL = CESIUM;
    const s = document.createElement("script"); s.src = CESIUM + "Cesium.js"; s.onload = () => res(window.Cesium); s.onerror = rej; document.head.append(s);
  }));
}
async function initCesium(container, { pick = false } = {}) {
  let C;
  try { C = await loadCesium(); } catch { return; }
  if (viewer && viewer.container !== container) { viewer.destroy(); viewer = null; lotEntity = null; pickBound = false; }
  if (!viewer) {
    viewer = new C.Viewer(container, { baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, requestRenderMode: true });
    try { viewer.imageryLayers.addImageryProvider(await C.ArcGisMapServerImageryProvider.fromUrl(ESRI)); }
    catch { viewer.imageryLayers.addImageryProvider(new C.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" })); }
  }
  if (pick && !pickBound) {
    pickBound = true;
    new C.ScreenSpaceEventHandler(viewer.scene.canvas).setInputAction((e) => {
      if (route().r !== "inicio") return;
      const cart = viewer.camera.pickEllipsoid(e.position, viewer.scene.globe.ellipsoid); if (!cart) return;
      const g = C.Cartographic.fromCartesian(cart);
      state.onPick?.(C.Math.toDegrees(g.latitude), C.Math.toDegrees(g.longitude));
    }, C.ScreenSpaceEventType.LEFT_CLICK);
  }
  if (pick && !state.draft?.place) viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(-60, 0, 18e6), duration: 1.2 });
}
function updateMap(pl, best) {
  if (!viewer || !window.Cesium || !pl) return;
  const C = window.Cesium, d = 0.0012;
  const col = best ? { good: "#15803D", care: "#B45309", danger: "#B91C1C" }[best.verdict] : "#111827";
  if (lotEntity) viewer.entities.remove(lotEntity);
  lotEntity = viewer.entities.add({
    polygon: { height: 0, hierarchy: C.Cartesian3.fromDegreesArray([pl.lon - d, pl.lat - d, pl.lon + d, pl.lat - d * 0.9, pl.lon + d * 0.95, pl.lat + d, pl.lon - d * 1.05, pl.lat + d * 0.92]), material: C.Color.fromCssColorString(col).withAlpha(0.45), outline: true, outlineColor: C.Color.WHITE, outlineWidth: 3 },
    position: C.Cartesian3.fromDegrees(pl.lon, pl.lat),
    label: { text: pl.name, font: "700 15px Inter, sans-serif", fillColor: C.Color.fromCssColorString("#111827"), showBackground: true, backgroundColor: C.Color.WHITE, backgroundPadding: new C.Cartesian2(10, 6), pixelOffset: new C.Cartesian2(0, -36) },
  });
  viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(pl.lon, pl.lat - (best ? 0.011 : 0.05), best ? 1400 : 9000), orientation: { heading: 0, pitch: C.Math.toRadians(best ? -48 : -60), roll: 0 }, duration: 1.6 });
  viewer.scene.requestRender();
}

/* ---------------- app ---------------- */
async function render() {
  const { r, arg } = route();
  document.documentElement.lang = state.lang;
  renderNav(r);
  if (desktop() && (!viewer || viewer.container !== $("#cesium"))) initCesium($("#cesium"), { pick: r === "inicio" });
  const views = { inicio: viewPlan, resultado: viewResult, porque: () => viewWhy(arg || 0), pasado: viewPast, pasaporte: viewPassport };
  try { await views[r](); } catch (e) { console.error(e); put($("#view"), errorCard(render)); }
}
async function start() {
  put($("#view"), skeleton());
  try { await loadBase(); } catch { put($("#view"), errorCard(start)); return; }
  addEventListener("hashchange", () => { render(); $(".content").scrollTo?.(0, 0); scrollTo(0, 0); });
  let w = innerWidth; addEventListener("resize", () => { if ((innerWidth >= 1024) !== (w >= 1024)) { w = innerWidth; if (viewer) { viewer.destroy(); viewer = null; lotEntity = null; pickBound = false; } render(); } });
  render();
}
start();
