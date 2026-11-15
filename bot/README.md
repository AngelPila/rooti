# Rooti on WhatsApp

A farmer talks to Rooti on WhatsApp, by text or voice note, and Rooti answers like someone who knows their plot:
what to sow, when and on how much land, from the same planner the web app runs on NASA POWER data. Voice notes get
voice notes back. For a longer conversation, Rooti sends a «📞 Hablar con Rooti» button that opens a live voice call
in the browser. When the farmer agrees, Rooti also writes first, with heavy-rain and time-to-sow alerts that come
with that same call button.

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
rooti-avisos (no model) ── forecast + saved plan ── voice note + call button
rooti-llamada ── call/ page ── WebRTC (Pipecat) ── Groq Whisper → model + tools → Edge TTS
```

- **One bot, one Hermes profile.** Every farmer gets their own Hermes session. What Rooti knows about each lot
  lives in `rooti.db`, keyed by the WhatsApp chat. Hermes' own memory is off, because it is per profile and would
  carry one farmer's words into another farmer's chat.
- **The plugin** (`hermes/plugins/rooti-whatsapp/`) answers only private chats and transcribes forwarded audio. It
  also joins a question split across several bubbles and hides Hermes' operator notices. Each tool call gets the
  chat it comes from, so the model never names whose lot it reads. Each turn opens with the farmer's lot, so the
  first answer needs no tool call.
- **The tools** (`src/rooti_bot/tools.py`) are the same for WhatsApp and for the live call:

  | Tool | What it does |
  |---|---|
  | `mi_lote` | What Rooti knows about the plot |
  | `guardar_lote` | Saves or corrects plot data and computes the plan |
  | `plan_recomendado` | The recommended plan for the plot |
  | `cuando_sembrar` | The best sowing months for each crop |
  | `probar` | What changes with other crops, irrigation, or dry, wet or El Niño years |
  | `como_va_este_anio` | Recent rain against the normal for those months |
  | `explicar` | Explains a term in plain words |
  | `boton_llamada` | WhatsApp only: sends the call button |
  | `boton_lote` | WhatsApp only: sends «Marcar mi lote», the app's map and crop questions |
  | `boton_plan` | WhatsApp only: sends «Ver mi plan», the app's plan page |

- **The planner** is the web app's own code (`app/planner.js`, `climate.js`, `terrain.js`), run headless by
  `engine/rooti.mjs`. The first plan for a plot takes up to a minute, mostly waiting on SoilGrids. After that it is
  read from the database until the plot changes, so an answer never waits on NASA.
- **Voice.** Speech to text is Groq's Whisper. Rooti's voice is Edge TTS with Vinci's Ecuadorian voice. Hermes
  replies to a voice note with a voice note on its own (`voice.auto_tts`).
- **Alerts** (`src/rooti_bot/alerts.py`) run without the model, every 30 minutes. They go only to farmers who said
  yes, only between 7:00 and 18:59, and at most 2 a week:
  - heavy rain in the next 3 days (Open-Meteo forecast, 40 mm or more in a day);
  - the plan's next sowing month, 10 days before it starts.

  Each alert is a voice note followed by the call button. If nobody opens the call within 4 hours, a short reminder
  follows.
- **The pages** (`src/rooti_bot/web.py`): the buttons open the web app itself, served at the root next to the call
  page, signed in as that farmer by the same kind of signed link. There is one lot, in `rooti.db`: what the farmer
  marks on the map, Rooti knows in the chat and confirms there; the plan they pick on the page reaches the chat and
  the model's context. An alert's «Ver el aviso» opens the coming days' rain and the call button. The other way
  round, the public website's «Continuar en WhatsApp» turns a plan into a code (`RT-XXXX`) that the farmer sends to
  Rooti, and the plugin brings that lot into the chat before the model reads the message.
- **The call** (`call/`, `src/rooti_bot/call_server.py`): the button's link carries a signed token (48 h), so the
  page knows whose plot it is and which alert it answers. The page sends the microphone over WebRTC to Pipecat's
  SmallWebRTC, peer to peer. Rooti speaks first about the alert and the farmer can interrupt it.

## Run it

Deploy as a second app in Coolify, next to Vinci, built from this repo with `bot/Dockerfile` (build context: the
repo root). Set these variables:

| Variable | What it is |
|---|---|
| `DEEPSEEK_API_KEY` | The model (default `deepseek` / `deepseek-chat`; change with `ROOTI_PROVIDER`, `ROOTI_MODEL`) |
| `GROQ_API_KEY` | Speech to text for voice notes and calls (free tier) |
| `ROOTI_CALL_SECRET` | Optional: signs the call links. Without it, Rooti makes one in the volume on first use |
| `ROOTI_CALL_URL` | Rooti's public HTTPS address (port 7860): the website at `/`, its pages and the call at `/llamada` (browsers allow the microphone only on HTTPS) |
| `ROOTI_OPERATOR` | Optional: your number, for Hermes' own deliveries |
| `ROOTI_WHATSAPP` | Optional: Rooti's number for the pages' WhatsApp buttons; by default the number the bridge is linked to |
| `ROOTI_ICE_SERVERS` | Optional: STUN/TURN servers as JSON (see the limits below) |

Rooti needs its own number, not Vinci's: a prepaid SIM is enough. Link it once, with the gateway stopped, from the
container's terminal:

```bash
rooti-bot whatsapp-vincular 5939XXXXXXXX     # type the 8-letter code on Rooti's phone: Linked devices
```

On a PC, for development:

```bash
cd bot
uv venv .venv && uv pip install -e .                    # the gateway's tools
uv venv .venv-call --python 3.12 && uv pip install --python .venv-call/bin/python -e ".[call]"   # the call
uv pip install --python .venv/bin/python pytest
.venv/bin/python -m pytest tests/e2e                    # ~35 s: real Hermes and live NASA POWER, fake WhatsApp and model
.venv/bin/rooti-bot avisos --probar                     # what the alerts would send now, without sending
```

How fast Rooti answers, from the farmer's message to the first text and the first voice note (median and p90 over
the last week), in the container's terminal:

```bash
rooti-bot tiempos [--dias 7]
```

For the public website (`server/server.mjs`) to show «Continuar en WhatsApp», set `ROOTI_BOT_URL` (the address
above) and `ROOTI_WHATSAPP` on that app too.

## Known limits

- **The bridge is an unofficial WhatsApp client**, as with Vinci, and WhatsApp may ban a number that uses it. Alerts
  go only to farmers who wrote first and said yes, at most 2 a week.
- **The page button opening inside WhatsApp** was seen working on iPhone in Vinci's tests, and was never tested on
  Android, where most farmers are. Elsewhere the button opens the browser, and the call works the same.
- **The call is not a phone call:** the phone does not ring, and it uses mobile data. The bridge cannot place
  WhatsApp calls, and a real phone call (Twilio) costs about $0.53 a minute to Ecuadorian mobiles.
- **Call audio is UDP between the phone and the server.** On a server behind Docker's bridge network, or for a
  phone behind a carrier's CGNAT, it needs a TURN relay (coturn, or a hosted one) in `ROOTI_ICE_SERVERS`, or the
  container on host networking.
- **«Marcar mi lote» loads the web app's 3D map (Cesium)** on the farmer's phone: a few MB of mobile data the first
  time.
- **No pest alerts:** Rooti has no pest data yet.
- **The E2E skips voice notes:** voice in and voice out depend on Groq and Hermes' own voice reply, which a test
  with fake keys cannot run. A voice note to the real number is the check.
