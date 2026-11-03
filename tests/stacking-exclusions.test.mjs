import { test } from "node:test";
import assert from "node:assert/strict";
import { createStackingExclusions } from "../scripts/services/stacking-exclusions.mjs";

test("register: idempotent, removable; a throwing predicate excludes nothing", () => {
  const exclusions = createStackingExclusions();
  const calls = [];
  const broken = () => {
    calls.push("broken");
    throw new Error("bad");
  };
  const mine = (effect, change) => (calls.push("mine"), change.value === "8");
  const offBroken = exclusions.register(broken);
  const offMine = exclusions.register(mine);
  exclusions.register(mine);
  try {
    assert.equal(exclusions.isExcluded({}, { value: "8" }), true);
    assert.deepEqual(calls, ["broken", "mine"], "registered once; the others are still consulted");
    assert.equal(exclusions.isExcluded({}, { value: "2" }), false);
  } finally {
    offBroken();
    offMine();
  }
  assert.equal(exclusions.isExcluded({}, { value: "8" }), false);
});
