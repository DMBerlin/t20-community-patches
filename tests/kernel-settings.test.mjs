import { test } from "node:test";
import assert from "node:assert/strict";

import { centerSettings, createSettingListeners, registerFeatureSetting } from "../scripts/kernel/settings.mjs";
import { FEATURES, GROUPS } from "../scripts/features/index.mjs";

/** RULE_SETTINGS of scripts/settings.mjs before #85, in its display order. */
const FORMER_RULE_SETTINGS = [
  { id: "mana-limit", group: "usage-effects", keys: ["manaLimitRule"] },
  { id: "usage-effect-max", group: "usage-effects", keys: ["usageEffectMaxRule"] },
  { id: "same-ability-stacking", group: "usage-effects", keys: ["sameAbilityStackingRule"] },
  { id: "source-stacking", group: "sheet-effects", keys: ["sourceStackingRule"] },
  { id: "item-effective-stats", group: "items", keys: ["itemEffectiveStats"] },
  { id: "casting-restrictions", group: "usage-effects", keys: ["sustainedSpellRule", "castingConditionRule", "concentrationRule"] },
  { id: "arcane-armor", group: "usage-effects", keys: ["arcaneArmorRule"] },
  { id: "non-proficiency", group: "items", keys: ["nonProficiencyRule"] },
  { id: "save-button", group: "combat", keys: ["saveButtonRule"] },
  { id: "attack-vs-defense", group: "combat", keys: ["attackVsDefenseRule", "attackVsDefenseVisibility"] },
  { id: "concealment-miss-chance", group: "combat", keys: ["concealmentMissChance"] },
  { id: "situational-modifiers", group: "combat", keys: ["situationalModifiersRule"] },
  { id: "trained-only-skills", group: "actor", keys: ["trainedOnlySkillsRule"] },
  { id: "skill-picker", group: "actor", keys: ["skillPickerRule"] },
  { id: "nonlethal-damage", group: "combat", keys: ["nonlethalDamageRule"] },
  { id: "combat-maneuvers", group: "combat", keys: ["combatManeuversRule"] },
  { id: "creature-type-traits", group: "actor", keys: ["creatureTypeTraitsRule"] },
  { id: "dying-states", group: "actor", keys: ["dyingStatesRule", "deathThresholdFloor"] },
  { id: "segmented-scene-limit", group: "settings", keys: ["segmentedSceneMaxSegments"] },
  { id: "encounter-xp", group: "settings", keys: ["encounterXp"] }
];

const byId = (list) => [...list].sort((a, b) => a.id.localeCompare(b.id));

test("centerSettings(FEATURES) shows the same entries, keys and groups as the former RULE_SETTINGS", () => {
  const entries = centerSettings(FEATURES);
  assert.deepEqual(byId(entries), byId(FORMER_RULE_SETTINGS));
  // The Center shows the entries group by group (GROUPS order); only the order inside a group follows FEATURES.
  for (const group of GROUPS) {
    const ids = (list) => list.filter((e) => e.group === group).map((e) => e.id).sort();
    assert.deepEqual(ids(entries), ids(FORMER_RULE_SETTINGS), group);
  }
});

test("centerSettings groups by centerId, keeps the first appearance order and skips center: false", () => {
  const features = [
    { id: "a", group: "combat", settings: [{ key: "a1" }, { key: "hidden", center: false }] },
    { id: "b", group: "items", settings: [{ key: "b1", centerId: "a" }, { key: "b2", centerId: "x" }] },
    { id: "c", group: "actor", settings: [{ key: "c1" }] }
  ];
  assert.deepEqual(centerSettings(features), [
    { id: "a", group: "combat", keys: ["a1", "b1"] },
    { id: "x", group: "items", keys: ["b2"] },
    { id: "c", group: "actor", keys: ["c1"] }
  ]);
});

test("registerFeatureSetting hides the setting, drops the module keys and builds a getter type on registration", () => {
  const calls = [];
  let built = 0;
  const spec = {
    key: "limit",
    scope: "world",
    centerId: "x",
    center: true,
    config: true,
    get type() {
      built++;
      return "field";
    },
    default: 1
  };
  assert.equal(built, 0);
  registerFeatureSetting((key, config) => calls.push([key, config]), spec);
  assert.deepEqual(calls, [["limit", { scope: "world", config: false, type: "field", default: 1 }]]);
  assert.equal(built, 1);
});

test("registerFeatureSetting builds the type with typeOf(platform) and calls the listeners after the spec's onChange", () => {
  const calls = [];
  const order = [];
  const platform = { fields: "core" };
  const errors = [];
  const listeners = createSettingListeners((err) => errors.push(err.message));
  listeners.on("limit", (value) => order.push(["listener", value]));
  listeners.on("limit", () => {
    throw new Error("boom");
  });
  listeners.on("limit", (value) => order.push(["after a failed listener", value]));
  const spec = { key: "limit", scope: "world", typeOf: (p) => `field of ${p.fields}`, onChange: (v) => order.push(["spec", v]) };
  registerFeatureSetting((key, config) => calls.push([key, config]), spec, { platform, listeners });
  const [[, config]] = calls;
  assert.equal(config.type, "field of core");
  assert.equal("typeOf" in config, false);
  config.onChange(3);
  assert.deepEqual(order, [
    ["spec", 3],
    ["listener", 3],
    ["after a failed listener", 3]
  ]);
  assert.deepEqual(errors, ["boom"]);
});
