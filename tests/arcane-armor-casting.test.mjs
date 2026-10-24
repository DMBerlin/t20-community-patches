import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appliedEffectIds,
  armorTestDC,
  armorTestFormula,
  armorTestRequirement,
  armorTestTraining,
  canPayGrant,
  failureKey,
  grantUsedKey,
  installArcaneArmorRule,
  outcomeForSource,
  resolveArmorTest,
  spellSources,
  strongestWaiver,
  usesDiscreetCasting,
  withGrantPayment,
  wornArmor
} from "../scripts/rules/arcane-armor-casting.mjs";
import { castCompleted, castFailed, isCastUse } from "../scripts/rules/cast-outcome.mjs";
import { automaticApplied } from "../scripts/rules/mana-limit.mjs";
import { installManaQueue } from "../scripts/rules/mana-queue.mjs";
import { isTrainedFor, plainUseEffect, trainingGrants } from "../scripts/rules/skill-training.mjs";

const slugify = (text) =>
  String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
if (!String.prototype.slugify) {
  Object.defineProperty(String.prototype, "slugify", {
    value() {
      return slugify(this);
    }
  });
}

/* -------------------------------------------- */
/*  Pure helpers                                */
/* -------------------------------------------- */

const equip = (tipo, { equipado = true, slot } = {}) => ({
  type: "equipamento",
  name: tipo,
  system: { tipo, equipado, equipado2: { slot } }
});

test("wornArmor: worn light/heavy armor only, as prepareDefense counts it", () => {
  assert.deepEqual(wornArmor([equip("leve")]), { name: "leve", tipo: "leve" });
  assert.equal(wornArmor([equip("pesada", { equipado: true, slot: 0 })], { equipmentSlots: true }), null);
  assert.deepEqual(wornArmor([equip("pesada", { slot: 5 })], { equipmentSlots: true }), { name: "pesada", tipo: "pesada" });
  assert.equal(wornArmor([equip("escudo")]), null);
  assert.equal(wornArmor([equip("acessorio")]), null);
  assert.equal(wornArmor([equip("leve", { equipado: false })]), null);
});

test("spellSources: the flag wins, otherwise inferred from the spell type and the classes", () => {
  assert.deepEqual(spellSources({ spellType: "arc", classSlugs: ["arcanista"] }), ["arcane"]);
  assert.deepEqual(spellSources({ spellType: "arc", classSlugs: ["druida"] }), ["exempt"]);
  assert.deepEqual(spellSources({ spellType: "arc", classSlugs: ["arcanista", "bardo"] }), ["arcane", "bard"]);
  assert.deepEqual(spellSources({ spellType: "uni", classSlugs: ["arcanista"] }), ["arcane"]);
  assert.deepEqual(spellSources({ spellType: "uni", classSlugs: ["arcanista", "clerigo"] }), ["arcane", "exempt"]);
  assert.deepEqual(spellSources({ spellType: "uni", classSlugs: ["clerigo"] }), ["exempt"]);
  for (const spellType of ["div", "eng", "sim"]) assert.deepEqual(spellSources({ spellType, classSlugs: ["arcanista"] }), ["exempt"]);
  for (const flag of ["arcane", "bard", "exempt"]) assert.deepEqual(spellSources({ spellType: "div", classSlugs: [], flag }), [flag]);
  assert.deepEqual(spellSources({ spellType: "arc", classSlugs: ["arcanista"], flag: "bogus" }), ["arcane"]);
});

test("outcomeForSource and strongestWaiver", () => {
  assert.equal(outcomeForSource("exempt", { armorTipo: "pesada" }), "not-arcane");
  assert.equal(outcomeForSource("arcane", { armorTipo: "pesada", waiver: "all" }), "waiver-all");
  assert.equal(outcomeForSource("arcane", { armorTipo: "leve", waiver: "light" }), "waiver-light");
  assert.equal(outcomeForSource("arcane", { armorTipo: "pesada", waiver: "light" }), "required");
  assert.equal(outcomeForSource("bard", { armorTipo: "leve" }), "bard-light");
  assert.equal(outcomeForSource("bard", { armorTipo: "pesada" }), "required");
  assert.equal(strongestWaiver(["", "light"]), "light");
  assert.equal(strongestWaiver(["light", "all"]), "all");
  assert.equal(strongestWaiver([]), "");
  assert.equal(strongestWaiver(["bogus", undefined]), "");
});

