import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPLY_STATES,
  applyLateDiagnosis,
  controlsFromMode,
  countCategories,
  createLateSummary,
  modeFromControls,
  needsReload,
  reportIssueUrl,
  stateCategory,
  summarizeNotifications,
  summaryMessage,
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
  statusRecord,
  nextFocusIndex
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

test("stateCategory: the 11 display states fall in the four categories; unknown needs attention", () => {
  const expected = {
    applied: "active",
    forced: "active",
    "applied-unverified": "active",
    "applied-guarded": "active",
    "suspected-fixed": "active",
    fixed: "unneeded",
    "disabled-fixed": "unneeded",
    unverified: "attention",
    error: "attention",
    disabled: "off",
    incompatible: "off"
  };
  for (const [state, category] of Object.entries(expected)) assert.equal(stateCategory(state), category, state);
  assert.equal(stateCategory("something-new"), "attention");
  assert.equal(stateCategory(undefined), "attention");
  assert.deepEqual(countCategories(["applied", "fixed", "error", "applied"]), { active: 2, unneeded: 1, attention: 1, off: 0 });
});

test("modeFromControls and controlsFromMode follow the switch/box table", () => {
  assert.equal(modeFromControls({ enabled: false, always: false }), "off");
  assert.equal(modeFromControls({ enabled: false, always: true }), "off");
  assert.equal(modeFromControls({ enabled: true, always: false }), "auto");
  assert.equal(modeFromControls({ enabled: true, always: true }), "force");
  for (const mode of ["auto", "off", "force"]) assert.equal(modeFromControls(controlsFromMode(mode)), mode);
  assert.deepEqual(controlsFromMode("off"), { enabled: false, always: false });
});

test("needsReload: patch modes and requiresReload settings only", () => {
  assert.equal(needsReload([], []), false);
  assert.equal(needsReload([], [{ requiresReload: false }, {}]), false);
  assert.equal(needsReload(["prone-defense"], []), true);
  assert.equal(needsReload([], [{}, { requiresReload: true }]), true);
});

const note = (id, key, level = "warn") => ({ id, name: id.toUpperCase(), key, level });

test("summarizeNotifications: each key falls in its section, in table order", () => {
  const keys = {
    error: "error",
    regression: "regression",
    fixed: "fixed",
    "disabled-fixed": "fixed",
    "suspected-fixed": "suspected-fixed",
    unverified: "unverified",
    "applied-unverified": "unverified-applied",
    "applied-guarded": "unverified-applied",
    incompatible: "incompatible"
  };
  for (const [key, section] of Object.entries(keys)) {
    assert.deepEqual(summarizeNotifications([note("a", key)]).sections, [{ section, names: ["A"], more: 0 }], key);
  }
  const all = summarizeNotifications(Object.keys(keys).reverse().map((k, i) => note(`p${i}`, k)));
  assert.deepEqual(
    all.sections.map((s) => s.section),
    ["error", "regression", "fixed", "suspected-fixed", "unverified", "unverified-applied", "incompatible"]
  );
  assert.equal(all.ids.length, 9);
});

test("summarizeNotifications: names, level and permanence", () => {
  assert.equal(summarizeNotifications([]), null);
  assert.equal(summarizeNotifications([note("a", "unknown-key")]), null);
  const many = summarizeNotifications(["a", "b", "c", "d", "e"].map((id) => note(id, "fixed", "info")));
  assert.deepEqual(many.sections, [{ section: "fixed", names: ["A", "B", "C"], more: 2 }]);
  assert.equal(many.level, "info");
  assert.equal(many.permanent, false);
  const mixed = summarizeNotifications([note("a", "fixed", "info"), note("b", "unverified", "warn")]);
  assert.equal(mixed.level, "warn");
  assert.equal(mixed.permanent, false);
  const failed = summarizeNotifications([note("a", "fixed", "info"), note("b", "error", "error")]);
  assert.equal(failed.level, "error");
  assert.equal(failed.permanent, true);
  assert.equal(summarizeNotifications([note("a", "regression", "warn")]).permanent, true);
});

