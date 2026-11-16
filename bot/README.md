# Rooti on WhatsApp

A farmer talks to Rooti on WhatsApp, by text or voice note, and Rooti answers like someone who knows their plot:
what to sow, when and on how much land, from the same planner the web app runs on NASA POWER data. Voice notes get
voice notes back. When the farmer agrees, Rooti also writes first, with heavy-rain and time-to-sow alerts that open
a page with the coming days' rain.

It is adapted from Vinci, a WhatsApp assistant already in production on Hermes Agent: same base image, same WhatsApp
bridge and its button patch, the same plugin patterns (endpointing, quiet notices, tool-call channel) and the same
E2E approach.

## How it works

```
WhatsApp ── Hermes' bridge (Baileys) ── Hermes gateway ── rooti-whatsapp plugin (no model)
                                              │
                                              ├─ the model, with Rooti's SOUL.md and only Rooti's tools
                                              └─ rooti-bot mcp ── tools.py ── engine/rooti.mjs (app/planner.js)
                                                                     └─ rooti.db: each farmer's lot and plan
rooti-avisos (no model) ── forecast + saved plan ── voice note + «Ver el aviso» button
rooti-web ── server.py ── the website, the pages farmers open from WhatsApp, their API, the website's Rooti
```

- **One bot, one Hermes profile.** Every farmer gets their own Hermes session. What Rooti knows about each lot
  lives in `rooti.db`, keyed by the WhatsApp chat. Hermes' own memory is off, because it is per profile and would
  carry one farmer's words into another farmer's chat.
- **The plugin** (`hermes/plugins/rooti-whatsapp/`) answers only private chats and transcribes forwarded audio. It
  also joins a question split across several bubbles and hides Hermes' operator notices. Each tool call gets the
  chat it comes from, so the model never names whose lot it reads. Each turn opens with the farmer's lot, so the
  first answer needs no tool call.
- **The tools** (`src/rooti_bot/tools.py`):

  | Tool | What it does |
  |---|---|
  | `mi_lote` | What Rooti knows about the plot |
  | `guardar_lote` | Saves or corrects plot data and computes the plan |
  | `plan_recomendado` | The recommended plan for the plot |
  | `cuando_sembrar` | The best sowing months for each crop |
  | `probar` | What changes with other crops, irrigation, or dry, wet or El Niño years |
  | `como_va_este_anio` | Recent rain against the normal for those months |
  | `explicar` | Explains a term in plain words |
  | `boton_lote` | Sends «Marcar mi lote», the app's map and crop questions |
  | `boton_plan` | Sends «Ver mi plan», the app's plan page |

  A button is a page that backs up the answer, never the answer: the model sends one when the farmer needs it
  (SOUL.md, «Las páginas»), and it goes out right after Rooti's text, not before it. Each turn's context lists the
  buttons the farmer already got today, so none is sent twice.
- **The planner** is the web app's own code (`app/planner.js`, `climate.js`, `terrain.js`), run headless by
  `engine/rooti.mjs`. The first plan for a plot takes up to a minute and a half (three at most), mostly waiting on SoilGrids, and on
  WhatsApp the farmer is told Rooti is checking before that wait. After that it is read from the database until the
  plot changes, so an answer never waits on NASA. The page and the chat asking for the same new plan compute it once. A plan saved without soil, because
  SoilGrids did not answer, asks for it again after a day.
- **Voice.** Speech to text is Groq's Whisper. Rooti's voice is Edge TTS with Vinci's Ecuadorian voice. Hermes
  replies to a voice note with a voice note on its own (`voice.auto_tts`).
- **Alerts** (`src/rooti_bot/alerts.py`) run without the model, every 30 minutes. They go only to farmers who said
  yes, only between 7:00 and 18:59, and at most 2 a week:
  - heavy rain in the next 3 days (Open-Meteo forecast, 40 mm or more in a day);
  - the plan's next sowing month, 10 days before it starts.

  Each alert is a voice note followed by the «Ver el aviso» button. If nobody opens the page within 4 hours, a short
  reminder with the same button follows.
- **Rooti in the website** (`src/rooti_bot/web_agent.py`): the avatar on every page of the app talks to `/api/rooti`
  on this address, with the same model and persona, its answer streamed as it is written; the prompt and its page
  tools are `hermes/rooti/WEB.md` and `web-tools.json`, and `glossary.json` holds the words both channels explain.
  The Node website asks this same API across sites. A page opened from WhatsApp carries the farmer's signed link, so
  its Rooti knows the chat's notes and chosen plan, and each turn in the chat knows what they asked on the page.
  `/api/rooti/say` reads its answers aloud with the WhatsApp voice (Edge TTS), streamed and cached; the page fetches
  each answer's audio as soon as it shows. See the main README.
