import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePenaltyAdjustments,
  isArmorPenaltyReducer,
  parseReduction,
  resolveDataRefs
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

const items = (result) => result.items;

test("reduces only the carrying item, never above 0", () => {
  const penalties = new Map([["armor", -5], ["shield", -2]]);
  assert.deepEqual(items(computePenaltyAdjustments(penalties, new Map([["armor", 1]]), new Map(), "armor")), new Map([["armor", -4]]));
  assert.deepEqual(items(computePenaltyAdjustments(penalties, new Map([["armor", 3]]), new Map(), "armor")), new Map([["armor", -2]]));
  assert.deepEqual(computePenaltyAdjustments(penalties, new Map([["shield", 3]]), new Map(), "armor"), { items: new Map([["shield", 0]]), actorDelta: 0 });
});

test("ignores unequipped items and routes unassigned reductions to the fallback", () => {
  const penalties = new Map([["armor", -5]]);
  assert.deepEqual(items(computePenaltyAdjustments(penalties, new Map([["other", 2]]), new Map(), "armor")), new Map());
  assert.deepEqual(items(computePenaltyAdjustments(penalties, new Map([["", 2]]), new Map(), "armor")), new Map([["armor", -3]]));
  assert.deepEqual(items(computePenaltyAdjustments(penalties, new Map([["", 2]]), new Map(), null)), new Map());
});

test("reductions beyond the base penalty cancel the item's own increases, not other actor penalties", () => {
  const penalties = new Map([["armor", -1]]);
  // Base -1, Reforçada -1, Sob Medida 2: combined item penalty goes to 0.
  assert.deepEqual(computePenaltyAdjustments(penalties, new Map([["armor", 2]]), new Map([["armor", 1]]), "armor"), { items: new Map([["armor", 0]]), actorDelta: 1 });
  // Base -5, Reforçada -1, Ajustada 1: only the base is reduced (-4 + -1 = -5).
  assert.deepEqual(computePenaltyAdjustments(new Map([["armor", -5]]), new Map([["armor", 1]]), new Map([["armor", 1]]), "armor"), { items: new Map([["armor", -4]]), actorDelta: 0 });
  // Leftover never exceeds the item's own increases, and increases of other items are untouched.
  assert.deepEqual(computePenaltyAdjustments(penalties, new Map([["armor", 4]]), new Map([["armor", 1], ["shield", 2]]), "armor"), { items: new Map([["armor", 0]]), actorDelta: 1 });
});

test("system version range check", () => {
  const range = { minimum: "1.6.5", maximum: "1.6.5" };
  assert.ok(isSystemVersionAffected("1.6.5", range));
  assert.ok(!isSystemVersionAffected("1.6.6", range));
  assert.ok(!isSystemVersionAffected("1.6.4", range));
  assert.ok(!isSystemVersionAffected("1.10.0", range));
});

test("formula data references resolve recursively and unresolved ones are rejected like core", () => {
  const FakeRoll = {
    replaceFormulaData(raw, data, { recursive }) {
      let out = raw.replace(/@(\w+)/g, (m, k) => (k in data ? String(data[k]) : m));
      return recursive && out !== raw ? this.replaceFormulaData(out, data, { recursive }) : out;
    }
  };
  assert.equal(resolveDataRefs("@nested", { nested: "@amount", amount: 2 }, FakeRoll), "2");
  assert.throws(() => resolveDataRefs("2+@missing", {}, FakeRoll));
  const missing = () => resolveDataRefs("2+@missing", {}, FakeRoll);
  assert.equal(parseReduction("2+@missing", missing), 0);
});
