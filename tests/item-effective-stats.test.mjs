import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFENSE_KEY,
  PDA_KEY,
  appendFormula,
  applyCritEffects,
  canFoldDefense,
  canFoldPenalty,
  classifyItemEffects,
  consumedArmorIds,
  computeEffectiveStats,
  createOnUseWrapper,
  critLabel,
  detailedStats,
  describeEffect,
  foldItemSystem,
  foldedState,
  hasDetails,
  linkedPdaCount,
  normalizeMode,
  parseItemCard,
  planCritFold,
  shouldSkipFoldedChange,
  statsFor,
  tooltipHtml
} from "../scripts/rules/item-effective-stats.mjs";
import { adjustThreatEffect } from "../scripts/patches/threatening-crit-range.mjs";

/* -------------------------------------------- */
/*  Fixtures                                    */
/* -------------------------------------------- */

const passive = (name, changes, extra = {}) => ({ name, onuse: false, transfer: true, disabled: false, changes, ...extra });
const usage = (name, changes, extra = {}) => ({ name, onuse: true, selfUse: true, automatic: true, changes, ...extra });

const pda = (value) => ({ key: PDA_KEY, type: "add", value });
const bonus = (value) => ({ key: DEFENSE_KEY, type: "add", value });
const ajustada = () => passive("Ajustada", [pda(-1)], { identifier: "adjusted" });
const sobMedida = () => passive("Sob Medida", [pda(-2)], { identifier: "undermeasure" });
const reforcada = () => passive("Reforçada", [bonus(1), pda(1)], { identifier: "reinforced" });
const polida = () => passive("Polida", [bonus(5)], { identifier: "polished" });

const precisa = (extra) => usage("Precisa", [{ key: "criticoM", type: "add", value: -1 }], extra);
const ameacadora = (extra) => usage("Ameaçadora", [{ key: "criticoM", type: "multiply", value: 2 }], extra);
const macica = (extra) => usage("Maciça", [{ key: "criticoX", type: "add", value: 1 }], extra);
const override18 = (extra) => usage("Override", [{ key: "criticoM", type: "override", value: "18" }], extra);

const armor = (penalidade, value = 10) => ({ type: "equipamento", tipo: "pesada", armadura: { value, penalidade } });
const weapon = (labels = {}) => ({ type: "arma", criticoM: 19, criticoX: 2, labels });

const stats = (base, effects, patches = { penaltyFix: true, threatFix: true }) =>
  computeEffectiveStats(base, classifyItemEffects(effects), patches);

/* -------------------------------------------- */
/*  classifyItemEffects                         */
/* -------------------------------------------- */

test("classifyItemEffects sorts the item's own effects", () => {
  const transferred = passive("A", []);
  const notTransferred = passive("B", [], { transfer: false });
  const disabled = passive("C", [], { disabled: true });
  const withStatus = passive("D", [], { hasStatus: true });
  const migrated = usage("E", [], { disabled: true });
  const temporary = usage("F", [], { temporary: true });
  const foreign = usage("G", [], { selfUse: false });
  const automatic = usage("H", []);
  const optional = usage("I", [], { automatic: false });
  const result = classifyItemEffects([transferred, notTransferred, disabled, withStatus, migrated, temporary, foreign, automatic, optional]);
  assert.deepEqual(result.passive, [transferred]);
  assert.deepEqual(result.notApplied, [notTransferred]);
  assert.deepEqual(result.bearer, [withStatus]);
  assert.deepEqual(result.automatic, [migrated, automatic]);
  assert.deepEqual(result.optional, [optional]);
});

test("describeEffect selects usage effects by self type or by the item name", () => {
  const item = { name: "Espada Longa" };
  const effect = (abilityUse) => ({ name: "Precisa", system: { onuse: true, abilityUse, changes: [], status: null } });
  assert.equal(describeEffect(effect({ types: new Set(["self"]), names: new Set() }), item).selfUse, true);
  assert.equal(describeEffect(effect({ types: [], names: ["Espada Longa"] }), item).selfUse, true);
  assert.equal(describeEffect(effect({ types: new Set(["ally"]), names: new Set(["Outra"]) }), item).selfUse, false);
  assert.equal(describeEffect({ name: "X", system: { status: { category: "mental" }, changes: [] } }, item).hasStatus, true);
  assert.equal(describeEffect({ name: "X", system: { status: null, changes: [] } }, item).hasStatus, false);
});

/* -------------------------------------------- */
/*  Armor penalty and Defense                   */
/* -------------------------------------------- */

