/**
 * Petrificado damage reduction (tormenta20 1.6.5).
 *
 * Bug: the "Petrificado" condition sets system.tracos.resistencias.dano.value with type "downgrade" (min), which never
 * raises the damage reduction; and initial-phase changes on resistencias.<type>.value are overwritten anyway by
 * AttributesFields.prepareDamageResistances (value = base + bonus) during prepareDerivedData. Copies created on an
 * actor go through the system's migrateResistancesPath, which moves the key to .bonus but keeps "downgrade", a no-op
 * on that ArrayField.
 *
 * Fix: one Petrificado reduction counts per actor and preparation cycle, the greatest among the active copies
 * (conditions with the same effects do not stack, book p. 394). A legacy winner (.value or .bonus, downgrade/upgrade) is applied
 * as "add" on resistencias.dano.bonus, the path every other damage reduction effect of the system uses; native
 * contributions ("add" 8 on .bonus) that do not win are skipped in memory. The condition's reduction is kept out of the
 * optional source-stacking rule. Nothing is written to the documents.
 */
import { markWrapper } from "../utils.mjs";
import { registerStackingExclusion } from "../rules/source-stacking.mjs";

export const PETRIFIED = "petrificado";
export const RD_VALUE_KEY = "system.tracos.resistencias.dano.value";
export const RD_BONUS_KEY = "system.tracos.resistencias.dano.bonus";
export const STATUS_PACK = "world.statuses";
export const PETRIFIED_RD = 8;
const LEGACY_TYPES = new Set(["downgrade", "upgrade"]);
const LEGACY_KEYS = new Set([RD_VALUE_KEY, RD_BONUS_KEY]);
const LOG = "t20-community-patches | petrified-damage-reduction:";

/** Whether an effect carries the Petrificado status (statuses is a Set on documents; arrays are accepted too). */
export function hasPetrifiedStatus(effect) {
  const statuses = effect?.statuses;
  if (!statuses) return false;
  return typeof statuses.has === "function" ? statuses.has(PETRIFIED) : Array.from(statuses).includes(PETRIFIED);
}

/**
 * Legacy form of the reduction (system data in 1.6.5): initial-phase downgrade/upgrade on resistencias.dano.value, as
 * in the compendium, or on .bonus, as stored on actors after the system's migrateResistancesPath.
 */
export function isPetrifiedReductionChange(change) {
  return !!change && LEGACY_KEYS.has(change.key) && (change.phase ?? "initial") === "initial" && LEGACY_TYPES.has(change.type);
}

/**
 * Native form of the reduction: initial-phase "add" of exactly 8 (book p. 395) on resistencias.dano.bonus. Other
 * bonuses on the same effect are independent and never stand for the condition's reduction.
 */
export function isNativePetrifiedReduction(change) {
  return !!change && change.key === RD_BONUS_KEY && change.type === "add" && (change.phase ?? "initial") === "initial"
    && Number(change.value) === PETRIFIED_RD;
}

/** Whether a change of an effect is the condition's own reduction (legacy or native). */
export function isPetrifiedContribution(effect, change) {
  return hasPetrifiedStatus(effect) && (isPetrifiedReductionChange(change) || isNativePetrifiedReduction(change));
}

