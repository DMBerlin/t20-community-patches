import { test } from "node:test";
import assert from "node:assert/strict";

import { runReady } from "../scripts/kernel/ready.mjs";
import { SETTINGS } from "../scripts/kernel/patch-settings.mjs";
import { createFakePlatform } from "./support/fake-platform.mjs";

const system = { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } };
const patchA = { id: "patch-a", system };
const patchB = { id: "patch-b", system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } } };

/** Timers run by hand, so a test decides when the late summary is due. */
function manualTimers() {
  const pending = new Set();
  return {
    set: (fn) => {
      const handle = { fn };
      pending.add(handle);
      return handle;
    },
    clear: (handle) => pending.delete(handle),
    flush: () => {
      for (const handle of [...pending]) {
        pending.delete(handle);
        handle.fn();
      }
    }
  };
}

function setup({ isGM = true, previous = {}, features = [patchA], status } = {}) {
  const platform = createFakePlatform({
    isGM,
    settings: { [SETTINGS.patches]: {}, [SETTINGS.lastStatus]: previous, "patch.patch-a": true, "patch.patch-b": true }
  });
  const entries = status ?? [{ id: "patch-a", kind: "patch", mode: "auto", state: "applied-unverified" }];
  return { platform, status: entries, features, contextFor: (f) => ({ id: f.id, platform }), timers: manualTimers() };
}

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

test("a state change produces one notification and marks the patch as changed", async () => {
  const deps = setup({ previous: { "patch-a": { state: "applied", systemVersion: "1.6.6" } } });
  await runReady(deps);
  assert.equal(deps.platform.notes.length, 1);
  assert.equal(deps.platform.notes[0].level, "warn");
  assert.match(deps.platform.notes[0].message, /T20CP\.Patches\.patch-a\.Name/);
  assert.equal(deps.status[0].changed, true);
  assert.deepEqual(deps.platform.settings.get(SETTINGS.lastStatus)["patch-a"], {
    state: "applied-unverified",
    systemVersion: "1.6.6"
  });
});

test("the same state as the previous load produces no notification", async () => {
  const deps = setup({ previous: { "patch-a": { state: "applied-unverified", systemVersion: "1.6.6" } } });
  await runReady(deps);
  assert.deepEqual(deps.platform.notes, []);
  assert.equal(deps.status[0].changed, undefined);
});

test("a lateProbe that throws does not block the late summary of the others", async () => {
  const failing = { ...patchA, lateProbe: async () => Promise.reject(new Error("boom")) };
  const found = { ...patchB, lateProbe: async () => ({ bug: "fixed", confidence: "low" }) };
  const deps = setup({
    previous: { "patch-a": { state: "applied" }, "patch-b": { state: "applied" } },
    features: [failing, found],
    status: [
      { id: "patch-a", kind: "patch", mode: "auto", state: "applied" },
      { id: "patch-b", kind: "patch", mode: "auto", state: "applied" }
    ]
  });
  // Both previous records lack systemVersion, so "applied" → "applied" is no news on ready.
  await runReady(deps);
  assert.deepEqual(deps.platform.notes, []);
  await flushPromises();
  assert.ok(deps.platform.logs.some((l) => l.level === "error" && /Late diagnosis failed: patch-a/.test(l.args[0])));
  assert.equal(deps.status[1].state, "suspected-fixed");
  assert.equal(deps.platform.notes.length, 1, "both probes settled, so the summary is emitted without the timer");
  assert.match(deps.platform.notes[0].message, /patch-b/);
  deps.timers.flush();
  assert.equal(deps.platform.notes.length, 1);
});

test("a player gets no notification and nothing is migrated or saved", async () => {
  const deps = setup({ isGM: false });
  await runReady(deps);
  assert.deepEqual(deps.platform.notes, []);
  assert.deepEqual(deps.platform.settings.get(SETTINGS.lastStatus), {});
  assert.deepEqual(deps.platform.settings.get(SETTINGS.patches), {});
});
