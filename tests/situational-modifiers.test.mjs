import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ANY_TARGET,
  FORM_ATTACK,
  FORM_DEFENSE,
  allowedModifiers,
  attackParts,
  attackSelection,
  chargeEffectData,
  decorate,
  defenseAdjustmentsByTarget,
  defenseRecord,
  installSituationalModifiersRule,
  isChargeEffect,
  normalizeValues,
  onRenderDialog,
  parseDefenseSelection,
  sanitizeFlavor,
  shouldCreateCharge
} from "../scripts/rules/situational-modifiers.mjs";
import { USE_PURPOSES, defenseAdjustmentsFor, withUsePurpose } from "../scripts/rules/shared/targets.mjs";
import { markCastFailed } from "../scripts/rules/cast-outcome.mjs";
import { markWrapper } from "../scripts/utils.mjs";

const MODULE = "t20-community-patches";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/* -------------------------------------------- */
/*  Pure functions                              */
/* -------------------------------------------- */

test("normalizeValues and attackSelection accept every FormDataExtended shape", () => {
  assert.deepEqual(normalizeValues(undefined), []);
  assert.deepEqual(normalizeValues(null), []);
  assert.deepEqual(normalizeValues("flank"), ["flank"]);
  assert.deepEqual(normalizeValues([null, "flank", null, "flank", "", 3]), ["flank"]);
  assert.deepEqual(attackSelection([null, "charge", "bogus", "flank"]), ["charge", "flank"]);
});

test("attackParts: table order, labels as flavor without brackets", () => {
  assert.deepEqual(attackParts(["longRange", "flank"], { flank: "Flan[quear]", longRange: "Alcance dobrado" }), [
    ["2[Flanquear]", ""],
    ["-5[Alcance dobrado]", ""]
  ]);
  assert.deepEqual(attackParts(["charge"], { charge: "[]" }), [["2", ""]]);
  assert.equal(sanitizeFlavor(undefined), "");
});

test("allowedModifiers: the maneuver resistance test only offers higher ground and no Defense", () => {
  assert.deepEqual(allowedModifiers(USE_PURPOSES.MANEUVER_RESISTANCE), { attack: ["elevated"], defense: false });
  const normal = allowedModifiers(null);
  assert.deepEqual([...normal.attack], ["flank", "charge", "elevated", "firingIntoMelee", "longRange"]);
  assert.equal(normal.defense, true);
});

test("parseDefenseSelection and defenseAdjustmentsByTarget: per target, '*' for all, unknown targets ignored", () => {
  const entries = parseDefenseSelection([null, "Scene.s.Token.A|cover", "*|invisible", "Scene.s.Token.Z|cover", "|cover", "x|bad", "nobar"]);
  assert.deepEqual(entries, [
    { target: "Scene.s.Token.A", id: "cover" },
    { target: ANY_TARGET, id: "invisible" },
    { target: "Scene.s.Token.Z", id: "cover" }
  ]);
  const byTarget = defenseAdjustmentsByTarget(entries, ["Scene.s.Token.A", "Scene.s.Token.B"]);
  assert.deepEqual([...byTarget], [
    ["Scene.s.Token.A", [{ id: "cover", delta: 5 }, { id: "invisible", delta: -5 }]],
    ["Scene.s.Token.B", [{ id: "invisible", delta: -5 }]]
  ]);
});

test("defenseRecord: one entry per target with adjustments, or one 'any target' entry without targets", () => {
  const records = [
    { uuid: "A", name: "Goblin", displayName: 50 },
    { uuid: "B", name: "Orc", displayName: 0 }
  ];
  assert.deepEqual(defenseRecord(records, [{ target: "B", id: "cover" }]), [
    { uuid: "B", index: 1, name: "Orc", displayName: 0, adjustments: [{ id: "cover", delta: 5 }] }
  ]);
  assert.deepEqual(defenseRecord([], [{ target: ANY_TARGET, id: "cover" }, { target: "A", id: "invisible" }]), [
    { uuid: null, index: 0, name: "", displayName: 0, adjustments: [{ id: "cover", delta: 5 }] }
  ]);
  assert.deepEqual(defenseRecord([], []), []);
});

