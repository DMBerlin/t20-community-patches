import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePatchState, shouldNotify } from "../scripts/registry.mjs";

const patch = { system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } } };
const resolve = (overrides) =>
  resolvePatchState({ patch, enabled: true, systemId: "tormenta20", systemVersion: "1.6.5", ...overrides }).state;

test("disabled and incompatible patches are never probed", () => {
  const probe = () => assert.fail("probe must not run");
  assert.equal(resolve({ enabled: false, probe }), "disabled");
  assert.equal(resolve({ systemId: "dnd5e", probe }), "incompatible");
  assert.equal(resolve({ systemVersion: "1.6.4", probe }), "incompatible");
});

test("inside the verified range the patch applies unless the probe proves the fix", () => {
  assert.equal(resolve({}), "applied");
  assert.equal(resolve({ probe: () => true }), "applied");
  assert.equal(resolve({ probe: () => undefined }), "applied");
  assert.equal(resolve({ probe: () => { throw new Error("x"); } }), "applied");
  assert.equal(resolve({ probe: () => false }), "fixed");
});

test("on a newer system version the probe decides", () => {
  assert.equal(resolve({ systemVersion: "1.6.6", probe: () => true }), "applied-unverified");
  assert.equal(resolve({ systemVersion: "1.6.6", probe: () => false }), "fixed");
  assert.equal(resolve({ systemVersion: "1.6.6", probe: () => undefined }), "unverified");
  assert.equal(resolve({ systemVersion: "1.6.6" }), "unverified");
  assert.equal(resolve({ systemVersion: "1.7.0", probe: () => { throw new Error("x"); } }), "unverified");
});

test("the GM is notified about errors and about changes that need attention", () => {
  assert.equal(shouldNotify("error", "error"), true);
  assert.equal(shouldNotify("fixed", "applied"), true);
  assert.equal(shouldNotify("fixed", "fixed"), false);
  assert.equal(shouldNotify("unverified", undefined), true);
  assert.equal(shouldNotify("applied", "fixed"), false);
  assert.equal(shouldNotify("disabled", "applied"), false);
});
