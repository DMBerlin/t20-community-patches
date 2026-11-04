/**
 * Wrappers of the system's item and effect methods. Registered last (after: ["*"]), so they sit outside those of
 * armor-penalty-reduction (ActiveEffect.applyChange) and threatening-crit-range (_allApplicableOnUseEffects).
 */
import { markWrapper } from "../../../lib/source.mjs";
import { fromFactory } from "../../../kernel/wrap.mjs";
import {
  DEFENSE_KEY,
  applyCritEffects,
  classifyItemEffects,
  computeEffectiveStats,
  baseOf,
  consumedArmorIds,
  isUsageBound,
  planCritFold,
  prepRollEffects,
  shouldSkipFoldedChange
} from "../domain/index.mjs";

/** Removes the folded effects from the roll clone's list when the full list confirms the preparation's plan. */
function foldRollClone(item, effects, engine, patches) {
  const src = item._source.system;
  const system = item.system;
  const prepPlan = planCritFold(prepRollEffects(engine.describe(item)));
  const isOwn = (ef) => ef?.parent?.documentName === "Item" && ef.parent.id === item.id;
  const fullPlan = planCritFold(
    effects.map((ef) => ({
      id: ef?.id,
      own: isOwn(ef),
      automatic: !!ef?.system?.abilityUse?.automatic,
      usageBound: isUsageBound(ef, engine.usage),
      changes: ef?.system?.changes ?? []
    }))
  );
  const same =
    prepPlan.fold &&
    fullPlan.fold &&
    prepPlan.effectIds.size === fullPlan.effectIds.size &&
    [...prepPlan.effectIds].every((id) => fullPlan.effectIds.has(id));
  if (!same) return effects;
  const recomputed = applyCritEffects(
    src.criticoM,
    src.criticoX,
    classifyItemEffects(engine.describe(item)).automatic,
    !!patches().threatFix
  );
  system.criticoM = recomputed.criticoM;
  system.criticoX = recomputed.criticoX;
  engine.keepsBase.delete(item);
  return effects.filter((ef) => !(isOwn(ef) && fullPlan.effectIds.has(ef.id)));
}

function isRollCloneOf(item) {
  try {
    return !!item.actor && item.actor.items?.get?.(item.id) !== item;
  } catch {
    return false;
  }
}

/**
 * Wrapper of ItemT20#_allApplicableOnUseEffects for mode "effective". The inner wrappers (threatening-crit-range)
 * always see the base critical. On the real item nothing changes; on the roll clone, the folded effects are removed
 * only when the full list confirms the preparation's plan, otherwise the clone keeps the base and the whole list.
 * @param {Function} original
 * @param {ReturnType<typeof import("./engine.mjs").createEngine>} engine
 * @param {{mode?: () => string, patches?: () => object}} [deps]
 */
export function createOnUseWrapper(original, engine, { mode = engine.mode, patches = engine.patches } = {}) {
  return markWrapper(function (...args) {
    let active = false;
    try {
      active = this?.type === "arma" && mode() === "effective" && !!this._source?.system;
    } catch {
      active = false;
    }
    if (!active) return original.apply(this, args);

    const system = this.system;
    const src = this._source.system;
    const saved = { criticoM: system.criticoM, criticoX: system.criticoX };

    if (!isRollCloneOf(this)) {
      system.criticoM = src.criticoM;
      system.criticoX = src.criticoX;
      try {
        return original.apply(this, args);
      } finally {
        system.criticoM = saved.criticoM;
        system.criticoX = saved.criticoX;
      }
    }

    system.criticoM = src.criticoM;
    system.criticoX = src.criticoX;
    engine.keepsBase.add(this);
    const effects = original.apply(this, args);
    try {
      if (!Array.isArray(effects)) return effects;
      return foldRollClone(this, effects, engine, patches);
    } catch (err) {
      engine.log.error("failed to plan the roll's critical", err);
      system.criticoM = src.criticoM;
      system.criticoX = src.criticoX;
      engine.keepsBase.add(this);
      return effects;
    }
  }, original);
}

