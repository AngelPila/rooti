// Rooti web: serves the static app and a small API for Vecinos, backed by Postgres.
// Env: DATABASE_URL (Postgres), PORT (default 3000), APP_DIR (default ../app), TRUST_PROXY=1 behind Coolify's proxy,
// ROOTI_BOT_URL and ROOTI_WHATSAPP (Rooti on WhatsApp: its public address and number) for «Continuar en WhatsApp».
// Rooti, the in-app assistant (rooti.mjs): DEEPSEEK_API_KEY, GROQ_API_KEY, ROOTI_PERSONA (default ../bot/hermes/rooti/SOUL.md).
// Without DATABASE_URL the API answers 503 and the app falls back to its example posts and this phone's storage.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as rooti from "./rooti.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(process.env.APP_DIR || path.join(HERE, "..", "app"));
const PORT = +(process.env.PORT || 3000);
const TRUST_PROXY = process.env.TRUST_PROXY !== "0";
const db = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 }) : null;

const TYPES = new Set(["asi_me_fue", "aviso", "pregunta"]);
const RESULTS = new Set(["bien", "regular", "perdio"]);
const UNITS = new Set(["ha", "cuadra", "acre", "m2"]);
const ZONE = /^(daule|babahoyo|quevedo|pt:-?\d{1,2}\.\d,-?\d{1,3}\.\d)$/;
let CROPS = new Set();

/* ---------- small helpers ---------- */
const clean = (s, max) => (typeof s === "string" ? s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max) : "");
// Same rule as the app: first name and last initial, nothing else is stored
const maskName = (n) => {
  const w = clean(n, 80).split(/\s+/).filter(Boolean).map((x) => x.replace(/[^\p{L}\p{M}'.-]/gu, "")).filter(Boolean);
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  return !w.length ? "Vecino" : w.length === 1 ? cap(w[0]).slice(0, 24) : `${cap(w[0]).slice(0, 24)} ${w[w.length - 1][0].toUpperCase()}.`;
};
const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
};
const clientIp = (req) => (TRUST_PROXY && req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",")[0].trim() : req.socket.remoteAddress) || "?";
async function readJson(req, limit = 4096) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error("too large"), { code: 413 }); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw Object.assign(new Error("bad json"), { code: 400 }); }
}
// A few writes per person, enough for a farmer, too few for a spammer. In memory: it resets on deploy, which is fine.
const hits = new Map();
function allowed(key, max, windowMs) {
  const now = Date.now(), list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) { hits.set(key, list); return false; }
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}

/* ---------- database ---------- */
async function migrate() {
  await db.query(await readFile(path.join(HERE, "schema.sql"), "utf8"));
  // Example posts ship with the app; they are loaded once, marked as examples, and never overwrite a real post.
  const seed = JSON.parse(await readFile(path.join(APP, "data", "vecinos.json"), "utf8")).posts || [];
  for (const p of seed) {
    const r = await db.query(
      `INSERT INTO vec_posts (id, type, zone, crop, sow_month, sow_year, result, area, unit, text_es, text_en, author, role, source, example, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'example',true,$14::date + time '12:00') ON CONFLICT (id) DO NOTHING RETURNING id`,
      [p.id, p.type, p.zone, p.crop || null, p.sowMonth || null, p.sowYear || null, p.result || null, p.area || null, p.unit || null,
        p.text_es || null, p.text_en || null, p.author, p.role || null, p.date]);
    if (r.rowCount) for (const x of p.replies || []) {
      await db.query(`INSERT INTO vec_replies (post_id, author, role, text_es, text_en, example, created_at) VALUES ($1,$2,$3,$4,$5,true,$6::date + time '12:00')`,
        [p.id, x.author, x.role || null, x.text_es || null, x.text_en || null, x.date]);
    }
  }
}
const POST_COLS = `p.id, p.type, p.zone, p.crop, p.sow_month AS "sowMonth", p.sow_year AS "sowYear", p.result, p.area, p.unit, p.text, p.text_es, p.text_en,
  p.author, p.role, p.example, to_char(p.created_at AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD') AS date, p.created_at AS ts`;
