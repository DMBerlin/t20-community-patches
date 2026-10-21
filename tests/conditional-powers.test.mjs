import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONDITIONAL_POWERS, findRule, summarizeLoadout, evaluateCondition, isConditionSuppressed, ownsFanatic,
  diagnose
} from "../scripts/patches/conditional-powers.mjs";

const rule = (item) => CONDITIONAL_POWERS.find((r) => r.item === item);
const weapon = (system, extra = {}) => ({ type: "arma", name: "Arma", ...extra, system: { proficiencia: "marcial", ...system } });
const melee = (empunhadura, equipado, extra = {}) =>
  weapon({ empunhadura, equipado, propriedades: { leve: empunhadura === "leve" }, rolls: [{ type: "ataque", parts: [["1d20"], ["luta"]] }] }, extra);
const bow = (equipado) => weapon({ empunhadura: "duas", equipado, propriedades: { ataqueDistancia: true }, rolls: [{ type: "ataque", parts: [["1d20"], ["pont"]] }] });
const gear = (tipo, equipado, slot = 0) => ({ type: "equipamento", system: { tipo, equipado, equipado2: { slot } } });
const info = (r, overrides = {}) => ({
  itemType: "poder", source: r.source, effectId: r.effectId, itemName: r.item, effectName: r.effect,
  onuse: false, transfer: true, changeKeys: [...r.keys], ...overrides
});
const evalFor = (item, items, type = "character", slots = false) =>
  evaluateCondition(rule(item).condition, summarizeLoadout(items, slots), type);

test("findRule recognizes official effects by id, official copies by effect name and items without origin by name", () => {
  for (const r of CONDITIONAL_POWERS) assert.equal(findRule(info(r)), r);
  const r = rule("Encouraçado");
  assert.equal(findRule(info(r, { effectId: "regenerado" })), r);
  assert.equal(findRule(info(r, { source: "", effectId: "regenerado" })), r);
  assert.equal(findRule(info(r, { source: undefined, effectId: "regenerado" })), r);
});

test("findRule ignores homonyms from another origin", () => {
  const r = rule("Encouraçado");
  assert.equal(findRule(info(r, { source: "Compendium.homebrew.powers.Item.other", effectId: "x" })), null);
  assert.equal(findRule(info(r, { source: "Compendium.homebrew.powers.Item.other" })), null);
  assert.equal(findRule(info(r, { effectId: "x", effectName: "Outro" })), null);
});

test("findRule ignores usage, non-transferred, non-power and customized effects", () => {
  const r = rule("Estilo de Uma Arma");
  assert.equal(findRule(info(r, { onuse: true })), null);
  assert.equal(findRule(info(r, { transfer: false })), null);
  assert.equal(findRule(info(r, { itemType: "arma" })), null);
  assert.equal(findRule(info(r, { changeKeys: ["system.attributes.defesa.bonus", "system.modificadores.ataque.cac"] })), null);
  assert.equal(findRule(info(r, { changeKeys: [] })), null);
  assert.equal(findRule(info(r, { source: "", effectId: "x", itemName: "Lobo Solitário", effectName: "Lobo Solitário" })), null);
});

test("Estilo de Duas Mãos needs a non-light melee weapon in both hands", () => {
  assert.equal(evalFor("Estilo de Duas Mãos", [melee("duas", 2)]), "met");
  assert.equal(evalFor("Estilo de Duas Mãos", [melee("duas", 1)]), "met");
  assert.equal(evalFor("Estilo de Duas Mãos", [melee("uma", 2)]), "met");
  assert.equal(evalFor("Estilo de Duas Mãos", [melee("uma", 1)]), "unmet");
  assert.equal(evalFor("Estilo de Duas Mãos", [melee("leve", 2)]), "unmet");
  assert.equal(evalFor("Estilo de Duas Mãos", [bow(2)]), "unmet");
  assert.equal(evalFor("Estilo de Duas Mãos", [melee("duas", 0)]), "unmet");
  assert.equal(evalFor("Estilo de Duas Mãos", [{ ...melee("uma", true), system: { ...melee("uma", true).system, equipado2: { slot: 12.1 } } }], "character", true), "met");
  assert.equal(evalFor("Estilo de Duas Mãos", [], "npc"), "unknown");
});

