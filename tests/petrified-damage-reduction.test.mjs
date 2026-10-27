import { test } from "node:test";
import assert from "node:assert/strict";
import petrified, {
  RD_BONUS_KEY,
  RD_VALUE_KEY,
  createReductionTracker,
  diagnosePetrifiedData,
  findWithRetry,
  isPetrifiedContribution,
  isPetrifiedReductionChange,
  normalizePetrifiedChange,
  petrifiedLookup,
  planPetrifiedReduction
} from "../scripts/patches/petrified-damage-reduction.mjs";
import { installSourceStackingRule } from "../scripts/rules/source-stacking.mjs";

const A = (value = 8) => ({ key: RD_VALUE_KEY, type: "downgrade", value, phase: "initial" });
/** Legacy form stored on actors: the system's migrateResistancesPath moves the key to .bonus and keeps downgrade. */
const B = (value = 8) => ({ key: RD_BONUS_KEY, type: "downgrade", value, phase: "initial" });
const N = (value = 8, phase = "initial") => ({ key: RD_BONUS_KEY, type: "add", value: String(value), phase });
const petri = (changes, { active = true, statuses = ["petrificado"] } = {}) => ({
  active,
  statuses: new Set(statuses),
  system: { changes }
});

test("isPetrifiedReductionChange: only the legacy initial-phase downgrade/upgrade on dano.value", () => {
  assert.equal(isPetrifiedReductionChange(A()), true);
  assert.equal(isPetrifiedReductionChange({ ...A(), type: "upgrade" }), true);
  assert.equal(isPetrifiedReductionChange(B()), true, "migrated copy on an actor");
  assert.equal(isPetrifiedReductionChange({ ...B(), type: "upgrade" }), true);
  assert.equal(isPetrifiedReductionChange({ key: RD_VALUE_KEY, type: "downgrade", value: 8 }), true, "no phase = initial");
  for (const c of [{ ...A(), phase: "final" }, { ...A(), type: "add" }, { ...A(), type: "override" }, N(), { ...A(), key: "system.tracos.resistencias.fogo.value" }, null]) {
    assert.equal(isPetrifiedReductionChange(c), false, JSON.stringify(c));
  }
});

test("isPetrifiedContribution: the condition's own reduction only", () => {
  assert.equal(isPetrifiedContribution(petri([]), A()), true);
  assert.equal(isPetrifiedContribution(petri([]), N()), true);
  assert.equal(isPetrifiedContribution(petri([]), N(2)), false, "independent bonus");
  assert.equal(isPetrifiedContribution(petri([], { statuses: [] }), N()), false);
  assert.equal(isPetrifiedContribution(petri([]), { key: "system.attributes.defesa.bonus", type: "add", value: "8" }), false);
});

