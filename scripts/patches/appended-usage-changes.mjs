/**
 * Appended usage changes (tormenta20 1.6.5).
 *
 * Bug: applyOnUseEffects mutates the live usage effects of other items (the "+" branch strips the "+" from the
 * change object and pushes that same object; the final reduce rewrites its value), and a "+system.*" change with
 * abilityUse.aumenta=false is appended twice to the main effect (once by the "+" branch, once by addToChange,
 * which already sees the stripped key). Inspiração Marcial doubles the damage bonus and leaks it to later uses.
 *
 * Fix: the applicable usage effects are isolated clones, and in that proven case the clone's "+system.*" key is
 * normalized to "system.*", so addToChange appends it exactly once.
 */
import { markWrapper } from "../utils.mjs";

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

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

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

function apply() {
  const ItemClass = CONFIG.Item.documentClass;
  const original = ItemClass.prototype._allApplicableOnUseEffects;
  if (typeof original !== "function") throw new Error("Tormenta20 usage effect API not found");

  // `this` is the rolled item's clone (ItemT20#roll); only the other items' effects were live documents.
  ItemClass.prototype._allApplicableOnUseEffects = markWrapper(function (...args) {
    const effects = original.apply(this, args);
    return Array.isArray(effects) ? effects.map((effect) => isolateUsageEffect(effect, this.type)) : effects;
  }, original);
}

/** applyEffectChanges/applyOnUseEffects are module-local in the system bundle, so the bug cannot be probed. */
function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "applyEffectChanges/applyOnUseEffects are module-local" };
}

export default {
  id: "appended-usage-changes",
  group: "usage-effects",
  issue: 23,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  apply
};