test("charge effect: -2 Defense, no origin, statuses or duration, flagged; never stacks", () => {
  const data = chargeEffectData({ name: "Investida", description: "d" });
  assert.deepEqual(data.system.changes, [{ key: "system.attributes.defesa.bonus", type: "add", value: "-2", phase: "initial" }]);
  assert.equal(data.origin, undefined);
  assert.equal(data.statuses, undefined);
  assert.equal(data.duration, undefined);
  assert.equal(isChargeEffect(data), true);
  assert.equal(shouldCreateCharge([]), true);
  assert.equal(shouldCreateCharge([{ flags: {} }]), true);
  assert.equal(shouldCreateCharge([data]), false);
  assert.equal(shouldCreateCharge(new Map([["x", data]]).values()), false);
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
const LANG = {
  "pt-BR": flatten(JSON.parse(readFileSync(new URL("../lang/pt-BR.json", import.meta.url)))),
  en: flatten(JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url))))
};

const token = (id, { name = id, displayName = 50 } = {}) => ({
  document: { uuid: `Scene.s.Token.${id}`, name, displayName, isOwner: false }
});

/**
 * ItemT20 mirroring the system: roll clones the item, the dialog fills options, rollAttack reads the first attack
 * roll's parts, displayCard returns the card. `wrapBefore` installs a foreign wrapper before this rule.
 */
