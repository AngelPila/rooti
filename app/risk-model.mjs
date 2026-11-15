// The same feature order and scoring are used by training and the planner.
export const RISK_SCHEMA = 1;
export const RISK_ZONES = { daule: [-1.86, -79.98], babahoyo: [-1.80, -79.53], quevedo: [-1.03, -79.46] };
export const RISK_CROPS = ["rice", "maize"];
export const FEATURES = ["yield_shortfall", "water_deficit", "ponding", "temperature_loss", "irrigated", "sow_sin", "sow_cos", "maize", "babahoyo", "quevedo"];

export function riskZone(lat, lon) {
  const nearby = Object.entries(RISK_ZONES).map(([name, [a, b]]) => [name, Math.hypot(lat - a, lon - b) * 111]);
  return nearby.sort((a, b) => a[1] - b[1]).find(([, km]) => km <= 15)?.[0] ?? null;
}

export function riskFeatures(run, crop, month, zone, irrigation) {
  const angle = 2 * Math.PI * (month - 1) / 12;
  return [1 - run.yieldShare, Math.max(0, 1 - run.ratio), run.ponding, run.temperatureLoss, +irrigation,
    Math.sin(angle), Math.cos(angle), +(crop === "maize"), +(zone === "babahoyo"), +(zone === "quevedo")];
}

export const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, z))));

export function predictRisk(model, features, hardFailure) {
  if (hardFailure) return 1;
  const logit = features.reduce((score, x, i) => score + model.weights[i] * (x - model.means[i]) / model.scales[i], model.intercept);
  return sigmoid(logit);
}

export function validatedRiskModel(model) {
  if (model?.schema !== RISK_SCHEMA || model.status !== "validated" || !Number.isFinite(model.intercept)) return null;
  if (JSON.stringify(model.features) !== JSON.stringify(FEATURES)) return null;
  if (![model.weights, model.means, model.scales].every((xs) => Array.isArray(xs) && xs.length === FEATURES.length && xs.every(Number.isFinite)) || model.scales.some((x) => x <= 0)) return null;
  if (!Array.isArray(model.cohorts) || !model.cohorts.length || !model.cohorts.every((id) => {
    const [zone, crop, extra] = String(id).split(":");
    const metrics = model.validation?.[id];
    return !extra && Object.hasOwn(RISK_ZONES, zone) && RISK_CROPS.includes(crop) && metrics?.testCount >= 10
      && Number.isFinite(metrics.modelBrier) && Number.isFinite(metrics.baselineBrier) && metrics.modelBrier < metrics.baselineBrier;
  })) return null;
  return model;
}
