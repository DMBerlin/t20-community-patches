import { fromFactory } from "../../kernel/wrap.mjs";
import { relabelPendingMarker, sustainCostIsPerMarker, unifySustainedOrigins, wrapSustainedPreCreate } from "./domain.mjs";

export const ON_SUSTAIN = "ChatMessageT20._onSustainEffect";

const queues = new Map();
const labels = new Map();

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const ItemClass = ctx.platform.classes.item;
  const displayCard = ItemClass?.prototype?.displayCard;
  const EffectClass = ctx.platform.classes.activeEffect;
  const preCreate = EffectClass?.prototype?._preCreate;
  if (typeof displayCard !== "function") throw new Error("ItemT20#displayCard not found");
  if (typeof preCreate !== "function") throw new Error("ActiveEffect#_preCreate not found");

  ctx.wrap(ItemClass.prototype, "displayCard", function (displayCard, config, ...rest) {
    try {
      unifySustainedOrigins(config?.options?.effects, this?.name);
    } catch (err) {
      ctx.log.error("failed to group the sustained effects", err);
    }
    return displayCard.call(this, config, ...rest);
  });

  ctx.wrap(
    EffectClass.prototype,
    "_preCreate",
    fromFactory((original) => wrapSustainedPreCreate(original, { queues, labels }))
  );

  ctx.hooks.on("preCreateActiveEffect", (effect, data) => {
    try {
      relabelPendingMarker(effect, data, labels);
    } catch (err) {
      ctx.log.error("failed to rename the Sustentando marker", err);
    }
  });
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const handler = ctx.platform.sourceOfMethod(ON_SUSTAIN);
  if (handler == null) {
    return { bug: "unknown", confidence: "low", evidence: "ChatMessage._onSustainEffect not found" };
  }
  if (sustainCostIsPerMarker(handler)) {
    return {
      bug: "present",
      confidence: "low",
      evidence: "_onSustainEffect charges 1 MP per Sustentando marker; per-effect origins (applyOnUseEffects) are module-local"
    };
  }
  return { bug: "unknown", confidence: "low", evidence: "_onSustainEffect not recognized" };
}
