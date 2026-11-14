import { recommendPlans, realPast } from "./engine.js";
import { STR } from "./i18n.js";

const CESIUM = "https://cdn.jsdelivr.net/npm/cesium@1.123.0/Build/Cesium/";
const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";
const WEIGHTS = { water: 1, soil: 2, income: 1 };
const ZONE_NAMES = { babahoyo: "Babahoyo", daule: "Daule", quevedo: "Quevedo" };
const DEFAULT_LOT = { zone: "daule", name: "Lote 3", crop: "rice", irrigation: "no", size: 5.2, unit: "ha" };
const ROUTES = ["inicio", "configurar", "lote", "porque", "pasado", "preguntar", "pasaporte"];
const NAV = [["lote", "i-sprout", "lot"], ["pasado", "i-history", "past"], ["preguntar", "i-chat", "ask"], ["pasaporte", "i-badge", "passport"]];

const store = {
  get(k, d) { try { const v = localStorage.getItem("rooti:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("rooti:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const state = {
  lang: store.get("lang", matchMedia("(min-width: 1024px)").matches ? "en" : "es"),
  lot: store.get("lot", DEFAULT_LOT),
  scenario: "normal",
  chosen: store.get("chosen", null),
  pastYear: 2017,
  picked: null,
  savedAt: store.get("savedAt", null),
};
const DATA = { zones: null, crops: null, byZone: {} };
const desktop = () => matchMedia("(min-width: 1024px)").matches;
const T = () => STR[state.lang];
const $ = (s) => document.querySelector(s);

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "style") n.setAttribute("style", v);
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
const KIND_ICON = { ok: "i-check", covered: "i-check", water_shortage: "i-drop-off", excess_rain: "i-rain", rain_on_bare: "i-rain", bare_in_sun: "i-sun" };
const LEVEL_ICON = { good: "i-check", care: "i-minus", danger: "i-x" };

/* ---------------- data ---------------- */
async function loadBase() {
  const [zones, crops, outlook] = await Promise.all([fetch("data/zones.json").then(ok), fetch("data/crops.json").then(ok), fetch("data/outlook.json").then(ok).catch(() => null)]);
  DATA.zones = zones; DATA.crops = crops.crops; DATA.outlook = outlook;
}
async function fireData(z) {
  if (!(z in (DATA.fires ||= {}))) DATA.fires[z] = await fetch(`data/fires_${z}.json`).then(ok).catch(() => null);
  return DATA.fires[z];
}
// Post-harvest season (May-Dec) fires near the lot and in the zone, per year, from MODIS.
function fireSummary(f) {
  if (!f) return null;
  const yrs = Object.entries(f.years).filter(([, v]) => v.lot_fires_by_month);
  const season = (arr) => arr.slice(4).reduce((a, b) => a + b, 0);
  const last = yrs[yrs.length - 1];
  const lotNow = season(last[1].lot_fires_by_month);
  const firstMonth = last[1].lot_fires_by_month.findIndex((n, i) => i >= 4 && n > 0);
  return { year: +last[0], lotNow, firstMonth, zoneYears: yrs.filter(([, v]) => season(v.zone_fires_by_month) > 0).length, totalYears: yrs.length };
}
async function zoneData(z) {
  if (!DATA.byZone[z]) DATA.byZone[z] = await fetch(`data/${z}.json`).then(ok);
  return DATA.byZone[z];
}
function ok(r) { if (!r.ok) throw new Error(r.status); return r.json(); }
function opts() {
  return { scenario: state.scenario, irrigation: state.lot.irrigation === "yes", weights: WEIGHTS, current: { wet: state.lot.crop === "other" ? "maize" : state.lot.crop, dry: "fallow" } };
}
const memo = new Map();
function plans(zone) {
  const key = JSON.stringify(["plans", state.lot.zone, opts()]);
  if (!memo.has(key)) memo.set(key, recommendPlans(zone, DATA.crops, opts()));
  return memo.get(key);
}
function past(zone, rotation) {
  const key = JSON.stringify(["past", state.lot.zone, rotation, opts().irrigation]);
  if (!memo.has(key)) memo.set(key, realPast(zone, DATA.crops, rotation, { irrigation: opts().irrigation, weights: WEIGHTS }).map((y) => ({ ...y, level: y.failed || y.soilLoss === "high" ? "danger" : y.soilLoss === "medium" || y.verdict === "fair" ? "care" : "good" })));
  return memo.get(key);
}
const cropName = (id) => T().crops[id] || id;
const planName = (p) => `${cropName(p.rotation.wet)} → ${cropName(p.rotation.dry)}`;
const isLegume = (id) => !!DATA.crops[id]?.n_fixing;

function planSummary(p) {
  const es = state.lang === "es", dry = p.rotation.dry;
  const bare = p.calendar.filter((c) => c.kind === "bare_in_sun" || c.kind === "rain_on_bare").length;
  if (p.role === "today") return es ? `Así está hoy · suelo pelado ${bare} meses` : `Today · soil bare ${bare} months`;
  if (p.calendar.some((c) => c.failed)) return es ? `Sin riego, ${cropName(dry).toLowerCase()} se seca` : `Without irrigation, ${cropName(dry).toLowerCase()} dries out`;
  if (dry === "mulch") return es ? "Suelo cubierto en verano" : "Soil covered in the dry season";
  if (isLegume(dry)) return es ? "Cubre el suelo y lo abona" : "Covers the soil and feeds it";
  return es ? "Deja algo para vender" : "Leaves something to sell";
}

/* ---------------- shell ---------------- */
function route() { const r = location.hash.replace("#/", ""); return ROUTES.includes(r) ? r : (store.get("lot", null) ? "lote" : desktop() ? "lote" : "inicio"); }
function go(r) { location.hash = "#/" + r; }
function renderNav(active) {
  const mk = (cls) => NAV.map(([r, ic, k]) => h("a", { href: "#/" + r, "aria-current": active === r ? "page" : null }, cls === "tabs" ? null : icon(ic), T().nav[k]));
  $("#tabs").replaceChildren(...mk("tabs"));
  $("#bottom-nav").replaceChildren(...mk("bottom"));
  const hideNav = active === "inicio" || active === "configurar";
  $("#bottom-nav").classList.toggle("hidden", hideNav);
}
function langToggle() {
  return h("button", { class: "pill", "aria-label": "Idioma / Language", onclick: () => { state.lang = state.lang === "es" ? "en" : "es"; store.set("lang", state.lang); document.documentElement.lang = state.lang; memo.clear(); render(); } }, state.lang === "es" ? "ES | EN" : "EN | ES");
}
function listenBtn(text) {
  if (!("speechSynthesis" in window)) return null;
  return h("button", { class: "round", "aria-label": T().listen, title: T().listen, onclick: () => { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text()); u.lang = state.lang === "es" ? "es-ES" : "en-US"; u.rate = 0.95; speechSynthesis.speak(u); } }, icon("i-volume"));
}
function minimap(zone) {
  const d = 0.004, b = [zone.lon - d, zone.lat - d, zone.lon + d, zone.lat + d].join(",");
  return h("a", { class: "minimap", href: "#/inicio", "aria-label": T().findTitle }, h("img", { alt: "", loading: "lazy", src: `${ESRI}/export?bbox=${b}&bboxSR=4326&size=96,96&format=jpg&f=image` }));
}
function skeleton() {
  return [h("div", { class: "skeleton", style: "height:34px;width:60%" }), h("div", { class: "skeleton", style: "height:48px" }),
    ...[0, 1, 2].map(() => h("div", { class: "card plan" }, h("div", { class: "skeleton", style: "height:20px;width:50%" }), h("div", { class: "months" }, ...Array.from({ length: 12 }, () => h("div", { class: "skeleton", style: "height:34px" })))))];
}
function errorCard(retry) {
  return h("div", { class: "errorcard", role: "alert" }, icon("i-wifi-off"), h("div", { style: "flex:1" }, h("b", {}, T().loadError)), h("button", { class: "btn", onclick: retry }, T().retry));
}

/* ---------------- views ---------------- */
// Next rainy season, told as what happened in years when the ocean off Ecuador looked like now.
function outlookCard() {
  const o = DATA.outlook, z = o?.zones?.[state.lot.zone];
  if (!z) return null;
  const es = state.lang === "es", sst = o.predictors_now.nino12_anom_c, a = z.analogs, c = a.counts;
  const hottest = sst > Math.max(...Object.values(a.nino12_by_year || { x: -9 }));
  const wettest = Object.entries(a.rain_mm).sort((x, y) => y[1] - x[1])[0];
  const line1 = es
    ? `El mar frente a Ecuador está ${sst > 0 ? "+" : ""}${sst.toLocaleString("es", { maximumFractionDigits: 1 })}\u00a0°C${hottest ? ", más caliente que nunca" : ""}.`
    : `The ocean off Ecuador is ${sst > 0 ? "+" : ""}${sst.toFixed(1)}\u00a0°C${hottest ? ", warmer than ever recorded" : ""}.`;
  const n = a.years.length;
  const line2 = a.strong_coastal_warming
    ? (es ? `Con el mar así, ${n} inviernos: ${c.wet} muy lluviosos, ${c.normal} normal${c.normal === 1 ? "" : "es"}, ${c.dry} secos. El peor: ${wettest[0]}.`
          : `With the ocean like this, ${n} rainy seasons: ${c.wet} very wet, ${c.normal} normal, ${c.dry} dry. Worst: ${wettest[0]}.`)
    : (es ? `En ${n} años parecidos: ${c.wet} lluviosos, ${c.normal} normales, ${c.dry} secos.` : `In ${n} similar years: ${c.wet} wet, ${c.normal} normal, ${c.dry} dry.`);
  return h("div", { class: "outlook" }, h("span", { class: "oc-ic" }, icon("i-rain")),
    h("div", { style: "flex:1" }, h("b", {}, line1), h("p", {}, line2),
      state.scenario !== "wet" ? h("button", { class: "oc-btn", onclick: () => { state.scenario = "wet"; viewLot(); } }, es ? "Ver plan para año lluvioso" : "See plan for a wet year", icon("i-chev-r")) : null));
}

function viewFind() {
  const v = $("#view"); v.className = "view find";
  const host = h("div", { class: "map-host", id: "cesium-phone" });
  const note = h("p", { class: "note hidden" });
  const choose = (z) => { state.lot = { ...state.lot, zone: z }; store.set("lot", state.lot); memo.clear(); go("configurar"); };
  put(v, host,
    h("div", { class: "top" },
      h("div", { class: "row between" }, h("div", { class: "row", style: "gap:8px" }, h("span", { class: "round", style: "background:var(--brand);color:#fff;width:32px;height:32px;border-radius:9px" }, icon("i-sprout")), h("b", { style: "font-size:22px" }, "Rooti")), langToggle()),
      h("h1", { class: "h1" }, T().findTitle),
      searchBox((z) => choose(z), note), note),
    h("div", { class: "hint" }, T().tapMap),
    h("div", { class: "bottom" },
      h("button", { class: "btn primary block", onclick: () => locate(choose, note) }, icon("i-locate"), T().imHere),
      h("button", { class: "btn block", onclick: () => choose(state.picked || state.lot.zone) }, T().useMarked)));
  initCesium(host, { pick: true });
}
function searchBox(onPick, note) {
  const input = h("input", { type: "search", placeholder: T().search, "aria-label": T().search, autocomplete: "off" });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = input.value.trim().toLowerCase();
    const z = Object.keys(ZONE_NAMES).find((k) => k.startsWith(q) || ZONE_NAMES[k].toLowerCase().includes(q));
    if (z) onPick(z); else if (note) { note.textContent = T().outOfArea; note.classList.remove("hidden"); }
  });
  return h("label", { class: "search" }, icon("i-search"), input);
}
function nearestZone(lat, lon) {
  let best = null, dist = Infinity;
  for (const z of DATA.zones) { const d = Math.hypot(z.lat - lat, z.lon - lon); if (d < dist) { dist = d; best = z.zone; } }
  return { zone: best, km: dist * 111 };
}
function locate(choose, note) {
  if (!navigator.geolocation) return choose(state.lot.zone);
  navigator.geolocation.getCurrentPosition((p) => {
    const n = nearestZone(p.coords.latitude, p.coords.longitude);
    if (n.km > 60) { note.textContent = T().outOfArea; note.classList.remove("hidden"); }
    choose(n.zone);
  }, () => choose(state.lot.zone), { timeout: 8000 });
}

