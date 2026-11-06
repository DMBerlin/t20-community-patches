import abilityDialogCost from "./ability-dialog-cost/index.mjs";
import alchemicalDamageBonus from "./alchemical-damage-bonus/index.mjs";
import appendedUsageChanges from "./appended-usage-changes/index.mjs";
import conditionalPowers from "./conditional-powers/index.mjs";
import conditionSkillLists from "./condition-skill-lists/index.mjs";
import conditionUpgradeChain from "./condition-upgrade-chain/index.mjs";
import armorPenaltyReduction from "./armor-penalty-reduction/index.mjs";
import deathThreshold from "./death-threshold/index.mjs";
import encumberedStatusSync from "./encumbered-status-sync/index.mjs";
import petrifiedDamageReduction from "./petrified-damage-reduction/index.mjs";
import finesseAgileWeapons from "./finesse-agile-weapons/index.mjs";
import defaultDamageAttribute from "./default-damage-attribute/index.mjs";
import ongoingDamageConditions from "./ongoing-damage-conditions/index.mjs";
import proneDefense from "./prone-defense/index.mjs";
import hideLegacyUpgrades from "./hide-legacy-upgrades/index.mjs";
import itemEffectsOnActorSheet from "./item-effects-on-actor-sheet/index.mjs";
import linkedUsageEffects from "./linked-usage-effects/index.mjs";
import menaceXpFraction from "./menace-xp-fraction/index.mjs";
import restRecovery from "./rest-recovery/index.mjs";
import spellCostZero from "./spell-cost-zero/index.mjs";
import spellCompendiumData from "./spell-compendium-data/index.mjs";
import enchantmentData from "./enchantment-data/index.mjs";
import raceData from "./race-data/index.mjs";
import partnerCombatant from "./partner-combatant/index.mjs";
import bestiaryCreatureType from "./bestiary-creature-type/index.mjs";
import spellDcBonus from "./spell-dc-bonus/index.mjs";
import fieldBonusesBreakdown from "./field-bonuses-breakdown/index.mjs";
import fieldBonusesTooltip from "./field-bonuses-tooltip/index.mjs";
import attributeBreakdown from "./attribute-breakdown/index.mjs";
import modifiedFieldsFilter from "./modified-fields-filter/index.mjs";
import saveSkillBonus from "./save-skill-bonus/index.mjs";
import sheetInitiativeToken from "./sheet-initiative-token/index.mjs";
import skillModifierAttributes from "./skill-modifier-attributes/index.mjs";
import engenhoqueiroArmorPenalty from "./engenhoqueiro-armor-penalty/index.mjs";
import segmentedSceneSetting from "./segmented-scene-setting/index.mjs";
import statusEffectsCompendium from "./status-effects-compendium/index.mjs";
import suppressedUsageEffects from "./suppressed-usage-effects/index.mjs";
import threateningCritRange from "./threatening-crit-range/index.mjs";
import temporaryUsageEffectExpiry from "./temporary-usage-effect-expiry/index.mjs";
import sustainedSpellCost from "./sustained-spell-cost/index.mjs";
import usageEffectToggle from "./usage-effect-toggle/index.mjs";
import usageBuffTemplates from "./usage-buff-templates/index.mjs";
import initiativeTiebreak from "./initiative-tiebreak/index.mjs";
import initialClass from "./initial-class/index.mjs";
import racialAttributeChoice from "./racial-attribute-choice/index.mjs";
import rdExceptionOnce from "./rd-exception-once/index.mjs";
import d20RollBonusZero from "./d20-roll-bonus-zero/index.mjs";

/**
 * Display groups, in the order they appear in the patch manager. i18n: T20CP.Groups.<id>.
 * Groups are only for organization: every patch keeps its own toggle, because upstream fixes bugs one at a time.
 */
export const GROUPS = ["conditions", "sheet-effects", "usage-effects", "items", "settings", "actor", "combat"];

/**
 * @typedef {object} Patch
 * @property {string} id                         Unique id, also used for settings and i18n keys.
 * @property {string} group                      One of GROUPS.
 * @property {number} [issue]                    Issue number in this repository.
 * @property {{id: string, affected: {minimum?: string, maximum?: string}}} system
 *                                               System versions verified to contain the bug.
 * @property {(ctx: import("../kernel/feature.mjs").FeatureContext) => import("../registry.mjs").Diagnosis|boolean|undefined} [isNeeded]
 *                                               Synchronous runtime probe, safe during "init", run before the fix.
 *                                               Returns a Diagnosis, or a legacy boolean: true = present/high,
 *                                               false = fixed/low, undefined = unknown. A probe that only reads
 *                                               source code never returns fixed/high.
 * @property {"source"|"behavior"} [probeKind]  "source" (default): isNeeded only reads system code through
 *                                               ctx.platform.sourceOfMethod, so `make audit` runs it on the bundle.
 *                                               "behavior": it executes code or reads CONFIG, data or settings.
 * @property {string[]} [sources]                Method labels the patch depends on (`Class#member`, `Class.member`,
 *                                               `#helper:name`, `#local:name`); `make audit` fingerprints them.
 *                                               Every label the probe reads must be listed.
 * @property {import("../kernel/feature.mjs").SettingSpec[]} [settings]
 *                                               Settings registered only when the patch is applied, before apply().
 * @property {boolean} [guarded]                 apply() only acts when the bug shows up, so it is safe to apply on
 *                                               an unverified system version without confirming the bug.
 * @property {(ctx: import("../kernel/feature.mjs").FeatureContext) => Promise<import("../registry.mjs").Diagnosis|boolean|undefined>} [lateProbe]
 *                                               Optional diagnosis after "ready", for bugs that cannot be checked
 *                                               during "init". Only runs when the patch was applied; it updates the
 *                                               badge and notifications, never installs or removes wrappers. It
 *                                               must not measure the patch's own effect. undefined = no news.
 * @property {(ctx: import("../kernel/feature.mjs").FeatureContext) => void} install
 *                                               Installs the fix through the injected context, once during "init"
 *                                               (see patchFeature in scripts/kernel/feature.mjs). Each patch lives in
 *                                               scripts/features/<id>/ (index, domain, integration, ui).
 */

/** @type {Patch[]} */
export const PATCHES = [statusEffectsCompendium, encumberedStatusSync, petrifiedDamageReduction, ongoingDamageConditions, proneDefense, conditionSkillLists, deathThreshold, itemEffectsOnActorSheet, usageEffectToggle, conditionalPowers, conditionUpgradeChain, modifiedFieldsFilter, fieldBonusesBreakdown, fieldBonusesTooltip, attributeBreakdown, suppressedUsageEffects, appendedUsageChanges, linkedUsageEffects, usageBuffTemplates, temporaryUsageEffectExpiry, sustainedSpellCost, abilityDialogCost, spellCostZero, armorPenaltyReduction, finesseAgileWeapons, defaultDamageAttribute, spellDcBonus, threateningCritRange, alchemicalDamageBonus, hideLegacyUpgrades, segmentedSceneSetting, restRecovery, menaceXpFraction, saveSkillBonus, sheetInitiativeToken, spellCompendiumData, enchantmentData, raceData, partnerCombatant, skillModifierAttributes, engenhoqueiroArmorPenalty, bestiaryCreatureType, initiativeTiebreak, initialClass, racialAttributeChoice, rdExceptionOnce, d20RollBonusZero];
