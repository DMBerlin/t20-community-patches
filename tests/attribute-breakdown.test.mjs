import { test } from "node:test";
import assert from "node:assert/strict";
import patch, { attributeBreakdown, attributeTarget, breakdownHTML, diagnoseTemplate, recordChange } from "../scripts/patches/attribute-breakdown.mjs";

const entry = (phase, target, label, delta, type = "add") => ({ phase, target, label, delta, type });
const rows = ({ lines }) => lines.map((l) => [l.key ?? l.label, l.value]);

test("attributeTarget: concrete value and bonus keys only", () => {
  assert.deepEqual(attributeTarget("system.atributos.car.bonus"), { attribute: "car", target: "bonus" });
  assert.deepEqual(attributeTarget("system.atributos.for.value"), { attribute: "for", target: "value" });
  for (const key of ["system.atributos.*.bonus", "system.atributos.car.base", "system.modificadores.atributos.car", undefined]) {
    assert.equal(attributeTarget(key), null, String(key));
  }
});

test("recordChange: keeps what the core actually applied, skips no-ops and non-numbers", () => {
  const log = { entries: {} };
  assert.equal(recordChange(log, { key: "system.atributos.car.bonus", phase: "initial", label: "Coroa", type: "add", before: 0, after: 2 }), true);
  // Clamped by the field (min -5): -4 + (-3) is stored as -5, a -1 contribution.
  recordChange(log, { key: "system.atributos.car.value", phase: "initial", label: "Penalidade", type: "add", before: -4, after: -5 });
  assert.equal(recordChange(log, { key: "system.atributos.car.bonus", phase: "initial", label: "Vazio", type: "add", before: 2, after: 2 }), false);
  assert.equal(recordChange(log, { key: "system.atributos.car.bonus", phase: "initial", label: "X", before: undefined, after: 2 }), false);
  assert.equal(recordChange(log, { key: "system.atributos.*.bonus", phase: "initial", label: "X", before: 0, after: 1 }), false);
  assert.deepEqual(log.entries.car.map((e) => [e.label, e.target, e.delta]), [["Coroa", "bonus", 2], ["Penalidade", "value", -1]]);
});

test("attributeBreakdown: Carisma 3 + Coroa Majestosa = 5", () => {
  const b = attributeBreakdown({ prepared: { base: 3, racial: 0, value: 5 }, start: { base: 3, racial: 0, bonus: 0 }, entries: [entry("initial", "bonus", "Coroa Majestosa", 2)] });
  assert.deepEqual(rows(b), [["Base", 3], ["Coroa Majestosa", 2]]);
  assert.equal(b.total, 5);
});

test("attributeBreakdown: order is value effects, manual bonus, bonus effects, final value effects; Outros closes the gap", () => {
  const b = attributeBreakdown({
    prepared: { base: 9, racial: 9, value: 18 },
    start: { base: 2, racial: 1, bonus: 1 },
    entries: [
      entry("initial", "bonus", "Físico Divino", 2),
      entry("initial", "value", "Aumento de Atributo", 1),
      entry("final", "bonus", "Tarde demais", 4),
      entry("final", "value", "Dobro", 7, "multiply")
    ]
  });
  // 2 + 1 + 1 + 1 + 2 = 7, final multiply x2 adds 7 → 14; the 4 left are other sources.
  assert.deepEqual(rows(b), [["Base", 2], ["Racial", 1], ["Aumento de Atributo", 1], ["Temporary", 1], ["Físico Divino", 2], ["Dobro", 7], ["Other", 4]]);
  assert.equal(b.lines.reduce((s, l) => s + l.value, 0), b.total);
});

test("attributeBreakdown: without a log, prepared base/racial and the persisted bonus are used and Outros closes", () => {
  const b = attributeBreakdown({ prepared: { base: 3, racial: 1, value: 7 }, sourceBonus: 1 });
  assert.deepEqual(rows(b), [["Base", 3], ["Racial", 1], ["Temporary", 1], ["Other", 2]]);
});

