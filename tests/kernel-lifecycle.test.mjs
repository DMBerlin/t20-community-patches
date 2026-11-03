import { test } from "node:test";
import assert from "node:assert/strict";

import { bootFeatures } from "../scripts/kernel/lifecycle.mjs";

const SYSTEM = { id: "tormenta20", version: "1.6.6" };
const affected = { minimum: "1.6.5", maximum: "1.6.6" };

/** Runs bootFeatures with recording fakes. */
function boot(features, { modes = {}, system = SYSTEM, modeOf = (f) => modes[f.id] ?? "auto" } = {}) {
  const calls = [];
  const registered = [];
  const errors = [];
  const status = bootFeatures({
    features: features.map((f) => ({ ...f, install: (ctx) => (calls.push([f.id, ctx.id]), f.install?.(ctx)) })),
    modeOf,
    system,
    contextFor: (f) => ({ id: f.id }),
    registerSetting: (spec) => registered.push(spec.key),
    log: { info: () => {}, error: (message) => errors.push(message) }
  });
  return { status, calls, registered, errors };
}

const rule = (id, extra = {}) => ({ id, kind: "rule", group: "combat", system: { id: "tormenta20" }, ...extra });
const patch = (id, extra = {}) => ({ id, kind: "patch", group: "combat", system: { id: "tormenta20", affected }, ...extra });

test("a rule that throws becomes error and the next ones are still installed", () => {
  const { status, calls, errors } = boot([
    rule("a", { install: () => { throw new Error("boom"); } }),
    rule("b"),
    patch("c", { isNeeded: () => true })
  ]);
  assert.deepEqual(status.map((s) => [s.id, s.kind, s.state]), [["a", "rule", "error"], ["b", "rule", "installed"], ["c", "patch", "applied"]]);
  assert.equal(status[0].reason, "boom");
  assert.deepEqual(calls.map(([id]) => id), ["a", "b", "c"]);
  assert.deepEqual(errors, ["Failed to install rule: a"]);
});

test("a patch whose mode or probe throws becomes error and the next ones are still installed", () => {
  const { status, calls, errors } = boot([
    patch("a"),
    patch("b", { isNeeded: () => { throw new Error("probe"); } }),
    rule("c")
  ], { modeOf: (f) => { if (f.id === "a") throw new Error("setting unavailable"); return "force"; } });
  assert.deepEqual(status.map((s) => [s.id, s.state]), [["a", "error"], ["b", "forced"], ["c", "installed"]]);
  assert.equal(status[0].reason, "setting unavailable");
  assert.deepEqual(calls.map(([id]) => id), ["b", "c"]);
  assert.deepEqual(errors, ["Failed to resolve patch: a"]);
});

test("a disabled patch is not installed and does not register its settings", () => {
  const settings = [{ key: "limit" }];
  const off = boot([patch("p", { settings })], { modes: { p: "off" } });
  assert.equal(off.status[0].state, "disabled");
  assert.deepEqual(off.calls, []);
  assert.deepEqual(off.registered, []);
  const on = boot([patch("p", { settings, isNeeded: () => true })]);
  assert.equal(on.status[0].state, "applied");
  assert.deepEqual(on.registered, ["limit"]);
});

test("a patch that throws becomes error; its probe and mode are kept", () => {
  const { status } = boot([patch("p", { isNeeded: () => true, install: () => { throw new Error("nope"); } })], { modes: { p: "force" } });
  assert.deepEqual({ ...status[0] }, { id: "p", kind: "patch", group: "combat", mode: "force", state: "error", diagnosis: { bug: "present", confidence: "high" }, reason: "nope" });
});

test("a rule for another system is incompatible, but its settings are still registered", () => {
  const { status, calls, registered } = boot([rule("r", { settings: [{ key: "k" }] })], { system: { id: "dnd5e", version: "5.0.0" } });
  assert.equal(status[0].state, "incompatible");
  assert.equal(status[0].reason, "dnd5e");
  assert.deepEqual(calls, []);
  assert.deepEqual(registered, ["k"]);
});

test("rule settings are registered before any install, in declaration order", () => {
  const order = [];
  bootFeatures({
    features: [
      patch("p", { isNeeded: () => true, install: () => order.push("install p") }),
      rule("a", { settings: [{ key: "a1" }, { key: "a2" }], install: () => order.push("install a") }),
      rule("b", { settings: [{ key: "b1" }], install: () => order.push("install b") })
    ],
    modeOf: () => "auto",
    system: SYSTEM,
    contextFor: (f) => ({ id: f.id }),
    registerSetting: (spec) => order.push(`register ${spec.key}`),
    log: { info: () => {}, error: () => {} }
  });
  assert.deepEqual(order, ["register a1", "register a2", "register b1", "install p", "install a", "install b"]);
});

test("a rule whose setting fails to register is not installed", () => {
  const errors = [];
  let installed = false;
  const status = bootFeatures({
    features: [rule("r", { settings: [{ key: "bad" }], install: () => (installed = true) })],
    modeOf: () => "auto",
    system: SYSTEM,
    contextFor: (f) => ({ id: f.id }),
    registerSetting: () => {
      throw new Error("taken");
    },
    log: { info: () => {}, error: (message) => errors.push(message) }
  });
  assert.equal(status[0].state, "error");
  assert.equal(status[0].reason, "taken");
  assert.equal(installed, false);
  assert.deepEqual(errors, ["Failed to register the settings of rule: r"]);
});

test("install receives the context built for its own feature, in declaration order", () => {
  const { calls } = boot([rule("x"), patch("y", { isNeeded: () => true }), rule("z")]);
  assert.deepEqual(calls, [["x", "x"], ["y", "y"], ["z", "z"]]);
});
