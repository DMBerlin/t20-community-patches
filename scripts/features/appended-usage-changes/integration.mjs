import { isolateUsageEffect } from "./domain.mjs";

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const ItemClass = ctx.platform.classes.item;
  if (typeof ItemClass?.prototype?._allApplicableOnUseEffects !== "function") {
    throw new Error("Tormenta20 usage effect API not found");
  }

  // `this` is the rolled item's clone (ItemT20#roll); only the other items' effects were live documents.
  ctx.wrap(ItemClass.prototype, "_allApplicableOnUseEffects", function (original, ...args) {
    const effects = original.apply(this, args);
    return Array.isArray(effects) ? effects.map((effect) => isolateUsageEffect(effect, this.type)) : effects;
  });
}

/** applyEffectChanges/applyOnUseEffects are module-local in the system bundle, so the bug cannot be probed. */
export function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "applyEffectChanges/applyOnUseEffects are module-local" };
}
