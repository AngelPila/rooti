# Rooti — pitch (presentación local, domingo 15, 16:00)

Formato: **3 minutos** de pitch con demo en vivo, más preguntas. Se habla en español; las slides van en inglés
(regla de la competencia). Si dan 5 minutos, se usa el bloque opcional de WhatsApp.

Ruta de la demo: `#/` → «Ver el plan de Daule» → elegir plan → plan → Su terreno → Comparar.
Probarla 10 minutos antes en la misma red: el primer plan tarda unos segundos en traer el clima de NASA POWER.

---

## Guion (3:00)

### 0:00–0:25 · El problema — slide 1
> **Slide:** *"Twice a year, a farmer on Ecuador's coast bets the whole harvest on one guess."* · foto satelital de Daule
> · fuente pequeña: MAG-SIPA 2023.

«En Daule, Babahoyo y Quevedo, un pequeño productor decide dos veces al año qué sembrar. Lo decide con la experiencia
de los últimos años y con lo que siembra el vecino. En 2023, las inundaciones causaron el 91 % de las pérdidas de
arroz en la costa. Y este invierno viene un Niño fuerte.»

### 0:25–0:45 · Qué es Rooti — slide 2
> **Slide:** *"Rooti: plant knowing."* · *Every option is replayed on 45 years of NASA climate, on the farmer's own plot.*

«Rooti le dice al agricultor qué sembrar, en qué meses y en cuánta tierra. Antes de que gaste en semilla, prueba cada
opción con el clima real de NASA POWER desde 1981, en su propio lote. Y cuando viene un Niño, la prueba con los 7
inviernos que siguieron a otros Niños.»

### 0:45–2:15 · Demo en vivo
1. **Inicio → «Ver el plan de Daule»** (0:45). «Un productor de arroz en Daule, con 5 hectáreas.»
2. **Pantalla de elección** (0:55). «Rooti no le da una orden. Le da opciones con nombre: *el más seguro*, *el que más
   deja*, y al lado *lo que hace hoy*, medidos con los mismos números: años con pérdida y meses con la tierra cubierta.»
   **Señalar la nota de abajo.** «Y aquí está lo más importante: lo que él hace hoy no perdió cosecha en ningún
   invierno de Niño. Rooti se lo dice. Lo que ganaría al cambiar es tener la tierra cubierta 12 meses en vez de 4.
   La herramienta no le vende nada: le muestra qué gana y qué arriesga.»
3. **«Ver este plan» en El más seguro** (1:20). «Soya, después arroz, después paja que cubre la tierra en verano: una
   rotación de verdad. Sobre el calendario, la lluvia de un año normal. Este 6 son los 6 de los últimos 7 inviernos
   de Niño en que le habría ido bien; cada punto es un año real.» Tocar un punto rojo: «Este fue el año que se perdió».
   **Señalar Riesgos:** «Y los riesgos se ven sin buscarlos: la soya se ahoga 1 de cada 7 años si el lote se
   encharca. Eso lo confirma con su técnico.»
4. **Su terreno** (1:50). «Este es su lote, recortado de la foto satelital, con el corte de su tierra: franco
   arcillosa. El 21 % del campo alrededor se encharca. Muevo los meses y se ve cuándo la tierra está mojada.»
5. **Comparar, solo si hay tiempo** (2:05). «Y si el agricultor quiere armar su propio plan, lo arma aquí y lo compara
   contra el recomendado.»

### 2:15–2:40 · Cómo llega al agricultor — slide 3
> **Slide:** *"Where the farmer already is."* · captura de WhatsApp con nota de voz + botón «📞 Hablar con Rooti».

«Un agricultor no va a abrir un mapa 3D. Por eso Rooti también vive en WhatsApp: le pregunta por nota de voz, Rooti le
contesta por voz con el mismo motor. Le avisa si vienen 40 mm de lluvia en los próximos días o si toca sembrar. Y en
la app, el asistente lee la pantalla y cambia el plan cuando el agricultor le dice "son tres cuadras".»