/** Positive numeric reduction of a change, or null. */
export function reductionOf(change) {
  const value = Number(change?.value);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Plan of the single Petrificado reduction of an actor in a preparation cycle (book p. 394). Every applicable
 * contribution of the active Petrificado effects competes; the greatest wins, a native one on ties (it needs no
 * conversion), then the first in order.
 * - Legacy winner: converted to "add" on .bonus (convert); every native contribution is skipped (neutralized).
 * - Native winner: applied by the system; the other native contributions are skipped.
 * Losing legacy contributions follow the system's path, which yields no reduction in 1.6.5.
 * @param {Iterable<object>} effects                                Actor#allApplicableEffects().
 * @param {(effect: object, change: object) => boolean} [canApply]  Same filter as the core (shouldApplyChange).
 * @returns {{convert: {effect: object, value: number}|null, counted: boolean, neutralized: Set<object>}|null}
 */
export function planPetrifiedReduction(effects, canApply = () => true) {
  const candidates = [];
  for (const effect of effects ?? []) {
    if (!effect?.active || !hasPetrifiedStatus(effect)) continue;
    for (const change of effect.system?.changes ?? []) {
      const native = isNativePetrifiedReduction(change);
      if (!native && !isPetrifiedReductionChange(change)) continue;
      const value = reductionOf(change);
      if (value === null || !canApply(effect, change)) continue;
      candidates.push({ effect, change, value, native });
    }
  }
  if (!candidates.length) return null;
  let winner = candidates[0];
  for (const c of candidates) {
    if (c.value > winner.value || (c.value === winner.value && c.native && !winner.native)) winner = c;
  }
  const neutralized = new Set(candidates.filter((c) => c.native && c !== winner).map((c) => c.change));
  const convert = winner.native ? null : { effect: winner.effect, value: winner.value };
  return { convert, counted: false, neutralized };
}

/**
 * Copy of the winning legacy change as "add" on resistencias.dano.bonus; null to apply the change as the system does.
 * Marks the plan as counted, so the reduction is applied once; a query (consume false) converts without counting.
 * @param {object} change  The copy received by ActiveEffect.applyChange (change.effect is the source effect).
 * @param {ReturnType<typeof planPetrifiedReduction>|undefined} plan
 * @param {{consume?: boolean}} [options]
 */
export function normalizePetrifiedChange(change, plan, { consume = true } = {}) {
  const convert = plan?.convert;
  if (!convert || plan.counted || change?.effect !== convert.effect || !isPetrifiedReductionChange(change)) return null;
  if (reductionOf(change) !== convert.value) return null;
  if (consume) plan.counted = true;
  return { ...change, key: RD_BONUS_KEY, type: "add", value: String(convert.value) };
}

/** Plans kept per actor while its initial phase is applied; each cycle starts from scratch. */
export function createReductionTracker() {
  const plans = new WeakMap();
  return {
    begin(actor, effects, canApply) {
      plans.delete(actor);
      const plan = planPetrifiedReduction(effects, canApply);
      if (plan) plans.set(actor, plan);
      return plan;
    },
    end(actor) {
      plans.delete(actor);
    },
    /** Whether the original change object (as given to shouldApplyChange) is a native contribution to skip. */
    neutralizes(actor, change) {
      return !!plans.get(actor)?.neutralized.has(change);
    },
    normalize(targetDoc, change, options) {
      return normalizePetrifiedChange(change, plans.get(targetDoc), options);
    }
  };
}

/**
 * Reads the Petrificado source data (not the prepared actor).
 * @param {unknown} changes  system.changes of the Petrificado document.
 * @returns {import("../registry.mjs").Diagnosis|undefined}
 */
export function diagnosePetrifiedData(changes) {
  if (!Array.isArray(changes)) return undefined;
  const rd = changes.filter((c) => typeof c?.key === "string" && c.key.startsWith("system.tracos.resistencias.dano."));
  if (rd.some(isNativePetrifiedReduction)) {
    return { bug: "fixed", confidence: "low", evidence: "Petrificado adds 8 to resistencias.dano.bonus in the initial phase" };
  }
  const legacy = rd.find((c) => c.type === "downgrade" && isPetrifiedReductionChange(c));
  if (legacy) {
    // Data only: downgrade is a min on .value and a no-op on .bonus, but the prepared result is not observed here.
    return { bug: "present", confidence: "low", evidence: `Petrificado downgrades ${legacy.key} without the native +8 on .bonus` };
  }
  const shape = rd.map(({ key, type, value, phase }) => ({ key, type, value, phase }));
  return { bug: "unknown", confidence: "low", evidence: `unrecognized Petrificado reduction: ${JSON.stringify(shape)}` };
}

/** First document with the Petrificado status, or null. */
export function pickPetrifiedDocument(docs) {
  for (const doc of docs ?? []) if (hasPetrifiedStatus(doc)) return doc;
  return null;
}

/**
 * Calls lookup until it returns a document, for the lists the system and patch #1 build asynchronously after ready.
 * @param {() => Promise<object|null|undefined>} lookup
 * @param {{attempts?: number, delay?: number, sleep?: (ms: number) => Promise<void>}} [options]
 */
export async function findWithRetry(lookup, { attempts = 10, delay = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; i < attempts; i++) {
    const found = await lookup();
    if (found) return found;
    if (i < attempts - 1) await sleep(delay);
  }
  return null;
}

/**
 * Lookup of the Petrificado document the token HUD clones: CONFIG.statusEffects first, then world.statuses by status.
 * @param {{statusUuid: () => unknown, fromUuid: (uuid: string) => Promise<object|null>, packDocuments: () => Promise<object[]|undefined>}} deps
 */
export function petrifiedLookup({ statusUuid, fromUuid, packDocuments }) {
  return async () => {
    const uuid = statusUuid();
    if (typeof uuid === "string") {
      const doc = await fromUuid(uuid);
      if (doc && hasPetrifiedStatus(doc)) return doc;
    }
    return pickPetrifiedDocument((await packDocuments()) ?? []);
  };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const tracker = createReductionTracker();

function actorOf(effect) {
  const parent = effect?.parent;
  return parent?.documentName === "Item" ? parent.parent : parent;
}

function apply() {
  const EffectClass = CONFIG.ActiveEffect.documentClass;
  const actorProto = CONFIG.Actor.documentClass.prototype;
  const applyChange = EffectClass.applyChange;
  const shouldApply = EffectClass.prototype.shouldApplyChange;
  const applyEffects = actorProto.applyActiveEffects;
  if (typeof applyChange !== "function") throw new Error("ActiveEffect.applyChange not found");
  if (typeof shouldApply !== "function") throw new Error("ActiveEffect#shouldApplyChange not found");
  if (typeof applyEffects !== "function") throw new Error("Actor#applyActiveEffects not found");

  actorProto.applyActiveEffects = markWrapper(function (phase, ...args) {
    if (phase !== "initial") return applyEffects.call(this, phase, ...args);
    try {
      let rollData;
      tracker.begin(this, this.allApplicableEffects(), (effect, change) => {
        rollData ??= this.getRollData();
        return effect.shouldApplyChange(change, { phase, replacementData: effect.getReplacementData(rollData) });
      });
    } catch (err) {
      tracker.end(this);
      console.warn(LOG, "could not plan", this?.name, err);
    }
    try {
      return applyEffects.call(this, phase, ...args);
    } finally {
      tracker.end(this);
    }
  }, applyEffects);

  EffectClass.prototype.shouldApplyChange = markWrapper(function (change, ...args) {
    const result = shouldApply.call(this, change, ...args);
    if (!result) return result;
    try {
      return tracker.neutralizes(actorOf(this), change) ? false : result;
    } catch {
      return result;
    }
  }, shouldApply);

  EffectClass.applyChange = markWrapper(function (targetDoc, change, options) {
    let normalized = null;
    try {
      normalized = tracker.normalize(targetDoc, change, { consume: options?.modifyTarget !== false });
    } catch (err) {
      console.warn(LOG, "could not normalize", change?.key, err);
    }
    return applyChange.call(this, targetDoc, normalized ?? change, options);
  }, applyChange);

  registerStackingExclusion(isPetrifiedContribution);
}

function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "Petrificado data is only checked after ready (lateProbe)" };
}

async function lateProbe() {
  const lookup = petrifiedLookup({
    statusUuid: () => {
      const list = CONFIG.statusEffects;
      return (Array.isArray(list) ? list.find((s) => s?.id === PETRIFIED) : list?.[PETRIFIED])?.uuid;
    },
    fromUuid: (uuid) => foundry.utils.fromUuid(uuid),
    packDocuments: async () => game.packs.get(STATUS_PACK)?.getDocuments()
  });
  const effect = await findWithRetry(lookup);
  return effect ? diagnosePetrifiedData(effect.system?.changes) : undefined;
}

export default {
  id: "petrified-damage-reduction",
  group: "conditions",
  issue: 63,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  lateProbe,
  apply
};
