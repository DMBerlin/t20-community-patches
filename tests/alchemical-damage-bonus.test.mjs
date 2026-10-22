import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  createPartLedger,
  diagnoseAlchemicalBonus,
  hasBonus,
  isAlchemical,
  isPlainDamageRoll,
  rollsMissingAlchemicalBonus
} from "../scripts/patches/alchemical-damage-bonus.mjs";

const getProperty = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);

/** Reduced copy of ItemT20#rollDamage 1.6.5 (T20:9108-9180); `fixed` swaps the alchemical test to `bonuses.alq`. */
function makeRollDamage({ fixed = false, damageRoll }) {
  const alq = fixed ? "alq" : "mag";
  const body = `return (async function rollDamage({ critical = false, event = null, options = {} } = {}) {
    const itemData = this.system;
    const actorData = this.actor.system;
    const recoveryTypes = new Set(["curatpv", "curapm", "curatpm"]);
    for (let r of itemData.rolls) {
      if (r.type !== "dano") continue;
      const isRecovery = r.parts.some((p) => recoveryTypes.has(p[1]));
      const isHealing = r.parts.some((p) => p[1] === "curapv");
      const perda = r.parts.some((p) => p[1] === "perda");
      const isSpell = this.type === "magia";
      const isAlchemical = this.type === "consumivel" && this.system.tipo === "alchemy";
      const parts = r.parts.map(([dano, tipo, extra]) => [dano, tipo, extra]);
      if (isRecovery) ; else if (isHealing) {
        const bonuses = foundry.utils.getProperty(actorData, "modificadores.cura") || {};
        if (isAlchemical && bonuses.alq?.filter(Boolean).length) parts.push(["@curaALQ", "", ""]);
      } else if (!perda) {
        const bonuses = foundry.utils.getProperty(actorData, "modificadores.dano") || {};
        if (bonuses.geral?.filter(Boolean).length) parts.push(["@dano", "", ""]);
        if (isSpell && bonuses.mag?.filter(Boolean).length) parts.push(["@danoMagico", "", ""]);
        else if (isAlchemical && bonuses.${alq}?.filter(Boolean).length) parts.push(["@danoALQ", "", ""]);
      }
      itemData.rolled[r.name] = await damageRoll({ data: this.getRollData(), parts, critical });
    }
    return "done";
  })`;
  return new Function("damageRoll", body)(damageRoll);
}

function installFakeFoundry(rollDamage) {
  class ItemT20 {}
  ItemT20.prototype.rollDamage = rollDamage;
  globalThis.CONFIG = { Item: { documentClass: ItemT20 } };
  globalThis.foundry = { utils: { getProperty } };
  return ItemT20;
}

function makeItem(Cls, { dano = {}, rolls, type = "consumivel", tipo = "alchemy" } = {}) {
  const item = new Cls();
  Object.assign(item, {
    type,
    name: "Fogo alquímico",
    system: { tipo, rolled: {}, rolls: rolls ?? [{ type: "dano", name: "Dano", parts: [["1d6", "fogo", ""]] }] },
    actor: { flags: {}, system: { modificadores: { dano, cura: {} } } },
    getRollData: () => ({})
  });
  return item;
}

const formulas = (calls) => calls.map((c) => c.parts.map((p) => p[0]).join(" + "));

test("hasBonus", () => {
  assert.equal(hasBonus(["2"]), true);
  assert.equal(hasBonus(["", null]), false);
  assert.equal(hasBonus([]), false);
  assert.equal(hasBonus(undefined), false);
});

test("isAlchemical", () => {
  assert.equal(isAlchemical({ type: "consumivel", system: { tipo: "alchemy" } }), true);
  assert.equal(isAlchemical({ type: "consumivel", system: { tipo: "potion" } }), false);
  assert.equal(isAlchemical({ type: "arma", system: { tipo: "alchemy" } }), false);
});

test("isPlainDamageRoll", () => {
  assert.equal(isPlainDamageRoll({ type: "dano", parts: [["1d6", "fogo", ""]] }), true);
  for (const tipo of ["curapv", "curapm", "curatpv", "curatpm", "perda"]) {
    assert.equal(isPlainDamageRoll({ type: "dano", parts: [["2d4", tipo, ""]] }), false, tipo);
  }
  assert.equal(isPlainDamageRoll({ type: "ataque", parts: [["1d20", "", ""]] }), false);
});

test("rollsMissingAlchemicalBonus", () => {
  const damage = { type: "dano", parts: [["1d6", "fogo", ""]] };
  const loss = { type: "dano", parts: [["1d12", "perda", ""]] };
  const item = { type: "consumivel", system: { tipo: "alchemy", rolls: [damage, loss] } };
  assert.deepEqual(rollsMissingAlchemicalBonus(item, { alq: ["5"] }), [damage]);
  assert.deepEqual(rollsMissingAlchemicalBonus(item, { alq: ["5"], mag: ["1"] }), []);
  assert.deepEqual(rollsMissingAlchemicalBonus(item, { mag: ["1"] }), []);
  assert.deepEqual(rollsMissingAlchemicalBonus({ ...item, type: "arma" }, { alq: ["5"] }), []);
});

