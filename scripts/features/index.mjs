/**
 * Every feature of the module, in install order (#85). Order = declaration order: whoever comes first sits closest to
 * the original in each wrapper chain. `after` never reorders; validateFeatures checks it against this order.
 * Patches come first, then the optional rules (rules only install on Tormenta20).
 */
import { GROUPS, PATCHES } from "../patches/index.mjs";
import { patchFeature } from "../kernel/feature.mjs";
import manaQueue from "../rules/mana-queue.mjs";
import manaLimit from "../rules/mana-limit.mjs";
import usageEffectMax from "../rules/usage-effect-max.mjs";
import sameAbilityStacking from "../rules/same-ability-stacking.mjs";
import sourceStacking from "../rules/source-stacking.mjs";
import nonProficiency from "../rules/non-proficiency-penalties.mjs";
import saveButton from "../rules/save-button.mjs";
import attackVsDefense from "../rules/attack-vs-defense.mjs";
import situationalModifiers from "../rules/situational-modifiers.mjs";
import concealmentMissChance from "../rules/concealment-miss-chance.mjs";
import combatManeuvers from "../rules/combat-maneuvers.mjs";
import arcaneArmor from "../rules/arcane-armor-casting.mjs";
import castingRestrictions from "../rules/casting-restrictions.mjs";
import trainedOnlySkills from "../rules/trained-only-skills.mjs";
import nonlethalDamage from "../rules/nonlethal-damage.mjs";
import nonlethalAttack from "../rules/nonlethal-attack.mjs";
import dyingStates from "../rules/dying-states.mjs";
import deathThresholdFloor from "../rules/death-threshold-floor.mjs";
import creatureTypeTraits from "../rules/creature-type-traits.mjs";
import encounterXp from "../rules/encounter-xp.mjs";
import skillPicker from "../rules/skill-picker.mjs";
import itemEffectiveStats from "../rules/item-effective-stats.mjs";

export { GROUPS };

/** @type {import("../kernel/feature.mjs").Feature[]} */
export const FEATURES = [
  ...PATCHES.map(patchFeature),
  // Transparent (only orders each actor's spendMana calls) and installed with every rule off.
  manaQueue,
  manaLimit,
  usageEffectMax,
  sameAbilityStacking,
  sourceStacking,
  nonProficiency,
  // save-button, attack-vs-defense, situational-modifiers, concealment-miss-chance and combat-maneuvers come before
  // casting-restrictions: its ItemT20#roll wrapper clones the item before calling the next one, so the shared
  // use-target wrappers (scripts/rules/shared/targets.mjs) must sit inside it to bind the system's clone.
  saveButton,
  attackVsDefense,
  // The order relative to attack-vs-defense does not matter: adjustments are registered before the original
  // rollAttack and read after it.
  situationalModifiers,
  // Its rollAttack wrapper composes with attack-vs-defense in either order: the d10 are published before the original
  // rollAttack and the critical is only ever cancelled.
  concealmentMissChance,
  // Without a declared maneuver, its displayCard wrapper only calls the original.
  combatManeuvers,
  // Its displayCard wrapper sits inside casting-restrictions', which only counts a cast through castCompleted
  // (scripts/rules/cast-outcome.mjs), so a failed armor test never ends a sustained spell.
  arcaneArmor,
  // After the other ItemT20#roll/displayCard wrappers (usage-effect-max): a blocked use never reaches them.
  castingRestrictions,
  // After usage-effect-max and the patches that wrap rollPericia: a blocked test never reaches them.
  trainedOnlySkills,
  // After the patches: its prepareDerivedData wrappers sit outside death-threshold's and widen the floor it sets.
  nonlethalDamage,
  // After situational-modifiers: both dialog hooks anchor on "Melhor/Pior de 2d20", and the later one ends up first.
  nonlethalAttack,
  dyingStates,
  deathThresholdFloor,
  // After death-threshold-floor: its applyDamageV2 wrapper may await a dialog before calling the inner chain, so the
  // floor must sit inside it to stay lifted while the system clamps synchronously. After the patches and the other
  // rules: its wrapper makes a single inner call, so their floors and reductions see one HP change.
  creatureTypeTraits,
  // Hooks only (scene controls, combat end, user connection, actor updates): no wrapper to order.
  encounterXp,
  // After the patches: its Item._preCreateOperation wrapper sits outside initial-class's (#54); either order chains.
  skillPicker,
  // Last on purpose: its wrappers must sit outside those of the patches and the other rules.
  itemEffectiveStats
];

/** The patches, as features. */
export const PATCH_FEATURES = FEATURES.filter((f) => f.kind === "patch");