- **The pages** (`src/rooti_bot/web.py`): the buttons open the web app itself, served at the root of Rooti's address,
  signed in as that farmer by the same kind of signed link. There is one lot, in `rooti.db`: what the farmer
  marks on the map, Rooti knows in the chat and confirms there; the plan they pick on the page reaches the chat and
  the model's context. An alert's «Ver el aviso» opens the coming days' rain and what to do. The other way
  round, the public website's «Continuar en WhatsApp» turns a plan into a code (`RT-XXXX`) that the farmer sends to
  Rooti, and the plugin brings that lot into the chat before the model reads the message.

## Run it

Deploy as a second app in Coolify, next to Vinci, built from this repo with `bot/Dockerfile` (build context: the
repo root). Set these variables:

| Variable | What it is |
|---|---|
| `DEEPSEEK_API_KEY` | The model (default `deepseek` / `deepseek-chat`; change with `ROOTI_PROVIDER`, `ROOTI_MODEL`) |
| `GROQ_API_KEY` | Speech to text for voice notes (free tier) |
| `ROOTI_CALL_SECRET` | Optional: signs the page links. Without it, Rooti makes one in the volume on first use |
| `ROOTI_CALL_URL` | Rooti's public HTTPS address (port 7860): the website at `/` and its pages. The name is from the live call, since removed |
| `ROOTI_OPERATOR` | Optional: your number, for Hermes' own deliveries |
| `ROOTI_WHATSAPP` | Optional: Rooti's number for the pages' WhatsApp buttons; by default the number the bridge is linked to |

Rooti needs its own number, not Vinci's: a prepaid SIM is enough. Link it once, with the gateway stopped, from the
container's terminal:

```bash
rooti-bot whatsapp-vincular 5939XXXXXXXX     # type the 8-letter code on Rooti's phone: Linked devices
```

On a PC, for development:

```bash
cd bot
uv venv .venv && uv pip install -e .                    # the gateway's tools and the web server
uv pip install --python .venv/bin/python pytest
.venv/bin/python -m pytest tests/e2e                    # ~35 s: real Hermes and live NASA POWER, fake WhatsApp and model
.venv/bin/rooti-bot avisos --probar                     # what the alerts would send now, without sending
```

How fast Rooti answers, from the farmer's message to the first text and the first voice note (median and p90 over
the last week), in the container's terminal:

```bash
rooti-bot tiempos [--dias 7]
```

How Rooti on the website is doing: questions, seconds to a full answer, tools that failed and the latest questions:

```bash
rooti-bot web-turnos [--dias 7] [--ultimas 10]
```

How it answers with the real model, on 16 farmer questions against page contexts captured from the app
(`evals/contexts.json`): short, no percentages, the right tool, neighbors' posts never obeyed:

```bash
DEEPSEEK_API_KEY=... rooti-bot web &                    # or any address that serves this bot's /api/rooti
python evals/web_agent.py --url http://127.0.0.1:7860
```

For the public website (`server/server.mjs`) to show «Continuar en WhatsApp» and its Rooti, set `ROOTI_BOT_URL` (the
address above) and `ROOTI_WHATSAPP` on that app too.

## Known limits

- **The bridge is an unofficial WhatsApp client**, as with Vinci, and WhatsApp may ban a number that uses it. Alerts
  go only to farmers who wrote first and said yes, at most 2 a week.
- **The page button opening inside WhatsApp** was seen working on iPhone in Vinci's tests, and was never tested on
  Android, where most farmers are. Elsewhere the button opens the browser.
- **No calls:** Rooti talks by text and voice notes only. The bridge cannot place WhatsApp calls, a real phone call
  (Twilio) costs about $0.53 a minute to Ecuadorian mobiles, and a call in the browser needed a TURN relay that the
  server's network did not allow.
- **«Marcar mi lote» loads the web app's 3D map (Cesium)** on the farmer's phone: a few MB of mobile data the first
  time.
- **No pest alerts:** Rooti has no pest data yet.
- **The E2E skips voice notes:** voice in and voice out depend on Groq and Hermes' own voice reply, which a test
  with fake keys cannot run. A voice note to the real number is the check.
