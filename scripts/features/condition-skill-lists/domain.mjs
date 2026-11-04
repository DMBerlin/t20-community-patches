import { keyAbility } from "../../lib/skills.mjs";

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
  const added = missingSkillKeys({ skills, listed, abilities, skillConfig });
  if (!added.length) return null;

  const at = changes.lastIndexOf(anchors.at(-1)) + 1;
  const copies = added.map((key) => ({ ...anchor, key }));
  return { changes: [...changes.slice(0, at), ...copies, ...changes.slice(at)], added };
}

/** `condi` keys of the actor's skills whose key attribute is in `abilities` and that are not listed. */
function missingSkillKeys({ skills, listed, abilities, skillConfig }) {
  const added = [];
  for (const [id, skill] of Object.entries(skills ?? {})) {
    if (IGNORED_SKILLS.has(id) || listed.has(id)) continue;
    if (abilities.has(keyAbility(id, skill, skillConfig))) added.push(`system.pericias.${id}.condi`);
  }
  return added;
}

/** Whether a condition penalizes skills only by downgrades on single skills' `condi`, as the system does. */
function isRecognizedCondition(changes) {
  return changes.some((c) => skillRepresentation(c) === "direct") && !changes.some((c) => skillRepresentation(c) === "other");
}

/**
 * Checks the system's own condition definitions (`CONFIG.T20.conditions` up to 1.6.5, the world.statuses copy in
 * `CONFIG.statusEffects[id]._source` from 1.6.6) against the skill table
 * (`CONFIG.T20.pericias`). The applied conditions come from the `world.statuses` copy, and custom skills only exist
 * on actors, so a complete list is never a high-confidence fix.
 * @param {Record<string, {system?: {changes?: object[]}}>} conditions
 * @param {Record<string, {abl?: string}>} skillConfig
 * @returns {import("../../registry.mjs").Diagnosis}
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
    if (!isRecognizedCondition(changes)) {
      unknown.push(id);
      continue;
    }
    const plan = planConditionChanges({ statuses: [id], changes, skills, skillConfig });
    if (plan) missing.push(`${id} (${plan.added.map((k) => k.split(".")[2]).join(", ")})`);
  }
  return conditionListsVerdict({ missing, unknown, checked });
}

/** @returns {import("../../registry.mjs").Diagnosis} */
function conditionListsVerdict({ missing, unknown, checked }) {
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