test("armor penalty with armor-penalty-reduction applied", () => {
  assert.equal(stats(armor(-5), [ajustada()])["armadura.penalidade"].final, -4);
  assert.equal(stats(armor(-5), [ajustada(), sobMedida()])["armadura.penalidade"].final, -2);
  assert.equal(stats(armor(-1), [sobMedida()])["armadura.penalidade"].final, 0);
  assert.equal(stats(armor(-5), [reforcada()])["armadura.penalidade"].final, -6);
  const adjusted = stats(armor(-5), [ajustada()])["armadura.penalidade"];
  assert.equal(adjusted.base, -5);
  assert.deepEqual(adjusted.parts, [{ label: "Ajustada", delta: "+1", kind: "applied" }]);
  assert.equal(adjusted.warning, undefined);
});

test("armor penalty without armor-penalty-reduction follows the system and warns", () => {
  const entry = stats(armor(-5), [ajustada()], { penaltyFix: false, threatFix: true })["armadura.penalidade"];
  assert.equal(entry.final, -6);
  assert.equal(entry.warning, "PenaltyFixOff");
});

test("Defense with Reforçada and Polida, with the book note on Polida", () => {
  const entry = stats(armor(-5), [reforcada(), polida()])["armadura.value"];
  assert.equal(entry.base, 10);
  assert.equal(entry.final, 16);
  assert.ok(entry.parts.some((p) => p.kind === "note" && p.label === "PolishedNote"));
});

test("not transferred effects are listed as not applied and other keys go to the bearer", () => {
  const mitral = passive("Mitral", [pda(-2)], { transfer: false, identifier: "mithral" });
  const selada = passive("Selada", [{ key: "system.modificadores.pericias.resistencia", type: "add", value: 1 }]);
  const result = stats(armor(-5), [mitral, selada]);
  assert.equal(result["armadura.penalidade"].final, -5);
  assert.deepEqual(result["armadura.penalidade"].parts, [{ label: "Mitral", delta: "+2", kind: "not-applied" }]);
  assert.equal(result.portador.parts[0].label, "Selada");
  assert.equal(hasDetails(result), true);
});

test("non-armor equipment has no effective stats", () => {
  assert.deepEqual(stats({ type: "equipamento", tipo: "acessorio", armadura: { value: 1, penalidade: 0 } }, [ajustada()]), {});
});

/* -------------------------------------------- */
/*  Critical                                    */
/* -------------------------------------------- */

test("critical: Precisa, Maciça and Ameaçadora with threatening-crit-range", () => {
  assert.equal(stats(weapon(), [precisa()]).criticoM.final, 18);
  const massive = stats(weapon(), [macica()]);
  assert.equal(massive.criticoX.final, 3);
  assert.equal(critLabel(massive.criticoM.final, massive.criticoX.final), "19/3x");
  assert.equal(stats(weapon(), [ameacadora()]).criticoM.final, 17);
  assert.equal(stats(weapon(), [ameacadora(), precisa()]).criticoM.final, 16);
  assert.equal(stats(weapon(), [precisa(), ameacadora()]).criticoM.final, 16);
});

test("critical without threatening-crit-range follows the system order and warns", () => {
  const off = { penaltyFix: true, threatFix: false };
  const keenFirst = stats(weapon(), [ameacadora(), precisa()], off).criticoM;
  assert.equal(keenFirst.final, 37);
  assert.equal(keenFirst.warning, "ThreatFixOff");
  assert.equal(stats(weapon(), [precisa(), ameacadora()], off).criticoM.final, 36);
});

test("critical: override first, then Ameaçadora rewritten on the base 19", () => {
  assert.equal(stats(weapon(), [override18(), ameacadora()]).criticoM.final, 16);
  assert.equal(stats(weapon(), [ameacadora(), override18()]).criticoM.final, 16);
});

test("applyCritEffects ignores zero and non-numeric values like the system", () => {
  const result = applyCritEffects(19, 2, [usage("X", [{ key: "criticoM", type: "add", value: 0 }, { key: "criticoX", type: "add", value: "abc" }])], true);
  assert.equal(result.criticoM, 19);
  assert.equal(result.criticoX, 2);
});

test("optional usage effects stay out of the final value", () => {
  const result = stats(weapon({ toHit: "+5" }), [usage("Certeira", [{ key: "ataque", type: "add", value: 1 }], { automatic: false })]);
  assert.equal(result.ataque.final, "+5");
  assert.deepEqual(result.ataque.parts, [{ label: "Certeira", delta: "+1", kind: "optional" }]);
  assert.equal(hasDetails(result), true);
});

/* -------------------------------------------- */
/*  Attack and damage                           */
/* -------------------------------------------- */

