# Rooti

**What should I plant so my soil lasts longer?** Rooti compares crop-rotation plans for a smallholder's plot against 45 years of NASA climate data, month by month, and replays each plan over the real years 2001–2024.

NASA Space Apps Challenge 2026 · *Field Shift: Adapting Farms with NASA Data* · Local event: Guayaquil, Ecuador.

Pilot zones: Daule, Babahoyo and Quevedo (rice and maize on the Ecuadorian coast).

## What it does

- **My lot.** Three plans side by side: what the farmer does today, the recommended plan, and the best cash crop. Each month is shown as a traffic light (fine / caution / danger) with an icon for the risk: too dry, rain on bare soil, bare soil in the sun.
- **Why.** Every recommendation is explained with counts of real years ("0 of 24 years with heavy soil damage"), a concrete action, and its data source.
- **Real past.** The same plans replayed on each real year 2001–2024 (El Niño years included), so the farmer sees evidence instead of a forecast.
- **Ask.** A WhatsApp entry point (voice or text). The conversation shown is an example.
- **Soil passport.** A record of verified practices to share. The score and stamps are example data.
- Spanish by default on phones (local words: *invierno*, *verano*, *cuadra*), English on desktop. A 🔊 button reads each screen aloud.

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
- `data-pipeline/` holds the download scripts (NASA POWER, MODIS, SoilGrids, DEM, ONI) and their README with known caveats. `env/Dockerfile` is the reproducible Python environment they run in.

## Run locally

```bash
cd app && python3 -m http.server 8765
# open http://localhost:8765
```

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
