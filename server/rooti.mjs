// Rooti inside the web app. The browser keeps the conversation and runs the tools on the page's own state and
// planner; this server only holds the keys, the persona and the tool list, so a page cannot add tools of its own.
// Env: DEEPSEEK_API_KEY (the model, the same as the WhatsApp bot), GROQ_API_KEY (voice notes), ROOTI_MODEL.
import { readFile } from "node:fs/promises";
import path from "node:path";

const MODEL = process.env.ROOTI_MODEL || "deepseek-chat";
// The URLs can point elsewhere so the E2E test runs against a fake model
const CHAT_URL = process.env.ROOTI_CHAT_URL || "https://api.deepseek.com/chat/completions";
const STT_URL = process.env.ROOTI_STT_URL || "https://api.groq.com/openai/v1/audio/transcriptions";
const on = () => !!process.env.DEEPSEEK_API_KEY && !!template;
const voiceOn = () => !!process.env.GROQ_API_KEY;

// The prompt and the tools live next to the persona, so this server and the bot's (web_agent.py) send the same ones
let persona = "", template = "", TOOLS = [];
export async function load(dir) {
  try {
    const soul = await readFile(path.join(dir, "SOUL.md"), "utf8");
    persona = ["## Quién eres", "## Tu personalidad"].map((h) => soul.split(h)[1]?.split("\n## ")[0]?.trim()).filter(Boolean).join("\n\n");
    template = (await readFile(path.join(dir, "WEB.md"), "utf8")).replace(/<!--[\s\S]*?-->\s*/, "");
    TOOLS = JSON.parse(await readFile(path.join(dir, "web-tools.json"), "utf8"));
  } catch (e) { console.warn(`rooti: no prompt in ${dir}, Rooti stays off`, e.message); template = ""; }
}
const LANGUAGE = { es: "Spanish, always with «usted».", en: "English. Keep the same warmth, without the coastal Spanish slang." };
const system = (lang, context) => template.replace("{persona}", () => persona).replace("{language}", () => LANGUAGE[lang]).replace("{context}", () => context);

const clean = (s, max) => (typeof s === "string" ? s.slice(0, max) : "");
function messages(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const m of list.slice(-40)) {
    if (m?.role === "user") out.push({ role: "user", content: clean(m.content, 1500) });
    else if (m?.role === "assistant") {
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls.slice(0, 4).map((c) => ({ id: clean(c.id, 80), type: "function",
        function: { name: clean(c.function?.name, 40), arguments: clean(c.function?.arguments, 2000) } })) : [];
      out.push({ role: "assistant", content: clean(m.content, 2000) || (calls.length ? null : ""), ...(calls.length ? { tool_calls: calls } : {}) });
    } else if (m?.role === "tool") out.push({ role: "tool", tool_call_id: clean(m.tool_call_id, 80), content: clean(m.content, 3000) });
    else return null;
  }
  // The cut at 40 can land inside a turn; the model only accepts a history that starts with the farmer
  const first = out.findIndex((m) => m.role === "user");
  return first >= 0 ? out.slice(first) : null;
}

export async function chat(body) {
  if (!on()) return { status: 503, body: { error: "off" } };
  const lang = body.lang === "en" ? "en" : "es", msgs = messages(body.messages);
  if (!msgs) return { status: 400, body: { error: "messages" } };
  const prompt = [{ role: "system", content: system(lang, clean(body.context, 8000)) }, ...msgs];
  // The last round of a turn must answer in words, so a model that keeps calling tools still says something.
  // DeepSeek now and then answers with neither words nor tools: ask again, then insist on words.
  for (const choice of body.final ? ["none"] : ["auto", "auto", "none"]) {
    const r = await fetch(CHAT_URL, {
      method: "POST", signal: AbortSignal.timeout(40e3),
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({ model: MODEL, temperature: 0.4, max_tokens: 400, tools: TOOLS, tool_choice: choice, messages: prompt }),
    });
    if (!r.ok) { console.error("rooti: model", r.status, (await r.text()).slice(0, 300)); return { status: 502, body: { error: "model" } }; }
    const c = (await r.json()).choices?.[0] || {}, m = c.message || {};
    if (m.content?.trim() || m.tool_calls?.length) return { status: 200, body: { message: { role: "assistant", content: m.content || "", ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) } } };
    console.warn("rooti: empty answer", c.finish_reason, choice);
  }
  return { status: 200, body: { message: { role: "assistant", content: "" } } };
}

export async function transcribe(audio, type, lang) {
  if (!voiceOn()) return { status: 503, body: { error: "off" } };
  const ext = /mp4|m4a|aac/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : /wav/.test(type) ? "wav" : "webm";
  const fd = new FormData();
  fd.append("file", new Blob([audio], { type: type || "audio/webm" }), `voice.${ext}`);
  fd.append("model", "whisper-large-v3-turbo");
  fd.append("language", lang === "en" ? "en" : "es");
  fd.append("response_format", "json");
  // Place and crop names Whisper otherwise mishears ("Daule" came back as "dable")
  if (lang !== "en") fd.append("prompt", "Daule, Babahoyo, Quevedo, Salitre, Vinces, Los Ríos, Guayas, cuadras, hectáreas, arroz, maíz, soya, maní, fréjol, riego, invierno, verano, El Niño, Rooti.");
  const r = await fetch(STT_URL, { method: "POST", body: fd, signal: AbortSignal.timeout(30e3), headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}` } });
  if (!r.ok) { console.error("rooti: voice", r.status, (await r.text()).slice(0, 300)); return { status: 502, body: { error: "voice" } }; }
  return { status: 200, body: { text: String((await r.json()).text || "").trim().slice(0, 1500) } };
}

export const status = () => ({ on: on(), voice: voiceOn() });
export const defaultDir = (here) => path.join(here, "..", "bot", "hermes", "rooti");