test("attack and damage labels", () => {
  const certeira = usage("Certeira", [{ key: "ataque", type: "add", value: 1 }]);
  const cruel = usage("Cruel", [{ key: "dano", type: "add", value: 1 }]);
  const result = stats(weapon({ toHit: "+5", dano: "1d8+3" }), [certeira, cruel]);
  assert.equal(result.ataque.final, "+6");
  assert.equal(result.dano.final, "1d8+4");
  const plain = stats(weapon({ toHit: "+5", dano: "1d8+3" }), []);
  assert.equal(plain.ataque.final, plain.ataque.base);
  assert.equal(plain.dano.final, plain.dano.base);
});

test("appendFormula merges trailing constants and never evaluates text", () => {
  assert.equal(appendFormula("1d8+3", ["1"]), "1d8+4");
  assert.equal(appendFormula("1d8+3", ["1d6"]), "1d8+3+1d6");
  assert.equal(appendFormula("1d8+3", ["@for*2"]), "1d8+3+@for*2");
  assert.equal(appendFormula("1d8", ["2"]), "1d8+2");
  assert.equal(appendFormula("1d8 + 3", ["1"]), "1d8 + 4");
  assert.equal(appendFormula("+5", ["1"]), "+6");
  assert.equal(appendFormula("1d8+1", ["-1"]), "1d8");
});

test("critLabel mirrors the system label", () => {
  assert.equal(critLabel(18, 2), "18");
  assert.equal(critLabel(18, 3), "18/3x");
});

/* -------------------------------------------- */
/*  Fold plans                                  */
/* -------------------------------------------- */

const rollEffect = (id, changes, own = true, automatic = true) => ({ id, own, automatic, changes });
const P = (own, automatic) => rollEffect("p", [{ key: "criticoM", type: "add", value: -1 }], own, automatic);

test("planCritFold: all or nothing", () => {
  const both = planCritFold([P(), rollEffect("m", [{ key: "criticoX", type: "add", value: 1 }])]);
  assert.equal(both.fold, true);
  assert.deepEqual([...both.effectIds].sort(), ["m", "p"]);

  const mixed = rollEffect("x", [{ key: "ataque", type: "add", value: 1 }, { key: "criticoM", type: "add", value: -1 }]);
  assert.deepEqual(planCritFold([P(), mixed]), { fold: false, effectIds: new Set() });
  assert.equal(planCritFold([rollEffect("k", [{ key: "criticoM", type: "multiply", value: 2 }]), mixed]).fold, false);
  assert.equal(planCritFold([P(), rollEffect("k", [{ key: "criticoM", type: "multiply", value: 2 }], true, false)]).fold, false);
  assert.equal(planCritFold([P(), rollEffect("ammo", [{ key: "criticoM", type: "add", value: -1 }], false)]).fold, false);
  assert.equal(planCritFold([rollEffect("o", [{ key: "criticoM", type: "override", value: 18 }])]).fold, false);
  assert.deepEqual(planCritFold([rollEffect("a", [{ key: "ataque", type: "add", value: 1 }])]), { fold: false, effectIds: new Set() });
  assert.deepEqual(planCritFold([]), { fold: false, effectIds: new Set() });
});

test("planCritFold: an effect charged, multiplied or limited by the usage dialog is not folded", () => {
  const bound = { ...P(), usageBound: true };
  assert.deepEqual(planCritFold([bound]), { fold: false, effectIds: new Set() });
  assert.equal(planCritFold([P(), { ...rollEffect("m", [{ key: "criticoX", type: "add", value: 1 }]), usageBound: true }]).fold, false);
  const cost = describeEffect({ id: "c", name: "C", system: { onuse: true, abilityUse: { automatic: true, custo: 2, types: new Set(["self"]) }, changes: [] } }, { name: "Espada" });
  const free = describeEffect({ id: "f", name: "F", system: { onuse: true, abilityUse: { automatic: true, custo: 0, types: new Set(["self"]) }, changes: [] } }, { name: "Espada" });
  const many = describeEffect({ id: "a", name: "A", system: { onuse: true, abilityUse: { automatic: true, aumenta: true }, changes: [] } }, { name: "Espada" });
  assert.deepEqual([cost.usageBound, free.usageBound, many.usageBound], [true, false, true]);
});

test("automatic Precisa plus optional Ameaçadora gives 16 when selected, in display and effective", () => {
  // Not folded: the roll applies both on the base, as in display mode.
  const plan = planCritFold([P(), rollEffect("k", [{ key: "criticoM", type: "multiply", value: 2 }], true, false)]);
  assert.equal(plan.fold, false);
  assert.equal(applyCritEffects(19, 2, [precisa(), ameacadora()], true).criticoM, 16);
});

