import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePatchState } from "../scripts/registry.mjs";
import patch, {
  attackPartWithDexterity,
  classifyFinesseSource,
  damagePartsWithDexterity,
  diagnoseFinesseBehavior,
  diagnoseFinesseSource,
  isAgileMeleeWeapon,
  isProbeSafe,
  prefersDexterity,
  probeDamage,
  probeItem,
  REFERENCE,
  rollsForCall,
  rollsWithDexterity
} from "../scripts/patches/finesse-agile-weapons.mjs";
import { ATTACK_1_6_5 as ATTACK, DAMAGE_1_6_5 as DAMAGE } from "./fixtures/finesse-agile-weapons-1.6.5.mjs";
import { ATTACK_1_6_6 } from "./fixtures/finesse-agile-weapons-1.6.6.mjs";
import { ROLL_DAMAGE_1_6_6 } from "./fixtures/roll-damage-1.6.6.mjs";

const weapon = (system) => ({ type: "arma", system: { proposito: "corpo-a-corpo", empunhadura: "uma", propriedades: {}, ...system } });

test("only agile melee weapons that are not light are handled", () => {
  assert.ok(isAgileMeleeWeapon(weapon({ propriedades: { agi: true } })));
  assert.ok(isAgileMeleeWeapon(weapon({ empunhadura: "duas", propriedades: { agi: true, ada: true } })));
  assert.ok(isAgileMeleeWeapon(weapon({ proposito: "corpo-a-corpo-arremesso", propriedades: { agi: true } })));
  assert.ok(!isAgileMeleeWeapon(weapon({ empunhadura: "leve", propriedades: { agi: true } })));
  assert.ok(!isAgileMeleeWeapon(weapon({ proposito: "arremesso", propriedades: { agi: true } })));
  assert.ok(!isAgileMeleeWeapon(weapon({ proposito: "disparo", propriedades: { agi: true } })));
  assert.ok(!isAgileMeleeWeapon(weapon({ propriedades: { agil: true } })));
  assert.ok(!isAgileMeleeWeapon({ type: "poder", system: { propriedades: { agi: true } } }));
});

test("mirrors the system's usarAcuidade condition", () => {
  const atributos = { des: { value: 4 }, for: { value: 1 } };
  assert.ok(prefersDexterity({ acuidade: true, atributos }));
  assert.ok(prefersDexterity({ optionalRule: true, atributos }));
  assert.ok(!prefersDexterity({ atributos }));
  assert.ok(!prefersDexterity({ acuidade: true, atributos: { des: { value: 2 }, for: { value: 2 } } }));
});

test("fills only an empty attack attribute", () => {
  assert.deepEqual(attackPartWithDexterity([["1d20", "", ""], ["luta", "", ""], ["0", "", ""]]), ["luta", "des", ""]);
  assert.equal(attackPartWithDexterity([["1d20"], ["luta", "for", ""]]), null);
  assert.equal(attackPartWithDexterity([["1d20"], ["", "", ""]]), null);
  assert.equal(attackPartWithDexterity([["1d20"]]), null);
});

test("replaces only the Padrão damage attribute", () => {
  const parts = [["1d6", "perfuracao", ""], ["padrao", "", ""]];
  assert.deepEqual(damagePartsWithDexterity(parts), [["1d6", "perfuracao", ""], ["@des", "", ""]]);
  assert.deepEqual(parts[1], ["padrao", "", ""]);
  assert.equal(damagePartsWithDexterity([["1d6", "perfuracao", ""], ["@for", "", ""]]), null);
});

test("builds a per-call rolls array without touching the original rolls", () => {
  const attack = { type: "ataque", parts: [["1d20", "", ""], ["luta", "", ""]] };
  const damage = { type: "dano", name: "Dano", rd: 0, parts: [["1d6", "corte", ""], ["padrao", "", ""]] };
  const fixed = { type: "dano", parts: [["1d4", "fogo", ""], ["@for", "", ""]] };
  const rolls = [attack, damage, fixed];
  const next = rollsWithDexterity(rolls);
  assert.notEqual(next, rolls);
  assert.equal(next[0], attack);
  assert.equal(next[2], fixed);
  assert.deepEqual(next[1].parts, [["1d6", "corte", ""], ["@des", "", ""]]);
  assert.equal(next[1].name, "Dano");
  assert.deepEqual(damage.parts[1], ["padrao", "", ""]);
  assert.equal(rollsWithDexterity([attack, fixed]), null);
});