async function listPosts(zone) {
  const posts = (await db.query(
    `SELECT ${POST_COLS} FROM vec_posts p
     WHERE p.zone = $1 AND NOT p.hidden AND (SELECT count(*) FROM vec_reports r WHERE r.post_id = p.id) < 3
     ORDER BY p.created_at DESC LIMIT 200`, [zone])).rows;
  if (!posts.length) return [];
  const replies = (await db.query(
    `SELECT post_id, author, role, text, text_es, text_en, example, to_char(created_at AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD') AS date
     FROM vec_replies WHERE post_id = ANY($1) ORDER BY created_at`, [posts.map((p) => p.id)])).rows;
  const by = new Map(posts.map((p) => [p.id, Object.assign(p, { replies: [] })]));
  for (const r of replies) by.get(r.post_id)?.replies.push(r);
  for (const p of posts) { for (const k of Object.keys(p)) if (p[k] === null) delete p[k]; p.ts = new Date(p.ts).toISOString(); }
  return posts;
}

/* ---------- API ---------- */
async function api(req, res, url) {
  if (!db) return send(res, 503, { error: "no database" });
  const parts = url.pathname.split("/").filter(Boolean); // ["api","vecinos",id?,action?]
  const ip = clientIp(req);
  if (req.method === "GET" && parts.length === 2) {
    const zone = url.searchParams.get("zone") || "";
    if (!ZONE.test(zone)) return send(res, 400, { error: "zone" });
    return send(res, 200, { posts: await listPosts(zone) });
  }
  if (req.method !== "POST") return send(res, 405, { error: "method" });
  const body = await readJson(req);
  if (parts.length === 2) {
    if (!allowed("w:" + ip, 8, 10 * 60e3)) return send(res, 429, { error: "slow down" });
    const type = body.type, zone = String(body.zone || ""), text = clean(body.text, 280);
    if (!TYPES.has(type) || !ZONE.test(zone)) return send(res, 400, { error: "type or zone" });
    let crop = null, sowMonth = null, sowYear = null, result = null, area = null, unit = null;
    if (type === "asi_me_fue") {
      crop = String(body.crop || ""); sowMonth = +body.sowMonth; sowYear = +body.sowYear; result = body.result;
      const thisYear = new Date().getFullYear();
      if (!CROPS.has(crop) || !(sowMonth >= 1 && sowMonth <= 12) || !(sowYear >= thisYear - 10 && sowYear <= thisYear) || !RESULTS.has(result)) return send(res, 400, { error: "report fields" });
      if (body.area != null && +body.area > 0 && +body.area < 100000) { area = +body.area; unit = UNITS.has(body.unit) ? body.unit : "ha"; }
    } else if (!text) return send(res, 400, { error: "text" });
    const id = "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await db.query(`INSERT INTO vec_posts (id, type, zone, crop, sow_month, sow_year, result, area, unit, text, author, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'web')`,
      [id, type, zone, crop, sowMonth, sowYear, result, area, unit, text || null, maskName(body.author)]);
    return send(res, 201, { id });
  }
  const id = String(parts[2] || "").slice(0, 40);
  if (parts[3] === "replies") {
    if (!allowed("w:" + ip, 8, 10 * 60e3)) return send(res, 429, { error: "slow down" });
    const text = clean(body.text, 280);
    if (!text) return send(res, 400, { error: "text" });
    const r = await db.query(`INSERT INTO vec_replies (post_id, author, text) SELECT id, $2, $3 FROM vec_posts WHERE id = $1 AND NOT hidden`, [id, maskName(body.author), text]);
    return r.rowCount ? send(res, 201, { ok: true }) : send(res, 404, { error: "post" });
  }
  if (parts[3] === "report") {
    if (!allowed("r:" + ip, 30, 10 * 60e3)) return send(res, 429, { error: "slow down" });
    const reporter = clean(body.device, 64) || ip;
    const r = await db.query(`INSERT INTO vec_reports (post_id, reporter) SELECT id, $2 FROM vec_posts WHERE id = $1 ON CONFLICT DO NOTHING`, [id, reporter]);
    return send(res, 200, { ok: true, new: r.rowCount > 0 });
  }
  return send(res, 404, { error: "not found" });
}

