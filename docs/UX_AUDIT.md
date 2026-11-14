# Auditoría UI/UX independiente — 14 nov 2026

**UI 6,5/10 · UX 5,5/10 · heurísticas (ux-heuristics) 5/10**

| Pantalla | Nota | Problema principal |
|---|---|---|
| Inicio | 5 | "Lote 3" visible antes de elegir; "Usar el punto marcado" funciona sin punto; búsqueda solo con Enter |
| Configurar | 7,5 | Stepper de 0,1 en 0,1; "Otro" sin imagen; sin indicador de pasos |
| Mi lote | 6 | Cuidado y Peligro con el mismo ícono (solo color); tarjeta del mar empuja planes bajo el pliegue |
| Por qué | 6,5 | Solo para el recomendado; sin vacíos ni riesgos; fuente vaga |
| Lo que pasó | 5 | Cuadros de 26×24 px sin año escrito |
| Preguntar | 5,5 | Maqueta; verde WhatsApp 1,98:1; texto 15 px |
| Pasaporte | 4 | "58" sin escala; ranking vs zona; fuego como sello bloqueado |
| Escritorio | 6 | Mapa 35 % sin datos; leyenda dispersa; página larga |

## Top 10 (por impacto)
1. Semáforo depende del color → nivel con forma propia (✓ – ✕), causa como ícono pequeño; naranja más oscuro (#B45309).
2. Faltan requisitos del reto: prioridades (agua/plata/suelo), "Lo que no sabemos", "Confírmelo con su técnico".
3. "Por qué" solo del recomendado → toda tarjeta tocable.
4. Celdas no tocables → hoja inferior con mes, mm, causa y 🔊.
5. Tarjeta del mar alarma sin conclusión → una línea con fecha de emisión.
6. Lo que pasó no usable con el dedo → celdas ≥44 px con año ('17).
7. Pasaporte parece juego → registro con fechas, sin puntaje ni promedio de zona.
8. Contraste WhatsApp → fondo #128C4B.
9. Mapa decorativo → franja de mapa en teléfono; en escritorio pintar riesgo/NDVI del mes; quitar WhatsApp duplicado.
10. Texto y toques bajo la norma propia → ≥16–18 px, segmentos de 56 px, letra al 200 %.

Menores: riego no editable en teléfono desde Mi lote; voz es-ES; leyenda en escritorio dispersa.

## Lo que funciona
- Incertidumbre en años reales ("22 de 24").
- Configurar con fotos y palabras locales, sin escribir.
- "Qué hacer" concreto y sin jerga.
- Detalle de 2017 conecta datos con la memoria del agricultor.
- Estados sin conexión y skeleton ya en el código.

## Estado de los arreglos (14 nov, tarde)
1. ✅ Semáforo con forma propia (✓ – ✕), causa como ícono en la esquina, naranja #B45309.
2. ✅ Prioridades (agua / plata / suelo), "Lo que no sabemos" y "Confírmelo con su técnico" en cada "por qué".
3. ✅ Las 3 tarjetas son tocables y cada plan tiene su "por qué".
4. ✅ Cada mes se toca y abre una hoja con mes, nivel, lluvia vs necesidad y 🔊 (no verificado con captura: requiere clic).
5. ✅ Pronóstico en 1–2 líneas con fecha, debajo de los planes.
6. ✅ Lo que pasó: pestaña por plan, cuadros de 52 px con el año ('17).
7. ✅ Pasaporte = registro con fechas y fuegos reales de MODIS; sin puntaje ni promedio de zona.
8. ✅ Verde WhatsApp #128C4B.
9. ✅ Celular: franja de mapa con el lote; escritorio: lote pintado con el nivel del mes actual; sin WhatsApp duplicado.
10. ✅ Texto ≥16–18 px, botones de 56 px.
Menores: ✅ riego editable desde Mi lote; ✅ tamaño editable (+/− de 0,5 y escribible); ✅ voz en español latino si el equipo la tiene; ✅ "Elegir" → "Guardar para hablar con mi técnico"; ✅ inicio sin "Lote 3" antes de elegir y "Usar el punto marcado" desactivado hasta marcar.