test("a nested call selects its rolls from the item's real rolls", () => {
  const real = [{ type: "dano", parts: [["padrao", "", ""]] }];
  const outer = rollsForCall(real, undefined, true);
  assert.equal(outer.base, real);
  assert.deepEqual(outer.rolls[0].parts, [["@des", "", ""]]);
  const frame = { base: real, installed: outer.rolls };
  assert.deepEqual(rollsForCall(outer.rolls, frame, false), { base: real, rolls: real });
  assert.deepEqual(rollsForCall(outer.rolls, frame, true).rolls[0].parts, [["@des", "", ""]]);
  const replaced = [];
  assert.equal(rollsForCall(replaced, frame, false).rolls, replaced, "someone else replaced rolls: use them");
  assert.equal(rollsForCall(real, undefined, false).rolls, real);
});

// The usual fix: widen the light-weapon condition with the agile property.
const fix = (source, expr = "this.system.propriedades?.agi") =>
  source.replace('usarAcuidade && empunhadura === "leve"', `usarAcuidade && (empunhadura === "leve" || ${expr})`);

test("recognizes the 1.6.5 code and the usual fix exactly", () => {
  assert.equal(classifyFinesseSource(ATTACK, REFERENCE.attack), "light-only");
  assert.equal(classifyFinesseSource(DAMAGE, REFERENCE.damage), "light-only");
  assert.equal(classifyFinesseSource(`/* propriedades.agi */\n${ATTACK.replaceAll("\t", "  ")}`, REFERENCE.attack), "light-only");
  assert.equal(classifyFinesseSource(fix(ATTACK), REFERENCE.attack), "agile");
  assert.equal(classifyFinesseSource(fix(DAMAGE, 'itemData.propriedades["agi"]'), REFERENCE.damage), "agile");
  const destructured = fix(DAMAGE, "propriedades?.agi").replace("{ empunhadura, proposito }", "{ empunhadura, proposito, propriedades }");
  assert.equal(classifyFinesseSource(destructured, REFERENCE.damage), "agile");
  assert.deepEqual(diagnoseFinesseSource(ATTACK, DAMAGE), { bug: "present", confidence: "high", evidence: "attack: light-only, damage: light-only" });
  assert.deepEqual(diagnoseFinesseSource(fix(ATTACK), DAMAGE), { bug: "present", confidence: "high", evidence: "attack: agile, damage: light-only" });
  assert.deepEqual(diagnoseFinesseSource(fix(ATTACK), fix(DAMAGE)), { bug: "fixed", confidence: "low", evidence: "attack: agile, damage: agile" });
});

test("anything else is unknown, including unrelated reads of agi", () => {
  const unknown = [
    "function wrapper(...args) { return original.apply(this, args); }",
    'f(){const other={};return other["agi"]}',
    ATTACK.replace("return { rollData, parts };", 'const other = {}; other["agi"]; return { rollData, parts };'),
    // Reads propriedades.agi, but outside the light-weapon condition (does not follow the usual fix).
    ATTACK.replace("return { rollData, parts };", "if (this.system.propriedades?.agi) atributo = \"des\"; return { rollData, parts };"),
    // Unparenthesized: `usarAcuidade && leve || agi` ignores usarAcuidade for agile weapons.
    ATTACK.replace('usarAcuidade && empunhadura === "leve"', 'usarAcuidade && empunhadura === "leve" || this.system.propriedades?.agi'),
    // The fix plus an unrelated change.
    fix(ATTACK).replace('atributo = "des"', 'atributo = "for"'),
    "",
    undefined
  ];
  for (const source of unknown) assert.equal(classifyFinesseSource(source, REFERENCE.attack), "unknown");
  assert.equal(classifyFinesseSource(DAMAGE, REFERENCE.attack), "unknown");
});

