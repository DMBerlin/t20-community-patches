/**
 * Prone (Caído) Defense penalty (tormenta20 1.6.5).
 *
 * Bug: the Caído condition applies -5 to `system.attributes.defesa.outros` with the "downgrade" mode. That field is
 * the manual "Outros" Defense bonus typed on the character sheet, so the result is min(Outros, -5) instead of
 * Outros - 5: with Outros +3 the Defense drops 8, with Outros -5 or lower Caído does nothing.
 *
 * Fix: when the change is applied to an actor in the "initial" phase, it is passed on as "add". Only the most severe
 * Caído penalty of that phase counts, legacy ("downgrade") and fixed ("add") copies alike, so duplicated copies of
 * the condition do not stack (book, p. 394). Stored effects are never changed.
 */
import { markWrapper } from "../utils.mjs";

export const PRONE = "caido";
export const OUTROS_KEY = "system.attributes.defesa.outros";
const DEFENSE_PREFIX = "system.attributes.defesa.";
const LOG = "t20-community-patches | prone-defense:";

/**
 * Whether a change is the system's Caído Defense penalty: a negative "downgrade" on the manual Outros field.
 * @param {{key?: string, type?: string, value?: unknown}} change
 * @returns {boolean}
 */
export function isBuggyProneChange(change) {
  if (change?.key !== OUTROS_KEY || change.type !== "downgrade") return false;
  if (change.value === null || change.value === "" || typeof change.value === "boolean") return false;
  const value = Number(change.value);
  return Number.isFinite(value) && value < 0;
}

/**
 * Whether a change is a Caído Defense penalty in either form: the system's "downgrade" or an already fixed "add"
 * (a copy edited by hand or a corrected system). Both kinds compete when choosing the penalty that counts.
 * @param {{key?: string, type?: string, value?: unknown}} change
 * @returns {boolean}
 */
export function isProneDefenseChange(change) {
  if (change?.key !== OUTROS_KEY || !["downgrade", "add"].includes(change.type)) return false;
  if (change.value === null || change.value === "" || typeof change.value === "boolean") return false;
  const value = Number(change.value);
  return Number.isFinite(value) && value < 0;
}

/**
 * Caído Defense penalties that will reach prepareDefense: active effects with the "caido" status whose change is
 * applied in the "initial" phase (the effect's own shouldApplyChange decides, as the core does). Changes from the
 * "final" phase run after prepareDefense and never compete. Each candidate keeps the index of its change in the
 * effect, so the winner is a change, not just an effect.
 * @param {Iterable<{active?: boolean, statuses?: Set<string>, system?: {changes?: object[]},
 *   shouldApplyChange?: Function}>} effects
 * @returns {{effect: object, index: number, value: number, buggy: boolean}[]}
 */
export function collectProneCandidates(effects) {
  const candidates = [];
  for (const effect of effects ?? []) {
    if (!effect?.active || !effect.statuses?.has(PRONE)) continue;
    const changes = effect.system?.changes ?? [];
    changes.forEach((change, index) => {
      if (!isProneDefenseChange(change)) return;
      if (typeof effect.shouldApplyChange === "function" && !effect.shouldApplyChange(change, { phase: "initial" })) {
        return;
      }
      candidates.push({ effect, index, value: Number(change.value), buggy: change.type === "downgrade" });
    });
  }
  return candidates;
}

/**
 * Picks the Caído penalty that counts: the most severe, the first one on ties.
 * @param {{effect: object, index: number, value: number, buggy: boolean}[]} candidates
 * @returns {{effect: object, index: number, value: number, buggy: boolean}|null}
 */
export function pickProneChange(candidates) {
  let best = null;
  for (const candidate of candidates ?? []) {
    if (!best || candidate.value < best.value) best = candidate;
  }
  return best;
}

/**
 * Whether the change handed to applyChange (a deep clone made by the core) has the content of a stored change.
 * @param {object|undefined} stored
 * @param {object} change
 * @returns {boolean}
 */
export function isSameChange(stored, change) {
  if (!stored || !change) return false;
  return (
    stored.key === change.key &&
    stored.type === change.type &&
    String(stored.value) === String(change.value) &&
    stored.phase === change.phase
  );
}

