import { statusEffectSources } from "../../lib/status-effects.mjs";
import { findWithRetry } from "../../lib/async.mjs";
import { PRONE, OUTROS_KEY, isProneDefenseChange, collectProneCandidates, planProneChange } from "../../lib/prone.mjs";
import { diagnoseProneChanges, toAdditive } from "./domain.mjs";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

// Active Actor#applyActiveEffects calls, innermost last. Duplicated Caído penalties are only deduplicated inside the
// actor's own "initial" pass, which runs once per preparation cycle.
/** @type {{actor: object, phase: string, counted: boolean}[]} */
const passes = [];

function currentPass(actor) {
  const pass = passes.at(-1);
  return pass?.actor === actor && pass.phase === "initial" ? pass : null;
}

/**
 * Reports a Caído change left out of the actor's preparation to applied-changes.
 * @param {FeatureContext} ctx
 * @returns {(targetDoc: object, effect: object, change: object) => void}
 */
function skippedReporter(ctx) {
  const applied = ctx.services["applied-changes"];
  return (targetDoc, effect, change) => {
    try {
      const entry = { key: OUTROS_KEY, label: effect.name, value: Number(change.value), reason: "not-stacking" };
      applied?.reportSuppressed(targetDoc, entry, change);
    } catch (err) {
      ctx.log.error("could not report the Caído change left out", err);
    }
  };
}

/** Whether a change given to applyChange is a Caído Defense penalty applied to an actor. */
function isProneApplication(change, targetDoc, ActorClass) {
  return isProneDefenseChange(change) && !!change.effect?.statuses?.has(PRONE) && targetDoc instanceof ActorClass;
}

/**
 * What to do with a change given to ActiveEffect.applyChange: the change to apply (null to skip it) and the actor
 * pass whose mark it consumes.
 * @param {{ActorClass: Function, report: ReturnType<typeof skippedReporter>}} env
 * @returns {{next: object|null, pass: object|null, counts: boolean}}
 */
function planApplication({ ActorClass, report }, targetDoc, change, options) {
  if (!isProneApplication(change, targetDoc, ActorClass)) return { next: change, pass: null, counts: false };
  const effect = change.effect;
  // Queries (modifyTarget: false) and calls outside the actor's own pass neither consume nor see the mark.
  const pass = options?.modifyTarget === false ? null : currentPass(targetDoc);
  const plan = planProneChange(
    {
      effect,
      change,
      // The core only calls applyChange for changes that passed shouldApplyChange in the current phase.
      eligible: change.phase === "initial",
      alreadyCounted: !!pass?.counted
    },
    collectProneCandidates(targetDoc.allApplicableEffects())
  );
  if (plan === "skip") {
    // Only the actor's own pass is the preparation the breakdown shows.
    if (pass) report(targetDoc, effect, change);
    return { next: null, pass, counts: false };
  }
  return { next: plan === "add" ? toAdditive(change) : change, pass, counts: plan === "add" || plan === "count" };
}

/** @param {FeatureContext} ctx */
export function install(ctx) {
  const report = skippedReporter(ctx);
  const ActorClass = ctx.platform.classes.actor;
  ctx.wrap(ActorClass.prototype, "applyActiveEffects", function (applyActiveEffects, phase, ...args) {
    passes.push({ actor: this, phase, counted: false });
    try {
      return applyActiveEffects.call(this, phase, ...args);
    } finally {
      passes.pop();
    }
  });

  const EffectClass = ctx.platform.classes.activeEffect;
  ctx.wrap(EffectClass, "applyChange", function (applyChange, targetDoc, change, options) {
    let planned = { next: change, pass: null, counts: false };
    try {
      planned = planApplication({ ActorClass: ctx.platform.core.Actor, report }, targetDoc, change, options);
    } catch (err) {
      ctx.log.error("could not correct the Caído Defense change", err);
      planned = { next: change, pass: null, counts: false };
    }
    if (planned.next === null) return undefined;
    const result = applyChange.call(this, targetDoc, planned.next, options);
    if (planned.counts && planned.pass) planned.pass.counted = true;
    return result;
  });
}

/** @param {FeatureContext} ctx */
export function isNeeded(ctx) {
  const changes = ctx.platform.t20Config()?.conditions?.caido?.system?.changes;
  if (changes === undefined) return undefined;
  return diagnoseProneChanges(changes);
}

/**
 * Tormenta20 1.6.6 dropped CONFIG.T20.conditions: Caído only exists after the system's "ready" builds
 * CONFIG.statusEffects from world.statuses. Up to 1.6.5 isNeeded already read the system's data, so nothing is new.
 * @param {FeatureContext} ctx
 */
export async function lateProbe(ctx) {
  if (ctx.platform.t20Config()?.conditions) return undefined;
  const conditions = await findWithRetry(async () => statusEffectSources([PRONE], ctx.platform.statusEffects()));
  return conditions ? diagnoseProneChanges(conditions[PRONE]?.system?.changes) : undefined;
}