test("planPetrifiedReduction: one contribution per actor, the greatest, native on ties", () => {
  let effects = [petri([A()])];
  let plan = planPetrifiedReduction(effects);
  assert.equal(plan.convert.effect, effects[0]);
  assert.equal(plan.convert.value, 8);
  assert.equal(plan.neutralized.size, 0);

  effects = [petri([A()]), petri([A()])];
  assert.equal(planPetrifiedReduction(effects).convert.effect, effects[0]);
  effects = [petri([A(8)]), petri([A(10)])];
  assert.equal(planPetrifiedReduction(effects).convert.effect, effects[1]);

  effects = [petri([N()]), petri([N()])];
  plan = planPetrifiedReduction(effects);
  assert.equal(plan.convert, null);
  assert.deepEqual([...plan.neutralized], [effects[1].system.changes[0]]);

  for (const order of [[0, 1, 2], [1, 2, 0], [1, 0, 2]]) {
    const all = [petri([A(10)]), petri([N()]), petri([N()])];
    const ordered = order.map((i) => all[i]);
    plan = planPetrifiedReduction(ordered);
    assert.equal(plan.convert.effect, all[0], `order ${order}`);
    assert.equal(plan.neutralized.size, 2);
  }

  for (const ordered of [[petri([A()]), petri([N()])], [petri([N()]), petri([A()])]]) {
    plan = planPetrifiedReduction(ordered);
    assert.equal(plan.convert, null, "native wins ties");
    assert.equal(plan.neutralized.size, 0);
  }

  const second = petri([N()]);
  plan = planPetrifiedReduction([petri([A(10)], { active: false }), petri([N()]), second]);
  assert.equal(plan.convert, null);
  assert.deepEqual([...plan.neutralized], [second.system.changes[0]]);
  assert.equal(planPetrifiedReduction([]), null);

  assert.equal(planPetrifiedReduction([petri([A(), N()])]).convert, null, "same effect: native wins");

  const bonus = N(2);
  plan = planPetrifiedReduction([petri([A(), bonus])]);
  assert.equal(plan.convert.value, 8);
  assert.equal(plan.neutralized.has(bonus), false);
  assert.equal(planPetrifiedReduction([petri([A(), N(8, "final")])]).convert.value, 8, "final phase does not compete");

  const native = N();
  const effect = petri([A(), native]);
  plan = planPetrifiedReduction([effect], (e, c) => c !== native);
  assert.equal(plan.convert.effect, effect, "a native rejected by canApply does not compete");

  assert.equal(planPetrifiedReduction([petri([A()], { statuses: ["caido"] })]), null);
  assert.equal(planPetrifiedReduction([petri([A("abc")])]), null);
  assert.equal(planPetrifiedReduction([petri([A(0)])]), null);
});

test("normalizePetrifiedChange: converts the winning copy once; queries do not consume", () => {
  const effect = petri([A(10)]);
  const plan = planPetrifiedReduction([effect]);
  const copy = { ...A(10), effect, priority: 20 };
  assert.deepEqual(normalizePetrifiedChange(copy, plan, { consume: false }), { ...copy, key: RD_BONUS_KEY, type: "add", value: "10" });
  assert.equal(plan.counted, false);
  assert.deepEqual(normalizePetrifiedChange(copy, plan), { ...copy, key: RD_BONUS_KEY, type: "add", value: "10" });
  assert.equal(plan.counted, true);
  assert.equal(normalizePetrifiedChange(copy, plan), null, "counted once");

  const fresh = planPetrifiedReduction([effect]);
  assert.equal(normalizePetrifiedChange({ ...A(10), effect: petri([A(10)]) }, fresh), null, "another copy");
  assert.equal(normalizePetrifiedChange({ ...A(8), effect }, fresh), null, "another value");
  assert.equal(normalizePetrifiedChange({ ...A(10), effect }, planPetrifiedReduction([petri([N()])])), null);
  assert.equal(normalizePetrifiedChange({ ...A(10), effect }, undefined), null);
});

test("createReductionTracker: isolated per actor and per cycle", () => {
  const tracker = createReductionTracker();
  const actorA = {};
  const actorB = {};
  const a = petri([A()]);
  const n1 = petri([N()]);
  const n2 = petri([N(), N(2)]);
  const b = petri([A()]);
  tracker.begin(actorA, [a, n1, n2]);
  tracker.begin(actorB, [b]);
  assert.equal(tracker.neutralizes(actorA, n2.system.changes[0]), true);
  assert.equal(tracker.neutralizes(actorA, n1.system.changes[0]), false, "native winner");
  assert.equal(tracker.neutralizes(actorA, n2.system.changes[1]), false, "independent bonus");
  assert.equal(tracker.neutralizes(actorB, n2.system.changes[0]), false);
  assert.equal(tracker.normalize(actorA, { ...A(), effect: b }), null);
  assert.ok(tracker.normalize(actorB, { ...A(), effect: b }));
  tracker.end(actorA);
  assert.equal(tracker.neutralizes(actorA, n2.system.changes[0]), false);
  const big = petri([A(10)]);
  tracker.begin(actorA, [big, n1]);
  assert.equal(tracker.neutralizes(actorA, n1.system.changes[0]), true);
  tracker.begin(actorA, [n1]);
  assert.equal(tracker.neutralizes(actorA, n1.system.changes[0]), false, "winner removed: next one wins");
});

