import abilityDialogCost from "./ability-dialog-cost.mjs";
import appendedUsageChanges from "./appended-usage-changes.mjs";
import conditionalPowers from "./conditional-powers.mjs";
import conditionSkillLists from "./condition-skill-lists.mjs";
import armorPenaltyReduction from "./armor-penalty-reduction.mjs";
import deathThreshold from "./death-threshold.mjs";
import encumberedStatusSync from "./encumbered-status-sync.mjs";
import ongoingDamageConditions from "./ongoing-damage-conditions.mjs";
import proneDefense from "./prone-defense.mjs";
import hideLegacyUpgrades from "./hide-legacy-upgrades.mjs";
import itemEffectsOnActorSheet from "./item-effects-on-actor-sheet.mjs";
import linkedUsageEffects from "./linked-usage-effects.mjs";
import menaceXpFraction from "./menace-xp-fraction.mjs";
import restRecovery from "./rest-recovery.mjs";
import spellCostZero from "./spell-cost-zero.mjs";
import spellCompendiumData from "./spell-compendium-data.mjs";
import spellDcBonus from "./spell-dc-bonus.mjs";
import fieldBonusesTooltip from "./field-bonuses-tooltip.mjs";
import attributeBreakdown from "./attribute-breakdown.mjs";
import modifiedFieldsFilter from "./modified-fields-filter.mjs";
import saveSkillBonus from "./save-skill-bonus.mjs";
import sheetInitiativeToken from "./sheet-initiative-token.mjs";
import skillModifierAttributes from "./skill-modifier-attributes.mjs";
import segmentedSceneSetting from "./segmented-scene-setting.mjs";
import statusEffectsCompendium from "./status-effects-compendium.mjs";
import suppressedUsageEffects from "./suppressed-usage-effects.mjs";
import threateningCritRange from "./threatening-crit-range.mjs";
import temporaryUsageEffectExpiry from "./temporary-usage-effect-expiry.mjs";
import usageEffectToggle from "./usage-effect-toggle.mjs";

/**
 * Display groups, in the order they appear in the patch manager. i18n: T20CP.Groups.<id>.
 * Groups are only for organization: every patch keeps its own toggle, because upstream fixes bugs one at a time.
 */
export const GROUPS = ["conditions", "sheet-effects", "usage-effects", "items", "settings", "actor"];

/**
 * @typedef {object} Patch
 * @property {string} id                         Unique id, also used for settings and i18n keys.
 * @property {string} group                      One of GROUPS.
 * @property {number} [issue]                    Issue number in this repository.
 * @property {{id: string, affected: {minimum?: string, maximum?: string}}} system
 *                                               System versions verified to contain the bug.
 * @property {() => import("../registry.mjs").Diagnosis|boolean|undefined} [isNeeded]
 *                                               Synchronous runtime probe, safe during "init", run before apply().
 *                                               Returns a Diagnosis, or a legacy boolean: true = present/high,
 *                                               false = fixed/low, undefined = unknown. A probe that only reads
 *                                               source code never returns fixed/high.
 * @property {boolean} [guarded]                 apply() only acts when the bug shows up, so it is safe to apply on
 *                                               an unverified system version without confirming the bug.
 * @property {() => Promise<import("../registry.mjs").Diagnosis|boolean|undefined>} [lateProbe]
 *                                               Optional diagnosis after "ready", for bugs that cannot be checked
 *                                               during "init". Only runs when the patch was applied; it updates the
 *                                               badge and notifications, never installs or removes wrappers. It
 *                                               must not measure the patch's own effect. undefined = no news.
 * @property {() => void} apply                  Installs the fix. Called once during "init".
 */

/** @type {Patch[]} */
export const PATCHES = [statusEffectsCompendium, encumberedStatusSync, ongoingDamageConditions, proneDefense, conditionSkillLists, deathThreshold, itemEffectsOnActorSheet, usageEffectToggle, conditionalPowers, modifiedFieldsFilter, fieldBonusesTooltip, attributeBreakdown, suppressedUsageEffects, appendedUsageChanges, linkedUsageEffects, temporaryUsageEffectExpiry, abilityDialogCost, spellCostZero, armorPenaltyReduction, spellDcBonus, threateningCritRange, hideLegacyUpgrades, segmentedSceneSetting, restRecovery, menaceXpFraction, saveSkillBonus, sheetInitiativeToken, spellCompendiumData, skillModifierAttributes];