function viewSetup() {
  const v = $("#view"); v.className = "view";
  const lot = state.lot, es = state.lang === "es";
  const save = () => { store.set("lot", state.lot); memo.clear(); viewSetup(); };
  const choice = (val, key, label, ph) => h("button", { class: "choice", "aria-pressed": String(lot[key] === val), onclick: () => { state.lot = { ...state.lot, [key]: val }; save(); } }, ph, label);
  const photo = (q) => h("span", { class: "ph", style: q ? `background-image:url(${q})` : "" }, q ? null : "+");
  put(v, 
    h("div", { class: "row between" }, h("a", { class: "round", href: "#/inicio", "aria-label": es ? "Atrás" : "Back" }, icon("i-back")), h("a", { href: "#/lote", style: "color:var(--brand);font-weight:600;text-decoration:none" }, T().skip)),
    h("h1", { class: "h1" }, T().setupTitle(ZONE_NAMES[lot.zone])),
    h("div", { class: "plan" }, h("p", { class: "q" }, T().qCrop), h("div", { class: "choices" },
      choice("rice", "crop", T().crops.rice, photo("img/rice.jpg")), choice("maize", "crop", T().crops.maize, photo("img/maize.jpg")), choice("other", "crop", T().other, photo(null)))),
    h("div", { class: "plan" }, h("p", { class: "q" }, T().qIrrigation), h("div", { class: "choices" },
      choice("yes", "irrigation", T().yes), choice("sometimes", "irrigation", T().sometimes), choice("no", "irrigation", T().no))),
    h("div", { class: "plan" }, h("p", { class: "q" }, T().qSize), h("div", { class: "row" },
      h("div", { class: "stepper" },
        h("button", { "aria-label": "−", onclick: () => { state.lot = { ...state.lot, size: Math.max(0.1, +(lot.size - 0.1).toFixed(1)) }; save(); } }, "−"),
        h("b", {}, lot.size.toLocaleString(state.lang)),
        h("button", { "aria-label": "+", onclick: () => { state.lot = { ...state.lot, size: +(lot.size + 0.1).toFixed(1) }; save(); } }, "+")),
      h("div", { class: "seg", style: "flex:none" }, ...["ha", "cuadra"].map((u) => h("button", { "aria-pressed": String(lot.unit === u), onclick: () => { state.lot = { ...state.lot, unit: u }; save(); } }, u === "ha" ? T().unitHa : T().unitCuadra))))),
    h("div", { style: "flex:1" }),
    h("a", { class: "btn primary block", href: "#/lote" }, T().done));
}

