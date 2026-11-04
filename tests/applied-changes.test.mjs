import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppliedChanges } from "../scripts/services/applied-changes.mjs";
import {
  appendLines,
  keyReaches,
  muteItemLines,
  residual,
  skillModifierKeys,
  suppressedLines
} from "../scripts/lib/applied-breakdown.mjs";

const DEF = "system.attributes.defesa.bonus";
const wrap = (target, method, wrapper) => {
  const original = target[method];
  target[method] = function (...args) {
    return wrapper.call(this, original, ...args);
  };
};

/** Core-like classes: applyActiveEffects applies `this.queue` (and runs `this.during`) in each phase. */
function setup() {
  class Effect {
    static applyChangeField(target, change) {
      if (change.boom) throw new Error("boom");
      change.mutate?.();
      return { [change.key]: change.value };
    }
  }
  class Actor {
    constructor(queue = []) {
      this.queue = queue;
      this._completedActiveEffectPhases = new Set();
    }
    applyActiveEffects(phase) {
      if (typeof phase !== "string") phase = this._completedActiveEffectPhases.has("initial") ? "final" : "initial";
      if (this._completedActiveEffectPhases.has(phase)) return;
      this._completedActiveEffectPhases.add(phase);
      this.during?.(phase);
      for (const change of this.queue.filter((c) => (c.phase ?? "initial") === phase)) Effect.applyChangeField(this, change, {});
    }
  }
  const warnings = [];
  const api = createAppliedChanges({ actorProto: Actor.prototype, EffectClass: Effect, wrap, warn: (msg) => warnings.push(msg) });
  const prepare = (actor) => {
    actor._completedActiveEffectPhases.clear();
    actor.applyActiveEffects("initial");
    actor.applyActiveEffects("final");
  };
  return { Actor, Effect, api, prepare, warnings };
}

const change = (key, value, extra = {}) => ({ key, type: "add", value, priority: 20, effect: { name: "E" }, ...extra });

test("records only tracked keys applied during a cycle and publishes them when the final phase returns", () => {
  const { Actor, Effect, api, prepare } = setup();
  const actor = new Actor([change(DEF, "2"), change("system.atributos.for.value", 1), change(DEF, "1", { phase: "final" })]);
  actor.during = (phase) => phase === "final" && assert.equal(api.changes(actor), null);
  prepare(actor);
  assert.deepEqual(
    api.changes(actor).map((c) => [c.key, c.label, c.value, c.phase]),
    [
      [DEF, "E", "2", "initial"],
      [DEF, "E", "1", "final"]
    ]
  );
  Effect.applyChangeField(actor, change(DEF, "9"), {});
  assert.equal(api.changes(actor).length, 2, "outside a cycle nothing is recorded");
});

test("queries (modifyTarget: false) are not recorded", () => {
  const { Actor, Effect, api, prepare } = setup();
  const actor = new Actor();
  actor.during = (phase) => phase === "initial" && Effect.applyChangeField(actor, change(DEF, "3"), { modifyTarget: false });
  prepare(actor);
  assert.deepEqual(api.changes(actor), []);
});

test("a phase that throws discards its cycle and keeps the previous one", () => {
  const { Actor, api, prepare } = setup();
  const actor = new Actor([change(DEF, "2")]);
  prepare(actor);
  actor.queue = [change(DEF, "5"), change(DEF, "1", { boom: true })];
  assert.throws(() => prepare(actor), /boom/);
  assert.deepEqual(api.changes(actor).map((c) => c.value), ["2"]);
  actor._completedActiveEffectPhases.delete("final");
  actor.applyActiveEffects("final");
  assert.deepEqual(api.changes(actor).map((c) => c.value), ["2"], "a final phase without its initial publishes nothing");
});

test("reports are kept per actor, once per origin, and ignored outside a cycle", () => {
  const { Actor, api, prepare } = setup();
  const a = new Actor();
  const b = new Actor();
  const origin = {};
  a.during = (phase) => {
    if (phase !== "initial") return;
    api.reportSuppressed(a, { key: DEF, label: "R", value: 1, reason: "folded" }, origin);
    api.reportSuppressed(a, { key: DEF, label: "R", value: 1, reason: "folded" }, origin);
    api.contribute(a, "system.pericias.luta.bonus", { label: "X", value: -2, owner: "o" });
    api.contribute(a, "system.pericias.luta.bonus", { label: "X", value: -4, owner: "o" });
  };
  api.reportSuppressed(a, { key: DEF, label: "Before", value: 1, reason: "folded" });
  prepare(a);
  prepare(b);
  assert.deepEqual(api.suppressed(a).map((s) => s.label), ["R"]);
  assert.deepEqual(api.contributions(a, "system.pericias.luta.bonus").map((c) => c.value), [-4]);
  assert.deepEqual(api.contributions(a, "system.pericias.acro.bonus"), []);
  assert.deepEqual(api.suppressed(b), []);
  a.during = null;
  prepare(a);
  assert.deepEqual(api.suppressed(a), [], "each cycle starts empty");
});

test("without applyActiveEffects or applyChangeField the API is inert and warns", () => {
  const warnings = [];
  const api = createAppliedChanges({ actorProto: {}, EffectClass: class {}, wrap, warn: (msg) => warnings.push(msg) });
  assert.equal(warnings.length, 1);
  assert.equal(api.changes({}), null);
});

