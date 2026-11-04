import { stripComments } from "../../lib/source.mjs";
import { deathThreshold } from "../../lib/death-threshold.mjs";

export const ACTOR_TYPES = ["character", "npc", "simple"];
/** The 1.6.5 assignment, as the last statement of the method. */
export const BUGGY_NPC_THRESHOLD =
  /this\.attributes\.pv\.min\s*=\s*Math\.floor\(\s*this\.attributes\.pv\.max\s*\/\s*2\s*\)\s*\*\s*-\s*1\s*;?\s*}\s*$/;

/**
 * Overwrites pv.min of prepared actor data. Leaves the data untouched when there is no HP or max is not a number.
 * @param {object} system  Prepared actor system data.
 * @returns {boolean}      Whether pv.min was set.
 */
export function applyDeathThreshold(system) {
  const pv = system?.attributes?.pv;
  if (!pv || typeof pv !== "object") return false;
  const min = deathThreshold(pv.max);
  if (min === null) return false;
  pv.min = min;
  return true;
}

/**
 * Reads MenaceData#prepareDerivedData. Only the known buggy assignment is recognized; source reading never proves
 * a fix, and it does not cover characters or "simple" actors. Recognized only when the buggy assignment is the
 * single reference to a minimum and the last statement, so a later correction is never reported as the bug.
 * @param {string|undefined} source
 * @returns {import("../../registry.mjs").Diagnosis}
 */
export function diagnoseNpcSource(source) {
  if (typeof source !== "string" || !source) {
    return { bug: "unknown", confidence: "low", evidence: "MenaceData#prepareDerivedData source unavailable" };
  }
  const code = stripComments(source);
  // Any other reference to a minimum (a later correction, a destructured pv.min) makes the code unrecognized.
  const mentions = code.match(/\.min\b|\[\s*["'`]min["'`]\s*\]/g)?.length ?? 0;
  if (mentions === 1 && BUGGY_NPC_THRESHOLD.test(code)) {
    return { bug: "present", confidence: "high", evidence: "MenaceData sets pv.min to -floor(max / 2), without the -10 floor" };
  }
  return { bug: "unknown", confidence: "low", evidence: "MenaceData#prepareDerivedData not recognized; checked after ready" };
}

/**
 * Compares the minimum HP the system computed for sample actors with the rulebook threshold.
 * Only valid samples count: the system's prepareDerivedData completed and max is the planned one.
 * @param {{label: string, max: number, min: number, expectedMax: number, prepared: boolean}[]} samples
 * @param {string[]} required  Labels that must all be valid and match the rule to report a fix.
 * @returns {import("../../registry.mjs").Diagnosis|undefined}
 */
export function diagnoseSamples(samples, required) {
  const wrong = [];
  const matched = new Set();
  for (const { label, max, min, expectedMax, prepared } of samples ?? []) {
    if (!prepared || Number(max) !== expectedMax) continue;
    const expected = deathThreshold(max);
    const actual = Number(min);
    if (expected === null || !Number.isInteger(actual)) continue;
    if (actual > expected) wrong.push(`${label}: max ${max}, min ${actual} (rule ${expected})`);
    else if (actual === expected) matched.add(label);
  }
  if (wrong.length) return { bug: "present", confidence: "high", evidence: wrong.join("; ") };
  if (required.length && required.every((label) => matched.has(label))) {
    return { bug: "fixed", confidence: "high", evidence: `minimum HP follows the rule for ${required.join(", ")}` };
  }
  return undefined;
}