test("diagnosePetrifiedData: reads the source data, never high confidence", () => {
  const d = (changes) => diagnosePetrifiedData(changes) && [diagnosePetrifiedData(changes).bug, diagnosePetrifiedData(changes).confidence];
  assert.deepEqual(d([A()]), ["present", "low"]);
  assert.deepEqual(d([B()]), ["present", "low"]);
  assert.deepEqual(d([A(), N()]), ["fixed", "low"]);
  assert.deepEqual(d([A(), N(2)]), ["present", "low"]);
  assert.deepEqual(d([A(), N(8, "final")]), ["present", "low"]);
  assert.deepEqual(d([N()]), ["fixed", "low"]);
  assert.deepEqual(d([{ ...A(), type: "add" }]), ["unknown", "low"]);
  assert.deepEqual(d([]), ["unknown", "low"]);
  assert.equal(diagnosePetrifiedData(undefined), undefined);
});

test("petrifiedLookup + findWithRetry: CONFIG uuid first, then the pack; retries while it is built", async () => {
  const real = { _id: "mbHvFIUVQDmDM6V1", statuses: new Set(["petrificado"]) };
  const sleep = async () => {};
  let packReads = 0;
  const lookup = (uuid, docs, byUuid = {}) =>
    petrifiedLookup({ statusUuid: () => uuid, fromUuid: async (u) => byUuid[u] ?? null, packDocuments: async () => (packReads++, docs()) });

  assert.equal(await findWithRetry(lookup(undefined, () => [real]), { sleep }), real);
  assert.equal(await findWithRetry(lookup("Compendium.world.statuses.ActiveEffect.PETRIFICADO00000", () => [real]), { sleep }), real);
  packReads = 0;
  const other = { statuses: new Set(["petrificado"]) };
  assert.equal(await findWithRetry(lookup("u", () => [real], { u: other }), { sleep }), other);
  assert.equal(packReads, 0, "the pack is not read");
  assert.equal(await findWithRetry(lookup("u", () => [real], { u: { statuses: new Set() } }), { sleep }), real);

  let calls = 0;
  let waits = 0;
  const late = lookup(undefined, () => (++calls < 3 ? [] : [real]));
  assert.equal(await findWithRetry(late, { sleep: async () => waits++ }), real);
  assert.equal(waits, 2);
  assert.equal(await findWithRetry(lookup(undefined, () => undefined), { attempts: 4, sleep }), null);
});

/* -------------------------------------------- */
/*  Foundry integration (mocks)                 */
/* -------------------------------------------- */

const MODULE = "t20-community-patches";
const spellFlag = { [MODULE]: { source: "magia" } };

/**
 * Mirrors core v14: Actor#applyActiveEffects filters with shouldApplyChange on the stored change, then hands a deep
 * clone (with copy.effect) to CONFIG.ActiveEffect.documentClass.applyChange; prepareDamageResistances then sets
 * dano.value = base + bonus. Patch and rule are installed in the given order.
 */