test("armorTestRequirement covers characters, armor, Magia Discreta, flags, ambiguity and waivers", () => {
  const heavy = { tipo: "pesada" };
  const light = { tipo: "leve" };
  const base = { actorType: "character", spellType: "arc", classSlugs: ["arcanista"], armor: heavy, waiver: "" };
  assert.equal(armorTestRequirement({ ...base, actorType: "npc" }).reason, "not-character");
  assert.equal(armorTestRequirement({ ...base, armor: null }).reason, "no-armor");
  assert.equal(armorTestRequirement({ ...base, discreet: true }).reason, "discreet");
  assert.equal(armorTestRequirement({ ...base, spellFlag: "exempt" }).reason, "not-arcane");
  assert.equal(armorTestRequirement({ ...base, spellType: "div" }).reason, "not-arcane");
  assert.deepEqual(armorTestRequirement({ ...base, spellType: "uni" }), { required: true, reason: "required" });
  assert.deepEqual(armorTestRequirement({ ...base, spellType: "uni", classSlugs: ["arcanista", "clerigo"] }), {
    required: false,
    reason: "ambiguous",
    ambiguous: true
  });
  const multi = { ...base, classSlugs: ["arcanista", "bardo"] };
  assert.equal(armorTestRequirement(multi).required, true);
  assert.equal(armorTestRequirement({ ...multi, armor: light }).reason, "ambiguous");
  assert.equal(armorTestRequirement({ ...multi, armor: light, spellFlag: "bard" }).reason, "bard-light");
  assert.equal(armorTestRequirement({ ...multi, armor: light, spellFlag: "arcane" }).reason, "required");
  const supplement = { ...base, classSlugs: ["mago-de-batalha"], spellFlag: "arcane" };
  assert.equal(armorTestRequirement(supplement).required, true);
  assert.equal(armorTestRequirement({ ...supplement, waiver: "all" }).reason, "waiver-all");
  assert.equal(armorTestRequirement({ ...base, waiver: "light" }).reason, "required");
});

test("armorTestDC, armorTestFormula and resolveArmorTest", () => {
  assert.deepEqual([1, null, 0, -1, "3", NaN].map(armorTestDC), [21, 20, 20, 20, 23, 20]);
  assert.equal(armorTestFormula({ skillValue: 7, armorPenalty: -2 }), "1d20 + 7 - 2");
  assert.equal(armorTestFormula({ skillValue: 7, armorPenalty: 2 }), "1d20 + 7 - 2");
  assert.equal(armorTestFormula({ skillValue: 7, armorPenalty: 0 }), "1d20 + 7");
  assert.equal(armorTestFormula({ skillValue: -1, armorPenalty: -2, trainingBonus: 2 }), "1d20 - 1 - 2 + 2");
  assert.equal(resolveArmorTest({ natural: 20, total: 15, dc: 30 }), true);
  assert.equal(resolveArmorTest({ natural: 1, total: 35, dc: 21 }), false);
  assert.equal(resolveArmorTest({ natural: 10, total: 21, dc: 21 }), true);
  assert.equal(resolveArmorTest({ natural: 10, total: 20, dc: 21 }), false);
});

