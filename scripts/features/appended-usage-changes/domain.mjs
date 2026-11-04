const ROLL_ONLY_TYPES = new Set(["pericia", "atributo"]);
const APPENDED_PASSIVE_KEY = /^\+system\.[\w.-]+$/;

/**
 * Whether a usage change "+system.*" must be normalized to "system.*".
 * @param {{key?: string}} change
 * @param {object} context
 * @param {boolean} [context.aumenta]   abilityUse.aumenta of the usage effect
 * @param {string} [context.itemType]   Type of the rolled item
 * @returns {boolean}
 */
export function shouldNormalizeAppendedChange(change, { aumenta, itemType } = {}) {
  if (aumenta || ROLL_ONLY_TYPES.has(itemType)) return false;
  return typeof change?.key === "string" && APPENDED_PASSIVE_KEY.test(change.key);
}

/**
 * Normalizes, in place, the eligible changes of an isolated usage effect copy.
 * @param {{key?: string}[]} changes
 * @param {{aumenta?: boolean, itemType?: string}} context
 * @returns {number} How many changes were normalized
 */
export function normalizeAppendedChanges(changes, context) {
  let count = 0;
  for (const change of changes ?? []) {
    if (!shouldNormalizeAppendedChange(change, context)) continue;
    change.key = change.key.slice(1);
    count++;
  }
  return count;
}

/**
 * Returns an isolated copy of a usage effect (same id and parent), or the original effect if it cannot be cloned.
 * @param {object} effect
 * @param {string} itemType   Type of the rolled item
 */
export function isolateUsageEffect(effect, itemType) {
  if (typeof effect?.clone !== "function") return effect;
  try {
    const copy = effect.clone({}, { keepId: true });
    normalizeAppendedChanges(copy.system?.changes, { aumenta: !!copy.system?.abilityUse?.aumenta, itemType });
    return copy;
  } catch (err) {
    console.warn("t20-community-patches | appended-usage-changes: could not isolate", effect?.uuid, err);
    return effect;
  }
}

