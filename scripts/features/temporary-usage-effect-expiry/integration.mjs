import { markWrapper } from "../../lib/source.mjs";
import { KEY, diagnose, findDescriptor, isTrackableUsageEffect } from "./domain.mjs";

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const EffectClass = ctx.platform.classes.activeEffect;
  const original = findDescriptor(EffectClass?.prototype, KEY);
  if (typeof original?.get !== "function") throw new Error("ActiveEffect#isExpiryTrackable not found (requires Foundry v14)");
  Object.defineProperty(EffectClass.prototype, KEY, {
    configurable: true,
    enumerable: original.enumerable ?? false,
    get: markWrapper(function () {
      if (original.get.call(this)) return true;
      try {
        return isTrackableUsageEffect(this);
      } catch {
        return false;
      }
    }, original.get)
  });
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const proto = ctx.platform.classes.activeEffect?.prototype;
  return diagnose(proto, findDescriptor(proto, KEY)?.get);
}