test("breakdownHTML: system markup, escaped labels, type marks and signed values", () => {
  const html = breakdownHTML(
    { lines: [{ key: "Base", value: 3 }, { label: "<b>Coroa</b>", value: 2, type: "add" }, { label: "Aparência", value: -1, type: "override" }], total: 4 },
    (k) => ({ Base: "Base", Total: "Total", "Type.override": "substitui" })[k]
  );
  assert.equal(
    html,
    '<ul class="fieldBonuses"><li class="flexrow"><label>Base:</label><span>+3</span></li><li class="flexrow"><label>&lt;b&gt;Coroa&lt;/b&gt;:</label><span>+2</span></li><li class="flexrow"><label>Aparência (substitui):</label><span>-1</span></li><hr><li class="flexrow"><label>Total:</label><span>+4</span></li></ul>'
  );
});

test("diagnoseTemplate: 1.6.5 is present/high; a live tooltip is fixed/low; unrelated is undefined", () => {
  const v165 = `<span class="rollable atributo-rollable">
			{{#if wip}}data-tooltip="{{fieldBonuses (concat 'system.atributos.' key '.value')}}" data-tooltip-direction="LEFT"{{/if}}
			<div class="atributo-value">{{numberFormat atr.value decimals=0 sign=true}}</div>`;
  assert.deepEqual([diagnoseTemplate(v165).bug, diagnoseTemplate(v165).confidence], ["present", "high"]);
  const fixed = `<span class="rollable" data-tooltip="{{fieldBonuses 'x'}}"><div class="atributo-value"></div></span>`;
  assert.deepEqual([diagnoseTemplate(fixed).bug, diagnoseTemplate(fixed).confidence], ["fixed", "low"]);
  assert.equal(diagnoseTemplate(`<div class="atributo-value"></div>`).bug, "present");
  assert.equal(diagnoseTemplate("<div></div>"), undefined);
  assert.equal(diagnoseTemplate(undefined), undefined);
});

function harness() {
  const hooks = [];
  const getProperty = (o, k) => k.split(".").reduce((x, p) => x?.[p], o);
  const setProperty = (o, k, v) => {
    const parts = k.split(".");
    const last = parts.pop();
    parts.reduce((x, p) => x[p], o)[last] = v;
  };
  // Core stand-ins: applyChangeField resolves and cleans (value min -5); applyActiveEffects applies the phase's changes.
  class Effect {
    static applyChangeField(doc, change, { modifyTarget = true } = {}) {
      const current = getProperty(doc, change.key);
      const delta = typeof change.value === "function" ? change.value(doc) : change.value;
      let next = change.type === "multiply" ? current * delta : change.type === "override" ? delta : current + delta;
      if (change.key.endsWith(".value")) next = Math.max(-5, next);
      if (modifyTarget) setProperty(doc, change.key, next);
      return next;
    }
  }
  class Actor {
    applyActiveEffects(phase) {
      for (const change of this.changes.filter((c) => (c.phase ?? "initial") === phase && c.applies !== false)) {
        Effect.applyChangeField(this, change, {});
      }
    }
    prepare() {
      for (const a of Object.values(this.system.atributos)) {
        a.value = a.base + a.racial;
        a.bonus = this.manual[a.key] ?? 0;
      }
      this.applyActiveEffects("initial");
      for (const a of Object.values(this.system.atributos)) a.value += a.bonus;
      this.applyActiveEffects("final");
    }
  }
  globalThis.Hooks = { on: (name, fn) => hooks.push([name, fn]) };
  globalThis.game = { i18n: { localize: (k) => k.split(".").pop() } };
  globalThis.CONFIG = { ActiveEffect: { documentClass: Effect }, Actor: { documentClass: Actor } };
  globalThis.foundry = { utils: { getProperty } };
  patch.apply();
  const actor = (atributos, changes, manual = {}) => {
    const a = new Actor();
    a.uuid = "Actor.x";
    a.system = { atributos: Object.fromEntries(Object.entries(atributos).map(([k, [base, racial = 0]]) => [k, { key: k, base, racial }])) };
    a.changes = changes.map((c) => ({ ...c, effect: { name: c.name } }));
    a.manual = manual;
    a._source = { system: { atributos: {} } };
    a.prepare();
    return a;
  };
  const span = (dataset = {}) => ({ dataset });
  const element = (key, dataset) => {
    const target = span(dataset);
    const value = { closest: () => target };
    return { li: { dataset: { itemId: key }, querySelector: () => value }, target };
  };
  const render = (a, ...els) => hooks[0][1]({ actor: a }, [{ querySelectorAll: () => els.map((e) => e.li) }]);
  return { hooks, Effect, actor, element, render };
}

