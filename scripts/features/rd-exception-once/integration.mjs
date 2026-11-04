import { sourceFingerprint } from "../../lib/source.mjs";
import { KNOWN_APPLY_DAMAGE_V2, diagnoseFingerprint, prepareCall } from "./domain.mjs";

export const APPLY_DAMAGE = "ActorT20#applyDamageV2";

/** Source of the original method under the module's wrappers, or null. */
function originalSource(ctx, fn) {
  try {
    return ctx.platform.sourceOf(fn);
  } catch {
    return null;
  }
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const source = ctx.platform.sourceOfMethod(APPLY_DAMAGE);
  if (source == null) return { bug: "unknown", confidence: "low", evidence: "applyDamageV2 not found" };
  return diagnoseFingerprint(sourceFingerprint(source));
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const prototype = ctx.platform.classes.actor?.prototype;
  const original = prototype?.applyDamageV2;
  if (typeof original !== "function") throw new Error("Tormenta20 applyDamageV2 not found");
  const known = sourceFingerprint(originalSource(ctx, original)) === KNOWN_APPLY_DAMAGE_V2;
  if (!known) ctx.log.warn("unrecognized applyDamageV2, not changing it");

  // applyDamageV2 reads the resistances synchronously, before its first await (this.update, T20:6273), so the
  // prepared data can be restored as soon as the original returns its promise.
  ctx.wrap(prototype, "applyDamageV2", function (original, roll, ...args) {
    const [multiplier = 1, type = "dano", ...rest] = args;
    let restore = null;
    if (known) {
      try {
        restore = prepareCall(this, roll, multiplier, type);
      } catch (err) {
        restore = null;
        ctx.log.warn("could not resolve the reductions", err);
      }
    }
    // Penetration was already spent by resolveReductions; the caller's roll is never changed.
    const call = restore ? Object.create(roll, { options: { value: { ...roll.options, rd: 0 } } }) : roll;
    try {
      return original.call(this, call, multiplier, type, ...rest);
    } finally {
      restore?.();
    }
  });
}