function setup({ rule = "on", isGM = true, invisible = false, wrapBefore, wrapAfter } = {}) {
  const settings = { [`${MODULE}.situationalModifiersRule`]: rule };
  const strings = LANG["pt-BR"];
  const docs = new Map();
  const hooks = {};
  const registered = {};
  const created = [];
  const seen = [];
  globalThis.game = {
    user: { isGM, targets: new Set() },
    settings: { get: (scope, key) => settings[`${scope}.${key}`] },
    i18n: {
      has: (key) => key in strings,
      localize: (key) => strings[key] ?? key,
      format: (key, data) => (strings[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => data[k])
    }
  };
  globalThis.Hooks = { on: (name, fn) => (registered[name] = fn) };
  globalThis.foundry = { utils: { fromUuidSync: (uuid) => docs.get(uuid) ?? null } };
  globalThis.document = { createElement: (tag) => new FakeElement(tag), createTextNode: (text) => ({ textContent: String(text) }) };

  const actor = {
    uuid: "Actor.hero",
    isOwner: true,
    effects: [],
    statuses: new Set(invisible ? ["invisivel"] : []),
    async createEmbeddedDocuments(type, data) {
      await tick();
      created.push({ type, data });
      this.effects.push(...data);
      return data;
    }
  };

  class ItemT20 {
    constructor(system) {
      this.system = system;
      this.actor = actor;
    }
    clone() {
      return new ItemT20(structuredClone({ ...this.system, rolled: undefined }));
    }
    async roll({ form = {}, card = true } = {}) {
      const item = this.clone({}, { keepId: true });
      await tick();
      const options = { ...form, effects: [] };
      hooks.duringDialog?.(item, options);
      item.system.rolled = {};
      await item.rollAttack({ options });
      const result = await item.displayCard({ options, createMessage: card });
      return { item, options, result };
    }
    async rollAttack({ options } = {}) {
      const first = this.system.rolls.find((r) => r.type === "ataque");
      const formula = first.parts.map((p) => p[0]).join(" + ");
      seen.push({ formula, adjustments: defenseAdjustmentsFor(this, "Scene.s.Token.A") });
      for (const r of this.system.rolls.filter((x) => x.type === "ataque")) this.system.rolled[r.name] = { formula, options: {} };
      return "attack-result";
    }
    async displayCard({ options } = {}) {
      hooks.duringCard?.(options);
      return { card: true };
    }
  }
  globalThis.CONFIG = { Item: { documentClass: ItemT20 } };
  wrapBefore?.(ItemT20.prototype, seen);
  installSituationalModifiersRule();
  wrapAfter?.(ItemT20.prototype, seen);

  const weapon = () =>
    new ItemT20({
      rolls: [
        { type: "ataque", name: "Ataque", parts: [["1d20"], ["luta"]] },
        { type: "ataque", name: "Disparo", parts: [["1d20"], ["pont"]] },
        { type: "dano", name: "Dano", parts: [["1d8"]] }
      ]
    });
  const target = (...tokens) => {
    for (const t of tokens) docs.set(t.document.uuid, t.document);
    game.user.targets = new Set(tokens);
  };
  return { ItemT20, weapon, target, actor, created, seen, settings, hooks, registered, docs };
}

/** A minimal use dialog body with the "Melhor/Pior de 2d20" group. */
function dialog(item) {
  const form = new FakeElement("form");
  const group = new FakeElement("div");
  group.className = "form-group";
  const select = new FakeElement("select");
  select.name = "rollKeep";
  group.append(select);
  const last = new FakeElement("div");
  form.append(group, last);
  const root = new FakeElement("div");
  root.append(form);
  return { app: { item, setPosition() {} }, root, form, group, last };
}

const inputs = (root) => root.querySelectorAll("input");

/* -------------------------------------------- */
/*  Integration                                 */
/* -------------------------------------------- */

test("attack boxes go into the first attack roll with labels; the item itself is untouched", async () => {
  const env = setup();
  const original = env.weapon();
  const { item } = await original.roll({ form: { [FORM_ATTACK]: ["flank", null, "longRange"], [FORM_DEFENSE]: [null] } });
  assert.equal(env.seen[0].formula, "1d20 + luta + 2[Flanquear] + -5[Alcance dobrado]");
  assert.deepEqual(original.system.rolls[0].parts, [["1d20"], ["luta"]]);
  assert.deepEqual(item.system.rolls[1].parts, [["1d20"], ["pont"]]);
  const data = item.system.rolled.Ataque.options[MODULE].situational;
  assert.deepEqual(data, { v: 1, attack: ["flank", "longRange"], defense: [] });
  assert.deepEqual(item.system.rolled.Disparo.options[MODULE].situational, data);
});

test("rule off, no boxes or a call without options: nothing changes", async () => {
  for (const variant of ["off", "no-form", "direct"]) {
    const env = setup({ rule: variant === "off" ? "off" : "on" });
    if (variant === "direct") {
      const item = env.weapon();
      item.system.rolled = {};
      assert.equal(await item.rollAttack(), "attack-result");
      assert.equal(item.system.rolled.Ataque.options[MODULE], undefined);
      continue;
    }
    const form = variant === "off" ? { [FORM_ATTACK]: "charge" } : {};
    const { item } = await env.weapon().roll({ form });
    assert.equal(env.seen[0].formula, "1d20 + luta", variant);
    assert.equal(item.system.rolled.Ataque.options[MODULE], undefined, variant);
    assert.equal(env.created.length, 0, variant);
  }
});

test("rollAttack twice with the same options adds the modifiers once", async () => {
  const env = setup();
  const item = env.weapon();
  item.system.rolled = {};
  const options = { [FORM_ATTACK]: "elevated" };
  await item.rollAttack({ options });
  await item.rollAttack({ options });
  assert.deepEqual(item.system.rolls[0].parts, [["1d20"], ["luta"], ["2[Posição elevada]", ""]]);
});

test("Defense boxes register per-target adjustments for attack-vs-defense, in either wrapper order", async () => {
  // A fake attack-vs-defense: reads the shared adjustments after its inner rollAttack.
  const fakeAvd = (proto, seen) => {
    const inner = proto.rollAttack;
    proto.rollAttack = markWrapper(async function (...args) {
      const result = await inner.apply(this, args);
      seen.push({ avd: defenseAdjustmentsFor(this, "Scene.s.Token.A") });
      return result;
    }, inner);
  };
  for (const order of ["wrapBefore", "wrapAfter"]) {
    const env = setup({ [order]: fakeAvd });
    env.target(token("A", { name: "Goblin" }), token("B", { name: "Orc", displayName: 0 }));
    const { item } = await env.weapon().roll({
      form: { [FORM_DEFENSE]: [null, "Scene.s.Token.A|cover", null, "Scene.s.Token.B|invisible", "Scene.s.Token.X|cover"] }
    });
    assert.deepEqual(env.seen.find((s) => s.avd).avd, [{ id: "cover", delta: 5 }], order);
    assert.equal(env.seen.find((s) => s.formula).formula, "1d20 + luta", order);
    assert.deepEqual(item.system.rolled.Ataque.options[MODULE].situational.defense, [
      { uuid: "Scene.s.Token.A", index: 0, name: "Goblin", displayName: 50, adjustments: [{ id: "cover", delta: 5 }] },
      { uuid: "Scene.s.Token.B", index: 1, name: "Orc", displayName: 0, adjustments: [{ id: "invisible", delta: -5 }] }
    ], order);
  }
});

test("targets changed with the dialog open: the frozen targets are used", async () => {
  const env = setup();
  env.target(token("A"));
  env.hooks.duringDialog = () => env.target(token("B"));
  const { item } = await env.weapon().roll({ form: { [FORM_DEFENSE]: ["Scene.s.Token.A|cover", "Scene.s.Token.B|cover"] } });
  assert.deepEqual(item.system.rolled.Ataque.options[MODULE].situational.defense.map((d) => d.uuid), ["Scene.s.Token.A"]);
});

test("maneuver resistance: only higher ground, no Defense, no charge", async () => {
  const env = setup();
  env.target(token("A"));
  const { item } = await withUsePurpose(USE_PURPOSES.MANEUVER_RESISTANCE, () =>
    env.weapon().roll({ form: { [FORM_ATTACK]: ["elevated", "charge", "flank"], [FORM_DEFENSE]: "*|cover" } })
  );
  assert.equal(env.seen[0].formula, "1d20 + luta + 2[Posição elevada]");
  assert.deepEqual(env.seen[0].adjustments, []);
  assert.deepEqual(item.system.rolled.Ataque.options[MODULE].situational, { v: 1, attack: ["elevated"], defense: [] });
  await tick();
  assert.equal(env.created.length, 0);
});

test("charge: creates the effect once after the card, never twice, and not when the use failed", async () => {
  const env = setup();
  const form = { [FORM_ATTACK]: "charge" };
  await Promise.all([env.weapon().roll({ form }), env.weapon().roll({ form })]);
  assert.equal(env.created.length, 1);
  assert.equal(env.created[0].type, "ActiveEffect");
  assert.equal(env.created[0].data[0].name, "Investida (guarda aberta)");
  await env.weapon().roll({ form });
  assert.equal(env.created.length, 1);

  const failed = setup();
  failed.hooks.duringCard = (options) => markCastFailed(options, { rule: "x", reason: "y" });
  await failed.weapon().roll({ form });
  assert.equal(failed.created.length, 0);
});

test("charge is not created for an actor the user does not own", async () => {
  const env = setup();
  env.actor.isOwner = false;
  await env.weapon().roll({ form: { [FORM_ATTACK]: "charge" } });
  assert.equal(env.created.length, 0);
});

test("dialog: one section after rollKeep, one row per frozen target, invisible pre-checked", () => {
  const env = setup({ invisible: true });
  env.target(token("A", { name: "Goblin" }), token("B", { name: "Segredo", displayName: 0 }));
  game.user.isGM = false;
  const item = env.weapon();
  const { app, root, form } = dialog(item);
  env.registered.renderAbilityUseDialog(app, [root]);
  env.registered.renderAbilityUseDialog(app, [root]);
  const sections = form.querySelectorAll(".t20cp-situational");
  assert.equal(sections.length, 1);
  assert.equal(form.children[1], sections[0]);
  const boxes = inputs(sections[0]);
  assert.deepEqual(boxes.filter((b) => b.name === FORM_ATTACK).map((b) => b.value), ["flank", "charge", "elevated", "firingIntoMelee", "longRange"]);
  const defense = boxes.filter((b) => b.name === FORM_DEFENSE);
  assert.deepEqual(defense.map((b) => [b.value, b.checked]), [
    ["Scene.s.Token.A|cover", false],
    ["Scene.s.Token.A|invisible", true],
    ["Scene.s.Token.B|cover", false],
    ["Scene.s.Token.B|invisible", true]
  ]);
  const text = sections[0].textContent;
  assert.match(text, /Goblin/);
  assert.match(text, /Alvo 2/);
  assert.doesNotMatch(text, /Segredo/);
});

test("dialog: no targets shows 'Qualquer alvo'; rule off, no attack roll or maneuver hides the Defense", () => {
  const env = setup();
  const { app, root, form } = dialog(env.weapon());
  onRenderDialog(app, root);
  assert.match(form.querySelector(".t20cp-situational").textContent, /Qualquer alvo/);
  assert.ok(inputs(form).some((b) => b.value === "*|cover"));

  const spell = new env.ItemT20({ rolls: [{ type: "dano", name: "Dano", parts: [["1d6"]] }] });
  const noAttack = dialog(spell);
  onRenderDialog(noAttack.app, noAttack.root);
  assert.equal(noAttack.form.querySelector(".t20cp-situational"), null);

  env.settings[`${MODULE}.situationalModifiersRule`] = "off";
  const off = dialog(env.weapon());
  onRenderDialog(off.app, off.root);
  assert.equal(off.form.querySelector(".t20cp-situational"), null);
});

test("dialog: the maneuver resistance test only shows higher ground", async () => {
  const env = setup();
  env.target(token("A"));
  let rendered;
  env.hooks.duringDialog = (item) => {
    rendered = dialog(item);
    onRenderDialog(rendered.app, rendered.root);
  };
  await withUsePurpose(USE_PURPOSES.MANEUVER_RESISTANCE, () => env.weapon().roll());
  assert.deepEqual(inputs(rendered.form).map((b) => b.value), ["elevated"]);
});

/* -------------------------------------------- */
/*  Chat card                                   */
/* -------------------------------------------- */

function card(rolls) {
  const html = new FakeElement("div");
  for (const roll of rolls) {
    const el = new FakeElement("div");
    el.className = "roll";
    el.dataset.rollTitle = roll.options.title;
    html.append(el);
  }
  return { message: { isContentVisible: true, rolls }, html };
}

test("card note: listed per target with the recorded name policy; skipped when attack-vs-defense compared", () => {
  const env = setup({ isGM: false });
  const defense = [
    { uuid: "Scene.s.Token.A", name: "Goblin", displayName: 50, adjustments: [{ id: "cover", delta: 5 }, { id: "invisible", delta: -5 }] },
    { uuid: "Scene.s.Token.B", name: "Segredo", displayName: 0, adjustments: [{ id: "cover", delta: 5 }] }
  ];
  const situational = { v: 1, attack: [], defense };
  const { message, html } = card([
    { options: { title: "Ataque", [MODULE]: { situational } } },
    { options: { title: "Disparo", [MODULE]: { situational, attackVsDefense: { targets: [{}] } } } }
  ]);
  decorate(message, html);
  decorate(message, html);
  const notes = html.querySelectorAll(".t20cp-situational-note");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].parent.dataset.rollTitle, "Ataque");
  const text = notes[0].textContent;
  assert.match(text, /Defesa do alvo \(Tabela 5-3\)/);
  assert.match(text, /Goblin: cobertura leve: \+5 · atacante invisível: −5/);
  assert.match(text, /Alvo 2: cobertura leve: \+5/);
  assert.doesNotMatch(text, /Segredo/);
  assert.equal(env.docs.size, 0);
});

