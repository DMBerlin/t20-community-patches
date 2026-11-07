/**
 * Ready-made profiles of the optional rules (#96): setting key → value. Every rule setting of the Center has a value in
 * every profile (tests/rule-profiles.test.mjs); patch settings (segmentedSceneMaxSegments) never do. The rules without
 * settings of their own follow their parent rule: mana-queue is transparent and nonlethal-attack follows
 * nonlethalDamageRule. The kernel and the Center receive these by parameter.
 */

/** "Só correções": every rule at the system's own behavior. It is also the neutral value of the Center's filters. */
const FIXES_ONLY = Object.freeze({
  manaLimitRule: "off",
  usageEffectMaxRule: "off",
  sameAbilityStackingRule: "off",
  sourceStackingRule: "off",
  nonProficiencyRule: "off",
  saveButtonRule: "off",
  attackVsDefenseRule: "off",
  attackVsDefenseVisibility: "show",
  situationalModifiersRule: "off",
  concealmentMissChance: "off",
  combatManeuversRule: "off",
  arcaneArmorRule: "off",
  sustainedSpellRule: "off",
  castingConditionRule: "off",
  concentrationRule: "off",
  trainedOnlySkillsRule: "off",
  nonlethalDamageRule: "off",
  dyingStatesRule: "off",
  deathThresholdFloor: "unbounded",
  creatureTypeTraitsRule: "off",
  encounterXp: "off",
  skillPickerRule: "off",
  itemEffectiveStats: "ends"
});

/** "Assistido": the core rules, with warnings and automation, without blocks or sheet preparation. */
const ASSISTED = Object.freeze({
  ...FIXES_ONLY,
  manaLimitRule: "warn",
  usageEffectMaxRule: "warn",
  saveButtonRule: "on",
  attackVsDefenseRule: "on",
  sustainedSpellRule: "warn",
  castingConditionRule: "warn",
  concentrationRule: "warn",
  trainedOnlySkillsRule: "warn",
  // Dying states without nonlethal damage automate death without allowing a capture.
  nonlethalDamageRule: "on",
  dyingStatesRule: "characters",
  encounterXp: "button",
  skillPickerRule: "on",
  itemEffectiveStats: "display"
});

/** "Livro configurado": the book, for tables whose sheets are prepared (proficiencies, creature types). */
const BOOK = Object.freeze({
  ...ASSISTED,
  sourceStackingRule: "on",
  nonProficiencyRule: "on",
  situationalModifiersRule: "on",
  concealmentMissChance: "on",
  combatManeuversRule: "on",
  arcaneArmorRule: "roll",
  creatureTypeTraitsRule: "on"
  // sameAbilityStackingRule stays off: "highest" only compares numbers, so dice formulas tie and the new effect is
  // refused (scripts/features/same-ability-stacking/domain.mjs).
});

export const PROFILES = Object.freeze({ "fixes-only": FIXES_ONLY, assisted: ASSISTED, book: BOOK });

/**
 * What the kernel and the Center receive: the profiles, the neutral one (the "off" value of the Center's filters) and
 * the recommended one (marked in the selector, and saved in a new world).
 * @type {import("../kernel/profiles.mjs").RuleProfiles}
 */
export const RULE_PROFILES = Object.freeze({ values: PROFILES, neutral: "fixes-only", recommended: "fixes-only" });