test("armorTestTraining, canPayGrant and withGrantPayment", () => {
  const ctx = { treino: 2, autoSpend: true };
  assert.deepEqual(armorTestTraining({ trained: true, grant: null }, ctx), {
    canRoll: true, trainingBonus: 0, grantCost: 0, grantPrice: 0, grantName: null, reason: null, hint: []
  });
  const eclectic = { trained: true, grant: { kind: "bonus", custo: 1, name: "Eclético" } };
  assert.equal(armorTestTraining(eclectic, ctx).trainingBonus, 2);
  assert.equal(armorTestTraining(eclectic, ctx).grantCost, 1);
  assert.deepEqual(
    [armorTestTraining(eclectic, { ...ctx, autoSpend: false }).grantCost, armorTestTraining(eclectic, { ...ctx, autoSpend: false }).grantPrice],
    [0, 1]
  );
  const exotic = armorTestTraining({ trained: true, grant: { kind: "ignore", custo: 0, name: "Cultura Exótica" } }, ctx);
  assert.equal(exotic.trainingBonus + exotic.grantCost, 0);
  const untrained = armorTestTraining({ trained: false }, { ...ctx, pendingGrants: [{ name: "Eclético" }] });
  assert.equal(untrained.reason, "untrained");
  assert.deepEqual(untrained.hint, ["Eclético"]);

  assert.equal(canPayGrant({ value: 1, temp: 0, cost: 1 }), true);
  assert.equal(canPayGrant({ value: 0, temp: 1, cost: 1 }), true);
  assert.equal(canPayGrant({ value: 0, temp: 0, cost: 1 }), false);
  assert.equal(canPayGrant({ value: 0, temp: 0, cost: 0 }), true);

  const paidTraining = armorTestTraining(eclectic, ctx);
  assert.deepEqual(withGrantPayment(paidTraining, false), {
    canRoll: false, trainingBonus: 0, grantCost: 0, grantPrice: 1, grantName: "Eclético", reason: "untrained", hint: [], unpaid: true
  });
  assert.equal(withGrantPayment(paidTraining, true), paidTraining);
  const plain = armorTestTraining({ trained: true, grant: null }, ctx);
  assert.equal(withGrantPayment(plain, false), plain);
});

test("failureKey and grantUsedKey tell whether the PM were spent or must be deducted by hand", () => {
  assert.equal(failureKey({ cost: 3, autoSpend: true }), "Failure");
  assert.equal(failureKey({ cost: 3, autoSpend: false }), "FailureManual");
  assert.equal(failureKey({ cost: 0, autoSpend: false }), "FailureFree");
  assert.equal(failureKey({ cost: null, autoSpend: true }), "FailureFree");
  assert.equal(grantUsedKey({ autoSpend: true, grantPrice: 1 }), "GrantUsed");
  assert.equal(grantUsedKey({ autoSpend: false, grantPrice: 1 }), "GrantUsedManual");
  assert.equal(grantUsedKey({ autoSpend: false, grantPrice: 0 }), "GrantUsedFree");
});

/** Usage effect in the shape of the system's ActiveEffect. */
function useEffect({ id, name = id, automatic = false, custo = 1, changes = [], types = ["skill"], parent = null }) {
  return {
    documentName: "ActiveEffect",
    id,
    name,
    parent,
    isTemporary: false,
    system: { onuse: true, abilityUse: { automatic, custo, types: new Set(types), names: new Set() }, changes }
  };
}
const ECLETICO = { key: "roll", type: "add", value: "@treino" };
const CULTURA = { key: "treinado", type: "override", value: true };

test("armorTestTraining with the real skill-training contract (#62)", () => {
  const config = { mist: { trainedOnly: true } };
  const run = (skill, effects) => {
    const grants = trainingGrants(effects.map(plainUseEffect));
    const training = isTrainedFor({ key: "mist", skill, config, grants, applied: automaticApplied(grants) });
    return armorTestTraining(training, { treino: 2, autoSpend: true, pendingGrants: grants.filter((g) => !g.automatic) });
  };
  const bard = run({ treinado: false }, [useEffect({ id: "e", name: "Eclético", automatic: true, changes: [ECLETICO] })]);
  assert.deepEqual([bard.canRoll, bard.trainingBonus, bard.grantCost], [true, 2, 1]);
  const manual = run({ treinado: false }, [useEffect({ id: "e", name: "Eclético", changes: [ECLETICO] })]);
  assert.deepEqual([manual.canRoll, manual.reason, manual.hint], [false, "untrained", ["Eclético"]]);
  const exotic = run({ treinado: false }, [useEffect({ id: "c", automatic: true, custo: 0, changes: [CULTURA] })]);
  assert.deepEqual([exotic.canRoll, exotic.trainingBonus, exotic.grantCost], [true, 0, 0]);
  const trained = run({ treinado: true }, [useEffect({ id: "e", automatic: true, changes: [ECLETICO] })]);
  assert.deepEqual([trained.canRoll, trained.trainingBonus, trained.grantCost], [true, 0, 0]);
});