function setupFoundry(order) {
  const settings = { rule: "on" };
  class NumberField {}
  class ArrayField {}
  const getProperty = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);

  class ActiveEffect {
    constructor(data, parent) {
      Object.assign(this, { disabled: false, transfer: false, flags: {}, origin: null, ...data });
      this.parent = parent;
      this.statuses = new Set(data.statuses ?? []);
      this.system = { changes: (data.changes ?? []).map((c) => ({ type: "add", phase: "initial", priority: 20, ...c })) };
      this._stats = { createdTime: data.time ?? 0 };
    }
    get uuid() {
      return `${this.parent.uuid}.ActiveEffect.${this.id}`;
    }
    get active() {
      if (this.disabled) return false;
      return this.parent.documentName === "Item" ? !!this.parent.system.equipado : true;
    }
    getReplacementData(data) {
      return data;
    }
    shouldApplyChange(change, options) {
      return change.phase === options?.phase;
    }
    static applyChange(targetDoc, change) {
      const rd = targetDoc.system.tracos.resistencias.dano;
      if (change.key === RD_BONUS_KEY && change.type === "add") rd.bonus = rd.bonus.concat(String(change.value));
      else if (change.key === RD_VALUE_KEY && change.type === "downgrade") rd.value = Math.min(rd.value, Number(change.value));
      else if (change.key === RD_VALUE_KEY && change.type === "upgrade") rd.value = Math.max(rd.value, Number(change.value));
    }
  }

  class Actor {
    constructor(name) {
      Object.assign(this, { documentName: "Actor", name, id: name, uuid: `Actor.${name}`, effects: new Map(), items: new Map() });
      this.base = 0;
    }
    get itemTypes() {
      return { equipamento: [] };
    }
    getRollData() {
      return {};
    }
    *allApplicableEffects() {
      yield* this.effects.values();
      for (const item of this.items.values()) for (const effect of item.effects.values()) if (effect.transfer) yield effect;
    }
    applyActiveEffects(phase) {
      const changes = [];
      for (const effect of this.allApplicableEffects()) {
        if (!effect.active) continue;
        for (const change of effect.system.changes) {
          if (!effect.shouldApplyChange(change, { phase, replacementData: {} })) continue;
          const copy = structuredClone(change);
          copy.effect = effect;
          changes.push(copy);
        }
      }
      changes.sort((a, b) => a.priority - b.priority);
      for (const change of changes) CONFIG.ActiveEffect.documentClass.applyChange(this, change, { replacementData: {} });
    }
    prepare() {
      this.system = {
        tracos: { resistencias: { dano: { base: this.base, bonus: [], value: 0 } } },
        getFieldForProperty: (path) => (path === "tracos.resistencias.dano.bonus" ? new ArrayField() : path === "tracos.resistencias.dano.value" ? new NumberField() : undefined)
      };
      this.applyActiveEffects("initial");
      const rd = this.system.tracos.resistencias.dano;
      rd.value = [rd.base, ...rd.bonus].filter(Boolean).reduce((sum, v) => sum + Number(v), 0);
      this.applyActiveEffects("final");
      return rd.value;
    }
    addEffect(id, data) {
      const effect = new ActiveEffect({ id, time: this.effects.size, ...data }, this);
      this.effects.set(id, effect);
      return effect;
    }
    addItem(id, change) {
      const item = { documentName: "Item", id, parent: this, type: "equipamento", name: id, _stats: { createdTime: 0 }, system: { equipado: true, tipo: "acessorio" }, effects: new Map() };
      item.effects.set("e", new ActiveEffect({ id: "e", transfer: true, changes: [change] }, item));
      this.items.set(id, item);
    }
  }

  class ItemT20 {
    _allApplicableOnUseEffects() {
      return [];
    }
  }

  Object.assign(globalThis, {
    CONFIG: {
      Item: { documentClass: ItemT20 },
      ActiveEffect: { documentClass: ActiveEffect },
      Actor: { documentClass: Actor, dataModels: {} },
      T20: {}
    },
    game: {
      user: { id: "u1" },
      actors: [],
      scenes: [],
      settings: { get: (scope, key) => (scope === MODULE && key === "sourceStackingRule" ? settings.rule : false), register: () => {} },
      i18n: { localize: (key) => key, format: (key) => key }
    },
    ui: { notifications: { info: () => {} } },
    Hooks: { on: () => {} },
    foundry: {
      data: { fields: { NumberField, ArrayField } },
      utils: { getProperty, escapeHTML: (s) => String(s) },
      dice: {
        Roll: {
          defaultImplementation: { replaceFormulaData: (f) => f },
          create: (formula) => ({ isDeterministic: true, evaluateSync: () => ({ total: Number(formula) }) })
        }
      }
    }
  });
  for (const step of order) (step === "patch" ? () => petrified.apply() : installSourceStackingRule)();
  return { settings, Actor };
}

const ORDERS = [["patch", "rule"], ["rule", "patch"]];
const RULE = ["on", "off"];