async function viewLot() {
  const v = $("#view"); v.className = "view"; put(v, ...skeleton());
  let zone;
  try { zone = await zoneData(state.lot.zone); } catch { put(v, errorCard(viewLot)); return; }
  const meta = DATA.zones.find((z) => z.zone === state.lot.zone);
  const ps = plans(zone), es = state.lang === "es";
  const sizeTxt = `${state.lot.size.toLocaleString(state.lang)} ${state.lot.unit === "ha" ? "ha" : T().unitCuadra}`;
  const head = h("div", { class: "row between" },
    h("div", {}, h("h1", { class: "h1" }, state.lot.name), h("p", { class: "sub" }, `${ZONE_NAMES[state.lot.zone]} · ${sizeTxt} · ${cropName(opts().current.wet).toLowerCase()}`)),
    h("div", { class: "row", style: "gap:10px" }, listenBtn(() => `${state.lot.name}. ${T().recommended}: ${planName(ps[0])}. ${planSummary(ps[0])}.`), minimap(meta), desktop() ? langToggle() : null));
  const yearSeg = h("div", { class: "plan" }, h("p", { class: "q", style: "font-size:16px" }, T().yearQ),
    h("div", { class: "seg" }, ...[["dry", "i-sun"], ["normal", "i-check"], ["wet", "i-rain"]].map(([k, ic]) =>
      h("button", { "aria-pressed": String(state.scenario === k), onclick: () => { state.scenario = k; viewLot(); } }, icon(ic), T()[k]))));
  const irrSeg = desktop() ? h("div", { class: "seg", style: "max-width:420px" }, ...[["no", es ? "Sin riego" : "No irrigation"], ["yes", es ? "Con riego" : "Irrigated"]].map(([k, l]) =>
    h("button", { "aria-pressed": String((state.lot.irrigation === "yes" ? "yes" : "no") === k), onclick: () => { state.lot = { ...state.lot, irrigation: k }; store.set("lot", state.lot); memo.clear(); viewLot(); } }, l))) : null;
  const cards = ps.map((p) => {
    const rec = p.role === "best";
    return h("article", { class: `card plan${rec ? " rec" : ""}` },
      h("div", { class: "row between" }, h("span", { class: "name" }, planName(p)), rec ? h("span", { class: "badge" }, icon("i-star"), T().recommended) : null),
      h("div", { class: "months", role: "img", "aria-label": p.calendar.map((c, i) => `${T().monthsLong[i]}: ${T().legend[c.level === "good" ? "good" : c.kind === "water_shortage" ? "water" : c.kind === "bare_in_sun" ? "bare" : "rain"]}`).join(", ") },
        ...p.calendar.map((c) => h("div", { class: `cell ${c.level}`, title: `${T().monthsLong[c.month - 1]} · ${c.rain} mm` }, icon(KIND_ICON[c.kind] || "i-check")))),
      h("div", { class: "row between" }, h("span", { class: "sum" }, planSummary(p)), rec ? h("a", { class: "why-link", href: "#/porque" }, T().whyLink, icon("i-chev-r")) : null));
  });
  const L = T().legend;
  const legend = h("div", { class: "plan", style: "gap:8px" },
    h("div", { class: "legend" }, ...[["good", L.good], ["care", L.care], ["danger", L.danger]].map(([k, l]) => h("span", {}, h("i", { style: `background:var(--${k})` }, icon(LEVEL_ICON[k])), l))),
    h("div", { class: "legend" }, ...[["i-drop-off", L.water], ["i-rain", L.rain], ["i-sun", L.bare]].map(([ic, l]) => h("span", {}, h("i", { style: "background:transparent;color:var(--ink)" }, icon(ic)), l))));
  const seasons = h("div", { class: "seasons" }, h("span", { class: "w" }, T().winter), h("span", { class: "s" }, T().summer), h("span", { class: "w2" }));
  const letters = h("div", { class: "letters" }, ...T().months.map((m) => h("span", {}, m)));
  put(v, head, h("div", { class: "row", style: "gap:16px;flex-wrap:wrap;align-items:flex-end" }, h("div", { style: "flex:1;min-width:260px" }, yearSeg), irrSeg), outlookCard(),
    h("div", { class: "plan" }, seasons, letters, ...cards), legend,
    desktop() ? h("div", { class: "desk-grid" }, whyBlock(zone, ps), pastBlock(zone, ps)) : null);
  updateMap(meta);
}

