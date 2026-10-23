import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  dropEngeArmorPenalty,
  engePdaHolders,
  keepStoredEngePda,
  prepareSkillOwners,
  prepareSkillRecognized,
  wrapPrepareSkill
} from "../scripts/patches/engenhoqueiro-armor-penalty.mjs";
import { CreatureData165 } from "./fixtures/non-proficiency-1.6.5.mjs";
import { markWrapper } from "../scripts/utils.mjs";

const ORIGINAL = CreatureData165.prototype.prepareSkill;

/** Runs the verbatim 1.6.5 prepareSkill (wrapped or not) and returns the formula it built. */
function withSystem(fn) {
  let formula;
  globalThis.foundry = {
    utils: {
      deepClone: (v) => structuredClone(v),
      getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj)
    }
  };
  globalThis.CONFIG = {
    T20: { pericias: { enge: { armorPenalty: true }, acro: { armorPenalty: true } }, resistencias: { fort: {} } }
  };
  globalThis.simplifyRollFormula = (f) => {
    formula = f;
    return "0";
  };
  try {
    fn();
    return formula;
  } finally {
    for (const key of ["foundry", "CONFIG", "simplifyRollFormula"]) delete globalThis[key];
  }
}

const skill = (extra = {}) => ({ atributo: "int", treinado: true, bonus: [], pda: true, outros: 0, condi: 0, ...extra });
const ROLL = { pda: -5, int: 3 };

test("dropEngeArmorPenalty: only Engenhoqueiro with pda on", () => {
  const enge = { pda: true, condi: "-2" };
  assert.equal(dropEngeArmorPenalty("enge", enge), true);
  assert.deepEqual(enge, { pda: false, condi: "-2" });
  const acro = { pda: true };
  assert.equal(dropEngeArmorPenalty("acro", acro), false);
  assert.equal(acro.pda, true);
  assert.equal(dropEngeArmorPenalty("enge", { pda: false }), false);
  assert.equal(dropEngeArmorPenalty("enge", undefined), false);
});

test("wrapped 1.6.5 prepareSkill: Engenhoqueiro loses @pda, keeps condi", () => {
  const wrapped = wrapPrepareSkill(ORIGINAL);
  const self = { pericias: {} };
  const skillData = skill({ condi: "-2" });
  assert.match(withSystem(() => ORIGINAL.call(self, "enge", { skillData: skill(), rollData: ROLL })), /@pda/);
  const formula = withSystem(() => wrapped.call(self, "enge", { skillData, rollData: ROLL }));
  assert.equal(formula, "@meionivel+@int+@treino+-2");
  assert.equal(skillData.pda, false);
});

test("wrapped 1.6.5 prepareSkill: without skillData the clone of this.pericias.enge has no @pda", () => {
  const wrapped = wrapPrepareSkill(ORIGINAL);
  const self = { pericias: { enge: skill() } };
  const formula = withSystem(() => wrapped.call(self, "enge", { rollData: ROLL }));
  assert.doesNotMatch(formula, /@pda/);
});

test("wrapped 1.6.5 prepareSkill: other skills keep the armor penalty", () => {
  const wrapped = wrapPrepareSkill(ORIGINAL);
  const skillData = skill({ atributo: "des", treinado: false });
  const formula = withSystem(() => wrapped.call({ pericias: {} }, "acro", { skillData, rollData: ROLL }));
  assert.equal(formula, "@meionivel+@des+@pda");
  assert.equal(skillData.pda, true);
});

test("wrapPrepareSkill preserves this, arguments, return value and errors", () => {
  const calls = [];
  const original = function (...args) {
    calls.push([this, args]);
    return "result";
  };
  const self = { pericias: {} };
  const options = { skillData: { pda: true } };
  assert.equal(wrapPrepareSkill(original).call(self, "enge", options, "extra"), "result");
  assert.equal(calls[0][0], self);
  assert.deepEqual(calls[0][1], ["enge", options, "extra"]);
  const thrower = wrapPrepareSkill(() => {
    throw new Error("boom");
  });
  assert.throws(() => thrower.call(self, "acro", {}), /boom/);
});

test("wrapPrepareSkill: a failure in the correction still runs the original", () => {
  const skillData = Object.freeze({ pda: true });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(wrapPrepareSkill(() => "ok").call({}, "enge", { skillData }), "ok");
  } finally {
    console.warn = warn;
  }
});

test("prepareSkillOwners: one prototype per definition", () => {
  class Base {
    prepareSkill() {}
  }
  class A extends Base {}
  class B extends Base {}
  class C {}
  assert.deepEqual(prepareSkillOwners({ a: A, b: B, c: C }), [Base.prototype]);
  assert.deepEqual(prepareSkillOwners(undefined), []);
});

