import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  REFERENCE,
  diagnoseDamageSource,
  legacyDefaultAttribute,
  partsWithDefaultAttribute,
  rollsForCall,
  rollsWithDefaultAttribute,
  systemResolvesDefault
} from "../scripts/patches/default-damage-attribute.mjs";
import { markWrapper, sourceFingerprint } from "../scripts/utils.mjs";
import { ROLL_DAMAGE_1_6_6 } from "./fixtures/roll-damage-1.6.6.mjs";

const weapon = (system = {}) => ({ type: "arma", system: { empunhadura: "uma", proposito: "corpo-a-corpo", propriedades: {}, ...system } });
const NO_DEX = { finesse: false, shootingStyle: false };

/* -------------------------------------------- */
/*  Pure logic                                  */
/* -------------------------------------------- */

test("the system resolves Padrão only at index 1 of light or agile weapons", () => {
  assert.equal(systemResolvesDefault(weapon({ empunhadura: "leve" }), 1), true);
  assert.equal(systemResolvesDefault(weapon({ propriedades: { agi: true } }), 1), true);
  assert.equal(systemResolvesDefault(weapon(), 1), false);
  assert.equal(systemResolvesDefault(weapon({ empunhadura: "leve" }), 2), false);
  assert.equal(systemResolvesDefault({ type: "poder", system: {} }, 1), false);
});

test("the 1.6.5 rule picks the attribute by purpose", () => {
  assert.equal(legacyDefaultAttribute({ proposito: "disparo", finesse: true, shootingStyle: false }), "");
  assert.equal(legacyDefaultAttribute({ proposito: "disparo", finesse: false, shootingStyle: true }), "@des");
  assert.equal(legacyDefaultAttribute({ proposito: "arremesso", empunhadura: "uma", finesse: true }), "@des");
  assert.equal(legacyDefaultAttribute({ proposito: "arremesso", empunhadura: "uma", finesse: false }), "@for");
  assert.equal(legacyDefaultAttribute({ proposito: "corpo-a-corpo", empunhadura: "leve", finesse: true }), "@des");
  assert.equal(legacyDefaultAttribute({ proposito: "corpo-a-corpo", empunhadura: "uma", finesse: true }), "@for");
  assert.equal(legacyDefaultAttribute({ finesse: false }), "@for");
});

test("only the Padrão parts the system leaves unresolved change", () => {
  const parts = [["1d6", "dano", "x"], ["padrao", "corte", "y"], ["@for"], ["des"], ["padrao", "curatpv"], ["padrao", "perda"]];
  assert.deepEqual(partsWithDefaultAttribute(parts, weapon(), NO_DEX), [
    ["1d6", "dano", "x"],
    ["@for", "corte", "y"],
    ["@for"],
    ["des"],
    ["padrao", "curatpv"],
    ["padrao", "perda"]
  ]);
  assert.equal(parts[1][0], "padrao");
  assert.equal(partsWithDefaultAttribute([["1d6"], ["padrao"]], weapon({ empunhadura: "leve" }), NO_DEX), null);
  assert.equal(partsWithDefaultAttribute([["1d6"], ["padrao"]], weapon({ propriedades: { agi: true } }), NO_DEX), null);
  assert.deepEqual(partsWithDefaultAttribute([["1d6"], ["@for"], ["padrao"]], weapon({ empunhadura: "leve" }), NO_DEX), [
    ["1d6"],
    ["@for"],
    ["@for"]
  ]);
  assert.deepEqual(partsWithDefaultAttribute([["2d6"], ["padrao"]], { type: "poder", system: {} }, NO_DEX), [["2d6"], ["@for"]]);
  assert.equal(partsWithDefaultAttribute([["1d6"], ["@for"]], weapon(), NO_DEX), null);
});