/** The folded change the actor skips (mode "effective"), reported to applied-changes when it is a Defense bonus. */
function skipsFolded({ ctx, engine, appliedChanges }, targetDoc, change) {
  const { platform } = ctx;
  const effect = change?.effect;
  const item = effect?.parent;
  const skip =
    item?.documentName === "Item" &&
    shouldSkipFoldedChange({
      mode: engine.mode(),
      change,
      targetIsActor: targetDoc instanceof platform.core.Actor,
      ownedByTarget: item.parent === targetDoc,
      consumed:
        item.type === "equipamento" &&
        item.parent === targetDoc &&
        consumedArmorIds(targetDoc.itemTypes?.equipamento, !!platform.settingsOf("tormenta20").get("equipmentSlots")).has(item.id),
      itemType: item.type,
      tipo: item._source?.system?.tipo,
      hasStatus: effect.system?.status !== null && effect.system?.status !== undefined,
      onuse: !!effect.system?.onuse,
      folded: engine.foldedState(item)
    });
  if (!skip) return false;
  try {
    if (change.key === DEFENSE_KEY) {
      const entry = { key: change.key, label: effect.name, value: change.value, reason: "folded" };
      appliedChanges?.reportSuppressed(targetDoc, entry, change);
    }
  } catch (err) {
    ctx.log.error("failed to report a folded change", err);
  }
  return true;
}

/**
 * Registers the wrappers, in the historical order (tests/fixtures/wrap-order.json).
 * @param {import("../../../kernel/feature.mjs").FeatureContext} ctx
 * @param {ReturnType<typeof import("./engine.mjs").createEngine>} engine
 * @param {{reportSuppressed: Function}|null} appliedChanges   The breakdowns list what is folded.
 */
export function installWrappers(ctx, engine, appliedChanges) {
  const { platform } = ctx;
  const deps = { ctx, engine, appliedChanges };
  const itemProto = platform.classes.item?.prototype;
  const EffectClass = platform.classes.activeEffect;
  if (typeof itemProto?._allApplicableOnUseEffects !== "function") throw new Error("Tormenta20 usage effect API not found");
  if (typeof itemProto?.prepareFinalAttributes !== "function") throw new Error("ItemT20#prepareFinalAttributes not found");
  if (typeof EffectClass?.applyChange !== "function") throw new Error("ActiveEffect.applyChange not found");

  // Effective attack and damage labels; the official labels are never overwritten.
  ctx.wrap(itemProto, "prepareFinalAttributes", function (finalAttributes, ...args) {
    const result = finalAttributes.apply(this, args);
    try {
      if (this?.type === "arma" && this.labels && engine.mode() !== "ends") {
        const stats = computeEffectiveStats(baseOf(this), classifyItemEffects(engine.describe(this)), engine.patches());
        this.labels.t20cpEffective = { toHit: stats.ataque?.final, dano: stats.dano?.final };
      }
    } catch (err) {
      ctx.log.error(`failed to prepare the labels of ${this?.name}`, err);
    }
    return result;
  });

  ctx.wrap(itemProto, "_allApplicableOnUseEffects", fromFactory((original) => createOnUseWrapper(original, engine)));

  ctx.wrap(EffectClass, "applyChange", function (applyChange, targetDoc, change, options) {
    try {
      if (skipsFolded(deps, targetDoc, change)) return undefined;
    } catch (err) {
      ctx.log.error("failed to check a change", err);
    }
    return applyChange.call(this, targetDoc, change, options);
  });

  // EquipmentData and WeaponData inherit prepareDerivedData; each gets its own wrapper.
  for (const type of ["equipamento", "arma"]) {
    const proto = platform.config.document("Item")?.dataModels?.[type]?.prototype;
    if (typeof proto?.prepareDerivedData !== "function") continue;
    ctx.wrap(proto, "prepareDerivedData", function (prepare, ...args) {
      const result = prepare.apply(this, args);
      try {
        engine.foldItemSystem(this);
      } catch (err) {
        ctx.log.error(`failed to fold ${this?.parent?.name}`, err);
      }
      return result;
    });
  }
}
