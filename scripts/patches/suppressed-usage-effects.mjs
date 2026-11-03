/**
 * Suppressed usage effects (tormenta20 1.6.5).
 *
 * Bug: usage effects (system.onuse) held by unequipped weapons/equipment are still offered in the usage
 * dialog and auto-applied ("Aplicar Sempre") on item, skill and attribute rolls, although the same effects are
 * shown as suppressed and give no passive bonus.
 *
 * Fix: usage effects held by another item whose effects are suppressed (ItemT20#areEffectsSuppressed or
 * ActiveEffect#isSuppressed) are removed from the applicable lists. The rolled item's own effects and the
 * actor's own effects are kept.
 */

import { unwrap } from "../utils.mjs";
import { wraps } from "../kernel/wrap.mjs";

/**
 * @param {object} effect                 ActiveEffect
 * @param {string|null} rolledItemId      Id of the rolled item (null for skill/attribute rolls)
 * @returns {boolean}
 */
export function isSuppressedUsageEffect(effect, rolledItemId) {
  if (!effect?.system?.onuse) return false;
  const parent = effect.parent;
  if (parent?.documentName !== "Item") return false;
  if (rolledItemId && parent.id === rolledItemId) return false;
  return Boolean(effect.isSuppressed || parent.areEffectsSuppressed);
}

/**
 * Whether a system function collects usage effects without looking at suppression.
 * @param {string} source
 * @returns {boolean}
 */
export function collectsIgnoringSuppression(source) {
  return source.includes("onuse") && !/suppress/i.test(source);
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const ROLL_METHODS = ["rollPericia", "rollAtributo"];

/** Depth of the synchronous collection window of rollPericia/rollAtributo, by actor. */
const collecting = new WeakMap();

function apply() {
  const ItemClass = CONFIG.Item.documentClass;
  const proto = CONFIG.Actor.documentClass.prototype;
  if (
    typeof ItemClass.prototype._allApplicableOnUseEffects !== "function" ||
    typeof proto.traverseEmbeddedDocuments !== "function" ||
    ROLL_METHODS.some((m) => typeof proto[m] !== "function")
  ) {
    throw new Error("Tormenta20 usage effect API not found");
  }

  // Item rolls (dialog and automatic path). `this` is the rolled item's clone, which keeps its id.
  wraps.wrap(ItemClass.prototype, "_allApplicableOnUseEffects", "suppressed-usage-effects", function (allApplicable, ...args) {
    const effects = allApplicable.apply(this, args);
    return Array.isArray(effects) ? effects.filter((e) => !isSuppressedUsageEffect(e, this.id)) : effects;
  });

  // Skill/attribute rolls build their list inline: filter the traversal only inside the collection window.
  wraps.wrap(proto, "traverseEmbeddedDocuments", "suppressed-usage-effects", function (traverse, ...args) {
    const iterator = traverse.apply(this, args);
    if (!collecting.get(this)) return iterator;
    return (function* () {
      for (const entry of iterator) {
        const doc = entry?.[1];
        if (doc?.documentName === "ActiveEffect" && isSuppressedUsageEffect(doc, null)) continue;
        yield entry;
      }
    })();
  });

  for (const method of ROLL_METHODS) {
    wraps.wrap(proto, method, "suppressed-usage-effects", function (original, ...args) {
      collecting.set(this, (collecting.get(this) ?? 0) + 1);
      try {
        // The async original runs synchronously until its first await, which comes after the collection loop.
        return original.apply(this, args);
      } finally {
        const depth = collecting.get(this) - 1;
        if (depth > 0) collecting.set(this, depth);
        else collecting.delete(this);
      }
    });
  }
}

/**
 * The bug exists while any of the three collection paths ignores suppression. A path that mentions suppression
 * may still be partially fixed, so that case is reported as unknown.
 * @returns {boolean|undefined}
 */
function isNeeded() {
  const itemProto = CONFIG.Item?.documentClass?.prototype;
  const actorProto = CONFIG.Actor?.documentClass?.prototype;
  const fns = [itemProto?._allApplicableOnUseEffects, ...ROLL_METHODS.map((m) => actorProto?.[m])].map(unwrap);
  if (fns.some((fn) => typeof fn !== "function")) return undefined;
  return fns.some((fn) => collectsIgnoringSuppression(Function.prototype.toString.call(fn))) || undefined;
}

export default {
  id: "suppressed-usage-effects",
  group: "usage-effects",
  issue: 4,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  apply
};
