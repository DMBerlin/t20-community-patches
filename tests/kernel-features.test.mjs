import { test } from "node:test";
import assert from "node:assert/strict";

import { createFeatureDirectory } from "../scripts/kernel/features.mjs";
import { createFeatureContext } from "../scripts/kernel/context.mjs";
import { createWrapRegistry } from "../scripts/kernel/wrap.mjs";
import { createFakePlatform } from "./support/fake-platform.mjs";

const FEATURES = [
  { id: "p", kind: "patch", settings: [{ key: "pLimit" }] },
  { id: "r", kind: "rule", settings: [{ key: "rMode" }], services: ["svc"] },
  { id: "me", kind: "rule", interactsWith: ["p", "r"] }
];

function contextOf(feature, status, settings = {}) {
  const platform = createFakePlatform({ settings });
  const features = createFeatureDirectory({ features: FEATURES, status: () => status, getSetting: (key) => platform.settings.get(key) });
  return createFeatureContext(platform, feature, { wraps: createWrapRegistry(), features });
}

test("ctx.features.isActive: an id outside interactsWith throws", () => {
  const ctx = contextOf(FEATURES[2], []);
  assert.throws(() => ctx.features.isActive("other"), /feature "other" is not declared in interactsWith/);
  assert.throws(() => contextOf(FEATURES[0], []).features.isActive("r"), /p: feature "r"/);
});

test("ctx.features.isActive reflects the status, read on every call", () => {
  const status = [];
  const ctx = contextOf(FEATURES[2], status);
  assert.equal(ctx.features.isActive("p"), false);
  status.push({ id: "p", kind: "patch", state: "applied" }, { id: "r", kind: "rule", state: "installed" });
  assert.equal(ctx.features.isActive("p"), true);
  assert.equal(ctx.features.isActive("r"), true);
  for (const state of ["applied-guarded", "suspected-fixed", "forced"]) {
    status[0] = { id: "p", kind: "patch", state };
    assert.equal(ctx.features.isActive("p"), true, state);
  }
  for (const state of ["disabled", "not-needed", "unverified", "error"]) {
    status[0] = { id: "p", kind: "patch", state };
    assert.equal(ctx.features.isActive("p"), false, state);
  }
  status[1] = { id: "r", kind: "rule", state: "error" };
  assert.equal(ctx.features.isActive("r"), false);
});

test("ctx.features.setting reads only declared features and keys they declare", () => {
  const ctx = contextOf(FEATURES[2], [], { rMode: "warn" });
  assert.equal(ctx.features.setting("r", "rMode"), "warn");
  assert.throws(() => ctx.features.setting("r", "pLimit"), /setting "pLimit" is not declared by "r"/);
  assert.throws(() => contextOf(FEATURES[1], []).features.setting("p", "pLimit"), /not declared in interactsWith/);
});

test("ctx.features.list gives the dependency graph", () => {
  assert.deepEqual(contextOf(FEATURES[2], []).features.list(), [
    { id: "p", kind: "patch", services: [], interactsWith: [] },
    { id: "r", kind: "rule", services: ["svc"], interactsWith: [] },
    { id: "me", kind: "rule", services: [], interactsWith: ["p", "r"] }
  ]);
});
