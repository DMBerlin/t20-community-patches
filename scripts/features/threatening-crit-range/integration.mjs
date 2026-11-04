import { adjustThreatEffect } from "./domain.mjs";

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const proto = ctx.platform.classes.item?.prototype;
  if (typeof proto?._allApplicableOnUseEffects !== "function") throw new Error("Tormenta20 usage effect API not found");

  // `this` is the rolled weapon's clone (ItemT20#roll); only its own effects are adjusted.
  ctx.wrap(proto, "_allApplicableOnUseEffects", function (original, ...args) {
    const effects = original.apply(this, args);
    if (this?.type !== "arma" || !Array.isArray(effects)) return effects;
    return effects.map((effect) => (effect?.parent?.id === this.id ? adjustThreatEffect(effect, this) : effect));
  });
}

/** applyItemChanges/applyOnUseEffects are module-local in the system bundle, so the bug cannot be probed. */
export function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "applyItemChanges is module-local" };
}