function whyReasons(zone, ps) {
  const es = state.lang === "es";
  const [best, today, cash] = ps;
  const pb = past(zone, best.rotation), pt = past(zone, today.rotation), pc = cash ? past(zone, cash.rotation) : null;
  const d = (arr) => arr.filter((y) => y.level === "danger").length, n = pb.length;
  const out = [{ ic: "i-shield", col: "var(--good)", big: es ? `${d(pb)} de ${n}` : `${d(pb)} of ${n}`, txt: es ? `años con daño fuerte. Hoy: ${d(pt)} de ${n}.` : `years with heavy damage. Today: ${d(pt)} of ${n}.` }];
  const bad = pt.filter((y) => y.level === "danger").map((y) => y.year).slice(-3);
  if (bad.length) out.push({ ic: "i-rain", col: "var(--care)", big: bad.join(" · "), txt: es ? "años en que el plan de hoy dañó más el suelo." : "years today's plan hurt the soil most." });
  if (pc) {
    const f = pc.filter((y) => y.failed).length;
    out.push(f >= n / 2
      ? { ic: "i-drop-off", col: "var(--danger)", big: es ? `${f} de ${n}` : `${f} of ${n}`, txt: es ? `años ${cropName(cash.rotation.dry).toLowerCase()} se secó en verano${opts().irrigation ? "" : " sin riego"}.` : `years ${cropName(cash.rotation.dry).toLowerCase()} dried out${opts().irrigation ? "" : " without irrigation"}.` }
      : { ic: "i-check", col: "var(--good)", big: es ? `${n - f} de ${n}` : `${n - f} of ${n}`, txt: es ? `años ${cropName(cash.rotation.dry).toLowerCase()} dio cosecha.` : `years ${cropName(cash.rotation.dry).toLowerCase()} gave a harvest.` });
  }
  return out;
}
function todoText(best) {
  const es = state.lang === "es", dry = best.rotation.dry, wet = cropName(best.rotation.wet).toLowerCase();
  if (dry === "mulch") return es ? "Después de cosechar, no queme la paja. Déjela tendida sobre el lote hasta el próximo invierno." : "After the harvest, don't burn the straw. Leave it spread over the lot until the next rains.";
  return es ? `Siembre ${cropName(dry).toLowerCase()} apenas coseche el ${wet}${opts().irrigation ? ", con riego" : ""}.` : `Sow ${cropName(dry).toLowerCase()} right after the ${wet} harvest${opts().irrigation ? ", with irrigation" : ""}.`;
}
function reasonsList(zone, ps) {
  return whyReasons(zone, ps).map((r) => h("div", { class: "reason" }, h("span", { class: "ic", style: `background:${r.col}` }, icon(r.ic)), h("div", {}, h("b", {}, r.big), h("span", {}, r.txt))));
}
function whyBlock(zone, ps) {
  return h("section", { class: "plan", style: "background:var(--soft);border-radius:16px;padding:20px" },
    h("h2", { class: "q" }, `${T().whyLink}: ${planName(ps[0])}`), ...reasonsList(zone, ps),
    h("div", { class: "todo", style: "background:#fff" }, h("b", {}, T().whatToDo), h("p", {}, todoText(ps[0]))),
    h("button", { class: "btn primary", onclick: choosePlan }, state.chosen ? T().chosen : T().choose));
}
function choosePlan() { state.chosen = true; store.set("chosen", true); render(); }