test("canFoldPenalty", () => {
  assert.equal(canFoldPenalty([ajustada()], 0), true);
  assert.equal(canFoldPenalty([sobMedida(), passive("S", [pda(1)], { hasStatus: true })], 0), false);
  assert.equal(canFoldPenalty([sobMedida(), passive("S", [pda(1)], { hasStatus: true, disabled: true })], 0), true);
  assert.equal(canFoldPenalty([ajustada()], 1), false);
  // A formula increase stays on the actor and needs the reductions' excess (#19), so nothing is folded.
  assert.equal(canFoldPenalty([sobMedida(), passive("F", [{ key: PDA_KEY, type: "add", value: "1+0" }])], 0), false);
  assert.equal(canFoldPenalty([sobMedida(), passive("F", [{ key: PDA_KEY, type: "add", value: "1+0" }], { disabled: true })], 0), true);
});

test("Defense: subtract removes a list entry, so it is not a numeric delta", () => {
  const sub = passive("Menos", [{ key: DEFENSE_KEY, type: "subtract", value: "2" }]);
  const stats = computeEffectiveStats(armor(), classifyItemEffects([sub]));
  assert.equal(stats["armadura.value"].final, 10);
  assert.equal(stats.portador.parts.length, 1);
  assert.equal(shouldSkipFoldedChange({ mode: "effective", change: sub.changes[0], targetIsActor: true, ownedByTarget: true, consumed: true, itemType: "equipamento", tipo: "pesada", hasStatus: false, folded: { value: true } }), false);
});

test("Defense: add then subtract of the same entry is not folded", () => {
  const effects = [passive("Mais", [bonus(2)]), passive("Menos", [{ key: DEFENSE_KEY, type: "subtract", value: "2" }])];
  assert.equal(canFoldDefense(effects), false);
  assert.equal(canFoldDefense([passive("Mais", [bonus(2)])]), true);
  assert.equal(canFoldDefense([passive("Final", [{ ...bonus(2), phase: "final" }])]), false);
  const armorItem = fakeArmor({ actor: fakeActor(), effects: [{ name: "Mais", changes: [bonus(2)] }, { name: "Menos", changes: [{ key: DEFENSE_KEY, type: "subtract", value: "2" }] }] });
  foldItemSystem(armorItem.system, "effective", PATCHES_ON());
  assert.equal(armorItem.system.armadura.value, 10);
  assert.equal(skipFor(armorItem, armorItem.effects[0], armorItem.effects[0].system.changes[0]), false);
});

test("penalty: subtract or a non-initial phase is neither corrected by #19 nor folded", () => {
  const sub = passive("Ajustada", [{ key: PDA_KEY, type: "subtract", value: "-1" }], { identifier: "adjusted" });
  const late = passive("Ajustada", [{ ...pda(-1), phase: "final" }], { identifier: "adjusted" });
  for (const effect of [sub, late]) {
    assert.equal(canFoldPenalty([effect], 0), false);
    const stats = computeEffectiveStats(armor(-5), classifyItemEffects([effect]), { penaltyFix: true });
    assert.equal(stats["armadura.penalidade"].final, -5);
    assert.equal(stats.portador.parts.length, 1);
    assert.equal(shouldSkipFoldedChange({ mode: "effective", change: effect.changes[0], targetIsActor: true, ownedByTarget: true, consumed: true, itemType: "equipamento", tipo: "pesada", hasStatus: false, folded: { penalty: true } }), false);
  }
  const armorItem = fakeArmor({ actor: fakeActor(), effects: [{ name: "Ajustada", identifier: "adjusted", changes: [{ ...pda(-1), phase: "final" }] }] });
  foldItemSystem(armorItem.system, "effective", PATCHES_ON());
  assert.equal(armorItem.system.armadura.penalidade, -5);
});

test("effective armor: a bearer's subtract on Defense keeps the item's bonus on the actor", () => {
  const actor = fakeActor();
  actor.effects.push(fakeEffect({ name: "Menos", onuse: false, changes: [{ key: DEFENSE_KEY, type: "subtract", value: "1" }], parent: actor }));
  const armorItem = fakeArmor({ actor, effects: [{ name: "Reforçada", changes: [bonus(1)] }] });
  foldItemSystem(armorItem.system, "effective", PATCHES_ON());
  assert.equal(armorItem.system.armadura.value, 10);
  assert.equal(skipFor(armorItem, armorItem.effects[0], armorItem.effects[0].system.changes[0]), false);
  actor.effects[0].disabled = true;
  foldItemSystem(armorItem.system, "effective", PATCHES_ON());
  assert.equal(armorItem.system.armadura.value, 11);
});

