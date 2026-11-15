# Rooti design rules

Rules learned from design reviews. Each one comes from a correction the product owner made, with the reason in their words. The living reference is the design system page: `design/system/index.html` (source `design/system/src.html`, built with `node design/system/build.mjs`).

## Visual direction
- **The look follows overstory.com: forest green `--bosque` #153E32, cream `--crema` #F3F0E5, parchment cards, one lime `--lima` #C8FF9E accent per screen, huge section radii, mono uppercase labels.**
  Why: "esta página siento que me gusta mucho, hagamos un design system de esto".
  <!-- 2026-11-14: user picked overstory.com as the reference for the whole UI -->
- **The logo is the 06 "Mosaico" mark (four modules = four plots) with the wordmark in Space Grotesk 500. Space Grotesk is used for the logo only.**
  <!-- 2026-11-14: "este html esta el logo es el 06 de rooti" -->

## Typography
- **Headings never use a condensed or narrow display face (no `font-stretch` below 100%, no Bricolage Grotesque).** Headings use a normal-width face at weight 400–500 with tracking around −0.04em: Geist today, Funnel Display and Instrument Serif are the candidates on trial.
  Why: "esta fuente es horrible", "que asco" (on Bricolage Grotesque at 82% width).
  <!-- 2026-11-15 -->

## Charts and data
- **Charts for farmers are simple but present: one dot per real year, 12 squares for soil cover, one calendar. Never one answer per screen, never a wheel or circular chart.**
  Why: "si graficos pero mas simples, tampoco son retrasados los agricultores"; "el grafico circular iuk".
  <!-- 2026-11-14 -->
- **Data marks must read at a glance: rain is a filled area with a 2.5px `--lluvia` line, never thin pale bars or needles.**
  Why: "esos azulitos NO SE VE".
  <!-- 2026-11-15: 6px pale-blue rain needles in the calendar -->

## Copy
- **Never write month ranges as abbreviations ("dic–mar", "abr–jul") in a plan. Show the plan as a route: crop icon, crop name, and the months spelled out ("Maíz · diciembre a marzo").** Cards show the crops as icon chips, not a sentence.
  Why: "esta huevada no se entiende y se ve horrible asi dic-mar".
  <!-- 2026-11-15 -->
- **The route is a stack of blocks that fit together like Scratch: no gaps and no arrows between steps; each block is tinted with its crop's colour and has a tab that fits into the next one, which shows the order.**
  Why: "esas tarjetitas con flechas mas parecidas a las de scratch, pegaditas pero con direccion".
  <!-- 2026-11-15 -->
- **A stat is a big number plus a plain sentence ("39 — de los últimos 44 años, le habría ido bien con este plan"), never a fraction with a label like "39/44 años salió bien".**
  Why: the old version was not understood ("esto tmb").
  <!-- 2026-11-15 -->
- **No marketing filler that sounds generated, and NASA is credited in a small source line, never in a headline or hero sentence.**
  Why: "este maldito texto no hace falta que este, se nota que es ia"; "si mencionarlo pero no tan asi tan feo".
  <!-- 2026-11-14 -->
- **What we don't know is shown as short chips ("Lluvia de la zona", "Suelo estimado") that open one sentence on tap, never as a paragraph.**
  Why: "por que el no sabemos tiene tantisimo texto?"
  <!-- 2026-11-14 -->

## Interaction
- **Never ask the farmer to pick a priority (Suelo / Ingreso / Agua). Show three named plans side by side, "El más seguro", "El que más deja", "El que más cuida la tierra", plus "Lo que hace hoy" to compare.**
  Why: "no hagamos elegir por plan btw quita esto"; the farmer picks from results, not from an abstract priority.
  <!-- 2026-11-15 -->

## Icons and images
- **UI icons are hand-drawn SVG symbols on a 24 grid, filled shapes with cuts like the logo, using `currentColor`. Never AI-generated raster icons.** AI images are only for large illustrations, and each one carries a visible "IMAGEN GENERADA CON IA" watermark (competition rule).
  Why: confirmed choice ("ok lo recomendado"): icons must stay sharp at 16px, recolor with the theme, and a watermark cannot fit on an icon.
  <!-- 2026-11-15 -->

- **"How it works" visuals are drawn live from the real components and data (Esri satellite photo, NASA POWER rain, route blocks, chat), never AI screenshots of the UI.**
  Why: "se ve feo y aparte las capturas se ven borrosas" (AI raster mockups with tiny upscaled text).
  <!-- 2026-11-15 -->

## Motion
Applied from the `remove-animations`, `choreograph` and `mobile-native` skills at the owner's request ("instala esos y aplicalos").
- **Nothing fades in on scroll, numbers count only when their value changes, and no loop runs on a persistent element (the loader is the exception).**
- **UI transitions stay under 300ms (`--t-fast` 150ms, `--t-base` 250ms); only drawings that explain something (the rain curve, the hero lines) take longer, once.**
- **On a computer the hero is a scroll stage: it stays pinned while the scroll draws the data sources into "your rotation plan" and out to the four plans, then the sheet rises over it. Labels open with a clip, never a fade-in, and everything runs backwards with the scroll. Phones and reduced motion keep the plain hero.**
  Why: the owner wanted the Overstory-style "connect every signal" animation on the hero itself ("la idea era de que esto sea para esto").
  <!-- 2026-11-15 -->
- **Hover styles live inside `@media (hover: hover) and (pointer: fine)`; every tappable element has an `:active` state instead.**

## Layout
- **On a computer, app screens use the full width up to 1920px with the same 24px side margin as the topbar; past 1920px the topbar insets to that same column so the edges line up.**
  This covers the landing, the results tabs and the bootcamp. Long text keeps its own reading width (about 75ch) inside the wide column instead of narrowing the whole page.
  Why: "estos espacios entre los lados no se ven bien" (bare cream bands beside a 1440px column on a wide screen).
  <!-- 2026-11-15 -->

## Working on UI
- **Do UI work in a single agent thread; do not fan out subagents for design work.**
  Why: "Un solo agente, este hilo".
  <!-- 2026-11-14 -->
