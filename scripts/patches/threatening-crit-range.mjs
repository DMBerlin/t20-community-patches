/**
 * Threatening critical range (tormenta20 1.6.5).
 *
 * Bug: the Ameaçadora enchantment stores "criticoM multiply 2". criticoM is the lowest d20 result that threatens a
 * critical hit, but applyItemChanges multiplies it as a plain number (19 -> 38), so the weapon never crits, not even
 * on a natural 20.
 *
 * Fix: in the rolled weapon's own usage effects, "criticoM multiply v" becomes "criticoM add -(21 - M)(v - 1)",
 * where M is the weapon's base criticoM. The threat range doubles (19 -> 17) and, since additions commute, the
 * doubling counts before any increase whatever the order of the usage effects (Tormenta20 JdA, p. 335).
 */
import { markWrapper } from "../utils.mjs";

const D20_FACES = 20;

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

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

/**
 * Returns a copy of one of the weapon's own usage effects with its threat range multiplications rewritten, or the
 * effect itself when there is nothing to rewrite or it cannot be cloned.
 * The changes go as clone data (clone() rebuilds from the source), so the copy keeps what earlier wrappers did to
 * the prepared changes and later clones keep the rewrite.
 * @param {object} effect
 * @param {object} weapon   The rolled weapon (clone made by ItemT20#roll)
 */
export function adjustThreatEffect(effect, weapon) {
  const changes = effect?.system?.changes;
  if (!Array.isArray(changes) || !changes.some(isThreatMultiply) || typeof effect.clone !== "function") return effect;
  try {
    const rewritten = rewriteThreatChanges(changes, weapon?.system?.criticoM);
    if (!rewritten.count) return effect;
    return effect.clone({ system: { changes: rewritten.changes } }, { keepId: true });
  } catch (err) {
    console.warn("t20-community-patches | threatening-crit-range: could not adjust", effect?.uuid, err);
    return effect;
  }
}

function apply() {
  const ItemClass = CONFIG.Item.documentClass;
  const original = ItemClass.prototype._allApplicableOnUseEffects;
  if (typeof original !== "function") throw new Error("Tormenta20 usage effect API not found");

  // `this` is the rolled weapon's clone (ItemT20#roll); only its own effects are adjusted.
  ItemClass.prototype._allApplicableOnUseEffects = markWrapper(function (...args) {
    const effects = original.apply(this, args);
    if (this?.type !== "arma" || !Array.isArray(effects)) return effects;
    return effects.map((effect) => (effect?.parent?.id === this.id ? adjustThreatEffect(effect, this) : effect));
  }, original);
}

/** applyItemChanges/applyOnUseEffects are module-local in the system bundle, so the bug cannot be probed. */
function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "applyItemChanges is module-local" };
}

export default {
  id: "threatening-crit-range",
  group: "items",
  issue: 30,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  apply
};
