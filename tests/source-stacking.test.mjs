import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFENSE_KEY,
  PENALTY_KEY,
  changeAmount,
  installSourceStackingRule,
  isArmorExempt,
  isStackingExcluded,
  keyLabel,
  newSuppressions,
  planSuppression,
  registerStackingExclusion,
  reportSignature,
  sourceCategory
} from "../scripts/rules/source-stacking.mjs";

const FORT = "system.pericias.fort.bonus";

test("sourceCategory: spells and items by item type, the card stamp, legacy origins; abilities stay out", () => {
  assert.equal(sourceCategory({ parent: "Item", itemType: "magia", transfer: true }), "magia");
  for (const itemType of ["equipamento", "consumivel", "arma", "tesouro"]) {
    assert.equal(sourceCategory({ parent: "Item", itemType, transfer: true }), "item", itemType);
  }
  for (const itemType of ["poder", "classe", "race", "comodo", "mobilia"]) {
    assert.equal(sourceCategory({ parent: "Item", itemType, transfer: true }), null, itemType);
  }
  assert.equal(sourceCategory({ parent: "Item", itemType: "equipamento", transfer: false }), null);
  assert.equal(sourceCategory({ parent: "Actor", flag: "item" }), "item");
  assert.equal(sourceCategory({ parent: "Actor", flag: "magia" }), "magia");
  assert.equal(sourceCategory({ parent: "Actor" }), null);
  assert.equal(sourceCategory({ parent: "Actor", flag: "poder" }), null);
  assert.equal(sourceCategory({ parent: "Actor", originItemType: "equipamento" }), "item");
  assert.equal(sourceCategory({ parent: "Actor", originItemType: "poder" }), null);
});

test("isArmorExempt: only armor and shield, only on Defense and armor penalty", () => {
  for (const tipo of ["leve", "pesada", "escudo"]) {
    assert.equal(isArmorExempt({ itemType: "equipamento", tipo, key: DEFENSE_KEY }), true, tipo);
    assert.equal(isArmorExempt({ itemType: "equipamento", tipo, key: PENALTY_KEY }), true, tipo);
  }
  assert.equal(isArmorExempt({ itemType: "equipamento", tipo: "acessorio", key: DEFENSE_KEY }), false);
  assert.equal(isArmorExempt({ itemType: "equipamento", tipo: "pesada", key: FORT }), false);
  assert.equal(isArmorExempt({ itemType: "magia", tipo: "pesada", key: DEFENSE_KEY }), false);
});

test("changeAmount: follows the target field; formulas without dice; armor penalty sign; anything else is NaN", () => {
  const resolve = (f) => (f === "5 + @circulo" ? 8 : NaN);
  assert.equal(changeAmount({ key: FORT, type: "add", value: "2" }, undefined, "array"), 2);
  assert.equal(changeAmount({ key: FORT, type: "add", value: 3 }, undefined, "number"), 3);
  assert.equal(changeAmount({ key: FORT, type: "add", value: "5 + @circulo" }, resolve, "array"), 8);
  assert.ok(Number.isNaN(changeAmount({ key: FORT, type: "add", value: "1d6" }, resolve, "array")));
  assert.ok(Number.isNaN(changeAmount({ key: FORT, type: "add", value: "abc" }, undefined, "array")));
  assert.ok(Number.isNaN(changeAmount({ key: FORT, type: "add", value: " " }, undefined, "array")));
  assert.ok(Number.isNaN(changeAmount({ key: FORT, type: "override", value: "2" }, undefined, "number")));
  assert.ok(Number.isNaN(changeAmount({ key: FORT, type: "add", value: "2" })), "unknown field");
  assert.equal(changeAmount({ key: FORT, type: "subtract", value: "2" }, undefined, "number"), -2);
  assert.ok(Number.isNaN(changeAmount({ key: FORT, type: "subtract", value: "2" }, undefined, "array")), "removes a part, adds nothing");
  assert.equal(changeAmount({ key: PENALTY_KEY, type: "add", value: "2" }, undefined, "number"), -2);
  assert.equal(changeAmount({ key: PENALTY_KEY, type: "add", value: "-2" }, undefined, "number"), -2);
  assert.ok(Number.isNaN(changeAmount({ key: PENALTY_KEY, type: "subtract", value: "2" }, undefined, "number")), "order dependent");
  assert.ok(Number.isNaN(changeAmount({ key: FORT, type: "add", value: "x" }, () => { throw new Error("bad"); }, "array")));
});

