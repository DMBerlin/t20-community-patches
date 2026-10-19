import abilityDialogCost from "./ability-dialog-cost.mjs";
import armorPenaltyReduction from "./armor-penalty-reduction.mjs";
import encumberedStatusSync from "./encumbered-status-sync.mjs";
import hideLegacyUpgrades from "./hide-legacy-upgrades.mjs";
import itemEffectsOnActorSheet from "./item-effects-on-actor-sheet.mjs";
import statusEffectsCompendium from "./status-effects-compendium.mjs";
import suppressedUsageEffects from "./suppressed-usage-effects.mjs";
import temporaryUsageEffectExpiry from "./temporary-usage-effect-expiry.mjs";
import usageEffectToggle from "./usage-effect-toggle.mjs";

/**
 * Display groups, in the order they appear in the patch manager. i18n: T20CP.Groups.<id>.
 * Groups are only for organization: every patch keeps its own toggle, because upstream fixes bugs one at a time.
 */
export const GROUPS = ["conditions", "sheet-effects", "usage-effects", "items", "settings"];

/**
 * @typedef {object} Patch
 * @property {string} id                         Unique id, also used for settings and i18n keys.
 * @property {string} group                      One of GROUPS.
 * @property {number} [issue]                    Issue number in this repository.
 * @property {{id: string, affected: {minimum?: string, maximum?: string}}} system
 *                                               System versions verified to contain the bug.
 * @property {() => boolean|undefined} [isNeeded] Synchronous runtime probe, safe during "init".
 *                                               true = bug present, false = fixed upstream, undefined = unknown.
 * @property {() => void} apply                  Installs the fix. Called once during "init".
 */

/** @type {Patch[]} */
export const PATCHES = [statusEffectsCompendium, encumberedStatusSync, itemEffectsOnActorSheet, usageEffectToggle, suppressedUsageEffects, temporaryUsageEffectExpiry, abilityDialogCost, armorPenaltyReduction, hideLegacyUpgrades];
