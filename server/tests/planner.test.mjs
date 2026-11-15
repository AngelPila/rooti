import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { plan } from "../../app/planner.js";

const data = (path) => JSON.parse(readFileSync(new URL(`../../app/data/${path}`, import.meta.url)));
const { crops } = data("crops.json");
const iowa = data("demo/iowa.json").clim;
const daule = data("demo/daule.json").clim;

test("a maize cycle that cannot fit keeps the weather calendar without claiming a harvest", () => {
  const result = plan(iowa, crops, ["maize"], { start: "2024-01", end: "2024-03" });
  assert.equal(result.farm.issue, "no_time");
  assert.equal(result.farm.verdict, "danger");
  assert.equal(result.farm.grid.length, 3);
  assert.equal(result.farm.parcels[0].d.steps.length, 0);
  assert.equal(result.farm.harvest, 0);
  assert.equal(result.windows.maize.L, 4);
});

test("maize that fits but freezes still has a simulated calendar and loss metrics", () => {
  const result = plan(iowa, crops, ["maize"], { start: "2024-01", end: "2024-04" });
  assert.equal(result.farm.issue, "risk");
  assert.equal(result.farm.verdict, "danger");
  const [attempt] = result.farm.parcels[0].d.steps;
  assert.equal(attempt.crop, "maize");
  assert.equal(attempt.cold, 1);
  assert.equal(result.farm.bigLoss, 1);
  assert.equal(result.evalFarm([{ share: 1, steps: [attempt] }]).harvest, result.farm.harvest);
});

test("the climate table can be reused for incomes without changing planting outcomes", () => {
  const options = { start: "2024-01", end: "2024-08", irrigation: true };
  const soil = plan(daule, crops, ["rice"], options);
  const income = plan(daule, crops, ["rice"], { ...options, priority: "income" });
  assert.equal(soil.farm.issue, undefined);
  assert.ok(soil.farm.harvest > 0);
  assert.deepEqual(soil.windows, income.windows);
});
