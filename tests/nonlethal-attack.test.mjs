import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FORM_FIELD,
  NATURAL_FLAG,
  PENALTY,
  decide,
  installNonlethalAttackRule,
  isDamageParts,
  naturalType,
  onRenderDialog,
  onRenderItemSheet,
  parseChoice,
  penaltyFor,
  waiversFor
} from "../scripts/rules/nonlethal-attack.mjs";
import { ROLL_DATA_KEY, pickDamageRoll, recordedNonlethal } from "../scripts/rules/nonlethal-damage.mjs";

const MODULE = "t20-community-patches";

/* -------------------------------------------- */
/*  Pure logic                                  */
/* -------------------------------------------- */

test("natural type: the field wins; auto is nonlethal for unarmed or active Piedosa", () => {
  assert.equal(naturalType({ mode: "auto" }), "lethal");
  assert.equal(naturalType({ mode: undefined, unarmed: true }), "nonlethal");
  assert.equal(naturalType({ mode: "auto", merciful: true }), "nonlethal");
  assert.equal(naturalType({ mode: "lethal", unarmed: true }), "lethal");
  assert.equal(naturalType({ mode: "nonlethal" }), "nonlethal");
  assert.equal(naturalType({ mode: "bogus", unarmed: true }), "nonlethal");
});

test("penalty: -5 only when the choice contradicts the natural type and nothing waives it", () => {
  assert.equal(penaltyFor({ choice: "lethal", natural: "lethal", waived: [] }), 0);
  assert.equal(penaltyFor({ choice: "nonlethal", natural: "lethal", waived: [] }), PENALTY);
  assert.equal(penaltyFor({ choice: "lethal", natural: "nonlethal", waived: [] }), -5);
  assert.equal(penaltyFor({ choice: "nonlethal", natural: "lethal", waived: ["piedoso"] }), 0);
});

test("waivers follow each power's limits", () => {
  const all = ["piedoso", "estilo", "paoCirco"];
  // Ataque Piedoso: nonlethal with a melee weapon only.
  assert.deepEqual(waiversFor({ choice: "nonlethal", natural: "lethal", melee: true, powers: ["piedoso"] }), ["piedoso"]);
  assert.deepEqual(waiversFor({ choice: "nonlethal", natural: "lethal", melee: false, powers: ["piedoso"] }), []);
  assert.deepEqual(waiversFor({ choice: "lethal", natural: "nonlethal", melee: true, powers: ["piedoso"] }), []);
  // Estilo Desarmado: both directions, unarmed only.
  assert.deepEqual(waiversFor({ choice: "lethal", natural: "nonlethal", unarmed: true, melee: true, powers: ["estilo"] }), ["estilo"]);
  assert.deepEqual(waiversFor({ choice: "nonlethal", natural: "lethal", unarmed: true, melee: true, powers: ["estilo"] }), ["estilo"]);
  assert.deepEqual(waiversFor({ choice: "nonlethal", natural: "lethal", unarmed: false, melee: true, powers: ["estilo"] }), []);
  // Pão e Circo: nonlethal with any weapon.
  assert.deepEqual(waiversFor({ choice: "nonlethal", natural: "lethal", melee: false, powers: new Set(["paoCirco"]) }), ["paoCirco"]);
  assert.deepEqual(waiversFor({ choice: "lethal", natural: "nonlethal", unarmed: true, powers: ["paoCirco"] }), []);
  // No penalty, nothing to waive.
  assert.deepEqual(waiversFor({ choice: "lethal", natural: "lethal", unarmed: true, melee: true, powers: all }), []);
  assert.deepEqual(decide({ choice: "nonlethal", natural: "lethal", unarmed: true, melee: true, powers: all }), {
    choice: "nonlethal", natural: "lethal", waivers: ["piedoso", "estilo", "paoCirco"], penalty: 0
  });
});

test("parseChoice accepts only a known, unambiguous value", () => {
  assert.equal(parseChoice("nonlethal"), "nonlethal");
  assert.equal(parseChoice([null, "lethal"]), "lethal");
  assert.equal(parseChoice(["lethal", "nonlethal"]), null);
  assert.equal(parseChoice("x"), null);
  assert.equal(parseChoice(undefined), null);
});

test("isDamageParts excludes healing, recovery and HP loss", () => {
  assert.equal(isDamageParts([["1d8", "corte"], ["@for", ""]]), true);
  assert.equal(isDamageParts([["2d8", "curapv"]]), false);
  assert.equal(isDamageParts([["1d6", "perda"]]), false);
  assert.equal(isDamageParts(undefined), false);
});

