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
import { statusEffectSources } from "../lib/status-effects.mjs";
import { findWithRetry } from "../lib/async.mjs";
import { wraps } from "../kernel/wrap.mjs";
import { PRONE, OUTROS_KEY, isProneDefenseChange, collectProneCandidates, planProneChange } from "../lib/prone.mjs";

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
 * Copy of the change that adds its value instead of downgrading the field. The original is not modified.
 * @param {object} change
 * @returns {object}
 */
export function toAdditive(change) {
  return { ...change, type: "add" };
}

/**
 * Reads the Caído condition data the system ships (CONFIG.T20.conditions.caido.system.changes up to 1.6.5, the
 * world.statuses copy in CONFIG.statusEffects.caido._source from 1.6.6).
 * It does not cover every copy applied in play (world.statuses is editable and actors store their own copies), so a
 * fix is never high confidence.
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
  wraps.wrap(ActorClass.prototype, "applyActiveEffects", "prone-defense", function (applyActiveEffects, phase, ...args) {
    passes.push({ actor: this, phase, counted: false });
    try {
      return applyActiveEffects.call(this, phase, ...args);
    } finally {
      passes.pop();
    }
  });

  const EffectClass = CONFIG.ActiveEffect.documentClass;
  wraps.wrap(EffectClass, "applyChange", "prone-defense", function (applyChange, targetDoc, change, options) {
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
  });
}

function isNeeded() {
  const changes = CONFIG.T20?.conditions?.caido?.system?.changes;
  if (changes === undefined) return undefined;
  return diagnoseProneChanges(changes);
}

/**
 * Tormenta20 1.6.6 dropped CONFIG.T20.conditions: Caído only exists after the system's "ready" builds
 * CONFIG.statusEffects from world.statuses. Up to 1.6.5 isNeeded already read the system's data, so nothing is new.
 */
async function lateProbe() {
  if (CONFIG.T20?.conditions) return undefined;
  const conditions = await findWithRetry(async () => statusEffectSources([PRONE], globalThis.CONFIG?.statusEffects));
  return conditions ? diagnoseProneChanges(conditions[PRONE]?.system?.changes) : undefined;
}

export default {
  id: "prone-defense",
  group: "conditions",
  issue: 40,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  probeKind: "behavior",
  guarded: true,
  isNeeded,
  lateProbe,
  apply
};