test("effective armor: the penalty of an armor prepareDefense does not read is not folded", () => {
  const actor = fakeActor();
  fakeArmor({ actor, id: "first" });
  const second = fakeArmor({ actor, id: "second", penalidade: -2, effects: [{ name: "Sob Medida", changes: [pda(-2)] }, { name: "Reforçada", changes: [bonus(1)] }] });
  foldItemSystem(second.system, "effective", PATCHES_ON());
  assert.equal(second.system.armadura.penalidade, -2);
  assert.equal(second.system.armadura.value, 11);
});

test("effective armor: a bearer's non-additive pda change keeps the penalty chain on the actor", () => {
  for (const type of ["subtract", "multiply", "override"]) {
    const actor = fakeActor();
    actor.effects.push(fakeEffect({ name: "Ator", onuse: false, changes: [{ key: PDA_KEY, type, value: "-1" }], parent: actor }));
    const armorItem = fakeArmor({ actor, effects: [{ name: "Reforçada", changes: [pda(1)] }] });
    foldItemSystem(armorItem.system, "effective", PATCHES_ON());
    assert.equal(armorItem.system.armadura.penalidade, -5, type);
    assert.equal(skipFor(armorItem, armorItem.effects[0], armorItem.effects[0].system.changes[0]), false, type);
  }
  // An additive bearer change commutes with the fold.
  const actor = fakeActor();
  actor.effects.push(fakeEffect({ name: "Ator", onuse: false, changes: [pda(1)], parent: actor }));
  const armorItem = fakeArmor({ actor, effects: [{ name: "Reforçada", changes: [pda(1)] }] });
  foldItemSystem(armorItem.system, "effective", PATCHES_ON());
  assert.equal(armorItem.system.armadura.penalidade, -6);
});

test("an aura that does not target its bearer is not applied nor folded", () => {
  const aura = (targets) => ({ aura: { isAura: true, behaviors: { a: { type: "applyActiveEffect" } } }, targets: new Set(targets), changes: [bonus(2)] });
  const ally = describeEffect({ id: "x", name: "Aura", system: aura(["ally"]) }, { name: "Armadura" });
  const self = describeEffect({ id: "y", name: "Aura", system: aura(["self", "ally"]) }, { name: "Armadura" });
  assert.deepEqual([ally.appliesToBearer, self.appliesToBearer], [false, true]);
  const stats = computeEffectiveStats(armor(-5), classifyItemEffects([{ ...ally, transfer: true }]));
  assert.equal(stats["armadura.value"].final, 10);
  assert.equal(stats["armadura.value"].parts[0].kind, "not-applied");
  assert.equal(computeEffectiveStats(armor(-5), classifyItemEffects([{ ...self, transfer: true }]))["armadura.value"].final, 12);
});

test("consumedArmorIds: first equipped armor and shield, as prepareDefense", () => {
  const eq = (id, tipo, equipado = true, slot = equipado) => ({ id, system: { tipo, equipado, equipado2: { slot } } });
  const items = [eq("a0", "pesada", false), eq("a1", "leve"), eq("a2", "pesada"), eq("s1", "escudo"), eq("s2", "escudo"), eq("x", "acessorio")];
  assert.deepEqual([...consumedArmorIds(items, false)].sort(), ["a1", "s1"]);
  assert.deepEqual([...consumedArmorIds([eq("a0", "pesada", false, true), eq("a1", "leve", true, false)], true)], ["a0"]);
});

test("hasDetails", () => {
  assert.equal(hasDetails({ a: { base: 1, final: 2, parts: [] } }), true);
  assert.equal(hasDetails({ a: { base: 1, final: 1, parts: [{ label: "x", kind: "optional" }] } }), true);
  assert.equal(hasDetails({ a: { base: 1, final: 1, parts: [{ label: "x", kind: "not-applied" }] } }), true);
  assert.equal(hasDetails({ a: { base: 1, final: 1, parts: [] } }), false);
  assert.equal(hasDetails({}), false);
});

test("tooltipHtml escapes document text", () => {
  const html = tooltipHtml(
    { stat: "penalty", base: -5, final: -4, parts: [{ label: "<b>Ajustada</b>", delta: "+1", kind: "applied" }] },
    (key) => key,
    (text) => text.replace(/</g, "&lt;").replace(/>/g, "&gt;")
  );
  assert.ok(html.includes("&lt;b&gt;Ajustada&lt;/b&gt; +1"));
  assert.ok(!html.includes("<b>"));
});

test("normalizeMode and parseItemCard", () => {
  assert.equal(normalizeMode("effective"), "effective");
  assert.equal(normalizeMode("x"), "display");
  const content = '<div class="tormenta20 chat-card item-card" data-actor-id="A1" data-item-id="I1">';
  assert.deepEqual(parseItemCard(content), { itemId: "I1", actorId: "A1" });
  assert.equal(parseItemCard("<div class='other'>"), null);
});