/**
 * What to do with a Caído Defense change being applied.
 * - "keep": apply it as is, untouched (not in the "initial" phase, or no candidate has the bug: system behavior).
 * - "add": it is the penalty that counts and still a "downgrade": apply it as "add".
 * - "count": it is the penalty that counts and already an "add": apply it as is.
 * - "skip": another change counts, or the winner was already applied in this preparation (an identical duplicate
 *   inside the same effect); conditions with the same effect do not stack (book, p. 394).
 * @param {{effect: object, change: object, eligible: boolean, alreadyCounted?: boolean}} current
 * @param {{effect: object, index: number, value: number, buggy: boolean}[]} candidates
 * @returns {"keep"|"add"|"count"|"skip"}
 */
export function planProneChange({ effect, change, eligible, alreadyCounted = false }, candidates) {
  if (!eligible || !candidates?.some((c) => c.buggy)) return "keep";
  const winner = pickProneChange(candidates);
  if (!winner) return "keep";
  if (winner.effect !== effect || !isSameChange(effect.system?.changes?.[winner.index], change)) return "skip";
  if (alreadyCounted) return "skip";
  return winner.buggy ? "add" : "count";
}

/**
 * Copy of the change that adds its value instead of downgrading the field. The original is not modified.
 * @param {object} change
 * @returns {object}
 */
export function toAdditive(change) {
  return { ...change, type: "add" };
}

/**
 * Reads the Caído condition data the system ships (CONFIG.T20.conditions.caido.system.changes).
 * It is not the data applied in play (world.statuses and copies stored on actors), so a fix is never high
 * confidence.
 * @param {unknown} changes
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseProneChanges(changes) {
  if (!Array.isArray(changes)) return { bug: "unknown", confidence: "low", evidence: "Caído condition data not found" };
  if (changes.some(isBuggyProneChange)) {
    return { bug: "present", confidence: "high", evidence: "Caído downgrades defesa.outros to -5" };
  }
  const additive = changes.find(
    (c) => typeof c?.key === "string" && c.key.startsWith(DEFENSE_PREFIX) && c.type === "add" && Number(c.value) < 0
  );
  if (additive) {
    return { bug: "fixed", confidence: "low", evidence: `Caído adds ${additive.value} to ${additive.key}` };
  }
  return { bug: "unknown", confidence: "low", evidence: "Caído has no recognized Defense change" };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

// Active Actor#applyActiveEffects calls, innermost last. Duplicated Caído penalties are only deduplicated inside the
// actor's own "initial" pass, which runs once per preparation cycle.
/** @type {{actor: object, phase: string, counted: boolean}[]} */
const passes = [];

function currentPass(actor) {
  const pass = passes.at(-1);
  return pass?.actor === actor && pass.phase === "initial" ? pass : null;
}

function apply() {
  const ActorClass = CONFIG.Actor.documentClass;
  const applyActiveEffects = ActorClass.prototype.applyActiveEffects;
  ActorClass.prototype.applyActiveEffects = markWrapper(function (phase, ...args) {
    passes.push({ actor: this, phase, counted: false });
    try {
      return applyActiveEffects.call(this, phase, ...args);
    } finally {
      passes.pop();
    }
  }, applyActiveEffects);

  const EffectClass = CONFIG.ActiveEffect.documentClass;
  const applyChange = EffectClass.applyChange;
  EffectClass.applyChange = markWrapper(function (targetDoc, change, options) {
    let next = change;
    let pass = null;
    let counts = false;
    try {
      const effect = change?.effect;
      if (isProneDefenseChange(change) && effect?.statuses?.has(PRONE) && targetDoc instanceof foundry.documents.Actor) {
        // Queries (modifyTarget: false) and calls outside the actor's own pass neither consume nor see the mark.
        pass = options?.modifyTarget === false ? null : currentPass(targetDoc);
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
        if (plan === "skip") return undefined;
        counts = plan === "add" || plan === "count";
        if (plan === "add") next = toAdditive(change);
      }
    } catch (err) {
      console.error(`${LOG} could not correct the Caído Defense change`, err);
      next = change;
      pass = null;
      counts = false;
    }
    const result = applyChange.call(this, targetDoc, next, options);
    if (counts && pass) pass.counted = true;
    return result;
  }, applyChange);
}

function isNeeded() {
  const changes = CONFIG.T20?.conditions?.caido?.system?.changes;
  if (changes === undefined) return undefined;
  return diagnoseProneChanges(changes);
}

export default {
  id: "prone-defense",
  group: "conditions",
  issue: 40,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  guarded: true,
  isNeeded,
  apply
};
