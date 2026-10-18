import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeReducedPenalties,
  isArmorPenaltyReducer,
  parseReduction
} from "../scripts/patches/armor-penalty-reduction.mjs";
import { isSystemVersionAffected } from "../scripts/utils.mjs";

test("identifies reducer upgrades by identifier, legacy flag, compendium source and name", () => {
  assert.ok(isArmorPenaltyReducer({ system: { identifier: "adjusted" } }));
  assert.ok(isArmorPenaltyReducer({ flags: { tormenta20: { upgrade: "undermeasure" } } }));
  assert.ok(isArmorPenaltyReducer({ _stats: { compendiumSource: "Compendium.world.item-upgrades.ActiveEffect.K9RtA8a5aPdqyRUR" } }));
  assert.ok(isArmorPenaltyReducer({ name: " Sob medida " }));
});

test("does not treat penalty increases as reducers", () => {
  assert.ok(!isArmorPenaltyReducer({ system: { identifier: "reinforced" }, name: "Reforçada" }));
  assert.ok(!isArmorPenaltyReducer({ name: "Sobrecarregado", system: { status: {} } }));
});

test("uses the magnitude of values stored with either sign", () => {
  assert.equal(parseReduction(-1), 1);
  assert.equal(parseReduction("2"), 2);
  assert.equal(parseReduction("@x", () => -3), 3);
  assert.equal(parseReduction("bad", () => { throw new Error(); }), 0);
});

test("reduces only the carrying item, never above 0", () => {
  const penalties = new Map([["armor", -5], ["shield", -2]]);
  assert.deepEqual(computeReducedPenalties(penalties, new Map([["armor", 1]]), "armor"), new Map([["armor", -4]]));
  assert.deepEqual(computeReducedPenalties(penalties, new Map([["armor", 3]]), "armor"), new Map([["armor", -2]]));
  assert.deepEqual(computeReducedPenalties(penalties, new Map([["shield", 3]]), "armor"), new Map([["shield", 0]]));
});

test("ignores unequipped items and routes unassigned reductions to the fallback", () => {
  const penalties = new Map([["armor", -5]]);
  assert.deepEqual(computeReducedPenalties(penalties, new Map([["other", 2]]), "armor"), new Map());
  assert.deepEqual(computeReducedPenalties(penalties, new Map([["", 2]]), "armor"), new Map([["armor", -3]]));
  assert.deepEqual(computeReducedPenalties(penalties, new Map([["", 2]]), null), new Map());
});

test("system version range check", () => {
  const range = { minimum: "1.6.5", maximum: "1.6.5" };
  assert.ok(isSystemVersionAffected("1.6.5", range));
  assert.ok(!isSystemVersionAffected("1.6.6", range));
  assert.ok(!isSystemVersionAffected("1.6.4", range));
  assert.ok(!isSystemVersionAffected("1.10.0", range));
});