/* -------------------------------------------- */
/*  Effective mode with fake documents          */
/* -------------------------------------------- */

const PATCHES_ON = () => ({ penaltyFix: true, threatFix: true });

let nextId = 0;
function fakeEffect({ name, changes, onuse = true, automatic = true, types = ["self"], names = [], disabled = false, transfer = !onuse, status = null, temporary = false, origin, parent, id }) {
  const effect = {
    id: id ?? `e${++nextId}`,
    name,
    disabled,
    transfer,
    origin,
    isTemporary: temporary,
    parent,
    system: { onuse, status, changes, abilityUse: { types: new Set(types), names: new Set(names), automatic } },
    clone(data) {
      return fakeEffect({ name, changes: data.system.changes, onuse, automatic, types, names, disabled, transfer, status, temporary, origin, parent: this.parent, id: this.id });
    }
  };
  return effect;
}

function fakeWeapon({ actor = null, effects = [] } = {}) {
  const item = {
    id: "w1",
    name: "Espada Longa",
    type: "arma",
    documentName: "Item",
    _source: { system: { criticoM: 19, criticoX: 2 } },
    system: { criticoM: 19, criticoX: 2 },
    effects: [],
    actor,
    parent: actor,
    get isEmbedded() {
      return !!actor;
    }
  };
  item.system.parent = item;
  for (const spec of effects) item.effects.push(fakeEffect({ ...spec, parent: item }));
  return item;
}

function cloneWeapon(real) {
  const clone = fakeWeapon({ actor: real.actor });
  for (const effect of real.effects) clone.effects.push(Object.assign(effect.clone({ system: { changes: effect.system.changes } }), { parent: clone }));
  return clone;
}

/** Simulates the system's _allApplicableOnUseEffects with the #30 wrapper inside. */
function systemOnUse(extra = []) {
  return function () {
    if (!this.isEmbedded) return [];
    const own = this.effects.filter((e) => e.system.onuse && !e.isTemporary && (e.system.abilityUse.types.has("self") || e.system.abilityUse.names.has(this.name)));
    return [...own.map((e) => adjustThreatEffect(e, this)), ...extra];
  };
}

const rollCrit = (item, list) => applyCritEffects(item.system.criticoM, item.system.criticoX, list.map((e) => ({ name: e.name, changes: e.system.changes })), false);

function fakeActor() {
  const actor = {
    documentName: "Actor",
    effects: [],
    items: new Map(),
    get itemTypes() {
      return { equipamento: [...this.items.values()].filter((i) => i.type === "equipamento") };
    }
  };
  return actor;
}

test("roll clone: an actor effect on the critical keeps the whole chain on the roll (17/3x)", () => {
  const actor = fakeActor();
  const real = fakeWeapon({ actor, effects: [{ name: "Ameaçadora", changes: [{ key: "criticoM", type: "multiply", value: 2 }] }] });
  actor.items.set(real.id, real);
  const actorEffect = fakeEffect({ name: "Aura", changes: [{ key: "criticoX", type: "add", value: 1 }], parent: actor });

  const clone = cloneWeapon(real);
  foldItemSystem(clone.system, "effective", PATCHES_ON());
  assert.equal(clone.system.criticoM, 17, "the preparation folds the own chain");

  const wrapped = createOnUseWrapper(systemOnUse([actorEffect]), { mode: () => "effective", patches: PATCHES_ON });
  const list = wrapped.call(clone);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0].system.changes, [{ key: "criticoM", type: "add", value: -2 }]);
  assert.equal(clone.system.criticoM, 19, "the clone keeps the base");
  const result = rollCrit(clone, list);
  assert.equal(critLabel(result.criticoM, result.criticoX), "17/3x");

  // Display mode gives the same roll.
  const displayClone = cloneWeapon(real);
  const displayList = createOnUseWrapper(systemOnUse([actorEffect]), { mode: () => "display" }).call(displayClone);
  const display = rollCrit(displayClone, displayList);
  assert.equal(critLabel(display.criticoM, display.criticoX), "17/3x");
});