/** Entry helper: one change of one source. */
const e = (source, amount, { category = "magia", key = DEFENSE_KEY, order = [Number(source.replace(/\D/g, "")) || 0, source], exempt = false } = {}) => ({
  ref: { source, amount, key },
  source,
  name: source,
  order,
  category,
  key,
  amount,
  exempt,
  effects: [`uuid.${source}`],
  items: []
});
const losers = (plan) => [...plan.suppressed].map((ref) => `${ref.source}:${ref.amount}`).sort();

test("planSuppression: within a source only the greatest bonus applies; different sources add up", () => {
  assert.deepEqual(losers(planSuppression([e("s1", 5), e("s2", 2)])), ["s2:2"]);
  assert.deepEqual(losers(planSuppression([e("s1", 2), e("s2", 5)])), ["s1:2"]);
  assert.deepEqual(losers(planSuppression([e("s1", 1), e("i2", 1, { category: "item" })])), []);
  assert.deepEqual(losers(planSuppression([e("s1", 1), e("s2", 1, { key: FORT })])), []);
});

test("planSuppression: a source sums its changes; ties go to the first source in order", () => {
  const plan = planSuppression([e("s2", 1), e("s2", 1), e("s1", 2)]);
  assert.deepEqual(losers(plan), ["s2:1", "s2:1"]);
  assert.deepEqual(losers(planSuppression([e("s1", 1), e("s1", 1), e("s2", 2)])), ["s2:2"]);
});

test("planSuppression: bonuses and penalties compete separately", () => {
  assert.deepEqual(losers(planSuppression([e("s1", 3), e("s1", -1)])), []);
  assert.deepEqual(losers(planSuppression([e("s1", -1), e("s2", -2)])), ["s1:-1"]);
  assert.deepEqual(losers(planSuppression([e("s1", 3), e("s2", -1), e("s3", 2), e("s4", -2)])).sort(), ["s2:-1", "s3:2"]);
});

test("planSuppression: exempt, uncategorized and non-numeric entries neither lose nor win", () => {
  assert.deepEqual(losers(planSuppression([e("s1", 5, { exempt: true }), e("s2", 2)])), []);
  assert.deepEqual(losers(planSuppression([e("s1", 5, { category: null }), e("s2", 2)])), []);
  assert.deepEqual(losers(planSuppression([e("s1", NaN), e("s2", 2)])), []);
  assert.deepEqual(losers(planSuppression([e("s1", 0), e("s2", 2)])), []);
});

test("planSuppression: the report names the loser and the winner with their totals", () => {
  const { report } = planSuppression([e("s1", 5), e("s2", 2)]);
  assert.equal(report.length, 1);
  assert.equal(report[0].loser.source, "s2");
  assert.equal(report[0].loser.total, 2);
  assert.equal(report[0].winner.source, "s1");
  assert.equal(report[0].winner.total, 5);
  assert.deepEqual(report[0].loser.effects, ["uuid.s2"]);
});

test("newSuppressions: only unseen suppressions that involve the changed document", () => {
  const { report } = planSuppression([e("s1", 5), e("s2", 2), e("s3", 1, { key: FORT }), e("s4", 3, { key: FORT })]);
  assert.deepEqual(newSuppressions(report, new Set(), { effect: "uuid.s2" }).map((r) => r.loser.source), ["s2"]);
  assert.deepEqual(newSuppressions(report, new Set(), { effect: "uuid.s1" }).map((r) => r.loser.source), ["s2"]);
  assert.deepEqual(newSuppressions(report, new Set(report.map(reportSignature)), { effect: "uuid.s2" }), []);
  assert.deepEqual(newSuppressions(report, new Set(), { item: "x" }), []);
});

test("keyLabel: Defense, penalty, skills and abilities; unknown keys as is", () => {
  const labels = { defense: "Defesa", penalty: "Penalidade", pericias: { fort: "Fortitude" }, atributos: { for: "Força" } };
  assert.equal(keyLabel(DEFENSE_KEY, labels), "Defesa");
  assert.equal(keyLabel(PENALTY_KEY, labels), "Penalidade");
  assert.equal(keyLabel(FORT, labels), "Fortitude");
  assert.equal(keyLabel("system.atributos.for.bonus", labels), "Força");
  assert.equal(keyLabel("system.x.y", labels), "system.x.y");
});

