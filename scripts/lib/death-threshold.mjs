/** Death threshold (death-threshold patch) and the damage floor below it (death-threshold-floor rule, dying-states). */
import { MODULE_ID } from "./module.mjs";
import { markWrapper } from "./source.mjs";

const LOG = `${MODULE_ID} | death-threshold:`;

export const DEATH_FLOOR = -10;

/**
 * Rulebook threshold: -10 or minus half the maximum HP (rounded down), whichever is lower.
 * @param {number|string} max  Maximum HP.
 * @returns {number|null}      The minimum HP, or null when max is not a number.
 */
export function deathThreshold(max) {
  const total = Math.floor(Number(max));
  if (!Number.isFinite(total)) return null;
  return Math.min(DEATH_FLOOR, -Math.floor(total / 2));
}

/* -------------------------------------------- */
/*  HP below the threshold (#51)                */
/* -------------------------------------------- */

export const DEATH_FLOOR_SETTING = "deathThresholdFloor";

export const DEATH_FLOOR_MODES = ["unbounded", "clamp"];

/** Whether damage may take this actor below the death threshold. */
export function allowsBelowThreshold({ floor, covered }) {
  return floor === "unbounded" && covered === true;
}

/**
 * Runs a damage method with pv.min lifted, so its synchronous clamp keeps values below the threshold.
 * pv.min is derived data; it is restored as soon as the original returns its Promise, before any await resumes.
 */
export function wrapDamageFloor(original, allows) {
  return markWrapper(function (...args) {
    const pv = this?.system?.attributes?.pv;
    let lifted = false;
    let min;
    try {
      // Already lifted (the nonlethal Proxy reads -Infinity but writes to the real data): saving it would keep it.
      if (pv && typeof pv === "object" && pv.min !== Number.NEGATIVE_INFINITY && allows(this)) {
        min = pv.min;
        pv.min = Number.NEGATIVE_INFINITY;
        lifted = true;
      }
    } catch (err) {
      console.warn(`${LOG} could not check the HP floor; keeping the system's clamp.`, err);
    }
    try {
      return original.apply(this, args);
    } finally {
      if (lifted) pv.min = min;
    }
  }, original);
}
