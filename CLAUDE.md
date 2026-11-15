# Field Shift — NASA Space Apps 2026 (Guayaquil)

Reto: "Field Shift: Adapting Farms with NASA Data". Herramienta de apoyo a la decisión de **rotación de cultivos** para pequeños productores de la costa ecuatoriana (zonas piloto: Babahoyo, Daule, Quevedo).

## Reglas de la competencia (no negociables)
- Todo lo entregable (página del proyecto, app, slides, video) **en inglés**. La app puede tener toggle ES/EN, pero el default para jueces es EN.
- **Uso de IA ("SI")**: se declara. `SI_USAGE.md` se llena solo con el hook de `.claude/settings.json`. No borrarlo.
- Imágenes generadas con IA: **marca de agua visible**. Nada de logos, banderas ni branding de NASA en contenido generado.
- Citar **todo** dato, código o imagen externa en `docs/REFERENCES.md`.
- Debe usar al menos un dato de NASA como núcleo (POWER, MODIS, SMAP, IMERG, GLDAS, SRTM/ECOSTRESS).
- Repo: github.com/AngelPila/rooti (cuenta personal AngelPila; no usar la cuenta del trabajo).
- Presentación local: domingo 15, 16:00 → todo funcional el domingo ~15:00. Entrega global hasta domingo 23:59.

## Lo que pide el reto (checklist de relevancia)
- Comparar **≥ 3 estrategias de rotación**, incluida la actual del agricultor.
- Por cada estrategia: por qué se sugiere, evidencia (dato NASA citado), beneficios, **vacíos de información**, **riesgos que requieren revisión local**.
- Mostrar periodos de suelo desnudo, temporadas vulnerables, oportunidades (cortar plagas, bajar agua, infiltración, ingreso).
- Entradas del agricultor: prioridades (agua / ingreso / suelo) y restricciones.
- Explicar términos (ET, anomalía de humedad, NDVI, balance hídrico) en lenguaje simple.
- La herramienta **apoya, no reemplaza** al agricultor ni al técnico.

## Arquitectura
- `../fieldshift-data/` → datos crudos y procesados (scripts en Docker `spaceapps-geo`).
- `pipeline/build_app_data.py` → genera `app/data/<zona>.json` (climatología mensual, compuestos ENSO, curva NDVI, suelo, relieve).
- `app/` → sitio **estático** (HTML + JS vanilla + CesiumJS con Esri World Imagery, sin API keys). El motor de recomendaciones corre en el navegador (`app/engine.js`) para que los sliders recalculen al instante.
- `app/data/crops.json` → parámetros agronómicos **con fuente por cada valor**.

## Estilo
- Honestidad sobre la incertidumbre: resolución (POWER ~50 km), nubes en MODIS, suelo de baja confianza en Babahoyo. Mostrarla en la UI, no esconderla.
- Lenguaje para agricultores, no para científicos. Nada de jerga sin explicación.
