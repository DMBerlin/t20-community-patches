/**
 * Every feature of the module, in install order (#85). Order = declaration order: whoever comes first sits closest to
 * the original in each wrapper chain. `after` never reorders; validateFeatures checks it against this order.
 * Patches come first, then the optional rules (rules only install on Tormenta20).
 */
import { GROUPS, PATCHES } from "./patches.mjs";
import { patchFeature } from "../kernel/feature.mjs";
import manaQueue from "./mana-queue/index.mjs";
import manaLimit from "./mana-limit/index.mjs";
import usageEffectMax from "./usage-effect-max/index.mjs";
import sameAbilityStacking from "./same-ability-stacking/index.mjs";
import sourceStacking from "./source-stacking/index.mjs";
import nonProficiency from "./non-proficiency/index.mjs";
import saveButton from "./save-button/index.mjs";
import attackVsDefense from "./attack-vs-defense/index.mjs";
import situationalModifiers from "./situational-modifiers/index.mjs";
import concealmentMissChance from "./concealment-miss-chance/index.mjs";
import combatManeuvers from "./combat-maneuvers/index.mjs";
import arcaneArmor from "./arcane-armor/index.mjs";
import castingRestrictions from "./casting-restrictions/index.mjs";
import trainedOnlySkills from "./trained-only-skills/index.mjs";
import nonlethalDamage from "./nonlethal-damage/index.mjs";
import nonlethalAttack from "./nonlethal-attack/index.mjs";
import dyingStates from "./dying-states/index.mjs";
import deathThresholdFloor from "./death-threshold-floor/index.mjs";
import creatureTypeTraits from "./creature-type-traits/index.mjs";
import encounterXp from "./encounter-xp/index.mjs";
import skillPicker from "./skill-picker/index.mjs";
import itemEffectiveStats from "./item-effective-stats/index.mjs";

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
  // use-targets service (scripts/services/use-targets.mjs), installed with the first of them, must sit inside it to
  // bind the system's clone.
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
  // (scripts/lib/cast-outcome.mjs), so a failed armor test never ends a sustained spell.
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