/* -------------------------------------------- */
/*  Foundry integration (mocks)                 */
/* -------------------------------------------- */

const MODULE = "t20-community-patches";

function setupFoundry() {
  const settings = { rule: "on" };
  const hooks = {};
  const infos = [];
  class NumberField {}
  class ArrayField {}
  const getProperty = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);

  class ActiveEffect {
    constructor(data, parent) {
      Object.assign(this, { disabled: false, transfer: false, flags: {}, origin: null, ...data });
      this.parent = parent;
      this.system = { changes: (data.changes ?? []).map((c) => ({ type: "add", phase: "initial", ...c })) };
      this._stats = { createdTime: data.time ?? 0 };
    }
    get uuid() {
      return `${this.parent.uuid}.ActiveEffect.${this.id}`;
    }
    get active() {
      if (this.disabled) return false;
      if (this.parent.documentName === "Item") return !!this.parent.system.equipado;
      return true;
    }
    getReplacementData(data) {
      return data;
    }
    shouldApplyChange(change, options) {
      return change.phase === options?.phase;
    }
  }

  class Actor {
    constructor(name) {
      Object.assign(this, { documentName: "Actor", name, id: name, uuid: `Actor.${name}`, effects: new Map(), items: new Map() });
      this.system = new CharacterData(this);
    }
    get itemTypes() {
      return { equipamento: [...this.items.values()].filter((i) => i.type === "equipamento") };
    }
    getRollData() {
      return { circulo: 3 };
    }
    *allApplicableEffects() {
      yield* this.effects.values();
      for (const item of this.items.values()) for (const effect of item.effects.values()) if (effect.transfer) yield effect;
    }
    /** Mirrors core: changes go through shouldApplyChange with the original change object, then add up. */
    applyActiveEffects(phase) {
      for (const effect of this.allApplicableEffects()) {
        if (!effect.active) continue;
        for (const change of effect.system.changes) {
          if (!effect.shouldApplyChange(change, { phase, replacementData: {} })) continue;
          this.applied.push(`${effect.id}:${phase}`);
          const field = this.system.getFieldForProperty(change.key.slice(7));
          if (field instanceof ArrayField) {
            const parts = (this.parts[change.key] ??= []);
            if (change.type === "add") parts.push(String(change.value));
            else if (change.type === "subtract" && parts.includes(String(change.value))) parts.splice(parts.indexOf(String(change.value)), 1);
            this.totals[change.key] = parts.reduce((sum, v) => sum + Number(v), 0);
          } else {
            let delta = Number(change.value);
            if (change.key === PENALTY_KEY) delta = -Math.abs(delta);
            let total = (this.totals[change.key] ?? 0) + (change.type === "subtract" ? -delta : delta);
            if (change.key === PENALTY_KEY) total = -Math.abs(total); // PenaltyField cleans the result too
            this.totals[change.key] = total;
          }
        }
      }
    }
    prepare() {
      this.totals = {};
      this.parts = {};
      this.applied = [];
      this.applyActiveEffects("initial");
      this.system.prepareDerivedData();
      this.applyActiveEffects("final");
      return this;
    }
    addEffect(id, data) {
      const effect = new ActiveEffect({ id, ...data }, this);
      this.effects.set(id, effect);
      return effect;
    }
    addItem(id, data) {
      const item = {
        documentName: "Item",
        id,
        parent: this,
        type: "equipamento",
        name: id,
        _stats: { createdTime: data.time ?? 0 },
        ...data,
        system: { equipado: true, armadura: { value: 0, penalidade: 0 }, ...data.system },
        effects: new Map()
      };
      for (const [eid, eff] of Object.entries(data.effects ?? {})) item.effects.set(eid, new ActiveEffect({ id: eid, transfer: true, ...eff }, item));
      this.items.set(id, item);
      return item;
    }
  }

  /** Stands in for prepareDefense: accessory Defense and penalty from item data, then the skills read the penalty. */
  class CharacterData {
    constructor(parent) {
      this.parent = parent;
      this.atributos = { for: { bonus: 0 }, des: { bonus: 0 } };
    }
    getFieldForProperty(path) {
      if (["attributes.defesa.bonus", "pericias.fort.bonus", "attributes.movement.walk.bonus"].includes(path)) return new ArrayField();
      if (path === "attributes.defesa.pda" || /^atributos\.\w+\.bonus$/.test(path)) return new NumberField();
      return undefined;
    }
    prepareDerivedData() {
      const accessories = this.parent.itemTypes.equipamento.filter((i) => i.system.equipado && !["leve", "pesada", "escudo"].includes(i.system.tipo));
      this.defesa = accessories.reduce((sum, i) => sum + i.system.armadura.value, 0);
      this.pda = accessories.reduce((sum, i) => sum + i.system.armadura.penalidade, 0);
      this.skillPenalty = this.pda;
    }
  }

  class ItemT20 {
    _allApplicableOnUseEffects() {
      return ["usage"];
    }
  }

  Object.assign(globalThis, {
    CONFIG: {
      Item: { documentClass: ItemT20 },
      ActiveEffect: { documentClass: ActiveEffect },
      Actor: { documentClass: Actor, dataModels: { character: CharacterData } },
      T20: { pericias: { fort: { label: "Fortitude" } } }
    },
    game: {
      user: { id: "u1" },
      actors: [],
      scenes: [],
      settings: {
        get: (scope, key) => (scope === MODULE && key === "sourceStackingRule" ? settings.rule : false),
        register: () => {}
      },
      i18n: { localize: (key) => key, format: (key, data) => `${key}${JSON.stringify(data)}` }
    },
    ui: { notifications: { info: (msg, opts) => infos.push({ msg, opts }) } },
    Hooks: { on: (name, fn) => (hooks[name] = fn) },
    foundry: {
      data: { fields: { NumberField, ArrayField } },
      utils: { getProperty, escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`) },
      dice: {
        Roll: {
          defaultImplementation: { replaceFormulaData: (f, data) => f.replace(/@(\w+)/g, (m, k) => (k in data ? String(data[k]) : m)) },
          create: (formula) => ({
            isDeterministic: !/\dd\d/.test(formula),
            evaluateSync: () => ({ total: formula.split("+").reduce((sum, part) => sum + Number(part.trim()), 0) })
          })
        }
      }
    }
  });
  installSourceStackingRule();
  return { settings, hooks, infos, Actor, ItemT20 };
}

test("integration: two spells on Defense apply only the greatest; off keeps the system's sum", () => {
  const { settings, Actor } = setupFoundry();
  const actor = new Actor("guerreiro");
  actor.addEffect("arcana", { name: "Armadura Arcana", time: 1, flags: { [MODULE]: { source: "magia" } }, changes: [{ key: DEFENSE_KEY, value: "5" }] });
  actor.addEffect("fe", { name: "Escudo da Fé", time: 2, flags: { [MODULE]: { source: "magia" } }, changes: [{ key: DEFENSE_KEY, value: "2" }] });
  assert.equal(actor.prepare().totals[DEFENSE_KEY], 5);
  actor.effects.delete("arcana");
  assert.equal(actor.prepare().totals[DEFENSE_KEY], 2, "the smaller one applies again");
  settings.rule = "off";
  actor.addEffect("arcana", { name: "Armadura Arcana", time: 1, flags: { [MODULE]: { source: "magia" } }, changes: [{ key: DEFENSE_KEY, value: "5" }] });
  assert.equal(actor.prepare().totals[DEFENSE_KEY], 7);
});

test("integration: subtract follows the target field; it never wins on a list of formula parts", () => {
  const { settings, Actor } = setupFoundry();
  const spell = { [MODULE]: { source: "magia" } };
  const actor = new Actor("guerreiro");
  actor.addEffect("maldicao", { name: "Maldição", time: 1, flags: spell, changes: [{ key: DEFENSE_KEY, value: "-2" }] });
  actor.addEffect("tira", { name: "Tira", time: 2, flags: spell, changes: [{ key: DEFENSE_KEY, type: "subtract", value: "5" }] });
  assert.deepEqual(actor.prepare().parts[DEFENSE_KEY], ["-2"], "the penalty stays");
  actor.addEffect("tira3", { name: "Tira 3", time: 3, flags: spell, changes: [{ key: PENALTY_KEY, type: "subtract", value: "3" }] });
  actor.addEffect("tira1", { name: "Tira 1", time: 3, flags: spell, changes: [{ key: PENALTY_KEY, type: "subtract", value: "1" }] });
  actor.addEffect("peso", { name: "Peso", time: 4, flags: spell, changes: [{ key: PENALTY_KEY, value: "1" }] });
  actor.addEffect("peso2", { name: "Peso Maior", time: 5, flags: spell, changes: [{ key: PENALTY_KEY, value: "2" }] });
  const { applied } = actor.prepare();
  assert.ok(applied.includes("tira3:initial") && applied.includes("tira1:initial"), "subtract on the penalty field does not take part");
  assert.ok(!applied.includes("peso:initial"));
  assert.ok(applied.includes("peso2:initial"), "only the worst penalty");
  assert.equal(actor.totals[PENALTY_KEY], -4);
  settings.rule = "off";
  assert.equal(actor.prepare().totals[PENALTY_KEY], -5);
});

test("integration: proxy keys compete by their concrete field, add and subtract", () => {
  const { Actor } = setupFoundry();
  const spell = { [MODULE]: { source: "magia" } };
  const ALL = "system.atributos.*.bonus";
  const actor = new Actor("guerreiro");
  actor.addEffect("a", { name: "A", time: 1, flags: spell, changes: [{ key: ALL, value: "5" }] });
  actor.addEffect("b", { name: "B", time: 2, flags: spell, changes: [{ key: ALL, value: "2" }] });
  actor.addEffect("c", { name: "C", time: 3, flags: spell, changes: [{ key: ALL, type: "subtract", value: "1" }] });
  actor.addEffect("d", { name: "D", time: 4, flags: spell, changes: [{ key: ALL, type: "subtract", value: "3" }] });
  assert.equal(actor.prepare().totals[ALL], 5 - 3);
  const WALK = "system.attributes.movement.walk";
  actor.addEffect("e", { name: "E", time: 5, flags: spell, changes: [{ key: WALK, value: "3" }] });
  actor.addEffect("f", { name: "F", time: 6, flags: spell, changes: [{ key: WALK, value: "6" }] });
  assert.equal(actor.prepare().totals[WALK], 6, "short movement keys add to the bonus field");
});

test("integration: item and spell add up; two items keep the greatest; unstamped and abilities stack", () => {
  const { Actor } = setupFoundry();
  const actor = new Actor("guerreiro");
  actor.addItem("capa", { name: "Capa Pesada", time: 1, system: { tipo: "traje" }, effects: { c1: { changes: [{ key: FORT, value: "1" }] } } });
  actor.addEffect("pocao", { name: "Poção de Proteção Divina", time: 2, flags: { [MODULE]: { source: "item" } }, changes: [{ key: FORT, value: "2" }] });
  actor.addEffect("magia", { name: "Proteção Divina", time: 3, flags: { [MODULE]: { source: "magia" } }, changes: [{ key: FORT, value: "2" }] });
  actor.addEffect("macro", { name: "Macro", time: 4, changes: [{ key: FORT, value: "1" }] });
  actor.addItem("poder", { type: "poder", time: 5, effects: { p1: { changes: [{ key: FORT, value: "1" }] } } });
  assert.equal(actor.prepare().totals[FORT], 2 + 2 + 1 + 1);
});

test("integration: formulas without dice compete; dice always apply; changes of other phases do not compete", () => {
  const { Actor } = setupFoundry();
  const actor = new Actor("guerreiro");
  actor.addEffect("robe", { time: 1, flags: { [MODULE]: { source: "item" } }, changes: [{ key: FORT, value: "5 + @circulo" }] });
  actor.addEffect("anel", { time: 2, flags: { [MODULE]: { source: "item" } }, changes: [{ key: FORT, value: "7" }] });
  actor.addEffect("final", { time: 3, flags: { [MODULE]: { source: "item" } }, changes: [{ key: FORT, value: "1", phase: "final" }] });
  actor.addEffect("dado", { time: 4, flags: { [MODULE]: { source: "item" } }, changes: [{ key: FORT, value: "1d6" }] });
  // The robe (5 + 3 = 8) wins over the ring (7) in "initial"; the die never competes; "final" has a single source.
  const { applied } = actor.prepare();
  assert.ok(applied.includes("robe:initial"));
  assert.ok(!applied.includes("anel:initial"));
  assert.ok(applied.includes("dado:initial"));
  assert.ok(applied.includes("final:final"));
});

test("integration: only one accessory adds Defense and penalty; armor upgrades always add; skills follow", () => {
  const { Actor } = setupFoundry();
  const actor = new Actor("guerreiro");
  const braceletes = actor.addItem("braceletes", { name: "Braceletes de Ouro", time: 1, system: { tipo: "acessorio", armadura: { value: 8, penalidade: 0 } } });
  const colar = actor.addItem("colar", { name: "Colar Guardião", time: 2, system: { tipo: "acessorio", armadura: { value: 5, penalidade: -1 } } });
  actor.addItem("baluarte", {
    time: 3,
    system: { tipo: "pesada", armadura: { value: 10, penalidade: -5 } },
    effects: { r: { changes: [{ key: DEFENSE_KEY, value: "2" }] } }
  });
  actor.addItem("escudo", { time: 4, system: { tipo: "escudo", armadura: { value: 2, penalidade: -1 } }, effects: { d: { changes: [{ key: DEFENSE_KEY, value: "1" }] } } });
  actor.prepare();
  assert.equal(actor.system.defesa, 8, "only the bracelets");
  assert.equal(actor.system.pda, -1, "the greatest accessory penalty");
  assert.equal(actor.system.skillPenalty, -1);
  assert.equal(actor.totals[DEFENSE_KEY], 3, "armor and shield upgrades add up");
  assert.equal(colar.system.armadura.value, 5, "item data restored");
  assert.equal(braceletes.system.armadura.value, 8);
});

test("integration: an accessory's data and its own effects count as one item against a potion", () => {
  const { Actor } = setupFoundry();
  const actor = new Actor("guerreiro");
  actor.addItem("anel", { name: "Anel da Proteção", time: 1, system: { tipo: "acessorio", armadura: { value: 2, penalidade: 0 } }, effects: { a: { changes: [{ key: DEFENSE_KEY, value: "2" }] } } });
  actor.addEffect("pocao", { time: 2, flags: { [MODULE]: { source: "item" } }, changes: [{ key: DEFENSE_KEY, value: "2" }] });
  actor.prepare();
  assert.equal(actor.system.defesa, 2);
  assert.equal(actor.totals[DEFENSE_KEY], 2, "the ring's effect applies, the potion is suppressed");
});

test("integration: the stamp marks spell and item clones, and removes it from abilities", () => {
  const { ItemT20 } = setupFoundry();
  const live = {};
  const clone = (type) => {
    const effect = { flags: { [MODULE]: { source: "magia" } }, _source: { flags: {} } };
    const item = Object.assign(new ItemT20(), { type, id: "i1", isEmbedded: true, actor: { items: { get: () => live } }, effects: [effect] });
    return { item, effect };
  };
  for (const [type, expected] of [["magia", "magia"], ["consumivel", "item"], ["poder", undefined]]) {
    const { item, effect } = clone(type);
    assert.deepEqual(item._allApplicableOnUseEffects(), ["usage"]);
    assert.equal(effect.flags[MODULE].source, expected, type);
    assert.equal(effect._source.flags?.[MODULE]?.source, expected, type);
  }
  const { item, effect } = clone("magia");
  item.actor = { items: { get: () => item } };
  effect.flags[MODULE].source = "x";
  item._allApplicableOnUseEffects();
  assert.equal(effect.flags[MODULE].source, "x", "live documents are never stamped");
});

test("integration: the user who applied the effect is notified once, with escaped values", async () => {
  const { hooks, infos, Actor } = setupFoundry();
  const actor = new Actor("guerreiro");
  actor.addEffect("arcana", { name: "Armadura Arcana", time: 1, flags: { [MODULE]: { source: "magia" } }, changes: [{ key: DEFENSE_KEY, value: "5" }] });
  const fe = actor.addEffect("fe", { name: "<b>Escudo</b>", time: 2, flags: { [MODULE]: { source: "magia" } }, changes: [{ key: DEFENSE_KEY, value: "2" }] });
  actor.prepare();
  hooks.createActiveEffect(fe, {}, "u1");
  await Promise.resolve();
  assert.equal(infos.length, 1);
  assert.equal(infos[0].msg, "T20CP.SourceStacking.Suppressed");
  assert.equal(infos[0].opts.format.loser, "<b>Escudo</b>", "the core escapes format values");
  assert.equal(infos[0].opts.format.winner, "Armadura Arcana");
  hooks.updateActiveEffect(fe, {}, {}, "u1");
  await Promise.resolve();
  assert.equal(infos.length, 1, "already notified");
});

test("integration: an effect created on an item is notified after the owner actor prepares again", async () => {
  const { hooks, infos, Actor } = setupFoundry();
  const actor = new Actor("guerreiro");
  actor.addEffect("pocao", { name: "Poção", time: 1, flags: { [MODULE]: { source: "item" } }, changes: [{ key: FORT, value: "5" }] });
  actor.prepare();
  // Core order for a grandchild effect: item.reset(), the create hook, then the actor's descendant callback resets it.
  const created = actor.addItem("capa", { name: "Capa", time: 2, system: { tipo: "traje" }, effects: { c1: { changes: [{ key: FORT, value: "2" }] } } }).effects.get("c1");
  hooks.createActiveEffect(created, {}, "u1");
  actor.prepare();
  await Promise.resolve();
  assert.equal(infos.length, 1);
  assert.equal(infos[0].opts.format.loser, "Capa");
  assert.equal(infos[0].opts.format.winner, "Poção");
});

test("integration: a batch notifies every new suppression of its documents", async () => {
  const { hooks, infos, Actor } = setupFoundry();
  const spell = { [MODULE]: { source: "magia" } };
  const actor = new Actor("guerreiro");
  actor.addEffect("a", { name: "A", time: 1, flags: spell, changes: [{ key: DEFENSE_KEY, value: "5" }] });
  actor.addEffect("b", { name: "B", time: 2, flags: spell, changes: [{ key: FORT, value: "5" }] });
  actor.prepare();
  const c = actor.addEffect("c", { name: "C", time: 3, flags: spell, changes: [{ key: DEFENSE_KEY, value: "1" }] });
  const d = actor.addEffect("d", { name: "D", time: 4, flags: spell, changes: [{ key: FORT, value: "1" }] });
  actor.prepare();
  hooks.createActiveEffect(c, {}, "u1");
  hooks.createActiveEffect(d, {}, "u1");
  await Promise.resolve();
  assert.deepEqual(infos.map((i) => i.opts.format.loser).sort(), ["C", "D"]);
});

test("integration: changes by other users keep the known suppressions up to date", async () => {
  const { hooks, infos, Actor } = setupFoundry();
  const spell = { [MODULE]: { source: "magia" } };
  const actor = new Actor("guerreiro");
  actor.addEffect("arcana", { name: "Armadura Arcana", time: 1, flags: spell, changes: [{ key: DEFENSE_KEY, value: "5" }] });
  const fe = actor.addEffect("fe", { name: "Escudo da Fé", time: 2, flags: spell, changes: [{ key: DEFENSE_KEY, value: "2" }] });
  const toggle = async (disabled, userId) => {
    fe.disabled = disabled;
    actor.prepare();
    hooks.updateActiveEffect(fe, {}, {}, userId);
    await Promise.resolve();
  };
  await toggle(false, "u1");
  await toggle(true, "u2");
  await toggle(false, "u1");
  assert.equal(infos.length, 2, "notified again after another user lifted the suppression");
  await toggle(true, "u2");
  await toggle(false, "u2");
  assert.equal(infos.length, 2, "other users' changes are not notified here");
});

test("registerStackingExclusion: idempotent, removable; a throwing predicate excludes nothing", () => {
  const calls = [];
  const broken = () => {
    calls.push("broken");
    throw new Error("bad");
  };
  const mine = (effect, change) => (calls.push("mine"), change.value === "8");
  const offBroken = registerStackingExclusion(broken);
  const offMine = registerStackingExclusion(mine);
  registerStackingExclusion(mine);
  try {
    assert.equal(isStackingExcluded({}, { value: "8" }), true);
    assert.deepEqual(calls, ["broken", "mine"], "registered once; the others are still consulted");
    assert.equal(isStackingExcluded({}, { value: "2" }), false);
  } finally {
    offBroken();
    offMine();
  }
  assert.equal(isStackingExcluded({}, { value: "8" }), false);
});

test("integration: an excluded change neither competes nor is suppressed", () => {
  const { Actor } = setupFoundry();
  const spell = { [MODULE]: { source: "magia" } };
  const actor = new Actor("guerreiro");
  actor.addEffect("a", { name: "A", time: 1, flags: spell, changes: [{ key: DEFENSE_KEY, value: "5" }] });
  actor.addEffect("b", { name: "B", time: 2, flags: spell, changes: [{ key: DEFENSE_KEY, value: "2" }] });
  const off = registerStackingExclusion((effect) => effect.id === "b");
  try {
    assert.equal(actor.prepare().totals[DEFENSE_KEY], 7);
  } finally {
    off();
  }
  assert.equal(actor.prepare().totals[DEFENSE_KEY], 5, "the smaller one is suppressed again");
});
