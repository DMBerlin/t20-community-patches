import { findWithRetry } from "../../lib/async.mjs";
import {
  PETRIFIED,
  STATUS_PACK,
  createReductionTracker,
  diagnosePetrifiedData,
  isPetrifiedContribution,
  petrifiedLookup
} from "./domain.mjs";

const tracker = createReductionTracker();

function actorOf(effect) {
  const parent = effect?.parent;
  return parent?.documentName === "Item" ? parent.parent : parent;
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
function wrapApplyActiveEffects(ctx, actorProto) {
  ctx.wrap(actorProto, "applyActiveEffects", function (applyEffects, phase, ...args) {
    if (phase !== "initial") return applyEffects.call(this, phase, ...args);
    try {
      let rollData;
      tracker.begin(this, this.allApplicableEffects(), (effect, change) => {
        rollData ??= this.getRollData();
        return effect.shouldApplyChange(change, { phase, replacementData: effect.getReplacementData(rollData) });
      });
    } catch (err) {
      tracker.end(this);
      ctx.log.warn("could not plan", this?.name, err);
    }
    try {
      return applyEffects.call(this, phase, ...args);
    } finally {
      tracker.end(this);
    }
  });
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const EffectClass = ctx.platform.classes.activeEffect;
  const actorProto = ctx.platform.classes.actor.prototype;
  const applyChange = EffectClass.applyChange;
  const shouldApply = EffectClass.prototype.shouldApplyChange;
  const applyEffects = actorProto.applyActiveEffects;
  if (typeof applyChange !== "function") throw new Error("ActiveEffect.applyChange not found");
  if (typeof shouldApply !== "function") throw new Error("ActiveEffect#shouldApplyChange not found");
  if (typeof applyEffects !== "function") throw new Error("Actor#applyActiveEffects not found");

  wrapApplyActiveEffects(ctx, actorProto);

  ctx.wrap(EffectClass.prototype, "shouldApplyChange", function (shouldApply, change, ...args) {
    const result = shouldApply.call(this, change, ...args);
    if (!result) return result;
    try {
      return tracker.neutralizes(actorOf(this), change) ? false : result;
    } catch {
      return result;
    }
  });

  ctx.wrap(EffectClass, "applyChange", function (applyChange, targetDoc, change, options) {
    let normalized = null;
    try {
      normalized = tracker.normalize(targetDoc, change, { consume: options?.modifyTarget !== false });
    } catch (err) {
      ctx.log.warn("could not normalize", change?.key, err);
    }
    return applyChange.call(this, targetDoc, normalized ?? change, options);
  });

  // Its own reduction never competes in source-stacking (#45), whatever the order of the two.
  ctx.services["stacking-exclusions"].register(isPetrifiedContribution);
}

export function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "Petrificado data is only checked after ready (lateProbe)" };
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export async function lateProbe(ctx) {
  const { platform } = ctx;
  const lookup = petrifiedLookup({
    statusUuid: () => {
      const list = platform.statusEffects();
      return (Array.isArray(list) ? list.find((s) => s?.id === PETRIFIED) : list?.[PETRIFIED])?.uuid;
    },
    fromUuid: (uuid) => platform.documents.fromUuid(uuid),
    packDocuments: async () => platform.documents.packs().get(STATUS_PACK)?.getDocuments()
  });
  const effect = await findWithRetry(lookup);
  return effect ? diagnosePetrifiedData(effect.system?.changes) : undefined;
}
