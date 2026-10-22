import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPLY_STATES,
  applyLateDiagnosis,
  isPatchApplied,
  displayState,
  normalizeDiagnosis,
  normalizeMode,
  planModeMigration,
  resolvePatchState,
  pickLateNotification,
  pickNotification,
  readStatusRecord,
  runProbe,
  statusRecord
} from "../scripts/registry.mjs";

const patch = { system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } } };
const guarded = { ...patch, guarded: true };
const run = (overrides) =>
  resolvePatchState({ patch, mode: "auto", systemId: "tormenta20", systemVersion: "1.6.5", ...overrides });
const resolve = (overrides) => run(overrides).state;

const fixedHigh = () => ({ bug: "fixed", confidence: "high" });
const fixedLow = () => ({ bug: "fixed", confidence: "low" });
const present = () => ({ bug: "present", confidence: "high" });
const unknown = () => ({ bug: "unknown", confidence: "low" });
const NEWER = "1.6.6";

test("normalizeDiagnosis converts legacy booleans and keeps diagnoses", () => {
  assert.deepEqual(normalizeDiagnosis(true), { bug: "present", confidence: "high" });
  assert.deepEqual(normalizeDiagnosis(false), { bug: "fixed", confidence: "low" });
  assert.deepEqual(normalizeDiagnosis(undefined), { bug: "unknown", confidence: "low" });
  assert.deepEqual(normalizeDiagnosis({ bug: "fixed", confidence: "high", evidence: "e" }), {
    bug: "fixed",
    confidence: "high",
    evidence: "e"
  });
  assert.deepEqual(normalizeDiagnosis({ bug: "fixed", confidence: "certain" }), { bug: "fixed", confidence: "low" });
  assert.deepEqual(normalizeDiagnosis({ bug: "gone" }), { bug: "unknown", confidence: "low" });
});

test("a throwing probe becomes unknown and keeps its message", () => {
  const diagnosis = runProbe(() => {
    throw new Error("boom");
  });
  assert.deepEqual(diagnosis, { bug: "unknown", confidence: "low", evidence: "boom" });
  const result = run({ probe: () => { throw new Error("boom"); } });
  assert.equal(result.state, "applied");
  assert.equal(result.diagnosis.evidence, "boom");
});

test("off: the probe still runs and its diagnosis is attached", () => {
  for (const systemVersion of ["1.6.5", NEWER]) {
    const result = run({ mode: "off", systemVersion, probe: fixedHigh });
    assert.equal(result.state, "disabled");
    assert.deepEqual(result.diagnosis, fixedHigh());
  }
});

test("incompatible systems are never probed", () => {
  const probe = () => assert.fail("probe must not run");
  for (const mode of ["auto", "force"]) {
    assert.equal(resolve({ mode, systemId: "dnd5e", probe }), "incompatible");
    assert.equal(resolve({ mode, systemVersion: "1.6.4", probe }), "incompatible");
  }
  assert.equal(resolve({ mode: "off", systemVersion: "1.6.4", probe }), "disabled");
});

test("force applies whatever the diagnosis says", () => {
  for (const probe of [fixedHigh, fixedLow, present, unknown]) {
    assert.equal(resolve({ mode: "force", probe }), "forced");
    assert.equal(resolve({ mode: "force", systemVersion: NEWER, probe }), "forced");
  }
});

test("auto inside the verified range", () => {
  assert.equal(resolve({ probe: fixedHigh }), "fixed");
  assert.equal(resolve({ probe: fixedLow }), "suspected-fixed");
  assert.equal(resolve({ probe: () => false }), "suspected-fixed");
  assert.equal(resolve({ probe: present }), "applied");
  assert.equal(resolve({ probe: unknown }), "applied");
  assert.equal(resolve({}), "applied");
});

test("auto above the verified range", () => {
  assert.equal(resolve({ systemVersion: NEWER, probe: fixedHigh }), "fixed");
  assert.equal(resolve({ systemVersion: NEWER, probe: present }), "applied-unverified");
  assert.equal(resolve({ systemVersion: NEWER, probe: () => true }), "applied-unverified");
  for (const probe of [unknown, fixedLow, undefined]) {
    assert.equal(resolve({ systemVersion: NEWER, probe, patch: guarded }), "applied-guarded");
    assert.equal(resolve({ systemVersion: NEWER, probe }), "unverified");
  }
});

const record = (state, extra = {}) => ({ state, systemVersion: "1.6.5", ...extra });
const key = (current, previous) => pickNotification(current, previous)?.key ?? null;

test("errors are always reported", () => {
  assert.deepEqual(pickNotification(record("error"), record("error")), { key: "error", level: "error" });
});

test("states that need attention are reported once per change and per system version", () => {
  assert.equal(key(record("unverified"), undefined), "unverified");
  assert.equal(key(record("unverified"), record("unverified")), null);
  assert.equal(key(record("unverified", { systemVersion: "1.6.6" }), record("unverified")), "unverified");
  assert.equal(key(record("suspected-fixed"), record("applied")), "suspected-fixed");
  assert.equal(key(record("applied-guarded"), record("applied")), "applied-guarded");
  assert.equal(key(record("applied-guarded"), record("applied-unverified")), null);
  assert.equal(key(record("applied-guarded", { systemVersion: "1.6.6" }), record("applied-unverified")), "applied-guarded");
  assert.equal(key(record("applied"), record("unverified")), null);
  assert.equal(key(record("disabled"), record("applied")), null);
  assert.equal(key(record("forced"), record("fixed")), null);
});

