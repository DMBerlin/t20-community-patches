import { MODULE_ID } from "../../lib/module.mjs";

export const FLAG = "tiebreak";
export const ABILITY_FLAG = "tiebreakAbility";
const DEFAULT_ABILITY = "des";
export const SYSTEM_FORMULA = "1d20 + @pericias.inic.value";
/** sourceFingerprint of foundry.documents.Combat#_sortCombatants in Foundry v14 (combat.mjs:569-573). */
export const KNOWN_SORT = "5b9a77c3:209";

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

/** A finite number from a number or a numeric string; null otherwise. */
function toNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * @param {object|null|undefined} actor
 * @returns {number|null}  The Initiative skill value, or null when it is not a number.
 */
export function initiativeSkill(actor) {
  return toNumber(actor?.system?.pericias?.inic?.value);
}

/**
 * @param {object|null|undefined} actor
 * @returns {number|null}  The value of the Initiative skill's key attribute (Destreza by default), or null.
 */
export function initiativeAbility(actor) {
  const system = actor?.system;
  const key = system?.pericias?.inic?.atributo || DEFAULT_ABILITY;
  return toNumber(system?.atributos?.[key]?.value);
}

/**
 * The tie-break values to save with an initiative change: the skill and its attribute for a numeric result, nulls when
 * the result is cleared, undefined when the initiative is not changing.
 * @param {object} changed   Update or creation data of the combatant
 * @param {object|null} actor
 * @returns {{skill: number|null, ability: number|null}|undefined}
 */
export function tiebreakValues(changed, actor) {
  if (!changed || typeof changed !== "object" || !("initiative" in changed)) return undefined;
  if (toNumber(changed.initiative) === null) return { skill: null, ability: null };
  return { skill: initiativeSkill(actor), ability: initiativeAbility(actor) };
}

/** Saved values first, higher first; 0 when both or neither have one and they are equal. */
function compareSaved(a, b) {
  const hasA = isNumber(a);
  const hasB = isNumber(b);
  if (hasA !== hasB) return hasA ? -1 : 1;
  return hasA ? b - a : 0;
}

/**
 * Compares two combatants that may be tied. Negative: `a` acts first. 0: let the core decide.
 * Among tied numeric results: by the saved skill, then by the saved attribute; for each, saved values first, higher
 * first, and combatants without a saved value after them.
 * @param {{initiative: number|null, flags?: object}} a
 * @param {{initiative: number|null, flags?: object}} b
 * @returns {number}
 */
export function compareInitiativeTie(a, b) {
  if (!isNumber(a?.initiative) || a.initiative !== b?.initiative) return 0;
  const fa = a.flags?.[MODULE_ID];
  const fb = b.flags?.[MODULE_ID];
  return compareSaved(fa?.[FLAG], fb?.[FLAG]) || compareSaved(fa?.[ABILITY_FLAG], fb?.[ABILITY_FLAG]);
}

/**
 * Recognizes the code involved without running it. Never returns fixed: it only knows the current code.
 * @param {{sortFingerprint: string|null, sortOverridden: boolean, formula: string, formulaOverridden: boolean}} facts
 * @returns {import("../../registry.mjs").Diagnosis}
 */
export function diagnose({ sortFingerprint, sortOverridden, formula, formulaOverridden }) {
  if (sortOverridden) return { bug: "unknown", confidence: "low", evidence: "_sortCombatants overridden" };
  if (sortFingerprint !== KNOWN_SORT) {
    return { bug: "unknown", confidence: "low", evidence: `unrecognized _sortCombatants (${sortFingerprint})` };
  }
  if (formula !== SYSTEM_FORMULA || formulaOverridden) {
    return { bug: "unknown", confidence: "low", evidence: `unrecognized initiative formula (${formula})` };
  }
  return { bug: "present", confidence: "high", evidence: "core breaks initiative ties by combatant id" };
}
