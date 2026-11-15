# Rooti

**What should I plant so my soil lasts longer?** Rooti compares crop-rotation plans for a smallholder's plot against 45 years of NASA climate data, month by month, and replays each plan over the real years 2001–2024.

NASA Space Apps Challenge 2026 · *Field Shift: Adapting Farms with NASA Data* · Local event: Guayaquil, Ecuador.

Pilot zones: Daule, Babahoyo and Quevedo (rice and maize on the Ecuadorian coast).

## Try it

```bash
cd app && python3 -m http.server 8765    # then open http://localhost:8765
```

On the landing page, tap one of the examples — **Daule, Ecuador (rice in El Niño)**, **Quevedo, Ecuador (maize and soybean)** or **Iowa, USA (corn and soybean)**. Their climate and plot data ship with the app (`app/data/demo/`), so they work without internet. Any other place on Earth fetches NASA POWER and soil data live. Add `?lang=en` or `?lang=es` to force a language.

Submission texts, demo script and judging notes: [`docs/SUBMISSION.md`](docs/SUBMISSION.md). Sources: [`docs/REFERENCES.md`](docs/REFERENCES.md). Use of AI: [`SI_USAGE.md`](SI_USAGE.md).

## Screens

Each route has its own layout on a computer and on a phone, and fits one screen without scrolling where possible:

| Route | Computer | Phone |
|---|---|---|
| `#/` | Landing: headline, photo with a sample farm calendar, how it works, NASA data | Same pitch, button within thumb reach |
| `#/bootcamp` | Free 12-minute course on planting and crop rotation, with a final quiz and course links | Same lessons and quiz, stacked |
| `#/planear` | Map on the left (click to mark the plot), all questions on the right | Four steps: where, when, which crops, land and water |
| `#/plan` | Answer, figures and land per crop on the left; farm calendar with monthly rain on the right; top ideas | Answer, figures, farm calendar, link to ideas |
| `#/terreno` | The plot: elevation and slope (Copernicus DEM via Open-Meteo), soil texture, pH and organic matter (ISRIC SoilGrids), waterlogging (soil + flatness, Landsat/JRC in pilot zones, or the farmer's answer), climate of the place, this year (last month vs normal, El Niño), practical tips | Same, stacked |
| `#/probar` | Ideas that would do better (each checked by re-running the planner), when to sow each crop | Same, stacked |
| `#/comparar` | Build your own plan (plots, crops, months, land) next to both calendars and a comparison table | Same, stacked |
| `#/pasado` | The plan on every real run of years since 1981 | Same |

Interface text is in plain language (Spanish first, English toggle): no jargon, fractions like "1 de cada 6 años" instead of percentages.

The bootcamp saves lesson progress and the quiz badge in the current browser. Its [references](docs/REFERENCES.md) include Ecuador's SEAL platform, a local garden guide, and crop rotation guidance from SARE.

## How to use it

1. **Plan.** Pick any place in the world (search, GPS or tap the globe), a date range (for example 4 Mar 2023 to 7 Jun 2027) the crops you want to grow and how much land you have (ha, m², acres or cuadras).
2. **Recommended farm plan.** The land is split into plots that run side by side, one led by each crop that suits the dates, each rotating the picked crops. Rooti says how much land goes to each crop and when, and shows one farm calendar with every crop (for example potato Jan–Apr and maize May–Aug on one plot, the opposite on the other, so both are in the ground every month). More land goes to what yields best, at least 15 % to each rotation.
3. **Try these simulations.** Better crops for the dates, irrigation, a legume, keeping the straw, testing on dry years; one tap each.
4. **Build your own plan and compare.** Start from the recommended plan, change crops, sowing months or land per plot, and see your plan's farm calendar and a side-by-side table: expected harvest, years with some loss, years losing over half, soil covered, soil damage and (in the pilot zones) money after costs.
5. **Single-plot rotations.** Rooti builds rotations **only from those crops** and picks the planting months itself. The best candidate is shown as recommended; every other option stays on screen.
6. **When to sow each crop.** For every picked crop, each month of the range is coloured by how it would go if sown that month; the best windows are named ("best to sow: Dec 2026 – Mar 2027 · up to 91 %").
7. **Try instead.** When a picked crop does not suit the dates (under 50 % of a harvest at best), Rooti suggests crops from its list that do better on the same dates, with one tap to add them to the plan.
8. **What if.** Each plan replayed on every real sequence of years since 1981.

How the global planner works (`app/climate.js`, `app/planner.js`):
- **NASA POWER** monthly climate for the point, 1981 to last month (monthly API plus daily data for the current year), fetched live from the browser. ET0 is FAO-56 Penman-Monteith from POWER's monthly means (`T2M`, `T2M_RANGE`, `RH2M`, `WS2M`, `ALLSKY_SFC_SW_DWN`).
- Months that already happened use the real climate. Future months are tested on every real run of consecutive years since 1981 (about 40), optionally only dry, wet or strong El Niño years.
- The plot changes the plan: water left in the soil after the rains counts for the next crop (bucket sized by soil texture), crops that cannot stand standing water can drown in very wet months on plots that hold water, soil pH outside a crop's range lowers its harvest, and bare soil on a slope loses more.
- Strategies shown side by side: the recommended farm plan, what the farmer does today (their crops, no straw cover) and other rotations, each with why, risks, what we don't know and questions for the agronomist.
- Each planting: water need = FAO-56 crop coefficients × ET0; lost when rain covers under 20 % of the need (no irrigation), or when a month is colder or hotter than the crop's ECOCROP limits (with a margin, since these are monthly means); yield share = FAO-33 Ky response.
- The best sequence is found by dynamic programming over months, weighing harvests, water deficit, failures, bare-soil months (rain on bare soil, bare soil in the sun) and rotation rules (no crop back to back, legume after a cereal, not two cereals in a row), by the farmer's priority (soil, water or income). Straw left after a cereal covers the soil if "keep the straw" is picked.
- Wheat, barley, potato, sunflower and chickpea were added for use outside the tropics with approximate FAO-56 / ECOCROP values (flagged in the app).
- Pilot zones (Daule, Babahoyo, Quevedo) keep the soil passport (MODIS fires) and Ecuador prices.

## El Niño 2026–27: what changes on the coast

- **Years like this one by default.** NOAA (12 Nov 2026) and ERFEN (6 Nov 2026) expect a strong to very strong El Niño. For a plot on the Pacific coast of Ecuador or northern Peru and a plan that starts before May 2027, Rooti tests the plan on the 7 rainy seasons that followed past strong El Niños (1982-83, 1986-87, 1991-92, 1997-98, 2009-10, 2015-16, 2023-24) and says so in a yellow note. One tap switches to all years.
- **Floods.** A month floods a non-rice crop when its rain, minus what evaporates, exceeds what the plot can drain: about 500 mm on a well-drained plot, about 215 mm on a flat, heavy one. So the extreme months of 1983 and 1998 (500–700 mm) drown maize and soybean in Daule even though Landsat shows the area as rarely under water. Rice is grown flooded and is not penalised.
- **1981–1983 are back.** NASA POWER has no solar radiation before 1984, so those months use Hargreaves ET0 (temperature only), scaled month by month to Penman-Monteith over the years that have both. This brings 1982-83, the closest match to this year, into every test.
- In the Daule example this moves land towards rice and flags maize in the rainy season as risky (lost 2 of 7 El Niño seasons).

## How it works

- `pipeline/` turns NASA and partner data into one JSON file per zone (`app/data/<zone>.json`):
  - **NASA POWER** daily climate, 1981–2025. Temperatures are corrected for the grid cell's elevation (−6.5 °C/km). Reference evapotranspiration (ET₀) is computed with **FAO-56 Penman-Monteith**.
  - **MODIS MOD13Q1/MYD13Q1** NDVI, 250 m (via Microsoft Planetary Computer).
  - **NOAA ONI** for El Niño years.
  - **ISRIC SoilGrids 2.0** soil.
  - **Copernicus DEM** slope.
- `app/data/crops.json` holds the crop parameters. Every value carries its source: FAO-56 crop coefficients, ECOCROP, FAO water manuals, INIAP.
- `app/engine.js` is the rotation engine and runs in the browser:
  - **Water need** = crop coefficient × ET₀ of the season.
  - **Failure:** a rain-fed crop that gets less than 20 % of its water need is marked as failed.
  - **Soil risk** = rain on bare soil plus months of bare soil in the sun.
  - Scores combine water, soil and income with the farmer's priorities. Risk multiplies the score down.
- `pipeline/outlook.py` builds the **rainy-season outlook** from October sea-surface temperatures, using NOAA CPC Niño 1+2 (the ocean right off Ecuador) and Niño 3.4.
  - When the coast is strongly warm (Niño 1+2 ≥ +1.5 °C), the farmer sees what happened in every past year with an ocean that warm.
  - For October 2026 (+5.3 °C, warmer than any year on record) that is 5 rainy seasons: 2 very wet (1983 and 1998, the wettest on record), 1 normal and 2 dry.
  - A multinomial logistic regression was tested leave-one-year-out and **does not beat climatology** (hit rate 20–32 % vs 33 % by chance). It is reported in `outlook.json` but not shown to farmers. Coastal rain depends on warming that often appears only in January–March, as in the 2017 coastal El Niño.
- `pipeline/surface_water.py` measures how waterlogged each area gets. Source: JRC Global Surface Water, built from NASA/USGS Landsat at 30 m, 1984–2021. Babahoyo has water at least a quarter of the time on 26 % of its land, Daule on 3 % and Quevedo on 1 %. The farmer confirms or corrects it ("Does your plot get waterlogged?"), and crops that cannot stand waterlogging get a "waterlogged soil" risk in the rainy season. Flooded rice paddies also count as water, so this is not a river-flood map. NASA OPERA DSWx-S1 (radar, 30 m, since 2023, sees through clouds) is the next step and needs an Earthdata login.
- `pipeline/fires.py` counts **fires seen from space** around each zone. Source: NASA MODIS MOD14A2/MYD14A2 thermal anomalies (8-day, 1 km). The count feeds the passport stamp "no burning seen by satellite".
- `app/data/economics.json` holds the money data, with a source for every number: yields (INEC ESPAC 2024, MAG), farm-gate prices (MAG-SIPA 2025), official minimum prices (2026) and costs per hectare.
  - Each plan shows **dry-season money for the whole plot as a range**, from low yield × low price − high cost to the best case.
  - When the crop fails in half or more of similar years, the plan shows **what you could lose**: the money invested.
  - The rainy-season rice is the same in all plans, so it is left out of the comparison.
  - Weak numbers are flagged in the app (soybean cost is from ~2015).
  - With 2024–2026 costs, typical rice and maize margins come out **negative** (about −800 and −480 USD/ha), in line with what growers' unions reported. Costs come from press statements and may include land rent.
- `app/` is a static site: HTML, vanilla JS and **CesiumJS** (Esri World Imagery, OpenStreetMap fallback).
- `bot/` is Rooti on WhatsApp: farmers ask by text or voice note and get answers from the same planner, plus opt-in alerts and a live voice call. See [`bot/README.md`](bot/README.md).
- `data-pipeline/` holds the download scripts (NASA POWER, MODIS, SoilGrids, DEM, ONI) and their README with known caveats. `env/Dockerfile` is the reproducible Python environment they run in.

## Run locally

```bash
cd app && python3 -m http.server 8765
# open http://localhost:8765
```

With Vecinos shared between phones (the app and its API, plus a throwaway Postgres):

```bash
docker network create rooti-dev
docker run -d --name rooti-pg --network rooti-dev -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=rooti postgres:16-alpine
docker build -f server/Dockerfile -t rooti-web .
docker run --rm --network rooti-dev -p 3000:3000 -e DATABASE_URL=postgres://postgres:dev@rooti-pg:5432/rooti rooti-web
# open http://localhost:3000
```

Without the API (the static server above) Vecinos still works: it shows the example posts and keeps what you post on
that phone.

### Rooti in the app

Rooti, the assistant from WhatsApp, also lives in the app: the avatar in the lower right corner opens a conversation
by text or by holding the microphone. It reads what the farmer has on screen, and acts on the page through the same
functions the buttons use:

| Tool | What happens on the page |
|---|---|
| `show_on_page` | Opens a screen and marks what Rooti is talking about (a crop in the route, the years, an idea) |
| `change_plot` | Changes the plot as the farmer said it ("son tres cuadras") and computes the plan again, with **Undo** |
| `try_idea` | Tests irrigation, straw, a legume or other years on the Try screen; the farmer applies it with a button |
| `offer_whatsapp` | A button to keep going on WhatsApp, where the alerts are |

Rooti never publishes on Vecinos or sends anything on its own. On the phone, after it changes the page, the sheet
drops to a bar so the page stays in view; on a computer the panel sits beside the page.

Both servers that serve the app answer it with the same API (`/api/rooti`): the bot's container, which serves the
public website (`bot/src/rooti_bot/web_agent.py`), and the Node server (`server/rooti.mjs`). Each needs
`DEEPSEEK_API_KEY` (the same model as the WhatsApp bot) and, for voice, `GROQ_API_KEY` (Whisper); without the model key
the avatar does not show. The prompt and tools are `bot/hermes/rooti/WEB.md` and `web-tools.json`, next to the persona
(`SOUL.md`) both channels share.

```bash
cd server && pnpm install && DEEPSEEK_API_KEY=... GROQ_API_KEY=... node server.mjs   # open http://localhost:3000
python -m pytest tests/e2e    # headless browser and a fake model; needs pytest and playwright
```

## Deploy on Coolify

1. **Database:** New resource → Database → PostgreSQL 16. Copy its *internal* connection URL.
2. **App:** New resource → this repository, build pack **Dockerfile**, Dockerfile location `server/Dockerfile`,
   base directory `/` (the build needs both `server/` and `app/`). Port **3000**.
3. **Environment:** `DATABASE_URL` = the internal URL from step 1. For Rooti in the app, also `DEEPSEEK_API_KEY`
   and `GROQ_API_KEY` (the same keys as the WhatsApp bot).
4. Health check path `/healthz`. On the first start the server creates the tables (`server/schema.sql`) and loads
   the example posts from `app/data/vecinos.json` once, marked as examples.

Moderation: a post leaves the feed when 3 different devices report it. To hide or bring back a post by hand, run in
the database's terminal: `UPDATE vec_posts SET hidden = true WHERE id = '...';`. The WhatsApp bot can later write
to the same database (`source = 'whatsapp'`) over Coolify's internal network.

Rebuild the data (needs Docker and the data folder produced by `data-pipeline/`):

```bash
docker build -t spaceapps-geo env/
docker run --rm -v "$PWD/../fieldshift-data:/src:ro" -v "$PWD:/proj" spaceapps-geo \
  python /proj/pipeline/build_app_data.py /src /proj/app/data
```

## Honest limits

- Climate data describe about 50 km around the lot, not the lot itself.
- NASA POWER rainfall looks too low in some years (for example 2005 and 2007). Cross-checking with **GPM IMERG** (10 km) is in progress.
- At 250 m, MODIS NDVI mixes fields with trees, so it cannot confirm what a single plot does. That would need Sentinel-2 at 10 m.
- Prices, costs and yields are national or provincial averages, not the farmer's own. Rice and soybean costs are the weakest numbers.
- Velvet bean and jack bean have no FAO water figures. A generic cover-crop coefficient (0.9) is assumed and stated as an assumption.
- NASA POWER smooths extreme rain over a ~50 km cell (for example January 1983 shows only 40 mm in Daule), so El Niño flood losses are probably understated. River floods and dam releases (Daule-Peripa) are not modelled; the farmer's answer ("Does your plot get waterlogged?") overrides the estimate.
- Money uses average yields, 2025 prices and 2024–2026 costs that include land rent, so totals often come out negative, as growers' unions report. Read the difference between plans, not the total.
- The soil passport (pilot zones) is a prototype and is not linked from the plan.

## Use of AI

AI tools (Claude) helped write the code, analyse the data and research sources. Every request is logged in `SI_USAGE.md`. The idea and the decisions are the team's.

## Credits

- Data: NASA POWER (LaRC), NASA MODIS (LP DAAC), NOAA CPC, ISRIC SoilGrids, ESA Copernicus DEM, FAO.
- Photos (CC BY-SA 4.0, Wikimedia Commons):
  - "Oryza sativa in Kadavoor" by Jeevan Jose
  - "Corn in a field by Myrstigen 1" by W.carter
- Map imagery: Esri World Imagery.
- Map engine: CesiumJS (Apache-2.0).

## License

MIT