async function viewWhy() {
  const v = $("#view"); v.className = "view"; put(v, ...skeleton());
  const zone = await zoneData(state.lot.zone), ps = plans(zone), es = state.lang === "es";
  const reasons = whyReasons(zone, ps);
  put(v, 
    h("div", { class: "row between" }, h("a", { class: "round", href: "#/lote", "aria-label": es ? "Atrás" : "Back" }, icon("i-back")),
      h("button", { class: "btn", style: "min-height:44px;border-radius:999px;background:var(--soft);border:0", onclick: () => speak(`${planName(ps[0])}. ${planSummary(ps[0])}. ${reasons.map((r) => r.big + " " + r.txt).join(". ")}. ${todoText(ps[0])}`) }, icon("i-volume"), T().listen)),
    h("div", {}, h("p", { style: "color:var(--brand);font-weight:600;font-size:16px" }, planName(ps[0])), h("h1", { class: "h1" }, planSummary(ps[0]))),
    h("div", { class: "plan", style: "gap:14px" }, ...reasonsList(zone, ps)),
    h("div", { class: "todo" }, h("b", {}, T().whatToDo), h("p", {}, todoText(ps[0]))),
    h("p", { class: "small" }, T().source),
    h("div", { style: "flex:1" }),
    h("div", { class: "actions" }, h("button", { class: "btn primary block", onclick: choosePlan }, state.chosen ? T().chosen : T().choose),
      h("a", { class: "btn wa block", href: waLink(es ? `¿Por qué me conviene ${planName(ps[0]).toLowerCase()} en mi lote de ${ZONE_NAMES[state.lot.zone]}?` : `Why is ${planName(ps[0]).toLowerCase()} best for my lot in ${ZONE_NAMES[state.lot.zone]}?`), target: "_blank", rel: "noopener" }, icon("i-chat"), T().askWa)));
}
function speak(text) { if (!("speechSynthesis" in window)) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = state.lang === "es" ? "es-ES" : "en-US"; u.rate = 0.95; speechSynthesis.speak(u); }
const waLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

