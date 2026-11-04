import { statusEffectSources } from "../../lib/status-effects.mjs";
import { findWithRetry } from "../../lib/async.mjs";
import { CONDITION_ABILITIES, conditionAbilities, diagnoseConditionLists, planConditionChanges } from "./domain.mjs";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

/** Logs only the first error of this install. */
function createWarnOnce(ctx) {
  let warned = false;
  return (message, err) => {
    if (warned) return;
    warned = true;
    ctx.log.error(message, err);
  };
}

/**
 * Gives each affected condition its planned changes for this phase; returns what to restore.
 * @param {FeatureContext} ctx
 * @param {(message: string, err: unknown) => void} warnOnce
 */
function augment(ctx, warnOnce, actor, phase) {
  const swapped = [];
  const skills = actor.system?.pericias;
  const skillConfig = ctx.platform.t20Config()?.pericias;
  if (!skills || !skillConfig) return swapped;
  try {
    swapConditions(actor, { phase, skills, skillConfig }, swapped);
  } catch (err) {
    restore(swapped);
    warnOnce(`could not plan the conditions of ${actor?.name}; keeping the system's lists`, err);
    return [];
  }
  return swapped;
}

/** Swaps the changes of every affected condition of the actor, recording each original array in `swapped`. */
function swapConditions(actor, { phase, skills, skillConfig }, swapped) {
  let rollData;
  for (const effect of actor.allApplicableEffects()) {
    if (!effect.active || !conditionAbilities(effect.statuses).size) continue;
    const changes = effect.system?.changes;
    // Same data the core passes to shouldApplyChange (Actor#applyActiveEffects).
    rollData ??= actor.getRollData();
    const plan = planEffect(effect, { phase, rollData, skills, skillConfig });
    if (!plan) continue;
    effect.system.changes = plan.changes;
    swapped.push([effect, changes]);
  }
}

function planEffect(effect, { phase, rollData, skills, skillConfig }) {
  const replacementData = effect.getReplacementData(rollData);
  return planConditionChanges({
    statuses: effect.statuses,
    changes: effect.system?.changes,
    skills,
    skillConfig,
    isEligible: (change) => effect.shouldApplyChange(change, { phase, replacementData })
  });
}

function restore(swapped) {
  for (const [effect, changes] of swapped.splice(0)) effect.system.changes = changes;
}

/** @param {FeatureContext} ctx */
export function install(ctx) {
  const ActorClass = ctx.platform.classes.actor;
  const applyActiveEffects = ActorClass?.prototype?.applyActiveEffects;
  if (typeof applyActiveEffects !== "function") throw new Error("Actor#applyActiveEffects not found");

  /** Phases being planned per actor: the core marks a phase as done only after the planning has run. */
  const planning = new WeakMap();
  const warnOnce = createWarnOnce(ctx);

  ctx.wrap(ActorClass.prototype, "applyActiveEffects", function (applyActiveEffects, phase, ...args) {
    // Invalid or repeated phases are left to the core, which warns and normalizes them.
    if (typeof phase !== "string" || this._completedActiveEffectPhases?.has(phase)) {
      return applyActiveEffects.call(this, phase, ...args);
    }
    // A same-phase call from inside the planning (getRollData, shouldApplyChange...) would be refused by the core,
    // which marks the phase before reading any data; it must not consume the phase the outer call is planning.
    let phases = planning.get(this);
    if (phases?.has(phase)) return undefined;
    if (!phases) planning.set(this, (phases = new Set()));
    phases.add(phase);
    let swapped;
    try {
      swapped = augment(ctx, warnOnce, this, phase);
    } finally {
      phases.delete(phase);
    }
    try {
      return applyActiveEffects.call(this, phase, ...args);
    } finally {
      restore(swapped);
    }
  });
}

/** @param {FeatureContext} ctx */
export function isNeeded(ctx) {
  const T20 = ctx.platform.t20Config();
  return diagnoseConditionLists(T20?.conditions, T20?.pericias);
}

/**
 * Tormenta20 1.6.6 dropped CONFIG.T20.conditions: the conditions only exist after the system's "ready" builds
 * CONFIG.statusEffects from world.statuses. Up to 1.6.5 isNeeded already read the system's data, so nothing is new.
 * @param {FeatureContext} ctx
 */
export async function lateProbe(ctx) {
  if (ctx.platform.t20Config()?.conditions) return undefined;
  const conditions = await findWithRetry(async () => statusEffectSources(Object.keys(CONDITION_ABILITIES), ctx.platform.statusEffects()));
  return conditions ? diagnoseConditionLists(conditions, ctx.platform.t20Config()?.pericias) : undefined;
}
