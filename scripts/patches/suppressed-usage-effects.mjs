/**
 * Whether a system function collects usage effects without looking at suppression.
 * @param {string} source
 * @returns {boolean}
 */
import { isSuppressedUsageEffect } from "../lib/usage-effects.mjs";
export function collectsIgnoringSuppression(source) {
  return source.includes("onuse") && !/suppress/i.test(source);
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const ROLL_METHODS = ["rollPericia", "rollAtributo"];

/** Depth of the synchronous collection window of rollPericia/rollAtributo, by actor. */
const collecting = new WeakMap();

/** @param {import("../kernel/feature.mjs").FeatureContext} ctx */
function install(ctx) {
  const ItemClass = ctx.platform.classes.item;
  const proto = ctx.platform.classes.actor?.prototype;
  if (
    typeof ItemClass?.prototype?._allApplicableOnUseEffects !== "function" ||
    typeof proto?.traverseEmbeddedDocuments !== "function" ||
    ROLL_METHODS.some((m) => typeof proto[m] !== "function")
  ) {
    throw new Error("Tormenta20 usage effect API not found");
  }

  // Item rolls (dialog and automatic path). `this` is the rolled item's clone, which keeps its id.
  ctx.wrap(ItemClass.prototype, "_allApplicableOnUseEffects", function (allApplicable, ...args) {
    const effects = allApplicable.apply(this, args);
    return Array.isArray(effects) ? effects.filter((e) => !isSuppressedUsageEffect(e, this.id)) : effects;
  });

  // Skill/attribute rolls build their list inline: filter the traversal only inside the collection window.
  ctx.wrap(proto, "traverseEmbeddedDocuments", function (traverse, ...args) {
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
    ctx.wrap(proto, method, function (original, ...args) {
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
 * @param {import("../kernel/feature.mjs").FeatureContext} ctx
 * @returns {boolean|undefined}
 */
function isNeeded(ctx) {
  const { classes, sourceOf } = ctx.platform;
  const itemProto = classes.item?.prototype;
  const actorProto = classes.actor?.prototype;
  const sources = [itemProto?._allApplicableOnUseEffects, ...ROLL_METHODS.map((m) => actorProto?.[m])].map(sourceOf);
  if (sources.some((source) => typeof source !== "string")) return undefined;
  return sources.some(collectsIgnoringSuppression) || undefined;
}

export default {
  id: "suppressed-usage-effects",
  group: "usage-effects",
  issue: 4,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  install
};
