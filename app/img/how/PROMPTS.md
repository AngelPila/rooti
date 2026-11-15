# Rooti image generation prompts

Final color-correction edit prompts (built-in generator, using the first generated image as edit target):

### 01-plot.png color correction

```text
Edit only two small header colors in the supplied image. Change the lime four-square rooti logo mark to forest green #153E32. Change the lime background of the "Mi terreno" navigation pill to parchment #E9E5D5. Preserve the lime plot outline, all photographic imagery, all text, framing, dimensions and the visible "IMAGEN GENERADA CON IA" watermark exactly. The only lime accent in the whole image must be the highlighted plot outline.
```

### 03-agent.png color correction

```text
Edit only the small microphone button at the bottom-right inside the phone: change its lime background to parchment #E9E5D5, preserve its forest-green microphone icon. Keep the voice note bubble lime as the single lime accent. Preserve every other pixel, all Spanish text, Rooti avatars, crop chips, composition, dimensions and the visible "IMAGEN GENERADA CON IA" watermark.
```


Generated with the built-in image generator. UI references were read from master: app/index.html, app/main.js, app/app.css, DESIGN.md, and bot/src/rooti_bot/engine.py, plus the local design system and agent and how-it-works prototypes. These are illustrative UI images; satellite scenery and plan results are synthetic examples, not measured plot data. All images request a burned-in AI watermark.

## 01-plot.png

Reference image: None.

Exact prompt:

```text
Use case: ui-mockup. Create a premium final raster landing-page illustration for Rooti, a crop rotation planner for small farmers on Ecuador's coast. Landscape 4:3, 1200x900 or higher. Flat front-facing clean product UI, not an infographic, no perspective distortion, restrained soft shadow, ample cream #F3F0E5 outside margin. Forest #153E32 text, parchment #E9E5D5 cards with large 22px rounded corners, paper #FBFAF4 interiors. Normal-width Geist-like sans-serif weight 400–500, never condensed; small mono uppercase labels. One single lime #C8FF9E accent per image. Real Rooti UI: simple farmer language, connected stacked crop route blocks with small tabs like Scratch, no arrows. All text Spanish and crisp. NO NASA branding, flags, insignia or logos. Burn a clearly legible small forest-green watermark "IMAGEN GENERADA CON IA" into bottom-right cream margin, away from all UI. This is an illustrative demo, not verified farm data. Asset 01-plot.png. A landscape tablet-style rounded thin forest frame taking most of the image. Inside, realistic high-resolution satellite aerial view of flat tropical coastal Ecuador near Daule: irregular rectangular small rice paddies and maize parcels, irrigation channels, narrow dirt tracks, varied olive and deep-green crop textures, a muddy winding water channel on one edge, no mountains. One single parcel traced with a precise lime polygon outline, subtle transparent fill. Cream compact floating label reads exactly "Su terreno · Daule · 2.4 ha". Minimal Rooti top bar wordmark "rooti" in forest green; tiny four-module mosaic mark. Bottom cream strip "Marque su terreno" and minimal zoom controls. Satellite surface must look photographic, not vector illustration.
```

## 02-climate.png

Reference image: None.

Exact prompt:

```text
Use case: ui-mockup. Create a premium final raster landing-page illustration for Rooti, a crop rotation planner for small farmers on Ecuador's coast. Landscape 4:3, 1200x900 or higher. Flat front-facing clean product UI, not an infographic, no perspective distortion, restrained soft shadow, ample cream #F3F0E5 outside margin. Forest #153E32 text, parchment #E9E5D5 cards with large 22px rounded corners, paper #FBFAF4 interiors. Normal-width Geist-like sans-serif weight 400–500, never condensed; small mono uppercase labels. One single lime #C8FF9E accent per image. Real Rooti UI: simple farmer language, connected stacked crop route blocks with small tabs like Scratch, no arrows. All text Spanish and crisp. NO NASA branding, flags, insignia or logos. Burn a clearly legible small forest-green watermark "IMAGEN GENERADA CON IA" into bottom-right cream margin, away from all UI. This is an illustrative demo, not verified farm data. Asset 02-climate.png. One large elegant app UI card with header small mono "DAULE · 44 AÑOS" and heading "La lluvia en su terreno". Small single lime pill "Su terreno". Main chart realistic coastal seasonal monthly rainfall: high January through April with March peak, rapidly lower May and June, near dry July through November, rise December. Solid blue #4A7FC1 2.5px-equivalent clean smooth line and clearly visible translucent blue area below. Very subtle horizontal grid, axis "mm" with 0, 150, 300. Label all 12 months fully spelled, rotated 55 degrees for room: enero, febrero, marzo, abril, mayo, junio, julio, agosto, septiembre, octubre, noviembre, diciembre. Below separated section heading "Así queda su suelo", exactly 12 equal small rounded squares aligned to months, five green #78B957, three green, two straw #CDBF8C and two bare #B8643A. Legend "Con cultivo", "Con paja", "Sin cubrir". Small footer "Ejemplo ilustrativo". No decorative charts.
```