test("prepareSkillRecognized: 1.6.5 code only", () => {
  const source = ORIGINAL.toString();
  assert.equal(prepareSkillRecognized(source), true);
  assert.equal(prepareSkillRecognized(source.replace('"@pda"', '"@armadura"')), false);
  assert.equal(prepareSkillRecognized(source.replace(/if \(skillData\.pda && rollData\.pda\)/, "if (false)")), false);
  const commented = `function f() { /* ${source.replace(/\*\//g, "")} */ }`;
  assert.equal(prepareSkillRecognized(commented), false);
  assert.equal(prepareSkillRecognized(undefined), false);
});

function withConfig(config, fn) {
  globalThis.CONFIG = config;
  try {
    return fn();
  } finally {
    delete globalThis.CONFIG;
  }
}

test("isNeeded: present/high with the 1.6.5 code and armorPenalty on", () => {
  const dataModels = { character: CreatureData165 };
  const diagnosis = withConfig({ T20: { pericias: { enge: { armorPenalty: true } } }, Actor: { dataModels } }, () =>
    patch.isNeeded()
  );
  assert.deepEqual([diagnosis.bug, diagnosis.confidence], ["present", "high"]);
});

test("isNeeded: recognizes the original behind another module's marked wrapper", () => {
  class Wrapped {}
  Wrapped.prototype.prepareSkill = markWrapper(function () {}, ORIGINAL);
  const diagnosis = withConfig(
    { T20: { pericias: { enge: { armorPenalty: true } } }, Actor: { dataModels: { character: Wrapped } } },
    () => patch.isNeeded()
  );
  assert.equal(diagnosis.bug, "present");
});

test("isNeeded: fixed/low when CONFIG no longer sets the penalty", () => {
  const diagnosis = withConfig(
    { T20: { pericias: { enge: { armorPenalty: false } } }, Actor: { dataModels: { character: CreatureData165 } } },
    () => patch.isNeeded()
  );
  assert.deepEqual([diagnosis.bug, diagnosis.confidence], ["fixed", "low"]);
});

test("isNeeded: unknown without the skill or with unrecognized code", () => {
  class Changed {
    prepareSkill() {
      return "new code";
    }
  }
  assert.equal(withConfig({ T20: { pericias: {} } }, () => patch.isNeeded()).bug, "unknown");
  const changed = withConfig(
    { T20: { pericias: { enge: { armorPenalty: true } } }, Actor: { dataModels: { character: CreatureData165, x: Changed } } },
    () => patch.isNeeded()
  );
  assert.deepEqual([changed.bug, changed.confidence], ["unknown", "low"]);
  assert.equal(withConfig({ T20: { pericias: { enge: { armorPenalty: true } } }, Actor: {} }, () => patch.isNeeded()).bug, "unknown");
});

test("keepStoredEngePda: puts the stored pda back in nested, dotted and replacement keys", () => {
  const nested = { system: { pericias: { enge: { pda: false, label: "x" }, acro: { pda: false } } } };
  assert.equal(keepStoredEngePda(nested, true), true);
  assert.equal(nested.system.pericias.enge.pda, true);
  assert.equal(nested.system.pericias.acro.pda, false);
  const dotted = { "system.pericias.enge.pda": false };
  keepStoredEngePda(dotted, true);
  assert.equal(dotted["system.pericias.enge.pda"], true);
  const mixed = { system: { "pericias.enge": { pda: false } } };
  keepStoredEngePda(mixed, true);
  assert.equal(mixed.system["pericias.enge"].pda, true);
  const replaced = { system: { "==pericias": { enge: { pda: false } } } };
  keepStoredEngePda(replaced, true);
  assert.equal(replaced.system["==pericias"].enge.pda, true);
});

/** Mirrors foundry.data.operators (core common/data/operators.mjs): get/set through a symbol, proxied create. */
const VALUE = Symbol("value");
class Operator {
  constructor(value) {
    this[VALUE] = value;
  }
  static get(value) {
    return value instanceof Operator ? value[VALUE] : value;
  }
  static set(operator, value) {
    return (operator[VALUE] = value);
  }
}
class Replacement extends Operator {
  static create(value) {
    const target = new Replacement(value);
    return new Proxy(target, {
      get: (t, prop, receiver) => (Reflect.has(t, prop) ? Reflect.get(t, prop, receiver) : t[VALUE]?.[prop]),
      ownKeys: (t) => (t[VALUE] && typeof t[VALUE] === "object" ? Reflect.ownKeys(t[VALUE]) : []),
      getOwnPropertyDescriptor: (t, prop) => Reflect.getOwnPropertyDescriptor(t[VALUE], prop)
    });
  }
}

