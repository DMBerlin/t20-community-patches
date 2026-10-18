import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRowQueue,
  getDataListsOnlyActorEffects,
  isItemHeldEffect
} from "../scripts/patches/item-effects-on-actor-sheet.mjs";

test("queues effects by id in render order and keeps repeated ids in sequence", () => {
  const a = { id: "A" };
  const b = { id: "B" };
  const itemA = { id: "A", item: true };
  const queue = buildRowQueue({
    onuse: { effects: [b] },
    passive: { effects: [a] },
    inactive: { effects: [] },
    suppressed: { effects: [itemA] }
  });
  assert.deepEqual([...queue.keys()], ["B", "A"]);
  assert.deepEqual(queue.get("A"), [a, itemA]);
});

test("handles missing categories", () => {
  assert.equal(buildRowQueue(undefined).size, 0);
  assert.equal(buildRowQueue({ passive: undefined, onuse: {} }).size, 0);
});

test("detects effects held by items of the actor", () => {
  const actor = { documentName: "Actor" };
  assert.equal(isItemHeldEffect({ parent: actor }, actor), false);
  assert.equal(isItemHeldEffect({ parent: { documentName: "Item" } }, actor), true);
  assert.equal(isItemHeldEffect({ parent: { documentName: "Actor" } }, actor), false);
  assert.equal(isItemHeldEffect({}, actor), false);
});

test("probes whether getData still lists only actor effects", () => {
  assert.equal(
    getDataListsOnlyActorEffects("async getData() { effects: await X.prepareActiveEffectCategories(this.actor.effects), }"),
    true
  );
  assert.equal(
    getDataListsOnlyActorEffects("effects: await X.prepareActiveEffectCategories(this.actor.allApplicableEffects())"),
    false
  );
  assert.equal(getDataListsOnlyActorEffects("async getData() { return {}; }"), undefined);
  assert.equal(getDataListsOnlyActorEffects(undefined), undefined);
});