test("real item (usage-effect-max query): base during the call, folded value restored after", () => {
  const actor = fakeActor();
  const real = fakeWeapon({ actor, effects: [{ name: "Ameaçadora", changes: [{ key: "criticoM", type: "multiply", value: 2 }] }] });
  actor.items.set(real.id, real);
  foldItemSystem(real.system, "effective", PATCHES_ON());
  assert.equal(real.system.criticoM, 17);
  let seen;
  const inner = systemOnUse([fakeEffect({ name: "Aura", changes: [{ key: "criticoX", type: "add", value: 1 }], parent: actor })]);
  const wrapped = createOnUseWrapper(
    function () {
      seen = this.system.criticoM;
      return inner.call(this);
    },
    { mode: () => "effective", patches: PATCHES_ON }
  );
  const list = wrapped.call(real);
  assert.equal(seen, 19);
  assert.equal(list.length, 2, "nothing removed on the real item");
  assert.equal(real.system.criticoM, 17);
  assert.throws(() => createOnUseWrapper(() => { throw new Error("boom"); }, { mode: () => "effective" }).call(real));
  assert.equal(real.system.criticoM, 17, "restored even on error");
});

test("roll clone: both plans fold the same ids → folded effects removed, folded value kept", () => {
  const actor = fakeActor();
  const real = fakeWeapon({
    actor,
    effects: [
      { name: "Precisa", changes: [{ key: "criticoM", type: "add", value: -1 }] },
      { name: "Temporária", changes: [{ key: "criticoM", type: "add", value: -1 }], automatic: false, temporary: true }
    ]
  });
  actor.items.set(real.id, real);
  const clone = cloneWeapon(real);
  foldItemSystem(clone.system, "effective", PATCHES_ON());
  assert.equal(clone.system.criticoM, 18);
  const list = createOnUseWrapper(systemOnUse(), { mode: () => "effective", patches: PATCHES_ON }).call(clone);
  assert.equal(list.length, 0);
  assert.equal(rollCrit(clone, list).criticoM, 18);

  const displayClone = cloneWeapon(real);
  const displayList = createOnUseWrapper(systemOnUse(), { mode: () => "display" }).call(displayClone);
  assert.equal(rollCrit(displayClone, displayList).criticoM, 18);
});

test("roll clone: different plan ids → nothing removed, base kept", () => {
  const actor = fakeActor();
  const real = fakeWeapon({ actor, effects: [{ name: "Precisa", changes: [{ key: "criticoM", type: "add", value: -1 }] }] });
  actor.items.set(real.id, real);
  const clone = cloneWeapon(real);
  foldItemSystem(clone.system, "effective", PATCHES_ON());
  const stray = fakeEffect({ name: "Estranho", changes: [{ key: "criticoX", type: "add", value: 1 }], parent: clone });
  const list = createOnUseWrapper(systemOnUse([stray]), { mode: () => "effective", patches: PATCHES_ON }).call(clone);
  assert.equal(list.length, 2);
  assert.equal(clone.system.criticoM, 19);
  const result = rollCrit(clone, list);
  assert.equal(critLabel(result.criticoM, result.criticoX), "18/3x");
});

test("unowned weapon in effective mode: no fold, the badge shows 18, the wrapper changes nothing", () => {
  const item = fakeWeapon({ effects: [{ name: "Precisa", changes: [{ key: "criticoM", type: "add", value: -1 }] }] });
  foldItemSystem(item.system, "effective", PATCHES_ON());
  assert.equal(item.system.criticoM, 19);
  assert.equal(statsFor(item, "effective", PATCHES_ON()).criticoM.final, 18);
  const list = createOnUseWrapper(systemOnUse(), { mode: () => "effective", patches: PATCHES_ON }).call(item);
  assert.deepEqual(list, []);
  assert.equal(item.system.criticoM, 19);
});

for (const [label, spec] of [
  ["disabled migrated Precisa", { disabled: true }],
  ["Precisa selected by name only", { types: [], names: ["Espada Longa"] }]
]) {
  test(`${label}: badge 18 and roll 18 in display and effective`, () => {
    const actor = fakeActor();
    const real = fakeWeapon({ actor, effects: [{ name: "Precisa", changes: [{ key: "criticoM", type: "add", value: -1 }], ...spec }] });
    actor.items.set(real.id, real);
    assert.equal(statsFor(real, "display", PATCHES_ON()).criticoM.final, 18);
    for (const mode of ["display", "effective"]) {
      const clone = cloneWeapon(real);
      if (mode === "effective") foldItemSystem(clone.system, mode, PATCHES_ON());
      const list = createOnUseWrapper(systemOnUse(), { mode: () => mode, patches: PATCHES_ON }).call(clone);
      assert.equal(rollCrit(clone, list).criticoM, 18, mode);
    }
  });
}

