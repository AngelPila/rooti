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
- Prices are not modelled: income only counts whether a season has something to sell.
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