function yearLabel(zone, y) {
  const es = state.lang === "es", yt = zone.year_types, oni = zone.years[String(y)]?.oni_peak ?? 0;
  const rain = yt.wet.years.includes(y) ? (es ? "invierno muy lluvioso" : "very wet rainy season") : yt.dry.years.includes(y) ? (es ? "invierno seco" : "dry rainy season") : (es ? "invierno normal" : "normal rainy season");
  const enso = oni >= 1.5 ? (es ? "Niño fuerte" : "strong El Niño") : oni >= 0.5 ? (es ? "Niño" : "El Niño") : oni <= -0.5 ? (es ? "Niña" : "La Niña") : null;
  return [enso, rain].filter(Boolean).join(" · ");
}
function outcomeText(p, y) {
  const es = state.lang === "es", c = cropName(p.rotation.dry).toLowerCase();
  if (y.failed) return es ? `${planName(p)}: ${c} se secó` : `${planName(p)}: ${c} dried out`;
  if (y.soilLoss === "high") return es ? `${planName(p)}: mucho daño al suelo` : `${planName(p)}: heavy soil damage`;
  if (y.soilLoss === "medium") return es ? `${planName(p)}: algo de daño al suelo` : `${planName(p)}: some soil damage`;
  return es ? `${planName(p)}: sin problema` : `${planName(p)}: no problem`;
}
function pastBlock(zone, ps) {
  const es = state.lang === "es";
  const rows = ps.map((p) => {
    const ys = past(zone, p.rotation), cnt = (l) => ys.filter((y) => y.level === l).length;
    const grid = (from) => h("div", { class: "years" }, ...ys.slice(from, from + 12).map((y) => h("button", { class: y.level, title: String(y.year), "aria-label": `${y.year}`, "aria-pressed": String(y.year === state.pastYear), onclick: () => { state.pastYear = y.year; render(); } }, icon(LEVEL_ICON[y.level]))));
    return h("div", { class: "plan", style: "gap:8px" },
      h("div", { class: "row between" }, h("b", { style: `font-size:17px;color:${p.role === "best" ? "var(--brand)" : "var(--ink)"}` }, planName(p)),
        h("div", { class: "counts" }, ...["good", "care", "danger"].map((l) => h("span", {}, h("i", { style: `background:var(--${l})` }), cnt(l))))),
      grid(0), grid(12));
  });
  const y = state.pastYear, yrs = Object.keys(zone.years).map(Number), i = yrs.indexOf(y);
  const step = (d) => { state.pastYear = yrs[Math.min(yrs.length - 1, Math.max(0, i + d))]; render(); };
  const detail = h("div", { class: "yeardetail" },
    h("div", { class: "row between" }, h("button", { class: "round", style: "background:#fff;border:1px solid var(--line)", "aria-label": es ? "Año anterior" : "Previous year", onclick: () => step(-1) }, icon("i-chev-l")),
      h("div", {}, h("p", { class: "y" }, String(y)), h("p", { class: "ys" }, yearLabel(zone, y))),
      h("button", { class: "round", style: "background:#fff;border:1px solid var(--line)", "aria-label": es ? "Año siguiente" : "Next year", onclick: () => step(1) }, icon("i-chev-r"))),
    ...ps.map((p) => { const yy = past(zone, p.rotation).find((x) => x.year === y); return h("div", { class: "outcome" }, h("i", { style: `background:var(--${yy.level})` }, icon(LEVEL_ICON[yy.level])), outcomeText(p, yy)); }));
  return h("section", { class: "plan", style: "gap:16px" }, h("div", {}, h("h2", { class: desktop() ? "q" : "h1" }, T().pastTitle), h("p", { class: "sub" }, T().pastSub)), ...rows, detail);
}
async function viewPast() {
  const v = $("#view"); v.className = "view"; put(v, ...skeleton());
  const zone = await zoneData(state.lot.zone);
  put(v, pastBlock(zone, plans(zone)));
}

