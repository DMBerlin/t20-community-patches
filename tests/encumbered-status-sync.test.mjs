import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSerializer,
  diagnoseEncumbranceHooks,
  encumbranceAction,
  shouldCheckAfterItems,
  wrapDescendantCallback
} from "../scripts/patches/encumbered-status-sync.mjs";

const NONE = { create: false, deleteIds: [] };

test("creates the condition only for an encumbered character without it", () => {
  assert.deepEqual(encumbranceAction({ isCharacter: true, isEncumbered: true, effectIds: [] }), { create: true, deleteIds: [] });
  assert.deepEqual(encumbranceAction({ isCharacter: true, isEncumbered: true, effectIds: ["a"] }), NONE);
});

test("keeps a single copy when an encumbered character has duplicates", () => {
  assert.deepEqual(encumbranceAction({ isCharacter: true, isEncumbered: true, effectIds: ["a", "b", "c"] }), { create: false, deleteIds: ["b", "c"] });
});

test("removes every copy when the character is no longer encumbered", () => {
  assert.deepEqual(encumbranceAction({ isCharacter: true, isEncumbered: false, effectIds: ["a", "b"] }), { create: false, deleteIds: ["a", "b"] });
  assert.deepEqual(encumbranceAction({ isCharacter: true, isEncumbered: false, effectIds: [] }), NONE);
});

test("never touches non-characters", () => {
  for (const isEncumbered of [true, false]) {
    for (const effectIds of [[], ["a"]]) {
      assert.deepEqual(encumbranceAction({ isCharacter: false, isEncumbered, effectIds }), NONE);
    }
  }
});

test("checks only after the actor's own items change, on the acting client", () => {
  const base = { collection: "items", parentIsActor: true, userId: "u1", currentUserId: "u1" };
  assert.ok(shouldCheckAfterItems(base));
  assert.ok(!shouldCheckAfterItems({ ...base, collection: "effects" }));
  assert.ok(!shouldCheckAfterItems({ ...base, parentIsActor: false }));
  assert.ok(!shouldCheckAfterItems({ ...base, userId: "u2" }));
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferredTask() {
  const pending = [];
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const task = (key) => {
    calls.push(key);
    active++;
    maxActive = Math.max(maxActive, active);
    return new Promise((resolve, reject) => pending.push({
      resolve: () => { active--; resolve(); },
      reject: (err) => { active--; reject(err); }
    }));
  };
  return { task, pending, calls, maxActive: () => maxActive };
}

test("overlapping calls for the same key run sequentially, at most twice, sharing the promise", async () => {
  const d = deferredTask();
  const run = createSerializer(d.task);
  const key = {};
  const p1 = run(key);
  const p2 = run(key);
  const p3 = run(key);
  assert.equal(p1, p2);
  assert.equal(p1, p3);
  assert.equal(d.calls.length, 1);
  d.pending.shift().resolve();
  await tick();
  assert.equal(d.calls.length, 2);
  d.pending.shift().resolve();
  await p1;
  assert.equal(d.calls.length, 2);
  assert.equal(d.maxActive(), 1);
});

test("different keys run in parallel", async () => {
  const d = deferredTask();
  const run = createSerializer(d.task);
  const a = run({});
  const b = run({});
  assert.notEqual(a, b);
  assert.equal(d.calls.length, 2);
  assert.equal(d.maxActive(), 2);
  d.pending.forEach((p) => p.resolve());
  await Promise.all([a, b]);
});

test("a failing task does not lock the key", async () => {
  const d = deferredTask();
  const run = createSerializer(d.task);
  const key = {};
  const failed = run(key);
  d.pending.shift().reject(new Error("boom"));
  await assert.rejects(failed, /boom/);
  const next = run(key);
  assert.equal(d.calls.length, 2);
  d.pending.shift().resolve();
  await next;
});

test("the wrapped callback keeps this, arguments and return value, and runs after an async original", async () => {
  const order = [];
  const self = {};
  let release;
  const original = function (...args) {
    order.push(["original", this, args]);
    return new Promise((resolve) => { release = () => resolve("done"); });
  };
  const wrapped = wrapDescendantCallback(original, (who, args) => order.push(["after", who, args]));
  const result = wrapped.call(self, "p", "items");
  assert.equal(order.length, 1);
  assert.deepEqual(order[0], ["original", self, ["p", "items"]]);
  release();
  assert.equal(await result, "done");
  await tick();
  assert.deepEqual(order[1], ["after", self, ["p", "items"]]);
});

test("a rejected original reaches the caller unchanged, without running the check", async () => {
  let ran = false;
  const unhandled = [];
  const onUnhandled = (err) => unhandled.push(err);
  process.on("unhandledRejection", onUnhandled);
  try {
    const wrapped = wrapDescendantCallback(() => Promise.reject(new Error("orig")), () => { ran = true; });
    await assert.rejects(wrapped.call({}), /orig/);
    await tick();
    assert.equal(ran, false);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a synchronous original keeps its return value and still triggers the check", async () => {
  let ran = false;
  const wrapped = wrapDescendantCallback(() => undefined, () => { ran = true; });
  assert.equal(wrapped.call({}), undefined);
  await tick();
  assert.ok(ran);
});

test("diagnoses the create/delete paths without accepting a partial fix", () => {
  const calls = "_onCreate(data, options, userId) { super._onCreate(data, options, userId); this.actor._checkEncumbered(); }";
  const silent = "_onDelete(options, userId) { super._onDelete(options, userId); }";
  const commented = "_onDelete(options, userId) { // TODO this.actor._checkEncumbered()\n }";
  assert.equal(diagnoseEncumbranceHooks({ create: [silent], delete: [silent] }).bug, "present");
  assert.equal(diagnoseEncumbranceHooks({ create: [silent], delete: [commented] }).bug, "present");
  assert.equal(diagnoseEncumbranceHooks({ create: [calls, silent], delete: [silent] }).bug, "unknown");
  assert.equal(diagnoseEncumbranceHooks({ create: [silent], delete: [silent, calls] }).bug, "unknown");
  assert.deepEqual(
    { ...diagnoseEncumbranceHooks({ create: [calls], delete: [calls] }), evidence: undefined },
    { bug: "fixed", confidence: "low", evidence: undefined }
  );
});

test("does not confirm the bug when a path is wrapped by another module or missing", () => {
  const method = "async _onCreateDescendantDocuments(...args) { await super._onCreateDescendantDocuments(...args); }";
  for (const opaque of [
    "function (...args) { return wrapped.apply(this, args); }",
    "(...args) => wrapped(...args)",
    "async function (...args) { return wrapped.apply(this, args); }",
    "async (...args) => wrapped(...args)",
    ""
  ]) {
    const diagnosis = diagnoseEncumbranceHooks({ create: [method, opaque], delete: [method] });
    assert.deepEqual([diagnosis.bug, diagnosis.confidence], ["unknown", "low"], opaque);
  }
  assert.equal(diagnoseEncumbranceHooks({ create: [method], delete: [method] }).bug, "present");
  assert.equal(diagnoseEncumbranceHooks({ create: [], delete: [] }).bug, "unknown");
});