test("damage rolls that change become views; the originals stay intact", () => {
  const attack = { type: "ataque", parts: [["1d20"], ["luta"]] };
  const damage = { type: "dano", name: "Dano", rd: 2, parts: [["1d6", "dano"], ["padrao"]] };
  const explicit = { type: "dano", name: "Extra", parts: [["1d4"], ["@for"]] };
  const rolls = [attack, damage, explicit];
  const next = rollsWithDefaultAttribute(rolls, weapon(), NO_DEX);
  assert.notEqual(next, rolls);
  assert.equal(next[0], attack);
  assert.equal(next[2], explicit);
  assert.deepEqual(next[1].parts, [["1d6", "dano"], ["@for"]]);
  assert.equal(next[1].name, "Dano");
  assert.equal(next[1].rd, 2);
  assert.deepEqual(damage.parts, [["1d6", "dano"], ["padrao"]]);
  assert.equal(rollsWithDefaultAttribute([attack, explicit], weapon(), NO_DEX), null);
});

test("a nested call starts from the item's real rolls", () => {
  const base = [{ type: "dano", parts: [["1d6"], ["padrao"]] }];
  const installed = [{ type: "dano", parts: [["1d6"], ["@for"]] }];
  const seen = [];
  const transform = (rolls) => {
    seen.push(rolls);
    return null;
  };
  assert.deepEqual(rollsForCall(installed, { base, installed }, transform), { base, rolls: base });
  assert.equal(seen[0], base);
  const other = [];
  assert.equal(rollsForCall(other, { base, installed }, transform).base, other);
});

test("the probe recognizes only the exact 1.6.6 code and never answers fixed", () => {
  const SystemItem = new Function(`return class { ${ROLL_DAMAGE_1_6_6} }`)();
  const source = Function.prototype.toString.call(SystemItem.prototype.rollDamage);
  assert.equal(sourceFingerprint(source), REFERENCE);
  assert.deepEqual(
    [diagnoseDamageSource(source).bug, diagnoseDamageSource(source).confidence],
    ["present", "high"]
  );
  const fixed = source.replace("if (this.type === \"arma\" && index == 1) {", "if (dano === \"padrao\" || (this.type === \"arma\" && index == 1)) {");
  for (const other of [fixed, "function wrapper(...args) { return original.apply(this, args); }", undefined]) {
    assert.equal(diagnoseDamageSource(other).bug, "unknown");
    assert.equal(diagnoseDamageSource(other).confidence, "low");
  }
});

/* -------------------------------------------- */
/*  Integration with the real 1.6.6 rollDamage  */
/* -------------------------------------------- */

const settings = { lightFinesseWeapons: false };
const calls = [];
let onDamageRoll = null;

// Like Roll#evaluate in the core, a literal attribute string cannot be evaluated.
async function damageRoll({ parts }) {
  const formulas = parts.map(([formula]) => formula);
  calls.push(formulas);
  if (formulas.some((f) => /^(padrao|for|des)$/.test(f))) {
    throw new Error(`Unresolved StringTerm ${formulas.find((f) => /^(padrao|for|des)$/.test(f))} requested for evaluation`);
  }
  if (onDamageRoll) await onDamageRoll();
  return { formulas };
}

const SystemItem = new Function("damageRoll", "foundry", "game", `return class { ${ROLL_DAMAGE_1_6_6} }`)(
  damageRoll,
  { utils: { getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj) } },
  { settings: { get: (_scope, key) => settings[key] } }
);

class FakeItem extends SystemItem {
  constructor({ type = "arma", system = {}, flags = {}, atributos = { for: { value: 2 }, des: { value: 4 } }, actor = true } = {}) {
    super();
    this.type = type;
    this.name = "Item";
    this.effects = [];
    const rolls = system.rolls ?? [{ type: "dano", name: "Dano", parts: [["1d6", "dano"], ["padrao"]] }];
    this.system = { empunhadura: "uma", proposito: "corpo-a-corpo", propriedades: {}, rolled: {}, ...system, rolls };
    this.actor = actor
      ? { system: { atributos, modificadores: {} }, getFlag: (_scope, key) => flags[key] }
      : null;
  }
  getRollData() {
    return {};
  }
}

const PristineRollDamage = SystemItem.prototype.rollDamage;
globalThis.CONFIG = { Item: { documentClass: FakeItem } };
globalThis.game = { settings: { get: (_scope, key) => settings[key] } };

