// Rooti inside the web app. The browser keeps the conversation and runs the tools on the page's own state and
// planner; this server only holds the keys, the persona and the tool list, so a page cannot add tools of its own.
// Env: DEEPSEEK_API_KEY (the model, the same as the WhatsApp bot), GROQ_API_KEY (voice notes), ROOTI_MODEL.
import { readFile } from "node:fs/promises";
import path from "node:path";

const MODEL = process.env.ROOTI_MODEL || "deepseek-chat";
// The URLs can point elsewhere so the E2E test runs against a fake model
const CHAT_URL = process.env.ROOTI_CHAT_URL || "https://api.deepseek.com/chat/completions";
const STT_URL = process.env.ROOTI_STT_URL || "https://api.groq.com/openai/v1/audio/transcriptions";
const on = () => !!process.env.DEEPSEEK_API_KEY;
const voiceOn = () => !!process.env.GROQ_API_KEY;

const SCREENS = ["plan", "plot", "try", "compare", "past", "neighbors", "planner", "course"];
const IDEAS = ["irrigation", "straw", "legume", "instead", "nino", "dry", "all"];
const TOOLS = [
  { name: "show_on_page", description: "Open a screen of the page and mark what you are talking about, so the farmer sees it while reading your answer. Call it whenever your answer refers to something on the page.",
    parameters: { type: "object", additionalProperties: false, required: ["screen"], properties: {
      screen: { type: "string", enum: SCREENS, description: "plan: the recommended plans, route, years and calendar. plot: soil, slope, climate. try: ideas that would do better and the best sowing months. compare: build your own plan. past: every run of real years. neighbors: what farmers nearby report. planner: where, when, crops and land. course: the free course." },
      mark: { type: "string", description: "What to mark. On plan: route, years, calendar, cover, plans, unknowns, nino, or crop-<crop id> (e.g. crop-maize). On try: sow, or idea-<irrigation|straw|legume|instead|nino|dry|all>." } } } },
  { name: "change_plot", description: "Change the farmer's plot data with only what they just said, and recompute the plan. The page shows the change with an Undo button.",
    parameters: { type: "object", additionalProperties: false, properties: {
      place: { type: "string", description: "Town or area of the plot, e.g. 'Daule'" },
      area: { type: "number", description: "Size of the plot, in unit" },
      unit: { type: "string", enum: ["ha", "cuadra", "m2", "acre"] },
      crops: { type: "array", items: { type: "string" }, description: "Crop ids the plan may use, from the list in the page context" },
      current: { type: "array", items: { type: "string" }, description: "Crop ids the farmer grows today" },
      irrigation: { type: "boolean" },
      floods: { type: "string", enum: ["yes", "sometimes", "no"], description: "Whether the plot floods in the rainy season" },
      start: { type: "string", description: "First month of the plan, YYYY-MM" },
      end: { type: "string", description: "Last month of the plan, YYYY-MM" } } } },
  { name: "try_idea", description: "Test a 'what if' on the farmer's plan with the planner and open it on the Try screen. It does not change the plan: the farmer decides with a button.",
    parameters: { type: "object", additionalProperties: false, required: ["idea"], properties: {
      idea: { type: "string", enum: IDEAS, description: "irrigation, straw (keep the straw), legume (add a legume), instead (another crop for one that does badly), nino (only El Niño years), dry (only dry years), all (every year)" } } } },
  { name: "offer_whatsapp", description: "Show a button to keep going with Rooti on WhatsApp, where Rooti sends heavy-rain and time-to-sow alerts for this plot. Only when the farmer wants alerts or to continue on WhatsApp.",
    parameters: { type: "object", additionalProperties: false, properties: {} } },
].map((f) => ({ type: "function", function: f }));

const GLOSSARY = `ET or evapotranspiration: the water the sun and wind take out of the soil and the leaves each day; if it rains less than that, the plant goes thirsty.
Soil moisture anomaly: when the ground holds more or less water than normal for that month.
NDVI: a satellite number for how green the field is; high is a healthy, dense crop, low is bare soil or a dry plant.
Water balance: the rain minus what the plant and the sun take; if it is negative, the crop needs water.
El Niño: when the sea off the coast warms up; on the coast of Ecuador it usually brings much wetter rainy seasons, with floods, like 1983 and 1998.
Bare soil: ground with nothing growing and no straw on it; heavy rain washes it away and the sun dries it out.
NASA POWER: NASA climate data since 1981 for squares about 50 km wide; it describes the area, not the exact plot.`;