## 03-agent.png

Reference image: design/whatsapp/rooti-perfil.png (Rooti avatar identity reference).

Exact prompt:

```text
Use case: ui-mockup. Create a premium final raster landing-page illustration for Rooti, a crop rotation planner for small farmers on Ecuador's coast. Landscape 4:3, 1200x900 or higher. Flat front-facing clean product UI, not an infographic, no perspective distortion, restrained soft shadow, ample cream #F3F0E5 outside margin. Forest #153E32 text, parchment #E9E5D5 cards with large 22px rounded corners, paper #FBFAF4 interiors. Normal-width Geist-like sans-serif weight 400–500, never condensed; small mono uppercase labels. One single lime #C8FF9E accent per image. Real Rooti UI: simple farmer language, connected stacked crop route blocks with small tabs like Scratch, no arrows. All text Spanish and crisp. NO NASA branding, flags, insignia or logos. Burn a clearly legible small forest-green watermark "IMAGEN GENERADA CON IA" into bottom-right cream margin, away from all UI. This is an illustrative demo, not verified farm data. Asset 03-agent.png. One large front-facing phone centered, fills 86% height, wide enough for readable chat text, narrow forest bezel, rounded corners. WhatsApp recognizable chat layout with Rooti forest header, phone call icon, circular avatar faithfully matching supplied reference: smiling golden root mascot, straw farmer hat green band, green leaves, turquoise background. Avatar is only an insert, not overall image style. Header "Rooti" and subtitle "Asistente de su terreno". Cream chat background. Farmer right bubble "Tengo 2.4 hectáreas en Daule. ¿Qué siembro?" followed by separate compact voice note bubble with play triangle, waveform and "0:12". Only this voice note bubble uses lime. Rooti left answer parchment bubble "Para su terreno, empezaría con este plan:" then two connected crop route chips with small rice and soy silhouettes, first teal #2E9E92 tinted "Arroz · diciembre a abril", second green #78B957 tinted "Soya · mayo a agosto". Below Rooti says "Así aprovecha la lluvia y cuida la tierra." A small plain outlined action "Ver los tres planes". Composer at bottom "Escriba o envíe un audio" with microphone. All lettering highly legible. No extra floating elements.
```

## 04-plans.png

Reference image: None.

Exact prompt:

```text
Use case: ui-mockup. Create a premium final raster landing-page illustration for Rooti, a crop rotation planner for small farmers on Ecuador's coast. Landscape 4:3, 1200x900 or higher. Flat front-facing clean product UI, not an infographic, no perspective distortion, restrained soft shadow, ample cream #F3F0E5 outside margin. Forest #153E32 text, parchment #E9E5D5 cards with large 22px rounded corners, paper #FBFAF4 interiors. Normal-width Geist-like sans-serif weight 400–500, never condensed; small mono uppercase labels. One single lime #C8FF9E accent per image. Real Rooti UI: simple farmer language, connected stacked crop route blocks with small tabs like Scratch, no arrows. All text Spanish and crisp. NO NASA branding, flags, insignia or logos. Burn a clearly legible small forest-green watermark "IMAGEN GENERADA CON IA" into bottom-right cream margin, away from all UI. This is an illustrative demo, not verified farm data. Asset 04-plans.png. Wide app comparison panel within landscape canvas. Heading "Tres planes para su terreno" and small mono "DAULE · EJEMPLO ILUSTRATIVO". Three equal rounded parchment plan cards SIDE BY SIDE, with generous readable spacing. Titles exact: "El más seguro"; "El que más deja"; "El que más cuida la tierra". Only first card has single small lime pill "MÁS SEGURO". Each card contains 2 connected stacked tabbed route blocks with simple filled crop silhouette icons: first card teal rice "Arroz" / "diciembre a abril", green soy "Soya" / "mayo a agosto"; second card rice same season then golden maize #E6AE2E "Maíz" / "mayo a agosto"; third card golden maize "Maíz" / "diciembre a abril" then green soy "Soya" / "mayo a agosto". Large forest numbers respectively "39", "35", "38", each followed by exact plain sentence "de los últimos 44 años le habría ido bien". Numbers never shown as fractions. Below cards a quiet full-width comparison strip "Lo que hace hoy" and "31 de los últimos 44 años le habría ido bien". Keep all text readable and contained.
```

