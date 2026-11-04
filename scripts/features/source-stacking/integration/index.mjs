/**
 * Installs the source-stacking rule: the stamp on rolled clones, the actor wrappers that suppress the losing changes
 * and accessories while the actor is prepared, and the hooks that notify and mark the sheet.
 */
import { DEFENSE_KEY, SOURCE_STACKING_SETTING } from "../domain.mjs";
import { buildPlan, stampClone, targetActor } from "./plan.mjs";
import { createState, isOn, markSheet, onEffectHook, onItemHook, refreshActors } from "./hooks.mjs";

/** @typedef {import("../../../kernel/feature.mjs").FeatureContext} FeatureContext */

/** Reports a suppressed change or accessory to applied-changes: the breakdowns list what is cut. */
function suppressedReporter(ctx) {
  const appliedChanges = ctx.services["applied-changes"] ?? null;
  return (actor, entry, origin) => {
    try {
      appliedChanges?.reportSuppressed(actor, entry, origin);
    } catch (err) {
      ctx.log.error("failed to report a suppressed change", err);
    }
  };
}

/** Plans the actor's phase, records its report and losing accessories; null when the rule is off. */
function planPhase(ctx, state, env, actor, phase) {
  if (phase === "initial") {
    state.actorReports.delete(actor);
    state.accessoryLosers.delete(actor);
  }
  if (typeof phase !== "string" || !isOn(ctx)) return null;
  const plan = buildPlan(env, actor, phase);
  state.actorReports.set(actor, [...(state.actorReports.get(actor) ?? []), ...plan.report]);
  if (phase !== "initial") return plan;
  const losers = new Map();
  for (const ref of plan.suppressed) {
    if (!ref?.item) continue;
    const entry = losers.get(ref.item) ?? { item: ref.item, value: false, penalty: false };
    entry[ref.field] = true;
    losers.set(ref.item, entry);
  }
  if (losers.size) state.accessoryLosers.set(actor, [...losers.values()]);
  return plan;
}

/** Zeroes the losing accessories of the actor, pushing to `restore` what to put back. */
function dropAccessories(actor, losers, report, restore) {
  for (const { item, value, penalty } of losers) {
    const armadura = item.system.armadura;
    restore.push([armadura, armadura.value, armadura.penalidade]);
    if (value && armadura.value) {
      const entry = { key: DEFENSE_KEY, label: item.name, value: armadura.value, reason: "not-stacking" };
      report(actor, { ...entry, item: { id: item.id, accessory: true } }, item);
    }
    if (value) armadura.value = 0;
    if (penalty) armadura.penalidade = 0;
  }
}

function wrapDocuments(ctx, state, { itemProto, effectProto, actorProto }, report) {
  const env = { platform: ctx.platform, exclusions: ctx.services["stacking-exclusions"] };
  ctx.wrap(itemProto, "_allApplicableOnUseEffects", function (onUse, ...args) {
    const effects = onUse.apply(this, args);
    try {
      stampClone(this);
    } catch (err) {
      ctx.log.error("failed to stamp the effect source", err);
    }
    return effects;
  });

  ctx.wrap(effectProto, "shouldApplyChange", function (shouldApply, change, ...args) {
    const result = shouldApply.call(this, change, ...args);
    const active = state.active;
    if (!result || !active || !active.suppressed.has(change)) return result;
    try {
      if (targetActor(this) !== active.actor) return result;
      const value = active.amounts?.get(change) ?? change.value;
      report(active.actor, { key: change.key, label: this.name, value, reason: "not-stacking" }, change);
      return false;
    } catch {
      return result;
    }
  });

  ctx.wrap(actorProto, "applyActiveEffects", function (applyEffects, phase, ...args) {
    let plan = null;
    try {
      plan = planPhase(ctx, state, env, this, phase);
    } catch (err) {
      plan = null;
      ctx.log.error(`failed to plan the effects of ${this?.name}`, err);
    }
    const previous = state.active;
    state.active = plan?.suppressed.size ? { actor: this, suppressed: plan.suppressed, amounts: plan.amounts } : null;
    try {
      return applyEffects.call(this, phase, ...args);
    } finally {
      state.active = previous;
    }
  });
}

/**
 * prepareDefense runs inside each actor type's TypeDataModel#prepareDerivedData, before the skills read the armor
 * penalty, so losing accessories are left out for the duration of the call only.
 */
function wrapDataModels(ctx, state, report) {
  const prototypes = new Set(
    Object.values(ctx.platform.config.document("Actor")?.dataModels ?? {})
      .map((cls) => cls?.prototype)
      .filter((proto) => proto && Object.hasOwn(proto, "prepareDerivedData"))
  );
  for (const proto of prototypes) {
    ctx.wrap(proto, "prepareDerivedData", function (prepareDerivedData, ...args) {
      const actor = this.parent;
      const losers = actor && state.accessoryLosers.get(actor);
      if (!losers?.length || state.preparing.has(actor)) return prepareDerivedData.apply(this, args);
      state.preparing.add(actor);
      const restore = [];
      try {
        dropAccessories(actor, losers, report, restore);
        return prepareDerivedData.apply(this, args);
      } finally {
        for (const [armadura, value, penalty] of restore) {
          armadura.value = value;
          armadura.penalidade = penalty;
        }
        state.preparing.delete(actor);
      }
    });
  }
}

function listen(ctx, state) {
  const { hooks } = ctx;
  hooks.on("createActiveEffect", (effect, options, userId) => onEffectHook(ctx, state, effect, userId));
  hooks.on("updateActiveEffect", (effect, changes, options, userId) => onEffectHook(ctx, state, effect, userId));
  hooks.on("deleteActiveEffect", (effect, options, userId) => onEffectHook(ctx, state, effect, userId, false));
  hooks.on("createItem", (item, options, userId) => onItemHook(ctx, state, item, userId));
  hooks.on("updateItem", (item, changes, options, userId) => onItemHook(ctx, state, item, userId));
  hooks.on("deleteItem", (item, options, userId) => onItemHook(ctx, state, item, userId, false));
  hooks.on("renderActorSheetT20", (app, html) => {
    try {
      markSheet(ctx, state, app, html);
    } catch (err) {
      ctx.log.error("failed to mark the sheet", err);
    }
  });
}

/**
 * Installs the rule. Must run after the patches: the stamp sees the effects linked-usage-effects injects, and the
 * actor wrappers sit outside armor-penalty-reduction's (the phase is passed through untouched).
 * The stamp is always applied (it is inert), so effects applied while the rule is off are recognized later.
 * @param {FeatureContext} ctx
 */
export function install(ctx) {
  const { classes } = ctx.platform;
  const itemProto = classes.item?.prototype;
  const effectProto = classes.activeEffect?.prototype;
  const actorProto = classes.actor?.prototype;
  if (typeof itemProto?._allApplicableOnUseEffects !== "function") throw new Error("Tormenta20 usage effect API not found");
  if (typeof effectProto?.shouldApplyChange !== "function") throw new Error("ActiveEffect#shouldApplyChange not found");
  if (typeof actorProto?.applyActiveEffects !== "function") throw new Error("Actor#applyActiveEffects not found");

  const state = createState();
  const report = suppressedReporter(ctx);
  wrapDocuments(ctx, state, { itemProto, effectProto, actorProto }, report);
  wrapDataModels(ctx, state, report);
  listen(ctx, state);
  ctx.onSettingChange(SOURCE_STACKING_SETTING, () => refreshActors(ctx));
}
