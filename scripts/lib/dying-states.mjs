/** Which actors the zero HP states rule (#51) covers in each mode; also read by the death-threshold floor. */

export const DYING_STATES_SETTING = "dyingStatesRule";

export const TRACKED_TYPES = {
  characters: new Set(["character"]),
  all: new Set(["character", "npc", "simple"])
};

/**
 * Whether the rule covers an actor type in a mode.
 * @param {string} type
 * @param {string} mode
 * @returns {boolean}
 */
export function isTracked(type, mode) {
  return TRACKED_TYPES[mode]?.has(type) ?? false;
}