test("a system fix is informative, even for a patch turned off", () => {
  assert.deepEqual(pickNotification(record("fixed"), record("applied")), { key: "fixed", level: "info" });
  assert.deepEqual(pickNotification(record("disabled-fixed"), record("disabled")), { key: "disabled-fixed", level: "info" });
  assert.equal(pickNotification(record("suspected-fixed"), undefined).level, "warn");
});

test("a fixed patch that detects the bug again is a regression, then a fix again", () => {
  const applied = record("applied-unverified", { bug: "present", confidence: "high" });
  assert.deepEqual(pickNotification(applied, record("fixed")), { key: "regression", level: "warn" });
  assert.equal(key(record("applied", { bug: "unknown" }), record("fixed")), null);
  assert.equal(key(applied, record("applied-unverified")), null);
  assert.equal(key(record("fixed"), applied), "fixed");
});

test("legacy string entries are read as the state", () => {
  assert.deepEqual(readStatusRecord("fixed"), { state: "fixed" });
  assert.equal(readStatusRecord(42), undefined);
  assert.equal(key(record("fixed"), "fixed"), null);
  assert.equal(key(record("fixed"), "applied"), "fixed");
});

test("the status record keeps the display state, diagnosis and system version", () => {
  assert.deepEqual(statusRecord({ state: "disabled", diagnosis: { bug: "fixed", confidence: "high" } }, "1.6.5"), {
    state: "disabled-fixed",
    systemVersion: "1.6.5",
    bug: "fixed",
    confidence: "high"
  });
  assert.deepEqual(statusRecord({ state: "incompatible" }, "1.6.5"), { state: "incompatible", systemVersion: "1.6.5" });
});

test("stored preferences keep their effective behavior as modes", () => {
  assert.equal(normalizeMode(true), "auto");
  assert.equal(normalizeMode(false), "off");
  assert.equal(normalizeMode("force"), "force");
  assert.equal(normalizeMode(undefined, false), "off");
  assert.equal(normalizeMode(undefined, true), "auto");
  assert.equal(normalizeMode("bogus", false), "off");
  assert.equal(normalizeMode(undefined), "auto");
});

test("migration rewrites booleans and 0.1.0 settings, and leaves modes alone", () => {
  const legacy = (id) => (id === "c" ? false : true);
  const plan = planModeMigration({ a: true, b: false, d: "force" }, ["a", "b", "c", "d", "e"], legacy);
  assert.deepEqual(plan.next, { a: "auto", b: "off", c: "off", d: "force" });
  assert.deepEqual(plan.migrated, ["a", "b", "c"]);
  assert.equal(planModeMigration({ a: "auto", b: "off" }, ["a", "b", "e"], () => true), null);
  assert.deepEqual(planModeMigration({ x: "bogus" }, ["x"], () => false).next, { x: "auto" });
});

test("a patch turned off on a system that fixed the bug says so", () => {
  assert.equal(displayState("disabled", { bug: "fixed", confidence: "high" }), "disabled-fixed");
  assert.equal(displayState("disabled", { bug: "fixed", confidence: "low" }), "disabled");
  assert.equal(displayState("disabled", undefined), "disabled");
  assert.equal(displayState("fixed", { bug: "fixed", confidence: "high" }), "fixed");
});

test("a late diagnosis updates the wording but never what was installed", () => {
  const base = { patch: guarded, mode: "auto", systemId: "tormenta20", systemVersion: NEWER };
  assert.deepEqual(applyLateDiagnosis({ ...base, state: "applied-guarded" }, present()), {
    state: "applied-unverified",
    diagnosis: present()
  });
  const kept = applyLateDiagnosis({ ...base, state: "applied-guarded" }, fixedHigh());
  assert.equal(kept.state, "applied-guarded");
  assert.deepEqual(kept.diagnosis, fixedHigh());
  assert.equal(applyLateDiagnosis({ ...base, systemVersion: "1.6.5", state: "applied" }, present()).state, "applied");
});

test("a late diagnosis reports news against the previous load without repeating this load", () => {
  const guarded = record("applied-guarded", { bug: "unknown" });
  const confirmed = record("applied-unverified", { bug: "present" });
  const lateKey = (late, initial, previous) => pickLateNotification(late, initial, previous)?.key ?? null;
  // A bug given as fixed comes back, confirmed only after "ready".
  assert.equal(lateKey(confirmed, guarded, record("fixed")), "regression");
  // Next load: same late result as before → silent.
  assert.equal(lateKey(confirmed, guarded, confirmed), null);
  // First load: the confirmation is news after the "guarded" warning.
  assert.equal(lateKey(confirmed, guarded, undefined), "applied-unverified");
  // Already reported as a regression on "ready".
  assert.equal(lateKey(confirmed, record("applied-unverified", { bug: "present" }), record("fixed")), null);
  // Same state, but the bug given as fixed is confirmed only after "ready".
  for (const state of ["applied", "forced"]) {
    const late = record(state, { bug: "present" });
    assert.equal(lateKey(late, record(state, { bug: "unknown" }), record("fixed")), "regression", state);
    assert.equal(lateKey(late, record(state, { bug: "unknown" }), late), null, state);
  }
  // Nothing changed since "ready".
  assert.equal(lateKey(record("applied", { bug: "present" }), record("applied", { bug: "unknown" }), undefined), null);
});

test("isPatchApplied is true only for states that ran apply()", () => {
  for (const state of APPLY_STATES) assert.equal(isPatchApplied([{ id: "p", state }], "p"), true, state);
  for (const state of ["disabled", "fixed", "unverified", "incompatible", "error"]) {
    assert.equal(isPatchApplied([{ id: "p", state }], "p"), false, state);
  }
  assert.equal(isPatchApplied([{ id: "q", state: "applied" }], "p"), false);
  assert.equal(isPatchApplied(undefined, "p"), false);
});