test("keepStoredEngePda: ForcedReplacement after cleaning, on pda or on an ancestor", () => {
  const onPda = { system: { pericias: { enge: { pda: new Replacement(false) } } } };
  assert.equal(keepStoredEngePda(onPda, true, Operator), true);
  assert.equal(Operator.get(onPda.system.pericias.enge.pda), true);
  assert.ok(onPda.system.pericias.enge.pda instanceof Replacement);

  const onEnge = { system: { pericias: { enge: new Replacement({ pda: false, treinado: true }) } } };
  keepStoredEngePda(onEnge, true, Operator);
  assert.deepEqual(Operator.get(onEnge.system.pericias.enge), { pda: true, treinado: true });

  const proxied = { system: { pericias: Replacement.create({ enge: { pda: false } }) } };
  keepStoredEngePda(proxied, true, Operator);
  assert.equal(Operator.get(proxied.system.pericias).enge.pda, true);

  const kept = { system: { pericias: { enge: { pda: new Replacement(true) } } } };
  assert.equal(keepStoredEngePda(kept, true, Operator), false);
});

test("keepStoredEngePda: leaves other updates alone", () => {
  const stored = { system: { pericias: { enge: { pda: false } } } };
  assert.equal(keepStoredEngePda(stored, false), false);
  assert.equal(stored.system.pericias.enge.pda, false);
  const other = { system: { pericias: { enge: { treinado: true }, engenho: { pda: false } } } };
  assert.equal(keepStoredEngePda(other, true), false);
  assert.deepEqual(other, { system: { pericias: { enge: { treinado: true }, engenho: { pda: false } } } });
  assert.deepEqual(engePdaHolders(null), []);
  assert.deepEqual(engePdaHolders({ "system.pericias.enge": null }), []);
});

test("custom Ofício creation: prepared skills written back keep the stored pda", () => {
  // T20:13950-13974 clones the actor (the same prepared pericias) and sends every skill to actor.update.
  const wrapped = wrapPrepareSkill(ORIGINAL);
  const self = { pericias: { enge: skill(), acro: skill({ atributo: "des" }) } };
  withSystem(() => wrapped.call(self, "enge", { skillData: self.pericias.enge, rollData: ROLL }));
  assert.equal(self.pericias.enge.pda, false);
  const changes = { system: { pericias: { ...self.pericias, ofi1: { label: "Ofício (Ferreiro)" } } } };
  keepStoredEngePda(changes, true);
  assert.equal(changes.system.pericias.enge.pda, true);
  assert.equal(changes.system.pericias.acro.pda, true);
});

function withHooks(fn) {
  const hooks = [];
  globalThis.Hooks = { on: (name, hook) => hooks.push([name, hook]) };
  const warn = console.warn;
  console.warn = () => {};
  try {
    fn();
    return hooks;
  } finally {
    console.warn = warn;
    delete globalThis.Hooks;
  }
}

test("apply: wraps recognized prepareSkill only and guards actor and delta updates", () => {
  class Recognized {}
  Recognized.prototype.prepareSkill = ORIGINAL;
  class Changed {
    prepareSkill() {}
  }
  const changedFn = Changed.prototype.prepareSkill;
  const hooks = withHooks(() => withConfig({ Actor: { dataModels: { a: Recognized, b: Changed } } }, () => patch.apply()));
  assert.notEqual(Recognized.prototype.prepareSkill, ORIGINAL);
  assert.equal(Changed.prototype.prepareSkill, changedFn);
  assert.deepEqual(hooks.map(([name]) => name), ["preUpdateActor", "preUpdateActorDelta"]);

  const [, onActor] = hooks[0];
  const actorChanges = { system: { pericias: { enge: { pda: false } } } };
  onActor({ _source: { system: { pericias: { enge: { pda: true } } } } }, actorChanges);
  assert.equal(actorChanges.system.pericias.enge.pda, true);
  const [, onDelta] = hooks[1];
  const deltaChanges = { "system.pericias.enge.pda": false };
  onDelta({ _source: { system: null }, syntheticActor: { _source: { system: { pericias: { enge: { pda: true } } } } } }, deltaChanges);
  assert.equal(deltaChanges["system.pericias.enge.pda"], true);
});

test("apply: nothing is installed when prepareSkill is not recognized", () => {
  class Changed {
    prepareSkill() {}
  }
  const hooks = withHooks(() => withConfig({ Actor: { dataModels: { b: Changed } } }, () => patch.apply()));
  assert.deepEqual(hooks, []);
});