/** Runs fn in every installation order, with the rule on and off. */
function everyCombination(fn) {
  for (const order of ORDERS) {
    for (const rule of RULE) {
      const { settings, Actor } = setupFoundry(order);
      settings.rule = rule;
      fn(new Actor("alvo"), `${order.join(">")} rule ${rule}`, rule);
    }
  }
}

const P = { statuses: ["petrificado"] };

test("integration: one Petrificado counts once, the greatest, in every order", () => {
  const cases = [
    [[A()], 8],
    [[B()], 8],
    [[B(), B()], 8],
    [[B(), N()], 8],
    [[B(10), N(), N()], 10],
    [[N()], 8],
    [[N(), N()], 8],
    [[A(10), N(), N()], 10],
    [[N(), N(), A(10)], 10],
    [[A(), N()], 8],
    [[N(), A()], 8]
  ];
  everyCombination((actor, label) => {
    for (const [changes, expected] of cases) {
      actor.effects.clear();
      changes.forEach((c, i) => actor.addEffect(`p${i}`, { ...P, changes: [c] }));
      assert.equal(actor.prepare(), expected, `${label}: ${JSON.stringify(changes.map((c) => c.type + c.value))}`);
    }
  });
});

test("integration: independent bonuses add up; base reduction adds up; repeated preparation is stable", () => {
  everyCombination((actor, label) => {
    actor.addEffect("p", { ...P, changes: [A(), N(2)] });
    assert.equal(actor.prepare(), 10, label);
    actor.effects.clear();
    actor.addEffect("p", { ...P, changes: [A()] });
    actor.base = 2;
    assert.equal(actor.prepare(), 10, label);
    actor.base = 0;
    assert.deepEqual([actor.prepare(), actor.prepare(), actor.prepare()], [8, 8, 8], label);
    actor.effects.clear();
    assert.equal(actor.prepare(), 0, label);
  });
});

test("integration: the condition's reduction stays out of the source rule, even with a spell stamp", () => {
  everyCombination((actor, label) => {
    actor.addEffect("a", { ...P, changes: [A()] });
    actor.addEffect("n", { ...P, flags: spellFlag, changes: [N()] });
    actor.addEffect("campo", { flags: spellFlag, changes: [N(30)] });
    assert.equal(actor.prepare(), 38, label);
    actor.effects.delete("a");
    assert.equal(actor.prepare(), 38, `${label} (native only)`);
  });
});

test("integration: item bonuses still compete under the rule; Petrificado adds on top", () => {
  everyCombination((actor, label, rule) => {
    actor.addItem("i2", N(2));
    actor.addItem("i3", N(3));
    actor.addEffect("p", { ...P, changes: [A()] });
    assert.equal(actor.prepare(), rule === "on" ? 11 : 13, label);
  });
});

test("integration: disabling or removing copies re-plans on the next preparation", () => {
  everyCombination((actor, label) => {
    const big = actor.addEffect("a10", { ...P, changes: [A(10)] });
    actor.addEffect("n1", { ...P, changes: [N()] });
    actor.addEffect("n2", { ...P, changes: [N()] });
    assert.equal(actor.prepare(), 10, label);
    big.disabled = true;
    assert.equal(actor.prepare(), 8, label);
    actor.effects.delete("n1");
    assert.equal(actor.prepare(), 8, label);
    actor.effects.delete("n2");
    assert.equal(actor.prepare(), 0, label);
  });
});

test("integration: effects without the status and other phases follow the system", () => {
  everyCombination((actor, label) => {
    actor.addEffect("manual", { changes: [A()] });
    assert.equal(actor.prepare(), 0, label);
    actor.effects.clear();
    actor.addEffect("p", { ...P, changes: [{ ...A(), phase: "final" }] });
    assert.equal(actor.prepare(), 0, label);
  });
});

test("normalizePetrifiedChange: a migrated copy (.bonus downgrade) becomes add 8 on .bonus", () => {
  const effect = petri([B()]);
  const plan = planPetrifiedReduction([effect]);
  assert.equal(plan.convert.value, 8);
  assert.deepEqual(normalizePetrifiedChange({ ...B(), effect }, plan), { ...B(), effect, type: "add", value: "8" });
});
