import { readFile, rename, writeFile } from "node:fs/promises";
import { fetchClimate } from "../app/climate.js";
import { observedPlanting } from "../app/planner.js";
import { FEATURES, RISK_CROPS, RISK_SCHEMA, predictRisk, riskFeatures, riskZone, sigmoid, validatedRiskModel } from "../app/risk-model.mjs";

const L2 = 0.05;
const MAX_ITERATIONS = 3000;
const TOLERANCE = 1e-7;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const between = (x, a, b) => Number.isFinite(x) && x >= a && x <= b;
const validDate = (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

function readRows(jsonl) {
  const seen = new Set();
  const today = new Date().toISOString().slice(0, 10);
  return jsonl.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    let r;
    try { r = JSON.parse(line); } catch { throw new Error(`Line ${index + 1}: invalid JSON`); }
    const zone = r && between(r.lat, -90, 90) && between(r.lon, -180, 180) ? riskZone(r.lat, r.lon) : null;
    if (!zone || !RISK_CROPS.includes(r.crop) || !validDate(r.sown) || !validDate(r.observedOn)
      || r.sown >= r.observedOn || r.observedOn > today || typeof r.irrigation !== "boolean"
      || !between(r.lossShare, 0, 1) || !between(r.site?.awc, 1, 350) || !between(r.site?.ph, 0, 14) || !between(r.site?.wl, 0, 1)
      || ![r.farmId, r.plotId].every((id) => typeof id === "string" && id.length > 0 && id.trim() === id)) {
      throw new Error(`Line ${index + 1}: expected a complete observed rice or maize record inside a pilot area`);
    }
    const key = JSON.stringify([r.farmId, r.plotId, r.crop, r.sown]);
    if (seen.has(key)) throw new Error(`Line ${index + 1}: duplicate planting`);
    seen.add(key);
    return [{ ...r, zone, cohort: `${zone}:${r.crop}`, target: +(r.lossShare >= 0.5), season: r.observedOn.slice(0, 4), line: index + 1 }];
  });
}

function fit(rows) {
  // Standardize on training rows only. Penalize the weights, leaving the intercept free.
  const means = FEATURES.map((_, i) => mean(rows.map((r) => r.x[i])));
  const scales = means.map((mu, i) => Math.sqrt(mean(rows.map((r) => (r.x[i] - mu) ** 2))) || 1);
  const data = rows.map((r) => ({ y: r.target, x: [1, ...r.x.map((x, i) => (x - means[i]) / scales[i])] }));
  const prevalence = mean(data.map((r) => r.y));
  const weights = [Math.log(prevalence / (1 - prevalence)), ...FEATURES.map(() => 0)];
  const step = 1 / (0.25 * mean(data.map((r) => r.x.reduce((sum, x) => sum + x * x, 0))) + L2);
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const gradient = weights.map((w, i) => i ? L2 * w : 0);
    for (const { x, y } of data) {
      const error = (sigmoid(x.reduce((sum, v, i) => sum + weights[i] * v, 0)) - y) / data.length;
      for (let i = 0; i < x.length; i++) gradient[i] += error * x[i];
    }
    if (Math.max(...gradient.map(Math.abs)) < TOLERANCE) {
      return { means, scales, weights: weights.slice(1), intercept: weights[0] };
    }
    for (let i = 0; i < weights.length; i++) weights[i] -= step * gradient[i];
  }
  throw new Error("Logistic regression did not converge; no model written");
}

const hasOutcomes = (rows, minimum) => [0, 1].every((outcome) => rows.filter((r) => r.target === outcome).length >= minimum);