test("breakdown lines: wildcard reports reach concrete skills, accessories are left to the item lines", () => {
  assert.ok(keyReaches("system.pericias.*.bonus", "system.pericias.luta.bonus"));
  assert.ok(!keyReaches("system.pericias.*.bonus", "system.pericias.luta.outros"));
  const suppressed = [
    { key: DEF, label: "Anel", value: 1, reason: "not-stacking", item: { id: "r", accessory: true } },
    { key: DEF, label: "Magia", value: "x", reason: "not-stacking" },
    { key: "system.modificadores.pericias.ataque", label: "Ataque", value: 2, reason: "folded" }
  ];
  assert.deepEqual(suppressedLines(suppressed, DEF), [{ label: "Magia", value: 0, muted: true, reason: "not-stacking" }]);
  assert.deepEqual(
    suppressedLines(suppressed, skillModifierKeys("luta", "for")).map((l) => l.label),
    ["Ataque"]
  );
  assert.deepEqual(suppressedLines(suppressed, skillModifierKeys("acro", "des")), []);
});

const html = (rows, sum) =>
  `<ul class="fieldBonuses">${rows.map(([l, v]) => `<li class="flexrow"><label>${l}:</label><span>${v}</span></li>`).join("")}\n<hr>\n<li class="flexrow"><label>Total:</label><span>${sum}</span></li></ul>`;

test("breakdown lines: muting keeps the HTML when an item line is not found; appending fixes the total", () => {
  const base = html([["A", "+2"], ["A", "+3"]], "+5");
  const muted = muteItemLines(base, [
    { label: "A", value: 2, muted: false },
    { label: "A", value: 3, muted: true, reason: "not-counted" }
  ]);
  assert.match(muted, /<label>A:<\/label><span>\+2<\/span>.*t20cp-muted"><label>A:<\/label><span>\(\+3\)/s);
  assert.match(muted, /Total:<\/label><span>\+2</);
  assert.equal(muteItemLines(base, [{ label: "B", value: 3, muted: true }]), base);
  assert.match(appendLines(base, [{ label: "<b>", value: -1 }]), /&lt;b&gt;:<\/label><span>-1<\/span>.*Total:<\/label><span>\+4</s);
  assert.equal(appendLines("<p>no total</p>", [{ label: "X", value: 1 }]), "<p>no total</p>");
  assert.equal(residual(Number.NaN, 3), 0);
  assert.equal(residual(5, 5.0000001), 0);
});

test("a phase the core rejects as already completed keeps the cycle being recorded", () => {
  const { Actor, api, prepare } = setup();
  const actor = new Actor([change(DEF, "2")]);
  actor.during = (phase) => {
    if (phase !== "initial") return;
    api.reportSuppressed(actor, { key: DEF, label: "R", value: 1, reason: "folded" });
    actor.applyActiveEffects("initial");
  };
  prepare(actor);
  assert.deepEqual(api.changes(actor).map((c) => c.value), ["2"]);
  assert.deepEqual(api.suppressed(actor).map((s) => s.label), ["R"]);
  actor.applyActiveEffects("final");
  assert.deepEqual(api.changes(actor).map((c) => c.value), ["2"], "a repeated final phase publishes nothing new");
});

test("a call without a phase follows the core: initial first, then final", () => {
  const { Actor, api } = setup();
  const actor = new Actor([change(DEF, "2")]);
  actor.applyActiveEffects();
  actor.applyActiveEffects();
  assert.deepEqual(api.changes(actor).map((c) => c.value), ["2"]);
});

test("a final phase run inside the initial one joins the cycle; the core's later final call publishes it", () => {
  const { Actor, api, prepare } = setup();
  const actor = new Actor([change(DEF, "3"), change(DEF, "2", { phase: "final" })]);
  actor.during = (phase) => phase === "initial" && actor.applyActiveEffects();
  actor.applyActiveEffects("initial");
  assert.equal(api.changes(actor), null, "prepareDerivedData has not run yet");
  api.contribute(actor, DEF, { label: "Derived", value: -2, owner: "x" });
  api.reportSuppressed(actor, { key: DEF, label: "Cut", value: 1, reason: "not-stacking" });
  actor.applyActiveEffects("final");
  assert.deepEqual(api.changes(actor).map((c) => c.value), ["2", "3"]);
  assert.deepEqual(api.contributions(actor, DEF).map((c) => c.label), ["Derived"]);
  assert.deepEqual(api.suppressed(actor).map((c) => c.label), ["Cut"]);
  actor.queue = [change(DEF, "5"), change(DEF, "1", { phase: "final" }), change(DEF, "9", { boom: true })];
  actor._completedActiveEffectPhases.clear();
  assert.throws(() => actor.applyActiveEffects("initial"), /boom/);
  assert.deepEqual(api.changes(actor).map((c) => c.value), ["2", "3"], "the nested final did not publish a partial cycle");
  actor.during = null;
  actor.queue = [change(DEF, "4")];
  prepare(actor);
  assert.deepEqual(api.changes(actor).map((c) => c.value), ["4"]);
});

test("records the value with its data references resolved against the data the core applied it with", () => {
  const { Actor, Effect, api, prepare } = setup();
  const actor = new Actor();
  const field = { _replaceDataRefs: (raw, data) => raw.replace(/@(\w+)/g, (_, k) => String(data[k])) };
  actor.during = (phase) => {
    if (phase !== "initial") return;
    Effect.applyChangeField(actor, change(DEF, "@for + 1"), { field, replacementData: { for: 2 } });
    Effect.applyChangeField(actor, change(DEF, "@for"), {});
    const data = { for: 0 };
    Effect.applyChangeField(actor, change(DEF, "@for", { mutate: () => (data.for = 9) }), { field, replacementData: data });
  };
  prepare(actor);
  assert.deepEqual(api.changes(actor).map((c) => c.value), ["2 + 1", "@for", "0"], "resolved before the change mutates the data");
});