test("diagnoseAlchemicalBonus", () => {
  assert.deepEqual(
    [diagnoseAlchemicalBonus({ alqOnly: [], both: ["@danoALQ"] })].map((d) => [d.bug, d.confidence]),
    [["present", "high"]]
  );
  const fixed = diagnoseAlchemicalBonus({ alqOnly: ["@danoALQ"], both: ["@danoALQ"] });
  assert.deepEqual([fixed.bug, fixed.confidence], ["fixed", "high"]);
  for (const input of [{ both: [] }, undefined, { alqOnly: [], both: undefined }]) {
    const d = diagnoseAlchemicalBonus(input);
    assert.deepEqual([d.bug, d.confidence], ["unknown", "low"]);
  }
});

test("createPartLedger keeps one part while overlapping calls hold it", () => {
  const roll = { parts: [["1d6", "fogo", ""]] };
  const ledger = createPartLedger();
  const a = ledger.acquire([roll]);
  const b = ledger.acquire([roll]);
  assert.equal(roll.parts.filter((p) => p[0] === "@danoALQ").length, 1);
  ledger.release(a);
  assert.equal(roll.parts.length, 2);
  ledger.release(b);
  assert.deepEqual(roll.parts, [["1d6", "fogo", ""]]);
});

test("isNeeded on the 1.6.5 code: present/high; on the fixed code: fixed/high; unknown code: not executed", async () => {
  let unhandled = 0;
  const onUnhandled = () => unhandled++;
  process.on("unhandledRejection", onUnhandled);
  try {
    let rolled = 0;
    const damageRoll = async () => rolled++;
    installFakeFoundry(makeRollDamage({ damageRoll }));
    assert.deepEqual(pick(patch.isNeeded()), ["present", "high"]);
    installFakeFoundry(makeRollDamage({ fixed: true, damageRoll }));
    assert.deepEqual(pick(patch.isNeeded()), ["fixed", "high"]);
    let ran = false;
    installFakeFoundry(async function rollDamage() {
      ran = true;
    });
    assert.deepEqual(pick(patch.isNeeded()), ["unknown", "low"]);
    assert.equal(ran, false);
    assert.equal(rolled, 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(unhandled, 0);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

const pick = (d) => [d.bug, d.confidence];

test("apply adds @danoALQ once, restores the parts and returns the original value", async () => {
  const calls = [];
  const Cls = installFakeFoundry(makeRollDamage({ damageRoll: async (o) => calls.push(o) }));
  patch.apply();

  const alqOnly = makeItem(Cls, { dano: { alq: ["5"] } });
  assert.equal(await alqOnly.rollDamage(), "done");
  const both = makeItem(Cls, { dano: { alq: ["5"], mag: ["1"] } });
  await both.rollDamage();
  const magOnly = makeItem(Cls, { dano: { mag: ["1"] } });
  await magOnly.rollDamage();
  const healing = makeItem(Cls, { dano: { alq: ["5"] }, rolls: [{ type: "dano", name: "Cura", parts: [["2d4", "curapv", ""]] }] });
  await healing.rollDamage();
  const weapon = makeItem(Cls, { dano: { alq: ["5"] }, type: "arma", tipo: undefined });
  await weapon.rollDamage();

  assert.deepEqual(formulas(calls), ["1d6 + @danoALQ", "1d6 + @danoALQ", "1d6 + @danoALQ", "2d4", "1d6"]);
  assert.deepEqual(alqOnly.system.rolls[0].parts, [["1d6", "fogo", ""]]);
});

test("apply removes the part when the original rejects, and overlapping rolls add it once", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const calls = [];
  let fail = false;
  const Cls = installFakeFoundry(
    makeRollDamage({
      damageRoll: async (o) => {
        calls.push(o);
        if (fail) throw new Error("cancelled");
        await gate;
      }
    })
  );
  patch.apply();

  const item = makeItem(Cls, { dano: { alq: ["5"] } });
  const first = item.rollDamage();
  const second = item.rollDamage();
  release();
  await Promise.all([first, second]);
  assert.deepEqual(formulas(calls), ["1d6 + @danoALQ", "1d6 + @danoALQ"]);
  assert.deepEqual(item.system.rolls[0].parts, [["1d6", "fogo", ""]]);

  fail = true;
  await assert.rejects(item.rollDamage(), /cancelled/);
  assert.deepEqual(item.system.rolls[0].parts, [["1d6", "fogo", ""]]);
});
