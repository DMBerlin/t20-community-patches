import { markWrapper } from "../../lib/source.mjs";
import { IGNORE_ARMOR_TAG, diagnose, findDescriptor, isConditionSuppressed, ownsFanatic } from "./domain.mjs";

export const SOURCES = ["ActiveEffectT20#isSuppressed", "BaseEffect#isSuppressed"];

function equipmentSlots(platform) {
  try {
    return Boolean(platform.settingsOf("tormenta20").get("equipmentSlots"));
  } catch {
    return false;
  }
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const { platform } = ctx;
  const EffectClass = platform.classes.activeEffect;
  const original = findDescriptor(EffectClass?.prototype, "isSuppressed");
  if (typeof original?.get !== "function") throw new Error("ActiveEffect#isSuppressed not found");
  const actorProto = platform.classes.actor?.prototype;
  if (typeof actorProto?.applyActiveEffects !== "function") throw new Error("Actor#applyActiveEffects not found");

  Object.defineProperty(EffectClass.prototype, "isSuppressed", {
    configurable: true,
    enumerable: original.enumerable ?? false,
    get: markWrapper(function () {
      const suppressed = original.get.call(this);
      if (suppressed) return suppressed;
      try {
        return isConditionSuppressed(this, equipmentSlots(platform));
      } catch {
        return suppressed;
      }
    }, original.get)
  });

  // prepareMovement (T20:18761) runs in the TypeDataModel's prepareDerivedData, after the "initial" phase.
  ctx.wrap(actorProto, "applyActiveEffects", function (applyEffects, phase, ...args) {
    const result = applyEffects.call(this, phase, ...args);
    if (phase === "initial") {
      try {
        const tags = this.system?.attributes?.movement?.tags;
        if (tags instanceof Set && ownsFanatic(this.items)) tags.add(IGNORE_ARMOR_TAG);
      } catch (err) {
        ctx.log.error("failed to apply Fanático", err);
      }
    }
    return result;
  });
}

/**
 * Only reads source code: nothing of the system is executed.
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 */
export function isNeeded(ctx) {
  return diagnose(...SOURCES.map((label) => ctx.platform.sourceOfMethod(label) ?? undefined));
}