test("Estilo de Uma Arma needs one melee weapon in one hand and nothing in the other", () => {
  assert.equal(evalFor("Estilo de Uma Arma", [melee("uma", 1)]), "met");
  assert.equal(evalFor("Estilo de Uma Arma", [melee("uma", 1), melee("leve", 0, { name: "Ataque desarmado" })]), "met");
  assert.equal(evalFor("Estilo de Uma Arma", [melee("uma", 1), melee("leve", 1, { name: "Ataque desarmado" })]), "met");
  assert.equal(evalFor("Estilo de Uma Arma", [melee("uma", 1), gear("escudo", true)]), "unmet");
  assert.equal(evalFor("Estilo de Uma Arma", [melee("uma", 1), melee("leve", 1)]), "unmet");
  assert.equal(evalFor("Estilo de Uma Arma", [melee("uma", 2)]), "unmet");
  assert.equal(evalFor("Estilo de Uma Arma", [bow(2)]), "unmet");
  assert.equal(evalFor("Estilo de Uma Arma", []), "unmet");
  const sword = melee("uma", true);
  sword.system.equipado2 = { slot: 1.1 };
  assert.equal(evalFor("Estilo de Uma Arma", [sword], "character", true), "met");
  assert.equal(evalFor("Estilo de Uma Arma", [sword, gear("esoterico", true, 2.1)], "character", true), "unmet");
  assert.equal(evalFor("Estilo de Uma Arma", [], "npc"), "unknown");
});

test("shield and heavy armor conditions follow the equipped equipment, for any actor type", () => {
  assert.equal(evalFor("Estilo de Arma e Escudo", [gear("escudo", true)], "npc"), "met");
  assert.equal(evalFor("Estilo de Arma e Escudo", [gear("escudo", false)]), "unmet");
  for (const item of ["Encouraçado", "Fanático", "Inexpugnável"]) {
    assert.equal(evalFor(item, [gear("pesada", true)]), "met");
    assert.equal(evalFor(item, [gear("leve", true)], "npc"), "unmet");
    assert.equal(evalFor(item, [gear("pesada", true, 1.2)], "character", true), "met");
    assert.equal(evalFor(item, [gear("pesada", true, 0)], "character", true), "unmet");
  }
});

test("isConditionSuppressed reads the effect's item and actor", () => {
  const r = rule("Encouraçado");
  const actor = { documentName: "Actor", type: "character", items: [] };
  const item = { documentName: "Item", type: "poder", name: r.item, parent: actor, _stats: { compendiumSource: r.source } };
  actor.items.push(item);
  const effect = { id: r.effectId, name: r.effect, parent: item, transfer: true, system: { onuse: false, changes: [{ key: r.keys[0] }] } };
  assert.equal(isConditionSuppressed(effect, false), true);
  actor.items.push(gear("pesada", true));
  assert.equal(isConditionSuppressed(effect, false), false);
  assert.equal(isConditionSuppressed({ ...effect, parent: actor }, false), false);
});

test("ownsFanatic follows the same origin rule", () => {
  assert.equal(ownsFanatic([{ type: "poder", name: "Fanático" }]), true);
  assert.equal(ownsFanatic([{ type: "poder", name: "Fanático", _stats: { compendiumSource: rule("Fanático").source } }]), true);
  assert.equal(ownsFanatic([{ type: "poder", name: "Fanático", _stats: { compendiumSource: "Compendium.homebrew.powers.Item.other" } }]), false);
  assert.equal(ownsFanatic([{ type: "poder", name: "Encouraçado" }, { type: "arma", name: "Fanático" }]), false);
});

test("diagnose recognizes only the exact 1.6.5 getters and never reports a fix", () => {
  const doc = `get isSuppressed() {
    if (this._suppressed) return this._suppressed;
    this._suppressed = super.isSuppressed; // cache
    return this._suppressed;
  }`;
  const base = `get isSuppressed() {
    if (!this.parent.isEmbedded) return false;
    if (!this.parent.target) return false;
    if (this.parent.target.documentName != "Actor") return false;
    let suppressed = super.isSuppressed ?? false;
    if (!suppressed) suppressed = this.isSuppressedByEquipment;
    // if (!suppressed) suppressed = this.isSuppressedByTarget;
    if (this.status) {
      if (!suppressed) suppressed = this.isSuppressedByInheritance;
      if (!suppressed) suppressed = this.isSuppressedByDuplicated;
      if (!suppressed) suppressed = this.isSuppressedByUpgrade;
      if (!suppressed) suppressed = this.isSuppressedByImunity;
    }
    return suppressed;
  }`;
  assert.deepEqual(diagnose(doc, base), { bug: "present", confidence: "low", evidence: "isSuppressed ignores armor, shields and wielded weapons" });
  const extra = base.replace("return suppressed;", "if (!suppressed) suppressed = customCheck(); return suppressed;");
  assert.equal(diagnose(doc, extra).bug, "unknown");
  const delegated = doc.replace("return this._suppressed;\n  }", "return this._suppressed || customSuppression();\n  }");
  assert.notEqual(delegated, doc);
  assert.equal(diagnose(delegated, base).bug, "unknown");
  assert.equal(diagnose("get isSuppressed() { return wrapped.call(this); }", base).bug, "unknown");
  assert.equal(diagnose(undefined, base).bug, "unknown");
  for (const d of [diagnose(doc, extra), diagnose(undefined, undefined)]) assert.equal(d.confidence, "low");
});
