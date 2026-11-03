/** Threat range of weapons (threatening-crit-range, item-effective-stats). */

export const D20_FACES = 20;

/**
 * Whether a change multiplies the threat range.
 * @param {{key?: string, type?: string}} change
 * @returns {boolean}
 */
export function isThreatMultiply(change) {
  return change?.key === "criticoM" && change?.type === "multiply";
}

/**
 * The criticoM increase equivalent to multiplying the threat range of a weapon.
 * @param {number|string} criticoM      Base lowest d20 result that threatens (19 = 19-20)
 * @param {number|string} multiplier    Change value (2 = doubles)
 * @returns {number|null}               Value for a "criticoM add" change, or null when the change must stay as is
 */
export function threatRangeIncrease(criticoM, multiplier) {
  const minimum = Number(criticoM);
  const factor = Number(multiplier);
  if (!Number.isInteger(minimum) || minimum < 1 || minimum > D20_FACES) return null;
  if (!Number.isInteger(factor) || factor <= 1) return null;
  return -(D20_FACES + 1 - minimum) * (factor - 1);
}

/**
 * Copies the changes, rewriting each threat range multiplication as the equivalent addition.
 * @param {object[]} changes
 * @param {number|string} criticoM   Base criticoM of the rolled weapon
 * @returns {{changes: object[], count: number}}
 */
export function rewriteThreatChanges(changes, criticoM) {
  let count = 0;
  const result = (changes ?? []).map((change) => {
    if (!isThreatMultiply(change)) return { ...change };
    const increase = threatRangeIncrease(criticoM, change.value);
    if (increase === null) return { ...change };
    count++;
    return { ...change, type: "add", value: increase };
  });
  return { changes: result, count };
}