test("appliedEffectIds and usesDiscreetCasting", () => {
  const effects = [
    { id: "a", system: { abilityUse: { automatic: true } } },
    { id: "b", system: { abilityUse: { automatic: false } } }
  ];
  assert.deepEqual([...appliedEffectIds({ aprs: { a: { aplica: 1 }, b: { aplica: 0 }, c: { aplica: true } } }, effects)], ["a", "c"]);
  assert.deepEqual([...appliedEffectIds({ "aprs.a.aplica": false, "aprs.b.aplica": 2 }, effects)], ["b"]);
  assert.deepEqual([...appliedEffectIds({ effects: [] }, effects)], ["a"]);

  const discreet = { id: "d", name: "Magia Discreta" };
  const renamed = { id: "r", name: "Aprimoramento", parent: { name: "Magia Discreta" } };
  assert.equal(usesDiscreetCasting([discreet], new Set(["d"]), slugify), true);
  assert.equal(usesDiscreetCasting([discreet], new Set(), slugify), false);
  assert.equal(usesDiscreetCasting([renamed], new Set(["r"]), slugify), true);
});

/* -------------------------------------------- */
/*  displayCard integration                     */
/* -------------------------------------------- */

/** spendMana like the system's (T20:7553-7579): reads pm before the first await, writes absolute values. */
class FakeActor {
  constructor({ pm = 10, temp = 0, mist = { value: 7, treinado: true, label: "Misticismo" }, pda = -2, items = [], effects = [] } = {}) {
    this.type = "character";
    this.name = "Mago";
    this.items = items;
    this.useEffects = effects;
    this.system = {
      attributes: { pm: { value: pm, temp, max: 20 }, defesa: { pda }, treino: 2 },
      pericias: { mist }
    };
    this.pending = [];
    this.autoResolve = true;
  }
  traverseEmbeddedDocuments() {
    return this.useEffects.map((ef) => ["effects", ef])[Symbol.iterator]();
  }
  update(changes) {
    return new Promise((resolve) => {
      const apply = () => {
        this.system.attributes.pm.temp = changes["system.attributes.pm.temp"];
        this.system.attributes.pm.value = changes["system.attributes.pm.value"];
        resolve(this);
      };
      if (this.autoResolve) queueMicrotask(apply);
      else this.pending.push(apply);
    });
  }
  async displayDamageCard() {}
  async spendMana(amount = 0, adjust = 0) {
    const pm = this.system.attributes.pm;
    const tmpPM = parseInt(pm.temp) || 0;
    amount = Math.floor(parseInt(amount) + adjust);
    const tmpSpend = amount > 0 ? Math.min(tmpPM, amount) : 0;
    const value = Math.min(Math.max(pm.value - (amount - tmpSpend), 0), pm.max);
    await this.update({ "system.attributes.pm.temp": tmpPM - tmpSpend, "system.attributes.pm.value": value });
    await this.displayDamageCard();
  }
}
installManaQueue(FakeActor.prototype);

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Fresh globals and a fresh ItemT20 class. `d20s` scripts the natural results of the rolls, in order.
 * `outer` installs a #37-like wrapper before (false) or after (true) this rule.
 */