async function viewAsk() {
  const v = $("#view"); v.className = "view";
  const zone = await zoneData(state.lot.zone), ps = plans(zone), es = state.lang === "es";
  const r = whyReasons(zone, ps);
  const q1 = es ? "¿Qué siembro después del arroz?" : "What should I plant after the rice?";
  const answer = es ? `Para su ${state.lot.name}: ${todoText(ps[0])} ${r[2] ? r[2].big + " " + r[2].txt : ""}` : `For your ${state.lot.name}: ${todoText(ps[0])} ${r[2] ? r[2].big + " " + r[2].txt : ""}`;
  const audio = (d) => h("div", { class: "audio" }, icon("i-play"), h("span", { class: "wave" }), d);
  put(v, 
    h("div", { class: "row between" }, h("div", {}, h("h1", { class: "h1" }, T().askTitle), h("p", { class: "sub" }, T().askSub)), h("span", { class: "tag-example" }, T().example)),
    h("div", { class: "chat" },
      h("div", { class: "bubble me" }, audio("0:12"), q1),
      h("div", { class: "bubble" }, answer, audio("0:20")),
      h("div", { class: "bubble" }, es ? "¿Le aviso cuando empiecen las lluvias?" : "Shall I tell you when the rains start?",
        h("div", { class: "row", style: "gap:8px" }, ...(es ? ["Sí, avíseme", "No"] : ["Yes, tell me", "No"]).map((l) => h("span", { class: "btn wa", style: "min-height:40px;flex:1;font-size:15px" }, l))))),
    h("div", { class: "plan", style: "gap:8px" }, ...(es ? ["¿Cuándo siembro el arroz?", "¿Va a llover este mes?"] : ["When should I sow the rice?", "Will it rain this month?"]).map((q) => h("a", { class: "suggest", href: waLink(q), target: "_blank", rel: "noopener" }, icon("i-chat"), q))),
    h("div", { class: "row", style: "gap:10px" }, h("a", { class: "btn wa-fill", style: "flex:1", href: waLink(q1), target: "_blank", rel: "noopener" }, icon("i-mic"), T().sendAudio)));
}

async function viewPassport() {
  const v = $("#view"); v.className = "view"; const es = state.lang === "es";
  const fs = fireSummary(await fireData(state.lot.zone));
  const stamp = (ic, label, tag, tagIc, locked) => h("div", { class: `stamp${locked ? " locked" : ""}` }, h("span", { class: "ic" }, icon(locked ? "i-lock" : ic)), label, h("small", {}, icon(tagIc), tag));
  put(v, 
    h("div", { class: "row between" }, h("div", {}, h("h1", { class: "h1" }, T().passportTitle), h("p", { class: "sub" }, `${state.lot.name} · ${ZONE_NAMES[state.lot.zone]}`)), h("span", { class: "tag-example" }, T().example)),
    h("div", { class: "score" }, h("div", { class: "ring", style: "background:conic-gradient(var(--good) 0 58%, var(--line) 58% 100%)" }, h("b", {}, "58")),
      h("div", { class: "plan", style: "gap:4px" }, h("b", { style: "font-size:24px;color:var(--good)" }, es ? "Mejorando" : "Improving"), h("span", { style: "font-size:16px" }, es ? "+17 frente al año pasado" : "+17 vs last year"), h("span", { class: "sub" }, es ? "Promedio de su zona: 49" : "Your area's average: 49"))),
    h("h2", { class: "q" }, T().stamps),
    h("div", { class: "stamps" },
      fs && fs.lotNow > 0
        ? stamp("i-shield", es ? `Fuego visto en ${T().monthsLong[fs.firstMonth]}` : `Fire seen in ${T().monthsLong[fs.firstMonth]}`, es ? `Satélite · ${fs.year}` : `Satellite · ${fs.year}`, "i-sat", true)
        : stamp("i-shield", es ? "No quemó la paja" : "Didn't burn the straw", fs ? (es ? `Satélite · ${fs.year}` : `Satellite · ${fs.year}`) : (es ? "Satélite" : "Satellite"), "i-sat"),
      stamp("i-check", es ? "Suelo cubierto en verano" : "Soil covered in the dry season", es ? "Satélite" : "Satellite", "i-sat"),
      stamp("i-sprout", es ? "Rotó el cultivo" : "Rotated the crop", es ? "Declarado" : "Declared", "i-user"),
      stamp("i-check", es ? "3 veranos cubierto" : "3 dry seasons covered", es ? "Faltan 2" : "2 to go", "i-history", true)),
    fs ? h("p", { class: "small" }, es ? `En su zona el satélite vio quemas en ${fs.zoneYears} de ${fs.totalYears} temporadas de cosecha (NASA MODIS, 1 km).` : `In your area, satellites saw burning in ${fs.zoneYears} of ${fs.totalYears} harvest seasons (NASA MODIS, 1 km).`) : null,
    h("div", { class: "row", style: "gap:10px" },
      h("button", { class: "btn primary", style: "flex:1", onclick: () => navigator.share ? navigator.share({ title: T().passportTitle, url: location.href }).catch(() => {}) : null }, icon("i-share"), T().share),
      h("button", { class: "btn" }, icon("i-qr"), T().qr)));
}