### 2:40–3:00 · Cierre — slide 4
> **Slide:** *NASA POWER · Copernicus DEM · SoilGrids · Landsat (JRC) · MODIS* · *Options, not orders. Check with your agronomist.* · QR a la app.

«Rooti usa los datos de NASA como núcleo y los convierte en una decisión que se toma dos veces al año. Muestra lo que
no sabemos: el clima es de una zona de 50 km y el suelo es estimado. No reemplaza al agricultor ni al técnico del
MAG: les da algo concreto para conversar. Siembre sabiendo.»

---

## Bloque opcional (+1:00, si dan 5 minutos)
Mostrar en un teléfono el chat de WhatsApp con Rooti: mandar una nota de voz («¿qué siembro en mi lote este
invierno?»), recibir la respuesta en voz y tocar «Ver mi plan», que abre la misma pantalla del plan.
**Ensayarlo antes:** depende del bot desplegado y de las claves de DeepSeek y Groq.

---

## Preguntas probables

| Pregunta | Respuesta corta |
|---|---|
| ¿Qué dato de NASA es el núcleo? | NASA POWER mensual 1981–2025 y diario 2026, en el punto exacto: lluvia, temperatura, radiación, humedad y viento. Con eso calculamos la evapotranspiración (FAO-56 Penman-Monteith). También usamos MODIS (incendios, NDVI) y Landsat a través de JRC Global Surface Water (encharcamiento). |
| ¿Cómo sabe si una cosecha se pierde? | Simulamos cada siembra (cultivo × mes) en cada año real: agua que necesita (coeficientes FAO-56) contra lluvia más agua guardada en el suelo; pérdida por sequía, frío, calor (rangos ECOCROP) o encharcamiento; rendimiento con FAO-33. |
| ¿Por qué solo 7 años? | Porque viene un Niño fuerte (NOAA/ERFEN): probamos con los 7 inviernos que siguieron a Niños fuertes desde 1982. Con «Ver con todos los años» se prueba con los 45 años. |
| «Lo que hace hoy» dice «más o menos» con 0 años de pérdida, ¿por qué? | No pierde cosecha, pero deja la tierra pelada 8 meses con lluvia, y eso se lleva el suelo. Por eso la nota dice qué gana al cambiar, no que esté haciendo algo mal. |
| ¿Qué tan preciso es? | El clima es de una celda de unos 50 km y el suelo es una estimación de 250 m. Lo mostramos en la pantalla («Lluvia de la zona», «Suelo estimado») y siempre pedimos confirmar con el técnico. |
| ¿Funciona fuera de Ecuador? | Sí: el clima y el suelo son globales (hay un ejemplo en Iowa). Los rendimientos, precios y el encharcamiento detallado son solo de las 3 zonas piloto. |
| ¿Usaron IA? | Sí, Claude como asistente de código e investigación, declarado en `SI_USAGE.md`. El asistente Rooti usa un modelo de lenguaje para conversar, pero los números salen del motor, no del modelo. No hay imágenes generadas con IA. |
| ¿Cómo se sostiene? | Puede apoyar a las mesas técnicas agroclimáticas (CIIFEN, INAMHI, MAG) y al seguro agrícola estatal; el canal de WhatsApp tiene un costo bajo por agricultor. |

---

## Checklist antes de las 16:00
- [ ] App abierta en la laptop en `#/`, con localStorage limpio, y un segundo navegador ya en el plan de Daule por si falla la red.
- [ ] Probar que NASA POWER responde en la red del evento. Si no responde, usar el respaldo cargado.
- [ ] Si se muestra el asistente en la app: el servidor necesita `DEEPSEEK_API_KEY` (y `GROQ_API_KEY` para voz); sin ellas el avatar no aparece.
- [ ] Teléfono con WhatsApp y el chat de Rooti, solo si se hace el bloque opcional.
- [ ] Slides en inglés: 4 slides y un QR a la app pública.