test("an unrecognized method makes the diagnosis unknown, so the patch is not applied above the range", () => {
  const unknown = 'f(){const other={};return other["agi"]}';
  for (const [attack, damage] of [[ATTACK, unknown], [unknown, DAMAGE], [unknown, unknown], [fix(ATTACK), unknown]]) {
    assert.equal(diagnoseFinesseSource(attack, damage).bug, "unknown");
  }
  const args = { patch, mode: "auto", systemId: "tormenta20" };
  assert.equal(resolvePatchState({ ...args, systemVersion: "1.6.6", probe: () => diagnoseFinesseSource(ATTACK, unknown) }).state, "unverified");
  assert.equal(resolvePatchState({ ...args, systemVersion: "1.6.6", probe: () => diagnoseFinesseSource(ATTACK, DAMAGE) }).state, "applied-unverified");
  assert.equal(resolvePatchState({ ...args, systemVersion: "1.6.5", probe: () => diagnoseFinesseSource(ATTACK, unknown) }).state, "applied");
});

// Minimal copy of the system's logic (T20:8167-8192 and T20:9108-9184). Like the real rollDamage, it takes the
// `rolls` iterator synchronously and awaits the evaluation of each damage roll (damageRoll → Roll#evaluate) before
// reading the next one. It returns the resolved attributes so the test can see them (the real one returns nothing).
class FakeItem {
  getAttackToHit() {
    const roll = this.system.rolls.find((r) => r.type === "ataque");
    let atributo = roll.parts[1][1];
    const { for: forca, des } = this.actor.system.atributos;
    const usar = this.actor.flags.tormenta20?.acuidade && des.value > forca.value;
    if (!atributo && usar && this.system.empunhadura === "leve") atributo = "des";
    return atributo || "for";
  }
  async rollDamage() {
    const itemData = this.system;
    const result = [];
    for (const r of itemData.rolls) {
      if (r.type !== "dano") continue;
      const { for: forca, des } = this.actor.system.atributos;
      const usar = this.actor.flags.tormenta20?.acuidade && des.value > forca.value;
      const parts = r.parts.map(([d]) => (d === "padrao" ? (usar && itemData.empunhadura === "leve" ? "@des" : "@for") : d));
      result.push(...parts.filter((d) => d.startsWith("@")));
      itemData.rolled[r.name] = await this.evaluate(parts);
    }
    return result;
  }
  evaluate(parts) {
    return new Promise((resolve) => setTimeout(() => resolve(parts), this.delay ?? 0));
  }
}
globalThis.CONFIG = { Item: { documentClass: FakeItem } };
globalThis.game = { settings: { get: () => false } };
patch.apply();

function makeItem() {
  const roll = (type, name, parts) => ({ type, name, parts });
  return Object.assign(new FakeItem(), {
    type: "arma",
    isOwned: true,
    actor: { flags: { tormenta20: { acuidade: true } }, system: { atributos: { des: { value: 4 }, for: { value: 1 } } } },
    system: {
      ...weapon({ propriedades: { agi: true } }).system,
      rolled: {},
      rolls: [
        roll("ataque", "Ataque", [["1d20", "", ""], ["luta", "", ""], ["0", "", ""]]),
        roll("dano", "Dano", [["1d6", "perfuracao", ""], ["padrao", "", ""]]),
        roll("dano", "Fogo", [["1d4", "fogo", ""], ["padrao", "", ""]])
      ]
    }
  });
}

test("wrappers give agile weapons Dexterity and never leave the item changed", async () => {
  const item = makeItem();
  const rolls = item.system.rolls;
  const [attack, damage1, damage2] = rolls.map((r) => r.parts);
  assert.equal(item.getAttackToHit(), "des");
  assert.deepEqual(attack[1], ["luta", "", ""]);
  const pending = item.rollDamage();
  assert.equal(item.system.rolls, rolls, "rolls is restored before the evaluation is awaited");
  assert.deepEqual(await pending, ["@des", "@des"]);
  assert.equal(item.system.rolls, rolls);
  assert.equal(rolls[0].parts, attack);
  assert.equal(rolls[1].parts, damage1);
  assert.equal(rolls[2].parts, damage2);
  item.actor.flags.tormenta20.acuidade = false;
  assert.equal(item.getAttackToHit(), "for");
  assert.deepEqual(await item.rollDamage(), ["@for", "@for"]);
});