test("recordedNonlethal reads the choice the attack recorded in the damage roll", () => {
  const rolls = [
    { options: { type: "attack", title: "Ataque" } },
    { options: { type: "damage", title: "Dano", [MODULE]: { [ROLL_DATA_KEY]: { v: 1, nonlethal: true } } } }
  ];
  assert.equal(recordedNonlethal(pickDamageRoll(rolls, "Dano")), true);
  assert.equal(recordedNonlethal({ options: { [MODULE]: { [ROLL_DATA_KEY]: { v: 1, nonlethal: false } } } }), false);
  assert.equal(recordedNonlethal(undefined), false);
});

/* -------------------------------------------- */
/*  Foundry mocks                               */
/* -------------------------------------------- */

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classes = new Set();
    this._text = "";
    this.parent = null;
  }
  set className(value) {
    this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  get className() {
    return [...this.classes].join(" ");
  }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }
  append(...nodes) {
    for (const node of nodes) node.parent = this;
    this.children.push(...nodes);
  }
  addEventListener(type, fn) {
    (this.listeners ??= {})[type] = fn;
  }
  before(node) {
    const siblings = this.parent.children;
    node.parent = this.parent;
    siblings.splice(siblings.indexOf(this), 0, node);
  }
  after(node) {
    const siblings = this.parent.children;
    node.parent = this.parent;
    siblings.splice(siblings.indexOf(this) + 1, 0, node);
  }
  closest(selector) {
    for (let el = this; el; el = el.parent) if (el.matches?.(selector)) return el;
    return null;
  }
  matches(selector) {
    if (selector === "form" || selector === "form#ability-use-form") return this.tagName === "FORM";
    if (selector === "[name=rollKeep]") return this.name === "rollKeep";
    const named = selector.match(/^(\w+)\[name="([^"]+)"\]$/);
    if (named) return this.tagName === named[1].toUpperCase() && this.name === named[2];
    if (selector.startsWith("input")) return this.tagName === "INPUT";
    const [, cls, attr] = selector.match(/^\.([\w-]+)(?:\[data-([\w-]+)\])?$/) ?? [];
    if (!cls || !this.classes.has(cls)) return false;
    return !attr || attr.replace(/-(\w)/g, (_, c) => c.toUpperCase()) in this.dataset;
  }
  querySelectorAll(selector) {
    const out = [];
    for (const child of this.children) {
      if (child.matches?.(selector)) out.push(child);
      if (child.querySelectorAll) out.push(...child.querySelectorAll(selector));
    }
    return out;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === "object") flatten(value, `${prefix}${key}.`, out);
    else out[`${prefix}${key}`] = value;
  }
  return out;
}
const STRINGS = flatten(JSON.parse(readFileSync(new URL("../lang/pt-BR.json", import.meta.url))));

const UNARMED = "Compendium.tormenta20.equipamentos.Item.NFepeG0ojjq3Xggs";
const power = (id, name) => ({ type: "poder", name, _stats: { compendiumSource: `Compendium.tormenta20.poderes.Item.${id}` } });

/** ItemT20 mirroring the system: roll clones the item, rollAttack reads the first attack roll, rollDamage fills rolled. */
function setup({ rule = "on", powers = [] } = {}) {
  const settings = { [`${MODULE}.nonlethalDamageRule`]: rule };
  const registered = {};
  const seen = [];
  globalThis.game = {
    user: { targets: new Set() },
    settings: { get: (scope, key) => settings[`${scope}.${key}`] },
    i18n: {
      localize: (key) => STRINGS[key] ?? key,
      format: (key, data) => (STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => data[k])
    }
  };
  globalThis.Hooks = { on: (name, fn) => (registered[name] = fn) };
  globalThis.document = { createElement: (tag) => new FakeElement(tag), createTextNode: (text) => ({ textContent: String(text) }) };
  const actor = { items: powers };

  class ItemT20 {
    constructor(data) {
      Object.assign(this, structuredClone(data));
      this.actor = actor;
    }
    clone() {
      const { actor: _a, ...data } = this;
      return new ItemT20({ ...data, system: { ...data.system, rolled: undefined } });
    }
    async roll({ form, attack = true, between } = {}) {
      const item = this.clone();
      const options = { ...(form ?? {}), effects: [] };
      item.system.rolled = {};
      if (attack) await item.rollAttack({ options });
      between?.();
      await item.rollDamage({ options });
      return { item, options };
    }
    async rollAttack({ options = {} } = {}) {
      const first = this.system.rolls.find((r) => r.type === "ataque");
      const formula = first.parts.map((p) => p[0]).join(" + ");
      seen.push(formula);
      this.system.rolled[first.name] = { formula, options: { type: "attack" } };
    }
    async rollDamage({ options = {} } = {}) {
      options.type = "damage";
      for (const r of this.system.rolls.filter((x) => x.type === "dano")) this.system.rolled[r.name] = { options: { ...options } };
    }
  }
  globalThis.CONFIG = { Item: { documentClass: ItemT20 } };
  installNonlethalAttackRule();

  const weapon = ({ name = "Espada longa", source, proposito = "corpo-a-corpo", natural, effects = [], heal = false } = {}) =>
    new ItemT20({
      type: "arma",
      name,
      _stats: { compendiumSource: source },
      flags: natural ? { [MODULE]: { [NATURAL_FLAG]: natural } } : {},
      effects,
      system: {
        proposito,
        rolls: [
          { type: "ataque", name: "Ataque", parts: [["1d20"], ["luta"]] },
          { type: "dano", name: "Dano", parts: [["1d8", "corte"]] },
          ...(heal ? [{ type: "dano", name: "Cura", parts: [["1d4", "curapv"]] }] : [])
        ]
      }
    });
  return { ItemT20, weapon, seen, settings, registered };
}