async function readBody(req, limit) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error("too large"), { code: 413 }); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function rootiApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/rooti") return send(res, 200, rooti.status());
  if (req.method !== "POST") return send(res, 405, { error: "method" });
  const ip = clientIp(req);
  // A conversation turn takes a few calls (one per tool round), so the limit counts calls, not questions
  if (url.pathname === "/api/rooti") {
    if (!allowed("a:" + ip, 80, 10 * 60e3)) return send(res, 429, { error: "slow down" });
    const r = await rooti.chat(await readJson(req, 96 * 1024));
    return send(res, r.status, r.body);
  }
  if (url.pathname === "/api/rooti/voice") {
    if (!allowed("v:" + ip, 30, 10 * 60e3)) return send(res, 429, { error: "slow down" });
    const r = await rooti.transcribe(await readBody(req, 4 * 1024 * 1024), String(req.headers["content-type"] || ""), url.searchParams.get("lang"));
    return send(res, r.status, r.body);
  }
  return send(res, 404, { error: "not found" });
}

/* ---------- static app ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".geojson": "application/geo+json" };
async function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(APP, "." + path.posix.normalize(rel));
  if (!file.startsWith(APP + path.sep)) { res.writeHead(403); return res.end(); }
  let st;
  try { st = await stat(file); } catch { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
  if (st.isDirectory()) { res.writeHead(301, { location: url.pathname + "/" }); return res.end(); }
  const ext = path.extname(file).toLowerCase();
  // The app versions its files with ?v=, so the browser may keep assets; pages and data are revalidated every time.
  const cache = [".html", ".json"].includes(ext) || !url.search ? "no-cache" : "public, max-age=604800";
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "content-length": st.size, "cache-control": cache, "x-content-type-options": "nosniff" });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/healthz") return send(res, 200, { ok: true, db: !!db });
    if (url.pathname.startsWith("/api/vecinos")) return await api(req, res, url);
    if (url.pathname === "/api/rooti" || url.pathname.startsWith("/api/rooti/")) return await rootiApi(req, res, url);
    if (url.pathname === "/data/bot.json" && process.env.ROOTI_BOT_URL) return send(res, 200, { url: process.env.ROOTI_BOT_URL, whatsapp: (process.env.ROOTI_WHATSAPP || "").replace(/\D/g, "") });
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    return await serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.code >= 400 && e.code < 500 ? e.code : 500, { error: e.code >= 400 && e.code < 500 ? e.message : "server" });
    if (!(e.code >= 400 && e.code < 500)) console.error(e);
  }
});

await rooti.loadPersona(process.env.ROOTI_PERSONA || rooti.defaultPersona(HERE));
CROPS = new Set(Object.keys(JSON.parse(await readFile(path.join(APP, "data", "crops.json"), "utf8")).crops || {}));
if (db) {
  for (let i = 1; ; i++) {
    try { await migrate(); console.log("vecinos: database ready"); break; }
    catch (e) { if (i >= 10) { console.error("vecinos: database not ready, serving without it", e.message); break; } await new Promise((r) => setTimeout(r, 2000 * i)); }
  }
} else console.warn("vecinos: DATABASE_URL not set, the app will use its example posts");
server.listen(PORT, () => console.log(`rooti web on :${PORT}, app ${APP}`));
