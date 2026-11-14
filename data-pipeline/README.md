# Field Shift: datos preparados

Zonas piloto (`scripts/zones.json`): Babahoyo (-1.80, -79.53), Daule (-1.86, -79.98), Quevedo (-1.03, -79.46).
Todo se genera con el entorno Docker `spaceapps-geo` (ver `~/spaceapps-env`):

    docker run --rm -u $(id -u):$(id -g) -v "$PWD:/data" spaceapps-geo python /data/scripts/<script>.py /data

## Archivos

| Archivo | Fuente | Contenido |
|---|---|---|
| `raw/power_<zona>.csv` | NASA POWER (comunidad AG), API sin clave | Diario 1981-01-01 → 2026-11-12, 14 variables (`raw/power_variables.json` tiene nombres y unidades). La radiación empieza en 1984; los últimos 1–3 días aún no se publican |
| `processed/power_monthly_<zona>.csv` | Derivado de POWER + ONI | Mensual: lluvia, días ≥20 mm, Tmax/Tmin, días ≥33 °C, humedad relativa, radiación, humedad del suelo (superficie/raíz), ET (mm = EVPTRNS / 2.45), balance hídrico, anomalías vs. 1991–2020, ONI y fase ENSO |
| `processed/climatologia_1991_2020_<zona>.csv` | Derivado de POWER | Promedio de cada mes del año, periodo 1991–2020 |
| `processed/oni.csv` | NOAA CPC, Oceanic Niño Index | ONI desde 1950. ≥ +0.5 = Niño, ≤ −0.5 = Niña |
| `raw/modis_<zona>.csv` | MODIS MOD13Q1 + MYD13Q1 v061 (Terra + Aqua) vía Microsoft Planetary Computer (`scripts/get_modis.py`) | NDVI y EVI cada 16 días por satélite (≈ cada 8 días combinados) desde 2000, media de pixeles confiables (reliability 0–1) en caja de ~5 km; columna `platform`; `pct_pixeles_confiables` indica nubes. Fallos de lectura, si hay, en `raw/modis_fallos_<zona>.csv` |
| `raw/terrain.csv` | Copernicus DEM GLO-30 (ESA) vía Planetary Computer | Elevación y pendiente (media, % del área > 8°) en caja de ~5 km |
| `raw/soil.csv`, `raw/soilgrids/*.tif` | ISRIC SoilGrids 2.0 (WCS) | Arcilla, arena, limo, carbono orgánico, pH, nitrógeno, densidad aparente, CEC; 0–60 cm; mediana de pixeles válidos |

## Advertencias (para la sección de validez / incertidumbre)

- **Resolución:** POWER es ~50 km (0.5°): describe la región, no el lote. MODIS es 250 m. SoilGrids 250 m.
- **Lluvia de POWER probablemente baja** para la costa (Babahoyo da ~1100 mm/año). Contrastar con GPM IMERG (0.1°) y, si se consigue, estaciones del INAMHI antes de usarla para decisiones.
- **Humedad del suelo de POWER** (`GWETTOP/GWETROOT/GWETPROF`) viene del modelo MERRA-2, no del satélite SMAP. SMAP se baja aparte con Earthdata.
- **Babahoyo, suelo:** carbono, pH, densidad y CEC salen de solo ~10 % de pixeles válidos en una caja de ~11 km (zona urbana y ribereña): confianza baja.
- **MODIS en Planetary Computer está incompleto en 2024–2025** (4–5 imágenes/año en vez de 23). Completar esos años desde LP DAAC (Earthdata / AppEEARS).
- **Nubes:** una primera descarga parecía tener ~47 % de fechas sin dato, pero era sobre todo por **links firmados de Planetary Computer que vencen a la hora**. Con `get_modis.py` (firma por año, `fail_on_error`, reintentos) la prueba de Daule 2022 dio 42 de 47 imágenes con dato limpio. Aun así hay nubes: interpolar huecos y decirlo en la página. Alternativa sin nubes: radar Sentinel-1.
- **NDVI regional no ve el suelo pelado:** en la caja de ~5 km (MODIS 250 m) el NDVI de Daule queda entre 0.47 y 0.58 todo el año y casi ninguna fecha baja de 0.35 (igual en Babahoyo y Quevedo). Los pixeles mezclan arroz, árboles, maleza y segundo ciclo con riego. **No se puede afirmar con MODIS que un lote queda pelado**; para eso: Sentinel-2 (10 m) sobre el polígono del lote o una máscara de cultivo.
- Zonas = centros de ciudad; para la versión final conviene mover los puntos a campos agrícolas reales.

## Pendiente (requiere cuenta NASA Earthdata)

- SMAP L3 9 km (`SPL3SMP_E`): humedad del suelo medida por satélite.
- GPM IMERG diario (`GPM_3IMERGDF` hasta sep-2025, `GPM_3IMERGDL` después): lluvia.
- GLDAS Noah mensual (`GLDAS_NOAH025_M`): humedad por capas, ET potencial, escorrentía.
- ECOSTRESS (`ECO_L3T_JET`, `ECO_L2T_LSTE`): ET y temperatura de superficie a 70 m (mejor vía AppEEARS).

## Citas

- NASA POWER: Prediction Of Worldwide Energy Resources, NASA Langley Research Center, https://power.larc.nasa.gov
- MODIS MOD13Q1 v061: Didan, K. (2021). NASA EOSDIS LP DAAC. doi:10.5067/MODIS/MOD13Q1.061
- Copernicus DEM GLO-30: European Space Agency (2021), Copernicus Programme.
- SoilGrids 2.0: Poggio, L. et al. (2021). SOIL 7, 217–240. doi:10.5194/soil-7-217-2021
- ONI: NOAA Climate Prediction Center, https://www.cpc.ncep.noaa.gov
- Acceso: Microsoft Planetary Computer, https://planetarycomputer.microsoft.com
