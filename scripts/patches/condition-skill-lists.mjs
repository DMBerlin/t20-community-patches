/**
 * Condition skill lists (tormenta20 1.6.5).
 *
 * Bug: Cego, Fraco, Debilitado, Frustrado and Esmorecido list their skill penalties one skill at a time
 * (`system.pericias.<key>.condi`), and the lists miss skills whose key attribute the book names: Ladinagem (Des) in
 * Cego, Fraco and Debilitado, and the six Ofícios (Int) in Frustrado and Esmorecido. Custom skills (Ofícios
 * "ofi1-9", other skills "_pc1-9") are never listed.
 *
 * Fix: while an actor applies its effects, each of these conditions gets, for that application only, a copy of its
 * own skill penalty for every skill of the actor whose key attribute it names and that it does not list. The copies
 * go through the core like the system's changes (shouldApplyChange, priority order). The condition is skipped when
 * it penalizes skills in any other way. Stored data is never changed.
 */
import { markWrapper, statusEffectSources } from "../utils.mjs";
import { findWithRetry } from "./petrified-damage-reduction.mjs";

/** Attributes whose skills each condition penalizes (Tormenta20 JdA, Apêndice, pp. 394-395). */
export const CONDITION_ABILITIES = Object.freeze({
  cego: Object.freeze(["for", "des"]),
  fraco: Object.freeze(["for", "des", "con"]),
  debilitado: Object.freeze(["for", "des", "con"]),
  frustrado: Object.freeze(["int", "sab", "car"]),
  esmorecido: Object.freeze(["int", "sab", "car"])
});

const SKILL_PENALTY = /^system\.pericias\.([^.*]+)\.condi$/;
/** Keys that change a skill test total (T20 prepareSkill): the skill itself or the skill modifiers. */
const SKILL_RELATED = /^system\.(pericias\.|modificadores\.pericias(\.|$))/;
/** Legacy key skipped by the system's prepareSkill. */
const IGNORED_SKILLS = new Set(["ofic"]);
const LOG = "t20-community-patches | condition-skill-lists:";

/**
 * @param {Iterable<string>} statuses
 * @returns {Set<string>}
 */
export function conditionAbilities(statuses) {
  const abilities = new Set();
  for (const id of statuses ?? []) for (const abl of CONDITION_ABILITIES[id] ?? []) abilities.add(abl);
  return abilities;
}

/**
 * Key attribute of a skill: the system's table (`CONFIG.T20.pericias[id].abl`) for the system's skills, so changing
 * their attribute on the sheet does not matter, and the attribute currently stored in the skill for custom skills,
 * which have no other definition.
 * @param {string} id
 * @param {{atributo?: string}} skill                  The actor's skill data.
 * @param {Record<string, {abl?: string}>} skillConfig
 * @returns {string|undefined}
 */
export function keyAbility(id, skill, skillConfig) {
  return Object.hasOwn(skillConfig ?? {}, id) ? skillConfig[id]?.abl : skill?.atributo;
}

/**
 * How a change touches skill totals: "none", "direct" (a downgrade on one skill's `condi`, the system's own
 * representation of a condition penalty) or "other" (anything else: wildcard, bonus, skill modifiers...).
 * @param {{key?: string, type?: string}} change
 * @returns {"none"|"direct"|"other"}
 */
export function skillRepresentation(change) {
  const key = change?.key ?? "";
  if (!SKILL_RELATED.test(key)) return "none";
  return change.type === "downgrade" && SKILL_PENALTY.test(key) ? "direct" : "other";
}

/**
 * Plans the changes a condition effect should apply in one phase.
 * Returns null (no intervention) when the effect is not an affected condition, when any of its changes penalizes
 * skills in a way other than a downgrade on one skill's `condi`, when no such change is applied in this phase, when
 * those changes disagree on value or priority, or when nothing is missing.
 * Otherwise returns the effect's changes with a copy of the anchor (the first applied skill penalty) for each missing
 * skill, inserted right after the last applied skill penalty so the priority order does not change.
 * @param {object} args
 * @param {Iterable<string>} args.statuses                        The effect's statuses.
 * @param {object[]} args.changes                                 The effect's changes.
 * @param {(change: object) => boolean} [args.isEligible]         Whether the core applies a change in this phase.
 * @param {Record<string, {atributo?: string}>} args.skills       The actor's `system.pericias`.
 * @param {Record<string, {abl?: string}>} args.skillConfig       `CONFIG.T20.pericias`.
 * @returns {{changes: object[], added: string[]}|null}
 */
export function planConditionChanges({ statuses, changes, isEligible = () => true, skills, skillConfig }) {
  const abilities = conditionAbilities(statuses);
  if (!abilities.size || !Array.isArray(changes)) return null;
  if (changes.some((c) => c?.key && skillRepresentation(c) === "other")) return null;

  const anchors = changes.filter((c) => c?.key && skillRepresentation(c) === "direct" && isEligible(c));
  if (!anchors.length) return null;
  const [anchor] = anchors;
  if (anchors.some((c) => String(c.value) !== String(anchor.value) || c.priority !== anchor.priority)) return null;

  const listed = new Set(anchors.map((c) => SKILL_PENALTY.exec(c.key)[1]));
  const added = [];
  for (const [id, skill] of Object.entries(skills ?? {})) {
    if (IGNORED_SKILLS.has(id) || listed.has(id)) continue;
    if (abilities.has(keyAbility(id, skill, skillConfig))) added.push(`system.pericias.${id}.condi`);
  }
  if (!added.length) return null;

  const at = changes.lastIndexOf(anchors.at(-1)) + 1;
  const copies = added.map((key) => ({ ...anchor, key }));
  return { changes: [...changes.slice(0, at), ...copies, ...changes.slice(at)], added };
}

