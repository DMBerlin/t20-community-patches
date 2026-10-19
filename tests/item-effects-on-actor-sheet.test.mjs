import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRowQueue,
  diagnoseItemEffectsSheet,
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

const BUGGY_LISTING = "async getData() { effects: await X.prepareActiveEffectCategories(this.actor.effects), }";
const FIXED_LISTING = "async getData() { effects: await X.prepareActiveEffectCategories(this.actor.allApplicableEffects()), }";
const BUGGY_ACTIONS =
  "static async onManageActiveEffect(event, owner) { const effect = owner.effects.get(li.dataset.effectId); switch (a.dataset.action) {} }";
const FIXED_ACTIONS =
  "static async onManageActiveEffect(event, owner) { const effect = fromUuidSync(li.dataset.effectUuid); switch (a.dataset.action) {} }";
const diagnose = (...args) => diagnoseItemEffectsSheet(...args).bug;

test("diagnoses the listing bug from getData", () => {
  assert.deepEqual(
    { ...diagnoseItemEffectsSheet(BUGGY_LISTING, BUGGY_ACTIONS), evidence: undefined },
    { bug: "present", confidence: "high", evidence: undefined }
  );
  assert.equal(diagnose(undefined, FIXED_ACTIONS), "unknown");
});

test("a fix mentioned only in comments is not a fix", () => {
  const commented = `// TODO: use allApplicableEffects()\n/* allApplicableEffects() */ ${BUGGY_LISTING}`;
  assert.equal(diagnose(commented, FIXED_ACTIONS), "present");
  const url = 'async getData() { const u = "https://x//y"; return X.prepareActiveEffectCategories(this.actor.effects); }';
  assert.equal(diagnose(url, FIXED_ACTIONS), "present");
});

test("a fixed listing with controls still resolving owner.effects is not fixed", () => {
  assert.deepEqual(diagnoseItemEffectsSheet(FIXED_LISTING, BUGGY_ACTIONS).bug, "present");
  assert.equal(diagnoseItemEffectsSheet(FIXED_LISTING, BUGGY_ACTIONS).confidence, "low");
});

test("unrecognized code, such as another module's wrapper, is unknown", () => {
  const wrapper = "function () { return wrapped.apply(this, arguments); }";
  assert.equal(diagnose(wrapper, FIXED_ACTIONS), "unknown");
  assert.equal(diagnose(FIXED_LISTING, wrapper), "unknown");
  assert.equal(diagnose(FIXED_LISTING, undefined), "unknown");
});

test("listing and controls both fixed is only a low-confidence fix", () => {
  assert.deepEqual(
    { ...diagnoseItemEffectsSheet(FIXED_LISTING, FIXED_ACTIONS), evidence: undefined },
    { bug: "fixed", confidence: "low", evidence: undefined }
  );
});