test("overlapping damage rolls on the same item keep their own attribute, in any order", async () => {
  for (const [slow, fast] of [[20, 1], [1, 20]]) {
    const item = makeItem();
    item.delay = slow;
    const a = item.rollDamage();
    item.delay = fast;
    item.actor.flags.tormenta20.acuidade = false;
    const b = item.rollDamage();
    item.actor.flags.tormenta20.acuidade = true;
    const c = item.rollDamage();
    assert.deepEqual(await Promise.all([a, b, c]), [["@des", "@des"], ["@for", "@for"], ["@des", "@des"]]);
    assert.deepEqual(item.system.rolls.map((r) => r.parts[1][0]), ["luta", "padrao", "padrao"]);
  }
});

test("a damage roll started during another one's evaluation (reentrancy) completes", async () => {
  const item = makeItem();
  let inner;
  item.evaluate = function (parts) {
    item.evaluate = FakeItem.prototype.evaluate;
    inner = item.rollDamage();
    return inner.then(() => parts);
  };
  assert.deepEqual(await item.rollDamage(), ["@des", "@des"]);
  assert.deepEqual(await inner, ["@des", "@des"]);
  assert.deepEqual(item.system.rolls.map((r) => r.parts[1][0]), ["luta", "padrao", "padrao"]);
});

test("a call nested in another one's synchronous start uses its own eligibility", async () => {
  for (const outerEligible of [true, false]) {
    const item = makeItem();
    const rolls = item.system.rolls;
    item.actor.flags.tormenta20.acuidade = outerEligible;
    let inner;
    // Roll#evaluate starts before the `await`, so a hook there runs inside the outer call's synchronous start.
    item.evaluate = function (parts) {
      item.evaluate = FakeItem.prototype.evaluate;
      item.actor.flags.tormenta20.acuidade = !outerEligible;
      inner = item.rollDamage();
      item.actor.flags.tormenta20.acuidade = outerEligible;
      return Promise.resolve(parts);
    };
    const outer = item.rollDamage();
    assert.equal(item.system.rolls, rolls);
    const [a, b] = outerEligible ? [["@des", "@des"], ["@for", "@for"]] : [["@for", "@for"], ["@des", "@des"]];
    assert.deepEqual(await outer, a);
    assert.deepEqual(await inner, b);
    assert.equal(item.system.rolls, rolls);
    assert.deepEqual(rolls.map((r) => r.parts[1][0]), ["luta", "padrao", "padrao"]);
  }
});

test("a rejected evaluation leaves the item intact and the next roll works", async () => {
  const item = makeItem();
  const rolls = item.system.rolls;
  item.evaluate = () => Promise.reject(new Error("evaluate failed"));
  await assert.rejects(item.rollDamage(), /evaluate failed/);
  assert.equal(item.system.rolls, rolls);
  delete item.evaluate;
  assert.deepEqual(await item.rollDamage(), ["@des", "@des"]);
});

/* Behavior probe, run against the system's real methods (1.6.5 and 1.6.6 fixtures). */

globalThis.foundry = {
  utils: {
    isEmpty: (value) => !value || !Object.keys(value).length,
    getProperty: (object, path) => path.split(".").reduce((value, key) => value?.[key], object)
  }
};

let damageRollCalls = 0;
const damageRollSpy = () => {
  damageRollCalls++;
  return {};
};
const systemClass = (attackSource, damageSource) =>
  new Function("damageRoll", `return class { ${attackSource}\n${damageSource} }`)(damageRollSpy);
const VERSIONS = { "1.6.5": [ATTACK, DAMAGE], "1.6.6": [ATTACK_1_6_6, ROLL_DAMAGE_1_6_6] };

function diagnoseWith(ItemClass) {
  const previous = CONFIG.Item.documentClass;
  CONFIG.Item.documentClass = ItemClass;
  try {
    return patch.isNeeded();
  } finally {
    CONFIG.Item.documentClass = previous;
  }
}