/**
 * Checks the system's own condition definitions (`CONFIG.T20.conditions` up to 1.6.5, the world.statuses copy in
 * `CONFIG.statusEffects[id]._source` from 1.6.6) against the skill table
 * (`CONFIG.T20.pericias`). The applied conditions come from the `world.statuses` copy, and custom skills only exist
 * on actors, so a complete list is never a high-confidence fix.
 * @param {Record<string, {system?: {changes?: object[]}}>} conditions
 * @param {Record<string, {abl?: string}>} skillConfig
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseConditionLists(conditions, skillConfig) {
  if (!conditions || !skillConfig) {
    return { bug: "unknown", confidence: "low", evidence: "CONFIG.T20.conditions or CONFIG.T20.pericias not found" };
  }
  const skills = Object.fromEntries(Object.keys(skillConfig).map((id) => [id, {}]));
  const missing = [];
  const unknown = [];
  let checked = 0;
  for (const id of Object.keys(CONDITION_ABILITIES)) {
    const changes = conditions[id]?.system?.changes;
    if (!Array.isArray(changes)) continue;
    checked++;
    if (!changes.some((c) => skillRepresentation(c) === "direct") || changes.some((c) => skillRepresentation(c) === "other")) {
      unknown.push(id);
      continue;
    }
    const plan = planConditionChanges({ statuses: [id], changes, skills, skillConfig });
    if (plan) missing.push(`${id} (${plan.added.map((k) => k.split(".")[2]).join(", ")})`);
  }
  if (missing.length) return { bug: "present", confidence: "high", evidence: `skills missing: ${missing.join("; ")}` };
  if (!checked || unknown.length) {
    return { bug: "unknown", confidence: "low", evidence: `conditions not recognized: ${unknown.join(", ") || "none found"}` };
  }
  return {
    bug: "fixed",
    confidence: "low",
    evidence: "system conditions cover the skill table; world.statuses and custom skills are not checked"
  };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

let warned = false;

function warnOnce(message, err) {
  if (warned) return;
  warned = true;
  console.error(`${LOG} ${message}`, err);
}

/** Gives each affected condition its planned changes for this phase; returns what to restore. */
function augment(actor, phase) {
  const swapped = [];
  const skills = actor.system?.pericias;
  const skillConfig = CONFIG.T20?.pericias;
  if (!skills || !skillConfig) return swapped;
  let rollData;
  try {
    for (const effect of actor.allApplicableEffects()) {
      if (!effect.active || !conditionAbilities(effect.statuses).size) continue;
      const changes = effect.system?.changes;
      // Same data the core passes to shouldApplyChange (Actor#applyActiveEffects).
      rollData ??= actor.getRollData();
      const replacementData = effect.getReplacementData(rollData);
      const plan = planConditionChanges({
        statuses: effect.statuses,
        changes,
        skills,
        skillConfig,
        isEligible: (change) => effect.shouldApplyChange(change, { phase, replacementData })
      });
      if (!plan) continue;
      effect.system.changes = plan.changes;
      swapped.push([effect, changes]);
    }
  } catch (err) {
    restore(swapped);
    warnOnce(`could not plan the conditions of ${actor?.name}; keeping the system's lists`, err);
    return [];
  }
  return swapped;
}

function restore(swapped) {
  for (const [effect, changes] of swapped.splice(0)) effect.system.changes = changes;
}

function apply() {
  const ActorClass = CONFIG.Actor.documentClass;
  const applyActiveEffects = ActorClass?.prototype?.applyActiveEffects;
  if (typeof applyActiveEffects !== "function") throw new Error("Actor#applyActiveEffects not found");

  /** Phases being planned per actor: the core marks a phase as done only after the planning has run. */
  const planning = new WeakMap();

  ActorClass.prototype.applyActiveEffects = markWrapper(function (phase, ...args) {
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
      swapped = augment(this, phase);
    } finally {
      phases.delete(phase);
    }
    try {
      return applyActiveEffects.call(this, phase, ...args);
    } finally {
      restore(swapped);
    }
  }, applyActiveEffects);
}

function isNeeded() {
  return diagnoseConditionLists(CONFIG.T20?.conditions, CONFIG.T20?.pericias);
}

/**
 * Tormenta20 1.6.6 dropped CONFIG.T20.conditions: the conditions only exist after the system's "ready" builds
 * CONFIG.statusEffects from world.statuses. Up to 1.6.5 isNeeded already read the system's data, so nothing is new.
 */
async function lateProbe() {
  if (CONFIG.T20?.conditions) return undefined;
  const conditions = await findWithRetry(async () => statusEffectSources(Object.keys(CONDITION_ABILITIES)));
  return conditions ? diagnoseConditionLists(conditions, CONFIG.T20?.pericias) : undefined;
}

export default {
  id: "condition-skill-lists",
  group: "conditions",
  issue: 38,
  guarded: true,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  lateProbe,
  apply
};