const tip = (el) => [...el.target.dataset.tooltipHtml.matchAll(/<label>(.*?):<\/label><span>(.*?)<\/span>/g)].map((m) => `${m[1]} ${m[2]}`);

test("integration: records what the core applied, per phase, resolved and clamped; skipped changes never show", () => {
  const { hooks, actor, element, render } = harness();
  try {
    assert.equal(hooks[0][0], "renderActorSheet");
    const a = actor({ car: [3], for: [-4], des: [3] }, [
      { name: "Coroa Majestosa", key: "system.atributos.car.bonus", type: "add", value: 2 },
      // "@car" resolved by the core with the data of that moment (3), not the final value.
      { name: "Eco", key: "system.atributos.car.bonus", type: "add", value: (doc) => doc.system.atributos.car.value },
      { name: "Aura sem alvo próprio", key: "system.atributos.car.bonus", type: "add", value: 9, applies: false },
      { name: "Penalidade", key: "system.atributos.for.value", type: "add", value: -3 },
      { name: "Dobro", key: "system.atributos.des.value", type: "multiply", value: 2, phase: "final" }
    ], { des: 2 });
    assert.equal(a.system.atributos.car.value, 8);
    const car = element("car");
    const str = element("for");
    const des = element("des");
    const kept = element("car", { tooltip: "system" });
    render(a, car, str, des, kept);
    assert.deepEqual(tip(car), ["Base +3", "Coroa Majestosa +2", "Eco +3", "Total +8"]);
    assert.deepEqual(tip(str), ["Base -4", "Penalidade -1", "Total -5"]);
    assert.deepEqual(tip(des), ["Base +3", "Temporary +2", "Dobro (multiply) +5", "Total +10"]);
    assert.equal(car.target.dataset.tooltipDirection, "LEFT");
    assert.equal(kept.target.dataset.tooltipHtml, undefined);

    // A new preparation cycle starts a new log.
    a.changes = [];
    a.prepare();
    const again = element("car");
    render(a, again);
    assert.deepEqual(tip(again), ["Base +3", "Total +3"]);
  } finally {
    delete globalThis.Hooks;
    delete globalThis.game;
    delete globalThis.CONFIG;
    delete globalThis.foundry;
  }
});

test("integration: wrappers keep return values and modifyTarget; errors never break the sheet", () => {
  const { Effect, actor, element, render } = harness();
  try {
    const a = actor({ car: [3] }, []);
    const r = Effect.applyChangeField(a, { key: "system.atributos.car.value", type: "add", value: 1 }, { modifyTarget: false });
    assert.equal(r, 4);
    assert.equal(a.system.atributos.car.value, 3);
    const broken = element("car");
    const warn = console.warn;
    console.warn = () => {};
    try {
      render({ ...a, system: { atributos: { car: { get value() { throw new Error("x"); } } } } }, broken);
    } finally {
      console.warn = warn;
    }
    assert.equal(broken.target.dataset.tooltipHtml, undefined);
  } finally {
    delete globalThis.Hooks;
    delete globalThis.game;
    delete globalThis.CONFIG;
    delete globalThis.foundry;
  }
});