function setup({ mode = "roll", d20s = [], messageMode = "public", autoSpend = true, wrapOrder = null } = {}) {
  const log = [];
  const created = [];
  const warnings = [];
  const settings = { arcaneArmorRule: mode, equipmentSlots: false, automaticManaSpend: autoSpend, messageMode };
  const rolls = [...d20s];

  class ItemT20 {
    constructor(actor, { type = "magia", tipo = "arc", flags = {}, effects = [] } = {}) {
      this.id = "spell1";
      this.name = "Bola de Fogo";
      this.type = type;
      this.actor = actor;
      this.flags = flags;
      this.system = { tipo };
      this.applicableOnUseEffects = effects;
    }
    async displayCard(config) {
      log.push("card");
      if (config?.createMessage === false) return { content: "card" };
      return { documentName: "ChatMessage", id: "card" };
    }
  }

  class Roll {
    constructor(formula) {
      this.formula = formula;
      if (formula.includes("throw")) throw new Error("bad roll");
    }
    async evaluate({ allowInteractive } = {}) {
      log.push(`evaluate:${allowInteractive}`);
      const natural = rolls.shift() ?? 10;
      const mods = [...this.formula.slice(4).matchAll(/([+-])\s*(\d+)/g)].reduce((s, [, sign, n]) => s + (sign === "-" ? -n : +n), 0);
      this.dice = [{ total: natural }];
      this.total = natural + mods;
      this._evaluated = true;
      return this;
    }
    async toMessage(data, { messageMode: m } = {}) {
      log.push("toMessage");
      const message = { id: `m${created.length + 1}`, ...data, rolls: [this], messageMode: m };
      created.push(message);
      return message;
    }
  }

  const sustain = { ends: 0, concentration: 0 };
  globalThis.CONFIG = { Item: { documentClass: ItemT20 }, T20: { pericias: { mist: { trainedOnly: true } } } };
  globalThis.game = {
    settings: { get: (scope, key) => settings[key], register() {} },
    i18n: { lang: "pt-BR", localize: (key) => key, format: (key, data) => `${key}${JSON.stringify(data)}` },
    modules: { get: () => ({ api: { status: [] } }) }
  };
  globalThis.ui = { notifications: { warn: (m) => warnings.push(m) } };
  globalThis.Hooks = { on() {} };
  globalThis.ChatMessage = {
    getSpeaker: ({ actor }) => ({ alias: actor.name }),
    applyMode: (data, m) => Object.assign(data, { messageMode: m }),
    create: async (data) => {
      const message = { id: `m${created.length + 1}`, ...data };
      created.push(message);
      return message;
    }
  };
  globalThis.foundry = {
    dice: { Roll },
    utils: {
      getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj),
      escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    }
  };

  // A wrapper that follows the cast-outcome contract like casting-restrictions (#37).
  const installOuter = () => {
    const inner = ItemT20.prototype.displayCard;
    ItemT20.prototype.displayCard = async function (config) {
      const result = await inner.call(this, config);
      if (isCastUse(config?.options) && castCompleted(result, config?.options)) {
        sustain.ends++;
        sustain.concentration++;
      }
      return result;
    };
  };
  if (wrapOrder === "outside") {
    installArcaneArmorRule();
    installOuter();
  } else if (wrapOrder === "inside") {
    installOuter();
    installArcaneArmorRule();
  } else installArcaneArmorRule();

  return { ItemT20, log, created, warnings, settings, sustain };
}

const wizard = (extra = {}) =>
  new FakeActor({ items: [{ type: "classe", name: "Arcanista" }, equip("pesada")], ...extra });
const cast = (manaCost = 3, extra = {}) => ({ options: { effects: [], manaCost, hasManaCost: true, ...extra } });

test("off, 'Mostrar no Chat' and createMessage: false call the original without any test", async () => {
  for (const [mode, config] of [
    ["off", cast()],
    ["roll", { options: { itemId: "spell1" } }],
    ["roll", { ...cast(), createMessage: false }]
  ]) {
    const { ItemT20, log, created } = setup({ mode });
    const item = new ItemT20(wizard());
    const result = await item.displayCard(config);
    assert.ok(result);
    assert.deepEqual(log, ["card"]);
    assert.equal(created.length, 0);
    assert.equal(castFailed(config.options), false);
  }
});

test("the roll is evaluated before its message, with the interactive policy of the message mode", async () => {
  for (const [messageMode, interactive] of [["public", true], ["blind", false]]) {
    const { ItemT20, log, created } = setup({ d20s: [18], messageMode });
    await new ItemT20(wizard()).displayCard(cast(3));
    assert.deepEqual(log, [`evaluate:${interactive}`, "toMessage", "card"]);
    assert.equal(created[0].rolls[0].formula, "1d20 + 7 - 2");
    assert.equal(created[0].messageMode, messageMode);
    assert.match(created[0].flavor, /"dc":23/);
    assert.match(created[0].flavor, /T20CP\.ArcaneArmor\.Success/);
  }
});

