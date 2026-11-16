# Rooti — submission texts (NASA Space Apps Challenge 2026)

Challenge: **Field Shift: Adapting Farms with NASA Data** · Local event: Guayaquil, Ecuador.
Everything below is in English, ready to paste into the submission form. Fill the `[ ]` parts before submitting.

---

## Project name
Rooti

## High-level summary (form field)
Rooti tells a farmer what to plant, in which months and on how much land, so the soil lasts and the harvest holds up in a changing climate. The farmer marks a plot anywhere on Earth, picks the dates and the crops they want to grow, and Rooti builds crop-rotation strategies from those crops only. Every strategy is replayed month by month on real NASA POWER climate since 1981: the months that already happened use the real weather, and the months ahead are tested on about 40 real sequences of years, including El Niño years. Rooti compares the recommended plan with what the farmer does today, shows when to sow each crop, how much land each one should get, how it would have gone year by year, what we don't know, and what to ask the local agronomist. It reads the plot too — slope, soil texture, acidity, organic matter and waterlogging — and gives plain-language tips. It runs in the browser, in Spanish and English, on a phone or a computer.

## Demo link
[30-second video or 7 slides — public link, no login]

## Final project link
[Public GitHub repository: https://github.com/AngelPila/rooti — make it public before submitting]
[Live app: URL once deployed]

## Project details (form field)

**What it does**
- One question first: where is the plot (search, GPS or tap the map, anywhere on Earth). Then dates, crops, land, irrigation. Two optional questions: what the farmer grows today, and whether the plot gets waterlogged.
- **Recommended farm plan:** the land is split into plots that run side by side, each led by one crop and rotating the others, so several crops share the season and no single crop carries the whole farm. The farm calendar shows every crop, how much land it takes and how each planting ends, over the average monthly rain of the place.
- **Strategies side by side:** the recommended plan, what the farmer does today and other rotations, judged with the same numbers (harvest, years with a loss, months with the soil covered). Each one has *why*, *risks*, *what we don't know* and *questions for your agronomist* — the challenge asks for all four.
- **My plot:** elevation and slope, soil type and how much water it holds, acidity, organic matter, waterlogging (with a button to correct it), the climate of the place, this year (last month's rain against normal, the official El Niño outlook) and tips.
- **Try these ideas:** irrigation, a better crop for the dates, a legume, covering the soil with crop residue, testing on dry years only. Each idea is checked by re-running the planner and only shown if it improves the plan; one tap to try, one to undo.
- **Compare:** the farmer builds their own plan (plots, crops, sowing months, land) and sees it against the recommended one.
- **What if:** the same plan on every real run of years since 1981.

**How it works**
- Climate: NASA POWER monthly (1981 to last year) and daily (this year) for the exact point, fetched live in the browser. Reference evapotranspiration is computed with FAO-56 Penman-Monteith.
- Each possible planting (crop × sowing month) is simulated on every year sequence: water need from FAO-56 crop coefficients; rain plus the water left in the soil from earlier months (bucket sized by soil texture); loss when rain covers under 20 % of the need without irrigation, when nights are colder or days hotter than the crop's ECOCROP limits, or when a non-rice crop sits in standing water on a plot that holds it; harvest share from the FAO-33 yield response factor, lowered by soil pH outside the crop's range.
- This year: a strong El Niño is under way (NOAA, ERFEN). On the Pacific coast, plans for the coming rainy season are tested by default on the 7 seasons that followed past strong El Niños (1982-83 … 2023-24); months whose rain exceeds what the plot can drain flood every crop but rice. NASA POWER has no radiation before 1984, so 1981–83 use Hargreaves ET0 calibrated to Penman-Monteith.
- The best sequence of plantings is found by dynamic programming over the months, weighing harvest, water deficit, failures, months of bare soil (worse on slopes) and rotation rules (no crop back to back, legume after a cereal, not two cereals in a row), by the farmer's priority (soil, water or income).
- Plot data: Copernicus DEM (elevation, slope), ISRIC SoilGrids (texture, pH, organic carbon). In the three pilot zones (Daule, Babahoyo, Quevedo): our own soil processing, waterlogging from 37 years of Landsat surface water, MODIS fire detections, and Ecuadorian yields, prices and costs.

**Benefits and intended impact**
- In coastal Ecuador, floods caused 91 % of rice losses in 2023 (MAG-SIPA), and the 2026–27 El Niño is forecast to be very strong. Rooti turns 45 years of satellite climate into a decision a farmer takes twice a year: what to sow before the rainy season and before the dry season.
- It keeps the farmer in charge: options with reasons, never orders, and a reminder to check with the local agronomist (MAG, INIAP). It can support the national rice agroclimatic technical table (CIIFEN, INAMHI, MAG) and the new state crop insurance.

**Tools**
HTML, vanilla JavaScript (no framework), CesiumJS. The planner runs in the browser and needs no API keys; the Rooti assistant (in the app and on WhatsApp) runs on a server with DeepSeek and Groq keys. Also Python (pandas, xarray, rioxarray, odc-stac) in Docker for the pilot-zone pipeline, Pencil for design. Built with the help of Claude (see Use of AI).

## NASA data used
- **NASA POWER** (Langley Research Center), community AG: PRECTOTCORR, T2M, T2M_RANGE, T2M_MAX, T2M_MIN, RH2M, WS2M, ALLSKY_SFC_SW_DWN — monthly 1981–2025 and daily 2026, any point. https://power.larc.nasa.gov
- **MODIS MOD14A2 / MYD14A2** thermal anomalies (fires seen from space around the pilot plots, 2003–2026), LP DAAC via Microsoft Planetary Computer.
- **MODIS MOD13Q1 / MYD13Q1** NDVI (pilot-zone pipeline; documented as unable to see single plots at 250 m).
- **Landsat** (NASA/USGS), through the JRC Global Surface Water dataset (1984–2021), for how often the land stays under water.
- **NASA Earthdata CMR** (MCP server) to search datasets and variables.

## Space agency partner and other data
- ESA **Copernicus DEM** GLO-30/90 (via Open-Meteo elevation API).
- ISRIC **SoilGrids 2.0**.
- EC JRC **Global Surface Water**.
- **FAO-56** (crop coefficients, Penman-Monteith), **FAO-33** (yield response), FAO **ECOCROP** (temperature and pH ranges).
- **NOAA CPC** ENSO advisory and Oceanic Niño Index; **ERFEN** Ecuador.
- **INEC ESPAC 2024**, **MAG-SIPA** (yields, prices), official minimum prices.
- OpenStreetMap Nominatim and Open-Meteo geocoding (place names); Esri World Imagery (map); one Wikimedia Commons photo (CC BY-SA 4.0).
Full list with links: `docs/REFERENCES.md`.

## Use of AI (form field)
AI is used in three places, all declared here:
- **Building the project:** Claude (Anthropic) through Claude Code as a coding and research assistant (details below).
- **Images:** the illustrations were generated with OpenAI image generation through Codex and are marked as AI-generated in the app (list and prompts in `docs/REFERENCES.md`).
- **Inside the product:** the Rooti assistant answers with DeepSeek (`deepseek-chat`), which only calls the planner's own functions; voice notes are transcribed with Whisper large-v3-turbo on Groq, and answers are read aloud with Microsoft Edge neural text-to-speech (edge-tts). The rotation plans themselves come from the planner (NASA POWER, FAO-56, FAO-33), not from a language model.

We used **Claude (Anthropic) through Claude Code** as a coding and research assistant during the event:
- writing and debugging the code (data pipeline, planner, interface), and the interface text in plain Spanish and English;
- searching and reading data documentation and official sources, and checking numbers;
- design reviews of the screens.
The challenge choice, the problem framing for coastal Ecuador, the persona and farmer requirements, and all product decisions were the team's. Every AI request made inside the project folder was logged automatically in `SI_USAGE.md`; requests made from outside it are listed there too, reconstructed from the git history. The app contains **no AI-generated images**: the only photo is a credited Wikimedia Commons image. No NASA logos or mission identifiers are used.

---

## 30-second video script (with English subtitles)
| s | Screen | Voice / subtitle |
|---|---|---|
| 0–4 | Landing | "Farmers on Ecuador's coast decide twice a year what to plant. This year, a very strong El Niño is coming." |
| 4–9 | Tap "Daule · rice in El Niño" | "Rooti tests every option on 45 years of NASA climate for their exact plot." |
| 9–16 | My plan: farm calendar, rain row | "It splits the land, rotates maize, soybean and rice, and keeps the soil covered all year." |
| 16–21 | Other strategies → "What you do now: so-so" | "And it shows what today's practice risks — with why, risks and what we don't know." |
| 21–26 | My plot + tips | "It reads the plot: soil, slope, waterlogging — and gives plain advice." |
| 26–30 | Iowa example | "Anywhere on Earth. Options, not orders. Check with your agronomist." |

## 7-slide outline (alternative demo)
1. Rooti — Know what to plant, and when. (team, challenge, Guayaquil)
2. The problem: floods = 91 % of rice losses (2023); El Niño 2026–27 "very strong or extraordinary"; decisions twice a year; monoculture and bare soil.
3. What Rooti does: plot → dates → crops → recommended farm plan vs. what you do today.
4. How it works: NASA POWER since 1981 → FAO-56 water balance + soil water + waterlogging + pH → 40 real year sequences → dynamic programming.
5. Demo screenshots: Daule (Ecuador) and Iowa (USA).
6. Validity and honesty: what it gets right (Daule, Quevedo, Iowa rotations match local practice), limits (50 km climate cell, monthly step, approximate crop values), what we don't know is on screen.
7. Impact and next steps: rice agroclimatic table (CIIFEN/INAMHI/MAG), crop insurance, WhatsApp, IMERG and SMAP.

## How it meets the judging criteria
- **Influence:** a decision farmers take twice a year, in a region where El Niño drives most losses; works for any place on Earth.
- **Creativity:** rotations from the farmer's own crops, land split across parallel plots, tested on real year sequences rather than a single forecast.
- **Validity:** FAO-56 and FAO-33 methods, ECOCROP limits, real NASA climate, sources on screen, uncertainty and what we don't know shown for every strategy.
- **Relevance:** compares 3+ strategies including today's; why, evidence, benefits, information gaps and risks for local review; bare-soil periods, vulnerable seasons, farmer priorities and constraints.
- **Presentation:** one screen per question, plain language, phone and computer layouts, Spanish and English, examples that work offline.

## Known limits (say them before the judges do)
- NASA POWER is a ~50 km cell; soil is 250 m; neither is the exact plot.
- Monthly time step; soil water is a simple bucket.
- Wheat, barley, potato, sunflower and chickpea use approximate FAO values.
- Prices and costs only for coastal Ecuador.
- POWER rain looks low in some years on the coast (January 1983: 40 mm in Daule), so El Niño flood losses are probably understated; cross-checking with GPM IMERG needs an Earthdata login (next step).
- River floods and dam releases are not modelled; the farmer can mark the plot as waterlogged.
- Money totals use costs that include land rent and often come out negative, as growers' unions report; compare the difference between plans.