test("without the patch the 1.6.6 code fails on Padrão (reproduces the bug)", async () => {
  const item = new FakeItem();
  await assert.rejects(PristineRollDamage.call(item), /Unresolved StringTerm padrao/);
});

test("isNeeded reports the bug on the 1.6.6 code", () => {
  assert.equal(patch.isNeeded().bug, "present");
});

test("with the patch every case of the issue rolls and the stored data never changes", async () => {
  patch.apply();
  const roll = async (opts) => {
    const item = new FakeItem(opts);
    const rolls = item.system.rolls;
    calls.length = 0;
    await item.rollDamage();
    assert.equal(item.system.rolls, rolls);
    assert.equal(rolls.find((r) => r.type === "dano").parts.find((p) => p[0] === "padrao")?.[0] ?? "padrao", "padrao");
    return calls[0];
  };
  // Espada: one hand, melee.
  assert.deepEqual(await roll(), ["1d6", "@for"]);
  // Azagaia: thrown, with and without Acuidade (Des 4 > For 2).
  assert.deepEqual(await roll({ system: { proposito: "arremesso" } }), ["1d6", "@for"]);
  assert.deepEqual(await roll({ system: { proposito: "arremesso" }, flags: { acuidade: true } }), ["1d6", "@des"]);
  assert.deepEqual(
    await roll({ system: { proposito: "arremesso" }, flags: { acuidade: true }, atributos: { for: { value: 4 }, des: { value: 2 } } }),
    ["1d6", "@for"]
  );
  // Arco: fired, with and without Estilo de Disparo.
  assert.deepEqual(await roll({ system: { proposito: "disparo", empunhadura: "duas" } }), ["1d6", ""]);
  assert.deepEqual(await roll({ system: { proposito: "disparo", empunhadura: "duas" }, flags: { estiloDisparo: true } }), ["1d6", "@des"]);
  // Adaga (light) and Florete (agile) follow the system's own rule.
  assert.deepEqual(await roll({ system: { empunhadura: "leve" }, flags: { acuidade: true } }), ["1d6", "@des"]);
  assert.deepEqual(await roll({ system: { propriedades: { agi: true } }, flags: { acuidade: true } }), ["1d6", "@des"]);
  assert.deepEqual(await roll({ system: { empunhadura: "leve" } }), ["1d6", "@for"]);
  // A power with 2d6 and Padrão.
  assert.deepEqual(
    await roll({ type: "poder", system: { rolls: [{ type: "dano", name: "Dano", parts: [["2d6", "dano"], ["padrao"]] }] } }),
    ["2d6", "@for"]
  );
});

test("overlapping and nested rolls on the same item keep the real rolls", async () => {
  const item = new FakeItem();
  const rolls = item.system.rolls;
  let nested = null;
  onDamageRoll = () => {
    onDamageRoll = null;
    nested = item.rollDamage();
  };
  calls.length = 0;
  await item.rollDamage();
  await nested;
  assert.deepEqual(calls, [["1d6", "@for"], ["1d6", "@for"]]);
  assert.equal(item.system.rolls, rolls);
});

test("a failing roll leaves the item intact and an item without actor is not touched", async () => {
  const item = new FakeItem({ system: { rolls: [{ type: "dano", name: "Dano", parts: [["1d6"], ["padrao"], ["for"]] }] } });
  const rolls = item.system.rolls;
  await assert.rejects(item.rollDamage(), /Unresolved StringTerm for/);
  assert.equal(item.system.rolls, rolls);

  const orphan = new FakeItem({ actor: false });
  const orphanRolls = orphan.system.rolls;
  await assert.rejects(orphan.rollDamage(), TypeError);
  assert.equal(orphan.system.rolls, orphanRolls);
});

test("isNeeded reads the original method under the wrapper", () => {
  assert.equal(patch.isNeeded().bug, "present");
  const wrapped = FakeItem.prototype.rollDamage;
  FakeItem.prototype.rollDamage = markWrapper(function (...args) {
    return wrapped.apply(this, args);
  }, wrapped);
  try {
    assert.equal(patch.isNeeded().bug, "present");
  } finally {
    FakeItem.prototype.rollDamage = wrapped;
  }
});
