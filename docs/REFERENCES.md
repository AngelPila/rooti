# References

## NASA data
- NASA POWER — Prediction Of Worldwide Energy Resources, NASA Langley Research Center. API: https://power.larc.nasa.gov/api/temporal/ (monthly and daily point, community AG).
- MODIS MOD14A2 / MYD14A2 v061 Thermal Anomalies and Fire, 8-day, 1 km. Giglio, L., Justice, C. (2021). NASA EOSDIS LP DAAC. doi:10.5067/MODIS/MOD14A2.061 — accessed via Microsoft Planetary Computer.
- MODIS MOD13Q1 / MYD13Q1 v061 Vegetation Indices, 16-day, 250 m. Didan, K. (2021). NASA EOSDIS LP DAAC. doi:10.5067/MODIS/MOD13Q1.061.
- Landsat 5, 7, 8 (NASA/USGS), through: Pekel, J.-F. et al. (2016). High-resolution mapping of global surface water and its long-term changes. Nature 540, 418–422 (JRC Global Surface Water v1.4).
- NASA Earthdata CMR MCP server: https://cmr.earthdata.nasa.gov/mcp/v1

## Partner and other data
- ESA Copernicus DEM GLO-30/GLO-90 (2021), via Open-Meteo Elevation API: https://open-meteo.com/en/docs/elevation-api
- Poggio, L. et al. (2021). SoilGrids 2.0. SOIL 7, 217–240. doi:10.5194/soil-7-217-2021 — REST API https://rest.isric.org
- Allen, R.G. et al. (1998). Crop evapotranspiration. FAO Irrigation and Drainage Paper 56 (Penman-Monteith ET0; Tables 11, 12 and 19). https://www.fao.org/4/x0490e/x0490e00.htm
- Doorenbos, J., Kassam, A.H. (1979). Yield response to water. FAO Irrigation and Drainage Paper 33 (yield response factor Ky).
- FAO ECOCROP — crop temperature and pH ranges. https://gaez.fao.org/pages/ecocrop
- NOAA Climate Prediction Center — ENSO diagnostic discussion (12 Nov 2026) and Oceanic Niño Index. https://www.cpc.ncep.noaa.gov
- ERFEN Ecuador — El Niño outlook, 6 Nov 2026.
- INEC — Encuesta de Superficie y Producción Agropecuaria Continua (ESPAC) 2024.
- MAG-SIPA — Panorama agroestadístico 2026; boletín situacional arroz 2023 (losses by cause); producer prices 2025.
- Chávez et al. (2017), soybean in Los Ríos, Universidad Técnica de Babahoyo (soybean after rice with residual moisture).
- OpenStreetMap contributors — Nominatim reverse geocoding. Open-Meteo Geocoding API.
- Esri World Imagery (map tiles). CesiumJS (Apache-2.0).
- Photo: "Oryza sativa in Kadavoor", Jeevan Jose, Wikimedia Commons, CC BY-SA 4.0.

## Research cited in the pitch
- Mudare, S. et al. (2025). Crop rotation increases yield, nutrition and revenue. Nature Communications 16, 9552.
- Bowles, T.M. et al. (2020). Long-term evidence shows crop-rotation diversification increases agricultural resilience. One Earth 2, 284–293.

## Bootcamp for farmers

- [Ecuador's SEAL platform](https://capacitacion.agricultura.gob.ec/mod/page/view.php?id=13043) and [training catalog](https://capacitacion.agricultura.gob.ec/mod/page/view.php?id=13046). References for structuring producer training. The [cape gooseberry course](https://capacitacion.agricultura.gob.ec/enrol/index.php?id=185) requires a SEAL account.
- [Ecuador Ministry of Education, Guide to setting up agroecological gardens](https://educacion.gob.ec/wp-content/uploads/downloads/2021/01/Guia-Huertos.pdf), sections 4–6. Planting, crop rotation, and harvest practices.
- [Mohler and Johnson, Crop Rotation on Organic Farms: A Planning Manual](https://www.sare.org/resources/crop-rotation-on-organic-farms/). Crop families, nutrient use, soil structure, and pest management.
- [FAO Irrigation and Drainage Paper 56, Chapter 8](https://www.fao.org/4/x0490e/x0490e0e.htm). Rooting depth and soil water. The bootcamp shows the same estimated cycle lengths as Rooti's planner, based on the per-crop sources listed in `app/data/crops.json`.
- [Formencia, Cultivo de hortalizas](https://formencia.com/course/cultivo-de-hortalizas). Free course content, with an optional paid certificate.
- [IICA, Introduction to Regenerative Agriculture](https://agreg.iica.int/) and [SEED course catalog](https://seed.iica.int/). Free training on soil health, biodiversity, and soil cover.
- [FAO, Climate-smart soil and land management](https://elearning.fao.org/course/view.php?id=435) and its [Spanish edition](https://elearning.fao.org/course/view.php?id=496&lang=es). Free training on soil, erosion, and water management.
- [W.carter, Corn in a field by Myrstigen 1](https://commons.wikimedia.org/wiki/File:Corn_in_a_field_by_Myrstigen_1.jpg). Bootcamp header photo, CC BY-SA 4.0.

## Design system (`design/system/`)

- Visual direction inspired by [overstory.com](https://www.overstory.com/) (layout, palette structure, motion). No code, fonts or images copied.
- Fonts from Google Fonts (SIL Open Font License): Geist, Geist Mono, Funnel Display, Instrument Serif, Space Grotesk.
- Crop illustrations (maize, rice, soybean, straw mulch) generated with AI (OpenAI image generation through Codex). Each carries a visible "IMAGEN GENERADA CON IA" watermark. The app uses the same files on the landing page (`app/img/illu/`).
- Icons and the vector logo mark were drawn by hand for this project.
- Agent skills in `.claude/skills/` (learn-taste, mobile-native, break-ui, remove-animations, find-animation-opportunities, choreograph, prototype) copied from [emilkowalski/skills](https://github.com/emilkowalski/skills) (MIT), commit 0f2e23b. License in `.claude/skills/EMIL-SKILLS-LICENSE`.

## Vecinos server (`server/`)
- [node-postgres (`pg`)](https://github.com/brianc/node-postgres) 8.13.1, MIT, the Postgres client of the Vecinos API.
- [Node.js](https://nodejs.org/) 22 and [PostgreSQL](https://www.postgresql.org/) 16 official Docker images (`node:22-alpine`, `postgres:16-alpine`).
- The example posts in `app/data/vecinos.json` are illustrative, written for the demo; they are labelled "Ejemplo" in the app and are not real farmer reports.