test("the behavior probe sees the 1.6.6 fix and the 1.6.5 bug, without rolling anything", async () => {
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  damageRollCalls = 0;
  try {
    const cases = [
      [VERSIONS["1.6.6"], "fixed", "behavior: attack des, damage des"],
      [VERSIONS["1.6.5"], "present", "behavior: attack for, damage for"],
      [[ATTACK_1_6_6, DAMAGE], "present", "behavior: attack des, damage for"],
      [[ATTACK, ROLL_DAMAGE_1_6_6], "present", "behavior: attack for, damage des"]
    ];
    for (const [[attack, damage], bug, evidence] of cases) {
      assert.deepEqual(diagnoseWith(systemClass(attack, damage)), { bug, confidence: "high", evidence });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    process.off("unhandledRejection", onRejection);
  }
  assert.equal(damageRollCalls, 0);
  assert.deepEqual(rejections, []);

  const args = { patch, mode: "auto", systemId: "tormenta20" };
  const probe = (version) => () => diagnoseWith(systemClass(...VERSIONS[version]));
  assert.equal(resolvePatchState({ ...args, systemVersion: "1.6.6", probe: probe("1.6.6") }).state, "fixed");
  assert.equal(resolvePatchState({ ...args, systemVersion: "1.6.5", probe: probe("1.6.5") }).state, "applied");
  assert.equal(resolvePatchState({ ...args, mode: "force", systemVersion: "1.6.6", probe: probe("1.6.6") }).state, "forced");
});

test("an inconclusive probe falls back to the source diagnosis", () => {
  // Known code that throws while probed (settings not ready yet).
  const { warn } = console;
  const { get } = game.settings;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  game.settings.get = () => {
    throw new Error("settings not ready");
  };
  try {
    assert.deepEqual(diagnoseWith(systemClass(...VERSIONS["1.6.6"])), diagnoseFinesseSource(ATTACK_1_6_6, ROLL_DAMAGE_1_6_6));
  } finally {
    console.warn = warn;
    game.settings.get = get;
  }
  assert.equal(warnings.length, 1);
  assert.equal(diagnoseFinesseBehavior({ attack: "des", damage: "des", lightAttack: "for", lightDamage: "des" }), undefined);
  assert.equal(diagnoseFinesseBehavior({ attack: "des", damage: null, lightAttack: "des", lightDamage: "des" }), undefined);
});

test("code the probe does not recognize is never called, in any mode", () => {
  const wrappers = [
    (original, log) => ({ async rollDamage(...args) { log.push("chat"); return original.apply(this, args); } }).rollDamage,
    (original, log) => function (...args) { log.push("chat"); return original.apply(this, args); },
    (original, log) => (...args) => { log.push("chat"); return original(...args); }
  ];
  for (const wrap of wrappers) {
    const log = [];
    const Wrapped = systemClass(...VERSIONS["1.6.6"]);
    Wrapped.prototype.rollDamage = wrap(Wrapped.prototype.rollDamage, log);
    for (const mode of ["auto", "off", "force"]) {
      const state = resolvePatchState({ patch, mode, systemId: "tormenta20", systemVersion: "1.6.6", probe: () => diagnoseWith(Wrapped) });
      assert.equal(state.diagnosis.bug, "unknown");
    }
    assert.deepEqual(log, []);
  }
  const unknownVersion = `getAttackToHit() { globalThis.sideEffect = true; return { rollData: { skill: 13 } }; }`;
  assert.equal(diagnoseWith(systemClass(unknownVersion, ROLL_DAMAGE_1_6_6)).bug, "unknown");
  assert.equal(globalThis.sideEffect, undefined);
});

test("probeDamage stops before rolling and ignores other errors", () => {
  const otherError = async function () {
    throw new Error("boom");
  };
  assert.equal(probeDamage(otherError, probeItem({ light: false })), null);
  const syncError = function () {
    throw new Error("boom");
  };
  assert.equal(probeDamage(syncError, probeItem({ light: false })), null);
});

test("only the 1.6.5 and 1.6.6 methods are probed", () => {
  assert.ok(isProbeSafe(ATTACK_1_6_6, "attack"));
  assert.ok(isProbeSafe(ROLL_DAMAGE_1_6_6, "damage"));
  assert.ok(isProbeSafe(ATTACK, "attack"));
  assert.ok(isProbeSafe(DAMAGE, "damage"));
  assert.ok(isProbeSafe(`// comment\n${ATTACK_1_6_6.replaceAll("\t", "  ")}`, "attack"));
  assert.ok(!isProbeSafe(ATTACK_1_6_6, "damage"));
  assert.ok(!isProbeSafe(ROLL_DAMAGE_1_6_6.replace("des.value > forca.value", "true"), "damage"));
  assert.ok(!isProbeSafe("async rollDamage(...args) { return original.apply(this, args); }", "damage"));
});
