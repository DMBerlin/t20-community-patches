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
import { ATTACK_VS_DEFENSE_SETTING } from "./rules/attack-vs-defense.mjs";
import { CONCEALMENT_SETTING } from "./rules/concealment-miss-chance.mjs";
import { TRAINED_ONLY_SETTING } from "./rules/trained-only-skills.mjs";
import { SITUATIONAL_SETTING } from "./rules/situational-modifiers.mjs";
import { NONLETHAL_SETTING } from "./rules/nonlethal-damage.mjs";
import { COMBAT_MANEUVERS_BUTTON_SETTING, COMBAT_MANEUVERS_SETTING } from "./rules/combat-maneuvers.mjs";
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
 * @type {{id: string, keys: string[]}[]}
 */
export const RULE_SETTINGS = [
  { id: "mana-limit", keys: [MANA_LIMIT_SETTING] },
  { id: "usage-effect-max", keys: [USAGE_EFFECT_MAX_SETTING] },
  { id: "same-ability-stacking", keys: [SAME_ABILITY_SETTING] },
  { id: "source-stacking", keys: [SOURCE_STACKING_SETTING] },
  { id: "item-effective-stats", keys: [ITEM_EFFECTIVE_STATS_SETTING] },
  { id: "casting-restrictions", keys: [SUSTAINED_SPELL_SETTING, CASTING_CONDITION_SETTING, CONCENTRATION_SETTING] },
  { id: "arcane-armor", keys: [ARCANE_ARMOR_SETTING] },
  { id: "non-proficiency", keys: [NON_PROFICIENCY_SETTING] },
  { id: "save-button", keys: [SAVE_BUTTON_SETTING] },
  { id: "attack-vs-defense", keys: [ATTACK_VS_DEFENSE_SETTING] },
  { id: "concealment-miss-chance", keys: [CONCEALMENT_SETTING] },
  { id: "situational-modifiers", keys: [SITUATIONAL_SETTING] },
  { id: "trained-only-skills", keys: [TRAINED_ONLY_SETTING] },
  { id: "nonlethal-damage", keys: [NONLETHAL_SETTING] },
  { id: "combat-maneuvers", keys: [COMBAT_MANEUVERS_SETTING, COMBAT_MANEUVERS_BUTTON_SETTING] },
  { id: "segmented-scene-limit", keys: [SEGMENTED_SCENE_LIMIT] }
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
