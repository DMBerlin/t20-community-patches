import { stripComments } from "../../lib/source.mjs";

export const D20_ROLL = "#local:d20Roll";
export const GET_ATTACK_TO_HIT = "ItemT20#getAttackToHit";

// A binary "+ @bonus" right after a complete operand (number, term, dice modifier, flavor, parenthesis or pool).
const TRAILING_BONUS = /([\w)\]}])\s*\+\s*@bonus\s*$/;
const ZERO = /^\s*[+-]?0+(\.0+)?\s*$/;

/**
 * The formula without a trailing "+@bonus" when the data has no bonus (Roll.parse would read it as 0).
 * Returns the formula unchanged in every other case.
 * @param {unknown} formula
 * @param {unknown} bonus  The `bonus` value of the roll data.
 * @returns {unknown}
 */
export function stripMissingBonus(formula, bonus) {
  if (typeof formula !== "string" || bonus != null || !TRAILING_BONUS.test(formula)) return formula;
  return formula.replace(TRAILING_BONUS, "$1");
}

/** Whether an attack part is the number zero. */
export function isZeroPart(part) {
  if (typeof part === "number") return part === 0;
  return typeof part === "string" && ZERO.test(part);
}

/**
 * getAttackToHit's result without zero parts; the same object when there is nothing to drop.
 * @param {{parts?: unknown[], rollData?: object}|undefined} result
 */
export function withoutZeroParts(result) {
  if (!Array.isArray(result?.parts) || !result.parts.some(isZeroPart)) return result;
  return { ...result, parts: result.parts.filter((part) => !isZeroPart(part)) };
}

const flat = (source) => {
  const code = stripComments(source);
  return typeof code === "string" ? code.replace(/\s+/g, "") : null;
};

/**
 * @param {string|null} d20Source           Source of d20Roll.
 * @param {string|null} attackSource        Source of ItemT20#getAttackToHit.
 * @returns {import("../../registry.mjs").Diagnosis}
 */
export function diagnose(d20Source, attackSource) {
  const d20 = flat(d20Source);
  const attack = flat(attackSource);
  if (!d20 || !attack) return { bug: "unknown", confidence: "low", evidence: "d20Roll or getAttackToHit not found" };
  const appends = d20.includes('parts=parts.concat(["@bonus"])');
  const pops = d20.includes("parts.pop()");
  const mapsParts = attack.includes("roll.parts.map((p)=>p[0]??p)");
  const filters = attack.includes(".filter(");
  if (appends && !pops && mapsParts && !filters) {
    return { bug: "present", confidence: "high", evidence: "d20Roll appends @bonus without dropping it; getAttackToHit keeps zero parts" };
  }
  if ((!appends || pops) && filters) {
    return { bug: "fixed", confidence: "low", evidence: "d20Roll drops @bonus and getAttackToHit filters parts" };
  }
  return { bug: "unknown", confidence: "low", evidence: "d20Roll or getAttackToHit not recognized" };
}