test("summaryMessage formats the sections with the localization function", () => {
  const t = (key, data = {}) =>
    ({
      "T20CP.Notifications.Separator": " · ",
      "T20CP.Notifications.More": `${data.names} +${data.count}`,
      "T20CP.Notifications.Sections.fixed": `fixed: ${data.names}`,
      "T20CP.Notifications.Sections.unverified": `unverified: ${data.names}`,
      "T20CP.Notifications.Summary": `T20CP · ${data.system} — ${data.sections}.`
    })[key];
  const summary = summarizeNotifications([
    note("a", "fixed", "info"),
    note("b", "fixed", "info"),
    note("c", "fixed", "info"),
    note("d", "fixed", "info"),
    note("e", "unverified")
  ]);
  assert.equal(summaryMessage(summary, "Tormenta20 1.6.6", t), "T20CP · Tormenta20 1.6.6 — fixed: A, B, C +1 · unverified: E.");
});

function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimer: (fn, ms) => timers.push({ fn, ms, cleared: false }) - 1,
    clearTimer: (i) => (timers[i].cleared = true),
    fire: () => timers.filter((t) => !t.cleared).forEach((t) => ((t.cleared = true), t.fn()))
  };
}

test("createLateSummary: results before the deadline become one summary; later ones are emitted alone", () => {
  const clock = fakeTimers();
  const emitted = [];
  const late = createLateSummary({ pending: 3, emit: (b) => emitted.push(b), ...clock });
  assert.equal(clock.timers[0].ms, 10000);
  late.settle({ id: "a" });
  late.settle({ id: "b", key: "regression" });
  assert.deepEqual(emitted, []);
  clock.fire();
  assert.deepEqual(emitted, [[{ id: "a" }, { id: "b", key: "regression" }]]);
  late.settle({ id: "c", key: "regression" });
  assert.deepEqual(emitted[1], [{ id: "c", key: "regression" }]);
  assert.equal(emitted.length, 2);
});

test("createLateSummary: all settled before the deadline emits at once and clears the timer", () => {
  const clock = fakeTimers();
  const emitted = [];
  const late = createLateSummary({ pending: 2, emit: (b) => emitted.push(b), ...clock });
  late.settle({ id: "a" });
  late.settle(null);
  assert.deepEqual(emitted, [[{ id: "a" }]]);
  assert.equal(clock.timers[0].cleared, true);
  clock.fire();
  assert.equal(emitted.length, 1);
});

test("createLateSummary: nothing to report emits nothing", () => {
  const clock = fakeTimers();
  const emitted = [];
  const late = createLateSummary({ pending: 1, emit: (b) => emitted.push(b), ...clock });
  late.settle(undefined);
  clock.fire();
  assert.deepEqual(emitted, []);
  createLateSummary({ pending: 0, emit: (b) => emitted.push(b), ...clock });
  assert.equal(clock.timers.length, 1);
});

test("reportIssueUrl: prefilled new issue with closed fields only", () => {
  const args = {
    bugs: "https://github.com/DMBerlin/t20-community-patches/issues/",
    patch: { id: "prone-defense", issue: 40 },
    name: "Caído",
    state: "error",
    mode: "auto",
    diagnosis: { bug: "present", confidence: "high", evidence: "Ator Zoltrak do jogador Bianca" },
    reason: "Cannot read Zoltrak of Bianca",
    versions: { system: "1.6.6", foundry: "14.369", module: "1.1.0" }
  };
  const url = reportIssueUrl(args);
  assert.ok(url.startsWith("https://github.com/DMBerlin/t20-community-patches/issues/new?title="));
  const params = new URL(url).searchParams;
  assert.equal(params.get("title"), "[prone-defense] error");
  const body = params.get("body");
  for (const text of ["Caído", "`prone-defense`", "#40", "1.6.6", "14.369", "1.1.0", "auto", "present/high"]) {
    assert.ok(body.includes(text), text);
  }
  const decoded = decodeURIComponent(url);
  assert.ok(!decoded.includes("Zoltrak"));
  assert.ok(!decoded.includes("Bianca"));
  assert.equal(reportIssueUrl({ ...args, bugs: undefined }), null);
  assert.ok(!new URL(reportIssueUrl({ ...args, patch: { id: "x" } })).searchParams.get("body").includes("#"));
});

test("nextFocusIndex moves Tab inside a container, wraps at the ends and recovers an escaped focus", () => {
  assert.equal(nextFocusIndex(3, 0, false), 1);
  assert.equal(nextFocusIndex(3, 2, false), 0);
  assert.equal(nextFocusIndex(3, 1, true), 0);
  assert.equal(nextFocusIndex(3, 0, true), 2);
  assert.equal(nextFocusIndex(3, -1, false), 0);
  assert.equal(nextFocusIndex(3, -1, true), 2);
  assert.equal(nextFocusIndex(0, -1, false), null);
});
