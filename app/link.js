// The app and Rooti on WhatsApp, one lot. Opened from a WhatsApp button, the address carries a signed link (?t=) and
// the lot lives in Rooti's database (bot/src/rooti_bot/web.py), so what the farmer marks here Rooti knows in the chat.
// Opened as the public website, a lot made here goes to WhatsApp as a short code the farmer sends to Rooti.
// data/bot.json says where Rooti's API is ("" = this same server) and Rooti's number; without them nothing shows.
const KEY = "rooti:link";
let cfg = { url: null, whatsapp: "" };
export const link = { token: null, plan: null, chosen: null, alert: null, call: null };

const remembered = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
async function api(method, path, body) {
  const r = await fetch(`${(cfg.url || "").replace(/\/$/, "")}${path}`, {
    method, cache: "no-store",
    headers: { "content-type": "application/json", ...(link.token ? { "x-rooti-token": link.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  return r.json();
}

// True when the page belongs to one farmer. Throws when the link expired or was edited.
export async function initLink() {
  const q = new URLSearchParams(location.search), fresh = q.get("t");
  if (fresh) {
    try { sessionStorage.setItem(KEY, fresh); } catch { /* private mode: the token lives in memory */ }
    q.delete("t"); // out of the address bar, so a screenshot or a shared address never carries it
    history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : "") + location.hash);
  }
  link.token = fresh || remembered();
  try { cfg = { ...cfg, ...(await fetch("data/bot.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {}))) }; } catch { /* no bot */ }
  if (!link.token) return false;
  const r = await api("GET", "/api/lot");
  Object.assign(link, { plan: r.plan, chosen: r.chosen, alert: r.alert, call: r.call });
  if (r.whatsapp) cfg.whatsapp = r.whatsapp;
  return true;
}

export const linked = () => !!link.token;
export const waUrl = (text) => `https://wa.me/${cfg.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
export const hasWhatsApp = () => !!cfg.whatsapp;
export const canHandoff = () => !link.token && cfg.url != null && !!cfg.whatsapp;
export const saveLot = (P) => api("PUT", "/api/lot", P);
export async function choosePlan(choice) { await api("POST", "/api/choice", choice); link.chosen = choice; }
export async function handoff(P) { const r = await api("POST", "/api/handoff", P); return r.code; }
