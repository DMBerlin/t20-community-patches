/** Pure logic of the usage-effect-max rule: evaluating a maximum and finding the applications above it. */

/**
 * Evaluates a maximum. Only an integer ≥ 0 is valid.
 * @param {string} formula
 * @param {object} rollData
 * @param {(formula: string, rollData: object) => number|null} evaluate  Dice-free evaluator (never eval).
 * @returns {number|null}  null when the formula is invalid.
 */
export function evaluateMax(formula, rollData, evaluate) {
  let value;
  try {
    value = evaluate(String(formula), rollData);
  } catch {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * How many times the system applies an effect for a form value, as applyOnUseEffects: a falsy value is not
 * applied, otherwise `Number(aplica) || 1` (a checked checkbox, or the array of repeated field names, is 1).
 * @param {unknown} aplica
 */
export function requestedApplications(aplica) {
  if (!aplica) return 0;
  const value = Number(aplica) || 1;
  return value > 0 ? value : 0;
}

/**
 * Merges the maximums of effects that share an id (ids are only unique per parent document; the system keys the
 * form by id, so they get the same quantity): the lowest maximum wins.
 * @param {{id: string, max: number, name: string}[]} entries
 * @returns {Record<string, {max: number, name: string}>}
 */
export function mergeLimits(entries) {
  const limits = {};
  for (const { id, max, name } of entries) {
    if (!(id in limits) || max < limits[id].max) limits[id] = { max, name };
  }
  return limits;
}

/**
 * @param {Record<string, {aplica?: unknown}>} applied  Expanded `aprs` of the form.
 * @param {Record<string, {max: number|null, name?: string}>} limits  Maximum of each effect, null = no limit.
 * @returns {{id: string, name: string, requested: number, max: number}[]}
 */
export function findViolations(applied = {}, limits = {}) {
  const violations = [];
  for (const [id, limit] of Object.entries(limits)) {
    if (!Number.isInteger(limit?.max)) continue;
    const requested = requestedApplications(applied?.[id]?.aplica);
    if (requested > limit.max) violations.push({ id, name: limit.name ?? id, requested, max: limit.max });
  }
  return violations;
}