async function train(input, output) {
  const records = readRows(await readFile(input, "utf8"));
  const lastSeason = records.map((r) => r.season).sort().at(-1);
  const heldOut = records.filter((r) => r.season === lastSeason);
  const heldOutFarms = new Set(heldOut.map((r) => r.farmId));
  const cutoff = heldOut.map((r) => r.sown).sort()[0];
  const earlier = records.filter((r) => r.observedOn < cutoff && !heldOutFarms.has(r.farmId));
  const cohorts = [...new Set(earlier.map((r) => r.cohort))].filter((id) => {
    const training = earlier.filter((r) => r.cohort === id), validation = heldOut.filter((r) => r.cohort === id);
    return training.length >= 30 && hasOutcomes(training, 5) && validation.length >= 10 && hasOutcomes(validation, 2);
  });
  if (!cohorts.length) throw new Error("No pilot crop/area has enough earlier records and outcomes from new farms in the latest season");

  const readData = async (name) => JSON.parse(await readFile(new URL(`../app/data/${name}`, import.meta.url), "utf8"));
  const [{ crops }, catalog] = await Promise.all([readData("crops.json"), readData("earthdata-imerg.json")]);
  const weather = new Map();
  async function features(record) {
    const point = `${record.lat.toFixed(2)},${record.lon.toFixed(2)}`;
    if (!weather.has(point)) weather.set(point, await fetchClimate(record.lat, record.lon, { catalog: () => catalog }));
    const month = Number(record.sown.slice(5, 7));
    const run = observedPlanting(weather.get(point), crops[record.crop], record.crop,
      { start: record.sown.slice(0, 7), irrigation: record.irrigation, site: record.site });
    if (!run) throw new Error(`Line ${record.line}: missing complete observed daily NASA weather for the crop cycle`);
    return { ...record, hardFailure: run.failed, baseline: +(run.yieldShare <= 0.5),
      x: riskFeatures(run, record.crop, month, record.zone, record.irrigation) };
  }
  // Requests are sequential and shared by each point to limit the load on NASA POWER.
  const training = [], validation = [];
  for (const r of earlier) if (cohorts.includes(r.cohort)) {
    const row = await features(r);
    if (!row.hardFailure) training.push(row);
  }
  const supported = cohorts.filter((id) => {
    const rows = training.filter((r) => r.cohort === id);
    return rows.length >= 30 && hasOutcomes(rows, 5);
  });
  if (!supported.length) throw new Error("Too few usable training records outside deterministic crop failures");
  const trainRows = training.filter((r) => supported.includes(r.cohort));
  const model = fit(trainRows);
  for (const r of heldOut) if (supported.includes(r.cohort)) validation.push(await features(r));
  const metrics = {};
  for (const id of supported) {
    const rows = validation.filter((r) => r.cohort === id);
    const rate = mean(trainRows.filter((r) => r.cohort === id).map((r) => r.target));
    const simulatorBrier = mean(rows.map((r) => (r.baseline - r.target) ** 2));
    const prevalenceBrier = mean(rows.map((r) => ((r.hardFailure ? 1 : rate) - r.target) ** 2));
    metrics[id] = {
      testCount: rows.length,
      simulatorBrier, prevalenceBrier, baselineBrier: Math.min(simulatorBrier, prevalenceBrier),
      modelBrier: mean(rows.map((r) => (predictRisk(model, r.x, r.hardFailure) - r.target) ** 2)),
    };
  }
  const approved = supported.filter((id) => metrics[id].modelBrier < metrics[id].baselineBrier);
  console.log(JSON.stringify({ heldOutSeason: lastSeason, trainingCount: trainRows.length, metrics, approved }, null, 2));
  const result = { ...model, schema: RISK_SCHEMA, features: FEATURES, status: "validated", trainedAt: new Date().toISOString(),
    trainingCount: trainRows.length, heldOutSeason: lastSeason, l2: L2, cohorts: approved, validation: metrics };
  if (!validatedRiskModel(result)) throw new Error("No cohort improved on held-out data; no model written");
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, output);
}

const [input, output] = process.argv.slice(2);
if (!input || input === "--help" || !output) {
  console.log("Usage: node pipeline/train-risk.mjs <observed-harvests.jsonl> <output-risk-model.json>");
  if (input !== "--help") process.exitCode = 2;
} else {
  try { await train(input, output); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
