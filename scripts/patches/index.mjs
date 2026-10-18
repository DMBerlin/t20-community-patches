import armorPenaltyReduction from "./armor-penalty-reduction.mjs";

/**
 * @typedef {object} Patch
 * @property {string} id                         Unique id, also used for settings and i18n keys.
 * @property {{id: string, affected: {minimum?: string, maximum?: string}}} system
 *                                               System versions known to contain the bug.
 * @property {() => void} apply                  Installs the fix. Called once during "init".
 */

/** @type {Patch[]} */
export const PATCHES = [armorPenaltyReduction];