test("natural 20 and 1 decide before the DC; a failure skips the card, returns null and marks the cast", async () => {
  {
    const { ItemT20, log } = setup({ d20s: [20] });
    const result = await new ItemT20(wizard({ mist: { value: -10, treinado: true } })).displayCard(cast(9));
    assert.equal(result.id, "card");
    assert.ok(log.includes("card"));
  }
  for (const d20 of [1, 10]) {
    const { ItemT20, log, created } = setup({ d20s: [d20] });
    const config = cast(3);
    const mist = d20 === 1 ? { value: 50, treinado: true } : { value: 7, treinado: true };
    const result = await new ItemT20(wizard({ mist })).displayCard(config);
    assert.equal(result, null);
    assert.equal(log.includes("card"), false);
    assert.equal(castFailed(config.options), true);
    assert.equal(config.options["t20-community-patches"].castOutcome.messageId, created[0].id);
    assert.match(created[0].flavor, /Failure.*"cost":3/);
  }
});

test("a broken roll falls back to the normal card", async () => {
  const { ItemT20, log } = setup();
  const original = globalThis.foundry.dice.Roll;
  globalThis.foundry.dice.Roll = class {
    constructor() {
      throw new Error("bad roll");
    }
  };
  const result = await new ItemT20(wizard()).displayCard(cast());
  globalThis.foundry.dice.Roll = original;
  assert.equal(result.id, "card");
  assert.deepEqual(log, ["card"]);
});

test("overlapping casts keep their own outcome", async () => {
  const { ItemT20 } = setup({ d20s: [18, 2] });
  const a = cast(1);
  const b = cast(1);
  const [ra, rb] = await Promise.all([new ItemT20(wizard()).displayCard(a), new ItemT20(wizard()).displayCard(b)]);
  assert.equal(ra.id, "card");
  assert.equal(rb, null);
  assert.equal(castFailed(a.options), false);
  assert.equal(castFailed(b.options), true);
});

test("no test for Magia Discreta applied, a divine caster, a waiver, an exempt flag or a shield alone", async () => {
  const discreet = { id: "md", name: "Magia Discreta", system: { abilityUse: { automatic: false } } };
  const cases = [
    [wizard(), { effects: [discreet] }, cast(5, { aprs: { md: { aplica: 1 } } })],
    [new FakeActor({ items: [{ type: "classe", name: "Clérigo" }, equip("pesada")] }), { tipo: "uni" }, cast()],
    [wizard({ items: [{ type: "classe", name: "Arcanista" }, equip("pesada"), { type: "poder", flags: { "t20-community-patches": { arcaneArmorWaiver: "all" } } }] }), {}, cast()],
    [wizard(), { flags: { "t20-community-patches": { arcaneArmorSource: "exempt" } } }, cast()],
    [new FakeActor({ items: [{ type: "classe", name: "Arcanista" }, equip("escudo")] }), {}, cast()],
    [Object.assign(wizard(), { type: "npc" }), {}, cast()]
  ];
  for (const [actor, data, config] of cases) {
    const { ItemT20, log, created } = setup({ d20s: [1] });
    await new ItemT20(actor, data).displayCard(config);
    assert.deepEqual(log, ["card"]);
    assert.equal(created.length, 0);
  }
});

