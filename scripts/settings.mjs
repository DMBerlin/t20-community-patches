import { MODULE_ID } from "./utils.mjs";
import { normalizeMode, planModeMigration } from "./registry.mjs";
import { PatchManager } from "./apps/patch-manager.mjs";
import { MANA_LIMIT_SETTING } from "./rules/mana-limit.mjs";
import { USAGE_EFFECT_MAX_SETTING } from "./rules/usage-effect-max.mjs";
import { SAME_ABILITY_SETTING } from "./rules/same-ability-stacking.mjs";
import { SOURCE_STACKING_SETTING } from "./rules/source-stacking.mjs";
import { ITEM_EFFECTIVE_STATS_SETTING } from "./rules/item-effective-stats.mjs";
import {
  CASTING_CONDITION_SETTING,
  CONCENTRATION_SETTING,
  SUSTAINED_SPELL_SETTING
} from "./rules/casting-restrictions.mjs";
import { ARCANE_ARMOR_SETTING } from "./rules/arcane-armor-casting.mjs";
import { NON_PROFICIENCY_SETTING } from "./rules/non-proficiency-penalties.mjs";
import { SAVE_BUTTON_SETTING } from "./rules/save-button.mjs";
import { ATTACK_VS_DEFENSE_SETTING, ATTACK_VS_DEFENSE_VISIBILITY_SETTING } from "./rules/attack-vs-defense.mjs";
import { CONCEALMENT_SETTING } from "./rules/concealment-miss-chance.mjs";
import { TRAINED_ONLY_SETTING } from "./rules/trained-only-skills.mjs";
import { SKILL_PICKER_SETTING } from "./rules/skill-picker.mjs";
import { SITUATIONAL_SETTING } from "./rules/situational-modifiers.mjs";
import { NONLETHAL_SETTING } from "./rules/nonlethal-damage.mjs";
import { CREATURE_TYPE_TRAITS_SETTING } from "./rules/creature-type-traits.mjs";
import { COMBAT_MANEUVERS_SETTING } from "./rules/combat-maneuvers.mjs";
import { DYING_STATES_SETTING } from "./rules/dying-states.mjs";
import { XP_AWARDS_SETTING } from "./rules/encounter-xp.mjs";
import { DEATH_FLOOR_SETTING } from "./patches/death-threshold.mjs";
import { LIMIT_KEY as SEGMENTED_SCENE_LIMIT } from "./patches/segmented-scene-setting.mjs";

export const SETTINGS = {
  /** {[patchId]: "auto"|"off"|"force"}. Booleans and missing ids are read through normalizeMode. */
  patches: "patches",
  /** {[patchId]: StatusRecord} seen by this user on the previous load, used to notify each GM once per change. */
  lastStatus: "lastStatus"
};

/**
 * Module settings shown in the Center's "Optional rules" tab, in display order. They are registered with
 * `config: false`, so they no longer appear in the core settings window. A rule with several settings shows them in
 * its detail, under the label `T20CP.Center.Rules.<id>`. Only settings registered on this load are listed (the scene
 * limit only exists while segmented-scene-setting applies its fix).
 * Each rule sits in one of the patch GROUPS, used by the Center's sidebar.
 * @type {{id: string, group: string, keys: string[]}[]}
 */
export const RULE_SETTINGS = [
  { id: "mana-limit", group: "usage-effects", keys: [MANA_LIMIT_SETTING] },
  { id: "usage-effect-max", group: "usage-effects", keys: [USAGE_EFFECT_MAX_SETTING] },
  { id: "same-ability-stacking", group: "usage-effects", keys: [SAME_ABILITY_SETTING] },
  { id: "source-stacking", group: "sheet-effects", keys: [SOURCE_STACKING_SETTING] },
  { id: "item-effective-stats", group: "items", keys: [ITEM_EFFECTIVE_STATS_SETTING] },
  { id: "casting-restrictions", group: "usage-effects", keys: [SUSTAINED_SPELL_SETTING, CASTING_CONDITION_SETTING, CONCENTRATION_SETTING] },
  { id: "arcane-armor", group: "usage-effects", keys: [ARCANE_ARMOR_SETTING] },
  { id: "non-proficiency", group: "items", keys: [NON_PROFICIENCY_SETTING] },
  { id: "save-button", group: "combat", keys: [SAVE_BUTTON_SETTING] },
  { id: "attack-vs-defense", group: "combat", keys: [ATTACK_VS_DEFENSE_SETTING, ATTACK_VS_DEFENSE_VISIBILITY_SETTING] },
  { id: "concealment-miss-chance", group: "combat", keys: [CONCEALMENT_SETTING] },
  { id: "situational-modifiers", group: "combat", keys: [SITUATIONAL_SETTING] },
  { id: "trained-only-skills", group: "actor", keys: [TRAINED_ONLY_SETTING] },
  { id: "skill-picker", group: "actor", keys: [SKILL_PICKER_SETTING] },
  { id: "nonlethal-damage", group: "combat", keys: [NONLETHAL_SETTING] },
  { id: "combat-maneuvers", group: "combat", keys: [COMBAT_MANEUVERS_SETTING] },
  { id: "creature-type-traits", group: "actor", keys: [CREATURE_TYPE_TRAITS_SETTING] },
  { id: "dying-states", group: "actor", keys: [DYING_STATES_SETTING, DEATH_FLOOR_SETTING] },
  { id: "segmented-scene-limit", group: "settings", keys: [SEGMENTED_SCENE_LIMIT] },
  { id: "encounter-xp", group: "settings", keys: [XP_AWARDS_SETTING] }
];

/** Setting used by 0.1.0, one Boolean per patch. Kept hidden only to migrate its value. */
const legacyKey = (id) => `patch.${id}`;

/** @param {{id: string}[]} patches */
export function registerSettings(patches) {
  game.settings.register(MODULE_ID, SETTINGS.patches, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
  game.settings.register(MODULE_ID, SETTINGS.lastStatus, {
    scope: "user",
    config: false,
    type: Object,
    default: {}
  });
  for (const { id } of patches) {
    game.settings.register(MODULE_ID, legacyKey(id), { scope: "world", config: false, type: Boolean, default: true });
  }
  game.settings.registerMenu(MODULE_ID, "manager", {
    name: "T20CP.Manager.Name",
    label: "T20CP.Manager.Label",
    hint: "T20CP.Manager.Hint",
    icon: "fa-solid fa-screwdriver-wrench",
    type: PatchManager,
    restricted: true
  });
}

/**
 * @param {string} id
 * @returns {import("./registry.mjs").PatchMode}
 */
export function getPatchMode(id) {
  const value = game.settings.get(MODULE_ID, SETTINGS.patches)?.[id];
  return normalizeMode(value, value === undefined ? game.settings.get(MODULE_ID, legacyKey(id)) : undefined);
}

/**
 * Rewrites booleans and the 0.1.0 settings as modes, keeping the effective behavior. Run by the active GM.
 * @param {{id: string}[]} patches
 */
export async function migrateLegacySettings(patches) {
  const plan = planModeMigration(
    game.settings.get(MODULE_ID, SETTINGS.patches) ?? {},
    patches.map((p) => p.id),
    (id) => game.settings.get(MODULE_ID, legacyKey(id))
  );
  if (!plan) return;
  await game.settings.set(MODULE_ID, SETTINGS.patches, plan.next);
  console.log(`${MODULE_ID} | Migrated patch preferences: ${plan.migrated.join(", ")}`);
}
