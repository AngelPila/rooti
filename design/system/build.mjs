// Builds index.html from src.html: inlines the demo plan and the images,
// so the page is a single file that opens from disk or inside an inline viewer.
// demo-plan.json is a snapshot of app/planner.js output for the Daule demo farm (Dec 2026 – Nov 2027).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const plan = JSON.parse(fs.readFileSync(path.join(here, "demo-plan.json"), "utf8"));

const jpeg = (file, width, quality) =>
  "data:image/jpeg;base64," + execFileSync("magick", [path.join(root, file), "-resize", `${width}x`, "-strip", "-quality", String(quality), "jpg:-"]).toString("base64");

const html = fs.readFileSync(path.join(here, "src.html"), "utf8")
  .replace("__PLAN__", JSON.stringify(plan))
  .replaceAll("__IMG_DAULE__", jpeg("app/img/sat/daule.jpg", 1800, 72))
  .replace(/__IMG_CROP_(\w+)__/g, (_, c) => "data:image/jpeg;base64," + fs.readFileSync(path.join(here, `assets/crop-${c.toLowerCase()}.jpg`)).toString("base64"));
fs.writeFileSync(path.join(here, "index.html"), html);
console.log(`index.html ${Math.round(html.length / 1024)} KB`);