test("an ambiguous source warns and casts without the test", async () => {
  const { ItemT20, log, warnings } = setup({ d20s: [1] });
  const actor = new FakeActor({ items: [{ type: "classe", name: "Arcanista" }, { type: "classe", name: "Clérigo" }, equip("pesada")] });
  await new ItemT20(actor, { tipo: "uni" }).displayCard(cast());
  assert.deepEqual(log, ["card"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Ambiguous/);
});

test("untrained without an automatic grant fails without a roll and hints the manual grant", async () => {
  const { ItemT20, log, created } = setup();
  const actor = wizard({
    mist: { value: 0, treinado: false, label: "Misticismo" },
    effects: [useEffect({ id: "e", name: "Eclético", changes: [ECLETICO] })]
  });
  const config = cast(1);
  assert.equal(await new ItemT20(actor).displayCard(config), null);
  assert.deepEqual(log, []);
  assert.equal(castFailed(config.options), true);
  assert.match(created[0].content, /Untrained/);
  assert.match(created[0].content, /UntrainedHint.*Eclético/);
});

test("Eclético in 'Aplicar Sempre' is charged after the spell's own spend, on success and on failure", async () => {
  for (const d20 of [20, 2]) {
    const { ItemT20, created } = setup({ d20s: [d20] });
    const actor = new FakeActor({
      pm: 5,
      mist: { value: 0, treinado: false, label: "Misticismo" },
      items: [{ type: "classe", name: "Bardo" }, equip("pesada")],
      effects: [useEffect({ id: "e", name: "Eclético", automatic: true, changes: [ECLETICO] })]
    });
    actor.autoResolve = false;
    actor.spendMana(3, 0, false); // T20:8669, without await
    const pending = new ItemT20(actor).displayCard(cast(3));
    for (let i = 0; i < 20; i++) {
      await tick();
      while (actor.pending.length) actor.pending.shift()();
    }
    await pending;
    assert.equal(actor.system.attributes.pm.value, 1);
    assert.equal(created[0].rolls[0].formula, "1d20 + 0 - 2 + 2");
    assert.match(created[0].flavor, /GrantUsed\{/);
    assert.match(created[0].flavor, d20 === 2 ? /\.Failure\{/ : /Success/);
  }
});

test("with automaticManaSpend off nothing is charged and the texts ask to deduct the PM by hand", async () => {
  const { ItemT20, created } = setup({ d20s: [2], autoSpend: false });
  const actor = new FakeActor({
    pm: 5,
    mist: { value: 0, treinado: false, label: "Misticismo" },
    items: [{ type: "classe", name: "Bardo" }, equip("pesada")],
    effects: [useEffect({ id: "e", name: "Eclético", automatic: true, changes: [ECLETICO] })]
  });
  const config = cast(3);
  assert.equal(await new ItemT20(actor).displayCard(config), null);
  assert.equal(actor.system.attributes.pm.value, 5);
  assert.match(created[0].flavor, /GrantUsedManual\{"grant":"Eclético","cost":1\}/);
  assert.match(created[0].flavor, /FailureManual\{"spell":"Bola de Fogo","cost":3\}/);

  const free = setup({ d20s: [2], autoSpend: false });
  await new free.ItemT20(wizard({ mist: { value: 0, treinado: true } })).displayCard(cast(0));
  assert.match(free.created[0].flavor, /FailureFree\{/);
});

test("a grant without PM left is not granted: no roll, no card, only the spell's spend", async () => {
  for (const temp of [0, 1]) {
    const { ItemT20, created, log } = setup({ d20s: [20] });
    const actor = new FakeActor({
      pm: 3,
      temp,
      mist: { value: 0, treinado: false, label: "Misticismo" },
      items: [{ type: "classe", name: "Bardo" }, equip("pesada")],
      effects: [useEffect({ id: "e", name: "Eclético", automatic: true, changes: [ECLETICO] })]
    });
    actor.autoResolve = false;
    actor.spendMana(3, 0, false);
    const config = cast(3);
    const pending = new ItemT20(actor).displayCard(config);
    for (let i = 0; i < 20; i++) {
      await tick();
      while (actor.pending.length) actor.pending.shift()();
    }
    const result = await pending;
    const pm = actor.system.attributes.pm;
    if (temp === 0) {
      assert.equal(result, null);
      assert.equal(castFailed(config.options), true);
      assert.ok(!log.some((l) => l.startsWith("evaluate")));
      assert.match(created[0].content, /GrantNoMana/);
      assert.equal(pm.value, 0);
    } else {
      assert.equal(result.id, "card");
      assert.equal(pm.value + pm.temp, 0);
    }
  }
});

test("with a #37-like wrapper, in either order, a failure never counts as a cast", async () => {
  for (const wrapOrder of ["outside", "inside"]) {
    for (const [d20, counted] of [[2, 0], [19, 1]]) {
      const { ItemT20, sustain } = setup({ d20s: [d20], wrapOrder });
      await new ItemT20(wizard()).displayCard(cast(3));
      assert.deepEqual(sustain, { ends: counted, concentration: counted }, `${wrapOrder} d20=${d20}`);
    }
  }
});
