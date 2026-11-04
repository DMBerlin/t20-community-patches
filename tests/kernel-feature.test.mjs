import { test } from "node:test";
import assert from "node:assert/strict";

import { patchFeature, validateFeatures } from "../scripts/kernel/feature.mjs";
import { FEATURES, GROUPS } from "../scripts/features/index.mjs";

const install = () => {};
const rule = (id, extra = {}) => ({ id, kind: "rule", group: "combat", install, ...extra });
const patch = (id, extra = {}) => ({
  id,
  kind: "patch",
  group: "combat",
  system: { id: "tormenta20", affected: { minimum: "1.6.5" } },
  install,
  ...extra
});
const invalid = (features, message) => assert.throws(() => validateFeatures(features, GROUPS), message);

test("validateFeatures accepts a valid list, with after pointing backwards and * on the last one", () => {
  validateFeatures([patch("a"), rule("b", { after: ["a"] }), rule("c", { after: ["*"] })], GROUPS);
});

test("validateFeatures rejects each broken rule of the contract", () => {
  invalid([rule("a"), rule("a")], /Feature a: duplicate id/);
  invalid([rule("")], /Feature #0: id missing/);
  invalid([rule("a", { kind: "fix" })], /Feature a: invalid kind "fix"/);
  invalid([rule("a", { group: "nope" })], /Feature a: unknown group "nope"/);
  invalid([patch("a", { system: undefined })], /Feature a: patch without system/);
  invalid([patch("a", { system: { id: "tormenta20" } })], /Feature a: patch without system.affected/);
  invalid([rule("a", { install: undefined })], /Feature a: install missing/);
  invalid([rule("a", { after: ["b"] }), rule("b")], /Feature a: after "b", which is not declared before it/);
  invalid([rule("a", { after: ["a"] })], /Feature a: after "a", which is not declared before it/);
  invalid([rule("a", { after: ["ghost"] })], /Feature a: after unknown id "ghost"/);
  invalid([rule("a", { after: ["*"] }), rule("b")], /Feature a: after "\*" but not the last feature/);
});

test("patchFeature marks the patch kind and keeps its fields", () => {
  const install = () => {};
  const feature = patchFeature({ id: "p", group: "combat", issue: 3, install });
  assert.equal(feature.kind, "patch");
  assert.equal(feature.issue, 3);
  assert.equal(feature.install, install);
});

test("patchFeature without install() fails validation, so validation rejects it", () => {
  const feature = patchFeature({ id: "p", group: "combat", system: { id: "tormenta20", affected: {} } });
  assert.equal(feature.install, undefined);
  assert.throws(() => validateFeatures([feature], ["combat"]), /Feature p: install missing/);
});

test("FEATURES is valid and declares every ordering constraint of the former main.mjs", () => {
  validateFeatures(FEATURES, GROUPS);
  const after = Object.fromEntries(FEATURES.filter((f) => f.after).map((f) => [f.id, [...f.after].sort()]));
  assert.deepEqual(after, {
    "casting-restrictions": [
      "arcane-armor",
      "attack-vs-defense",
      "combat-maneuvers",
      "concealment-miss-chance",
      "save-button",
      "situational-modifiers",
      "usage-effect-max"
    ],
    "trained-only-skills": ["usage-effect-max"],
    "nonlethal-damage": ["death-threshold"],
    "nonlethal-attack": ["situational-modifiers"],
    "death-threshold-floor": ["dying-states"],
    "creature-type-traits": ["death-threshold-floor", "nonlethal-damage"],
    "skill-picker": ["initial-class"],
    "item-effective-stats": ["*"]
  });
  const kinds = FEATURES.map((f) => f.kind);
  assert.equal(kinds.lastIndexOf("patch") < kinds.indexOf("rule"), true, "patches install before every rule");
  assert.equal(FEATURES.find((f) => f.kind === "rule").id, "mana-queue");
  for (const f of FEATURES.filter((f) => f.kind === "rule")) assert.equal(f.system?.id, "tormenta20", f.id);
});