const recorded = (item, name = "Dano") => item.system.rolled[name].options[MODULE]?.[ROLL_DATA_KEY];

function dialog(item) {
  const form = new FakeElement("form");
  const group = new FakeElement("div");
  group.className = "form-group";
  const select = new FakeElement("select");
  select.name = "rollKeep";
  group.append(select);
  const situational = new FakeElement("div");
  situational.className = "t20cp-situational";
  form.append(group, situational);
  const root = new FakeElement("div");
  root.append(form);
  return { app: { item, setPosition() {} }, form, group, situational };
}

function sheetRoot() {
  const root = new FakeElement("div");
  const group = new FakeElement("div");
  group.className = "form-group";
  const wielding = new FakeElement("select");
  wielding.name = "system.empunhadura";
  group.append(wielding);
  root.append(group);
  return root;
}

/* -------------------------------------------- */
/*  Integration                                 */
/* -------------------------------------------- */

test("nonlethal with a lethal weapon: -5 labelled in the clone's attack, choice recorded in the damage", async () => {
  const env = setup();
  const original = env.weapon();
  const { item } = await original.roll({ form: { [FORM_FIELD]: "nonlethal" } });
  assert.equal(env.seen[0], "1d20 + luta + -5[Não letal]");
  assert.deepEqual(original.system.rolls[0].parts, [["1d20"], ["luta"]]);
  assert.deepEqual(recorded(item), { v: 1, nonlethal: true });
});

test("lethal with the unarmed attack costs -5; the shortcut uses the natural type without penalty", async () => {
  const env = setup();
  const fist = env.weapon({ name: "Ataque desarmado", source: UNARMED });
  const lethal = await fist.roll({ form: { [FORM_FIELD]: "lethal" } });
  assert.equal(env.seen[0], "1d20 + luta + -5[Letal]");
  assert.deepEqual(recorded(lethal.item), { v: 1, nonlethal: false });
  const shortcut = await fist.roll();
  assert.equal(env.seen[1], "1d20 + luta");
  assert.deepEqual(recorded(shortcut.item), { v: 1, nonlethal: true });
});

test("the weapon field and an active Piedosa set the natural type", async () => {
  const env = setup();
  await env.weapon({ natural: "nonlethal" }).roll({ form: { [FORM_FIELD]: "nonlethal" } });
  const merciful = env.weapon({ effects: [{ system: { identifier: "merciful" }, disabled: false }] });
  const { item } = await merciful.roll();
  await env.weapon({ effects: [{ system: { identifier: "merciful" }, disabled: true }] }).roll({ form: { [FORM_FIELD]: "nonlethal" } });
  assert.deepEqual(env.seen, ["1d20 + luta", "1d20 + luta", "1d20 + luta + -5[Não letal]"]);
  assert.equal(recorded(item).nonlethal, true);
});

test("a waiver removes the -5 within its limits", async () => {
  const env = setup({ powers: [power("whJFemzRCrz6gvtp", "Ataque Piedoso")] });
  await env.weapon().roll({ form: { [FORM_FIELD]: "nonlethal" } });
  await env.weapon({ proposito: "disparo" }).roll({ form: { [FORM_FIELD]: "nonlethal" } });
  assert.deepEqual(env.seen, ["1d20 + luta", "1d20 + luta + -5[Não letal]"]);
});

test("healing rolls are not recorded; damage without an attack records without pushing", async () => {
  const env = setup();
  const { item } = await env.weapon({ heal: true }).roll({ form: { [FORM_FIELD]: "nonlethal" }, attack: false });
  assert.deepEqual(recorded(item), { v: 1, nonlethal: true });
  assert.equal(recorded(item, "Cura"), undefined);
  assert.deepEqual(item.system.rolls[0].parts, [["1d20"], ["luta"]]);
});