function fakeArmor({ actor = null, penalidade = -5, value = 10, effects = [], id = "a1" } = {}) {
  const item = {
    id,
    name: "Armadura",
    type: "equipamento",
    documentName: "Item",
    _source: { system: { tipo: "pesada", armadura: { value, penalidade } } },
    system: { tipo: "pesada", equipado: true, armadura: { value, penalidade } },
    effects: [],
    parent: actor,
    isEmbedded: !!actor
  };
  item.system.parent = item;
  for (const spec of effects) item.effects.push(fakeEffect({ onuse: false, transfer: true, ...spec, parent: item }));
  actor?.items.set(item.id, item);
  return item;
}

function skipFor(item, effect, change, consumed = true) {
  return shouldSkipFoldedChange({
    mode: "effective",
    change,
    targetIsActor: true,
    ownedByTarget: true,
    consumed,
    itemType: item.type,
    tipo: item._source.system.tipo,
    hasStatus: effect.system.status !== null,
    onuse: effect.system.onuse,
    folded: foldedState(item)
  });
}

test("effective armor: Ajustada folded into the item and skipped on the actor", () => {
  const armorItem = fakeArmor({ actor: fakeActor(), effects: [{ name: "Ajustada", changes: [pda(-1)] }, { name: "Reforçada", changes: [bonus(1)] }] });
  foldItemSystem(armorItem.system, "effective", PATCHES_ON());
  assert.equal(armorItem.system.armadura.penalidade, -4);
  assert.equal(armorItem.system.armadura.value, 11);
  assert.equal(armorItem._source.system.armadura.penalidade, -5);
  assert.equal(skipFor(armorItem, armorItem.effects[0], armorItem.effects[0].system.changes[0]), true);
  assert.equal(skipFor(armorItem, armorItem.effects[1], armorItem.effects[1].system.changes[0]), true);
  // A second equipped armor is not read by prepareDefense: its changes keep applying to the actor.
  assert.equal(skipFor(armorItem, armorItem.effects[1], armorItem.effects[1].system.changes[0], false), false);
  // Idempotent.
  foldItemSystem(armorItem.system, "effective", PATCHES_ON());
  assert.equal(armorItem.system.armadura.penalidade, -4);
  // Not in display mode.
  assert.equal(shouldSkipFoldedChange({ mode: "display", change: pda(-1), targetIsActor: true, ownedByTarget: true, itemType: "equipamento", tipo: "pesada", hasStatus: false, folded: { penalty: true } }), false);
});

test("effective armor: a status Defense bonus (immune bearer) is neither folded nor skipped", () => {
  const armorItem = fakeArmor({ actor: fakeActor(), effects: [{ name: "Mental", changes: [bonus(2)], status: { category: "mental" } }] });
  foldItemSystem(armorItem.system, "effective", PATCHES_ON());
  assert.equal(armorItem.system.armadura.value, 10);
  assert.equal(skipFor(armorItem, armorItem.effects[0], armorItem.effects[0].system.changes[0]), false);
});

test("effective armor: a status pda increase keeps the base penalty and nothing is skipped", () => {
  const armorItem = fakeArmor({
    actor: fakeActor(),
    penalidade: -1,
    effects: [{ name: "Sob Medida", changes: [pda(-2)] }, { name: "Status", changes: [pda(1)], status: { category: "x" } }]
  });
  foldItemSystem(armorItem.system, "effective", PATCHES_ON());
  assert.equal(armorItem.system.armadura.penalidade, -1);
  assert.equal(skipFor(armorItem, armorItem.effects[0], armorItem.effects[0].system.changes[0]), false);
});

test("effective armor: an actor pda effect linked by origin keeps the base penalty", () => {
  const actor = fakeActor();
  const armorItem = fakeArmor({ actor, penalidade: -1, effects: [{ name: "Sob Medida", changes: [pda(-2)] }] });
  actor.effects.push(fakeEffect({ name: "Ligado", changes: [pda(1)], onuse: false, origin: "Actor.x.Item.a1", parent: actor }));
  const parseUuid = (uuid) => ({ id: uuid.split(".").pop() });
  assert.equal(linkedPdaCount(armorItem, parseUuid), 1);
  globalThis.foundry = { utils: { parseUuid } };
  try {
    foldItemSystem(armorItem.system, "effective", PATCHES_ON());
  } finally {
    delete globalThis.foundry;
  }
  assert.equal(armorItem.system.armadura.penalidade, -1);
  assert.equal(skipFor(armorItem, armorItem.effects[0], armorItem.effects[0].system.changes[0]), false);
});

test("detailedStats keeps the critical range and multiplier together for the chat snapshot", () => {
  const result = detailedStats(stats(weapon({ toHit: "+5", dano: "1d8" }), [macica()]));
  assert.deepEqual(Object.keys(result).sort(), ["criticoM", "criticoX"]);
  assert.equal(critLabel(result.criticoM.final, result.criticoX.final), "19/3x");
});