/* ---------------- CesiumJS ---------------- */
let cesiumLoading = null, viewer = null, lotEntity = null;
function loadCesium() {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (!cesiumLoading) cesiumLoading = new Promise((res, rej) => {
    window.CESIUM_BASE_URL = CESIUM;
    const s = document.createElement("script"); s.src = CESIUM + "Cesium.js"; s.onload = () => res(window.Cesium); s.onerror = rej; document.head.append(s);
  });
  return cesiumLoading;
}
async function initCesium(container, { pick = false } = {}) {
  let C;
  try { C = await loadCesium(); } catch { container.textContent = ""; return; }
  if (viewer && viewer.container !== container) { viewer.destroy(); viewer = null; lotEntity = null; }
  if (!viewer) {
    viewer = new C.Viewer(container, { baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, requestRenderMode: true });
    try { viewer.imageryLayers.addImageryProvider(await C.ArcGisMapServerImageryProvider.fromUrl(ESRI)); }
    catch { viewer.imageryLayers.addImageryProvider(new C.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" })); }
    for (const z of DATA.zones) viewer.entities.add({ id: "zone-" + z.zone, position: C.Cartesian3.fromDegrees(z.lon, z.lat), point: { pixelSize: 10, color: C.Color.WHITE, outlineColor: C.Color.fromCssColorString("#006B77"), outlineWidth: 3 }, label: { text: ZONE_NAMES[z.zone], font: "600 14px Inter, sans-serif", fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -18), distanceDisplayCondition: new C.DistanceDisplayCondition(5000, 4e6) } });
  }
  if (pick) {
    const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((e) => {
      const cart = viewer.camera.pickEllipsoid(e.position, viewer.scene.globe.ellipsoid); if (!cart) return;
      const g = C.Cartographic.fromCartesian(cart);
      state.picked = nearestZone(C.Math.toDegrees(g.latitude), C.Math.toDegrees(g.longitude)).zone;
      viewer.entities.removeById("picked");
      viewer.entities.add({ id: "picked", position: cart, point: { pixelSize: 18, color: C.Color.fromCssColorString("#006B77"), outlineColor: C.Color.WHITE, outlineWidth: 4 } });
      viewer.scene.requestRender();
    }, C.ScreenSpaceEventType.LEFT_CLICK);
  }
  updateMap(DATA.zones.find((z) => z.zone === state.lot.zone));
}
function updateMap(meta) {
  if (!viewer || !window.Cesium || !meta) return;
  const C = window.Cesium, half = Math.sqrt(state.lot.size * (state.lot.unit === "ha" ? 10000 : 7056)) / 2;
  const dLat = half / 111320, dLon = half / (111320 * Math.cos(meta.lat * Math.PI / 180));
  if (lotEntity) viewer.entities.remove(lotEntity);
  for (const z of DATA.zones) { const e = viewer.entities.getById("zone-" + z.zone); if (e) e.show = z.zone !== state.lot.zone; }
  lotEntity = viewer.entities.add({
    polygon: { height: 0, hierarchy: C.Cartesian3.fromDegreesArray([meta.lon - dLon, meta.lat - dLat, meta.lon + dLon, meta.lat - dLat * 0.9, meta.lon + dLon * 0.95, meta.lat + dLat, meta.lon - dLon * 1.05, meta.lat + dLat * 0.92]), material: C.Color.WHITE.withAlpha(0.18), outline: true, outlineColor: C.Color.WHITE, outlineWidth: 3 },
    position: C.Cartesian3.fromDegrees(meta.lon, meta.lat),
    label: { text: state.lot.name, font: "700 15px Inter, sans-serif", fillColor: C.Color.fromCssColorString("#111827"), showBackground: true, backgroundColor: C.Color.WHITE, backgroundPadding: new C.Cartesian2(10, 6), pixelOffset: new C.Cartesian2(0, -4) },
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
  const r = route();
  document.documentElement.lang = state.lang;
  renderNav(r);
  offlineBanner();
  $("#search-desk").placeholder = T().search;
  const wa = $("#wa-desk"); wa.href = waLink(state.lang === "es" ? "Hola Rooti, tengo una pregunta sobre mi lote" : "Hi Rooti, I have a question about my lot"); wa.querySelector("span").textContent = T().askWa;
  if (r !== "inicio" && desktop() && !viewer) initCesium($("#cesium"));
  try {
    ({ inicio: desktop() ? viewLot : viewFind, configurar: viewSetup, lote: viewLot, porque: viewWhy, pasado: viewPast, preguntar: viewAsk, pasaporte: viewPassport })[r]()?.catch?.((e) => { console.error(e); put($("#view"), errorCard(render)); });
  } catch (e) { console.error(e); $("#view").replaceChildren(errorCard(render)); }
  if (r !== "inicio") $(".content").scrollTo?.(0, 0);
}

async function start() {
  $("#view").replaceChildren(...skeleton());
  try { await loadBase(); } catch { $("#view").replaceChildren(errorCard(start)); return; }
  state.savedAt = Date.now(); store.set("savedAt", state.savedAt);
  $("#search-desk").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = e.target.value.trim().toLowerCase(), z = Object.keys(ZONE_NAMES).find((k) => k.startsWith(q));
    if (z) { state.lot = { ...state.lot, zone: z }; store.set("lot", state.lot); memo.clear(); render(); }
  });
  addEventListener("hashchange", render);
  addEventListener("online", offlineBanner); addEventListener("offline", offlineBanner);
  let w = innerWidth; addEventListener("resize", () => { if ((innerWidth >= 1024) !== (w >= 1024)) { w = innerWidth; if (viewer) { viewer.destroy(); viewer = null; lotEntity = null; } render(); } });
  render();
}
start();