test("rule off: no penalty, nothing recorded, no dialog line, no sheet field", async () => {
  const env = setup({ rule: "off" });
  const weapon = env.weapon();
  const { item } = await weapon.roll({ form: { [FORM_FIELD]: "nonlethal" } });
  assert.equal(env.seen[0], "1d20 + luta");
  assert.equal(recorded(item), undefined);
  const d = dialog(weapon);
  onRenderDialog(d.app, d.form.parent);
  assert.equal(d.form.querySelector(".t20cp-nonlethal-attack"), null);
  const root = sheetRoot();
  onRenderItemSheet({ document: { type: "arma", flags: {} } }, [root]);
  assert.equal(root.children.length, 1);
});

test("dialog line: above the situational section, natural type checked, note follows the choice", () => {
  const env = setup({ powers: [power("k4kKX4hcWhrum67F", "Pão e Circo")] });
  const fist = env.weapon({ name: "Ataque desarmado", source: UNARMED });
  const d = dialog(fist);
  env.registered.renderAbilityUseDialog(d.app, [d.form.parent]);
  env.registered.renderAbilityUseDialog(d.app, [d.form.parent]);
  const lines = d.form.querySelectorAll(".t20cp-nonlethal-attack");
  assert.equal(lines.length, 1);
  assert.deepEqual(d.form.children.map((c) => c.className), ["form-group", "form-group t20cp-nonlethal-attack", "t20cp-situational"]);
  const radios = lines[0].querySelectorAll("input");
  assert.deepEqual(radios.map((r) => [r.name, r.value, r.checked]), [[FORM_FIELD, "lethal", false], [FORM_FIELD, "nonlethal", true]]);
  const note = lines[0].querySelector(".hint");
  assert.equal(note.textContent, "");
  radios[0].listeners.change();
  assert.equal(note.textContent, "\u22125 no ataque");
  radios[1].listeners.change();
  assert.equal(note.textContent, "");
});

test("the dialog line ignores weapons without damage and non-weapons", () => {
  const env = setup();
  const noDamage = env.weapon();
  noDamage.system.rolls = noDamage.system.rolls.filter((r) => r.type !== "dano");
  const power = new env.ItemT20({ type: "poder", system: { rolls: env.weapon().system.rolls } });
  for (const item of [noDamage, power]) {
    const d = dialog(item);
    onRenderDialog(d.app, d.form.parent);
    assert.equal(d.form.querySelector(".t20cp-nonlethal-attack"), null);
  }
});

test("weapon sheet: a 'Dano natural' select after 'Empunhadura' with the stored mode", () => {
  setup();
  const root = sheetRoot();
  onRenderItemSheet({ document: { type: "arma", flags: { [MODULE]: { [NATURAL_FLAG]: "nonlethal" } } }, isEditable: true }, [root]);
  const select = root.querySelector(`select[name="flags.${MODULE}.${NATURAL_FLAG}"]`);
  assert.ok(select);
  assert.equal(root.children[1].className, "form-group t20cp-natural-damage");
  assert.deepEqual(select.children.map((o) => [o.value, o.selected]), [["auto", false], ["lethal", false], ["nonlethal", true]]);
  onRenderItemSheet({ document: { type: "arma", flags: {} } }, [root]);
  assert.equal(root.querySelectorAll(`select[name="flags.${MODULE}.${NATURAL_FLAG}"]`).length, 1);
});

test("the penalty lives only during the clone's attack; direct calls on a document keep the official behavior", async () => {
  const env = setup();
  const weapon = env.weapon();
  const { item } = await weapon.roll({ form: { [FORM_FIELD]: "nonlethal" } });
  assert.deepEqual(item.system.rolls[0].parts, [["1d20"], ["luta"]]);
  weapon.system.rolled = {};
  await weapon.rollAttack({ options: { [FORM_FIELD]: "nonlethal" } });
  await weapon.rollDamage({ options: { [FORM_FIELD]: "nonlethal" } });
  assert.deepEqual(env.seen, ["1d20 + luta + -5[Não letal]", "1d20 + luta"]);
  assert.equal(recorded(weapon), undefined);
});

test("each use resolves its own choice; the rule is read again at damage time", async () => {
  const env = setup();
  const fist = await env.weapon({ name: "Ataque desarmado", source: UNARMED }).roll();
  const sword = await env.weapon().roll();
  assert.deepEqual([recorded(fist.item).nonlethal, recorded(sword.item).nonlethal], [true, false]);
  assert.deepEqual(env.seen, ["1d20 + luta", "1d20 + luta"]);
  const { item } = await env.weapon().roll({
    form: { [FORM_FIELD]: "nonlethal" },
    between: () => (env.settings[`${MODULE}.nonlethalDamageRule`] = "off")
  });
  assert.equal(env.seen[2], "1d20 + luta + -5[Não letal]");
  assert.equal(recorded(item), undefined);
});