// Who Rooti is comes from the WhatsApp persona, so both channels sound like the same Rooti
let persona = "";
export async function loadPersona(file) {
  try {
    const soul = await readFile(file, "utf8");
    persona = ["## Quién eres", "## Tu personalidad"].map((h) => soul.split(h)[1]?.split("\n## ")[0]?.trim()).filter(Boolean).join("\n\n");
  } catch { persona = ""; }
  if (!persona) console.warn(`rooti: persona not found at ${file}, using the short one`);
}
const system = (lang, context) => `You are Rooti, a field assistant for smallholder farmers on the coast of Ecuador. You help them decide what to plant, when and on how much land, from what the Rooti tool computes with 45 years of NASA climate data and the soil of their plot. You support the farmer and their technician; you never replace them.

${persona}

## Where you are now
You are inside the Rooti web page, in a chat panel next to the screen the farmer is looking at. The page context at the end says what is on that screen; trust it over anything you remember.

## How you answer
- Reply in ${lang === "en" ? "English. Keep the same warmth, without the coastal Spanish slang." : "Spanish, always with «usted»."}
- 2 to 4 short sentences, the most important first. No lists, tables, markdown, links or emojis beyond one at most.
- Numbers the way they are said in the field: "39 of 44 years", never percentages.
- Answer from the page context and your tools, never from memory. If the data is not there, say so and suggest the technician or the MAG.
- When your answer refers to something on the page (the plan, a crop in the route, the years, the calendar, an idea, the plot), call show_on_page so the page opens it and marks it.
- When the farmer tells you something about their plot (where, how much land, which crops, dates, irrigation, flooding), call change_plot right away with only what they said. Never invent a value. The first time, say in a few words that they can undo it.
- For "what if" questions call try_idea. It does not change the plan: say what would change and that they can apply it with the button. Never say you changed the plan when you did not.
- You never publish on Neighbors and never send anything by WhatsApp. For alerts or to continue on WhatsApp, call offer_whatsapp: the farmer taps the button.
- Say what we do not know: NASA climate describes about 50 km around the plot, prices are averages, pests and drainage need local eyes.
- Never mention tools, models, the system, the page context or errors. If something failed, say it like a person would.

## Words to explain in one plain sentence when they come up
${GLOSSARY}

## Page context
${context}`;

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
  return out.length && out[0].role === "user" ? out : null;
}

export async function chat(body) {
  if (!on()) return { status: 503, body: { error: "off" } };
  const lang = body.lang === "en" ? "en" : "es", msgs = messages(body.messages);
  if (!msgs) return { status: 400, body: { error: "messages" } };
  const r = await fetch(CHAT_URL, {
    method: "POST", signal: AbortSignal.timeout(40e3),
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({ model: MODEL, temperature: 0.4, max_tokens: 500, tools: TOOLS, tool_choice: "auto",
      messages: [{ role: "system", content: system(lang, clean(body.context, 8000)) }, ...msgs] }),
  });
  if (!r.ok) { console.error("rooti: model", r.status, (await r.text()).slice(0, 300)); return { status: 502, body: { error: "model" } }; }
  const m = (await r.json()).choices?.[0]?.message || {};
  return { status: 200, body: { message: { role: "assistant", content: m.content || "", ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) } } };
}

export async function transcribe(audio, type, lang) {
  if (!voiceOn()) return { status: 503, body: { error: "off" } };
  const ext = /mp4|m4a|aac/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : /wav/.test(type) ? "wav" : "webm";
  const fd = new FormData();
  fd.append("file", new Blob([audio], { type: type || "audio/webm" }), `voice.${ext}`);
  fd.append("model", "whisper-large-v3-turbo");
  fd.append("language", lang === "en" ? "en" : "es");
  fd.append("response_format", "json");
  const r = await fetch(STT_URL, { method: "POST", body: fd, signal: AbortSignal.timeout(30e3), headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}` } });
  if (!r.ok) { console.error("rooti: voice", r.status, (await r.text()).slice(0, 300)); return { status: 502, body: { error: "voice" } }; }
  return { status: 200, body: { text: String((await r.json()).text || "").trim().slice(0, 1500) } };
}

export const status = () => ({ on: on(), voice: voiceOn() });
export const defaultPersona = (here) => path.join(here, "..", "bot", "hermes", "rooti", "SOUL.md");