test("card note: a hidden target keeps its number from the dialog when earlier targets have no adjustment", async () => {
  const env = setup({ isGM: false });
  env.target(token("A", { name: "Oculto 1", displayName: 0 }), token("B", { name: "Oculto 2", displayName: 0 }));
  const { item } = await env.weapon().roll({ form: { [FORM_DEFENSE]: ["Scene.s.Token.B|cover"] } });
  const rolled = item.system.rolled.Ataque;
  rolled.options.title = "Ataque";
  const { message, html } = card([rolled]);
  decorate(message, html);
  const text = html.querySelector(".t20cp-situational-note").textContent;
  assert.match(text, /Alvo 2: cobertura leve: \+5/);
  assert.doesNotMatch(text, /Alvo 1|Oculto/);
});

test("card note: hidden content, no data or no adjustments add nothing", () => {
  setup();
  const situational = { v: 1, attack: ["flank"], defense: [] };
  for (const [rolls, visible] of [
    [[{ options: { title: "Ataque", [MODULE]: { situational } } }], true],
    [[{ options: { title: "Ataque" } }], true],
    [[{ options: { title: "Ataque", [MODULE]: { situational: { ...situational, defense: [{ uuid: null, adjustments: [{ id: "cover" }] }] } } } }], false]
  ]) {
    const { message, html } = card(rolls);
    message.isContentVisible = visible;
    decorate(message, html);
    assert.equal(html.querySelector(".t20cp-situational-note"), null);
  }
});

/* -------------------------------------------- */
/*  i18n                                        */
/* -------------------------------------------- */

test("i18n: pt-BR and en have the same keys and every label the rule uses", () => {
  const keys = (lang) => Object.keys(LANG[lang]).filter((k) => k.startsWith("T20CP.SituationalModifiers.") || k.startsWith("T20CP.DefenseAdjustment."));
  assert.deepEqual(keys("en").sort(), keys("pt-BR").sort());
  for (const id of ["flank", "charge", "elevated", "firingIntoMelee", "longRange"]) {
    for (const group of ["Attack", "Label", "Tooltip"]) assert.ok(LANG.en[`T20CP.SituationalModifiers.${group}.${id}`], `${group}.${id}`);
  }
  for (const id of ["cover", "invisible"]) {
    assert.ok(LANG.en[`T20CP.DefenseAdjustment.${id}`]);
    assert.ok(LANG.en[`T20CP.SituationalModifiers.Defense.${id}`]);
    assert.ok(LANG.en[`T20CP.SituationalModifiers.Tooltip.${id}`]);
  }
});
