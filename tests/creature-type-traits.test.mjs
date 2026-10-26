import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONSTRUCT,
  SKELETAL_NATURE_ID,
  UNDEAD,
  creatureKind,
  isTypeImmune,
  needsLightChoice,
  onCreateActiveEffect,
  planDamage,
  presentDamage,
  resolveTerms,
  typeImmunityGetter,
  wrapApplyDamage
} from "../scripts/rules/creature-type-traits.mjs";

const term = (total, flavor, extra = {}) => ({ total, options: flavor ? { flavor } : {}, ...extra });
const op = (operator) => ({ operator });
const entry = (flavor, total) => ({ flavor, total });
const strip = (plan) => plan && { ...plan, entries: plan.entries.map(({ flavor, total }) => ({ flavor, total })) };

function fakeGame({ enabled = true, userId = "u1", isGM = true } = {}) {
  const notes = [];
  globalThis.game = {
    settings: { get: () => (enabled ? "on" : "off") },
    i18n: {
      localize: (key) => key,
      format: (key, data) => `${key} ${JSON.stringify(data)}`
    },
    user: { id: userId, isGM }
  };
  globalThis.ui = { notifications: { info: (message) => notes.push(message) } };
  return notes;
}

/* -------------------------------------------- */
/*  Pure logic                                  */
/* -------------------------------------------- */

test("creatureKind: Type first, then Natureza Esquelética", () => {
  assert.equal(creatureKind({ tipo: "mor" }), UNDEAD);
  assert.equal(creatureKind({ tipo: "con" }), CONSTRUCT);
  assert.equal(
    creatureKind({ tipo: "hum", items: [{ type: "poder", name: "X", sourceId: `Compendium.tormenta20.poderes.Item.${SKELETAL_NATURE_ID}` }] }),
    UNDEAD
  );
  assert.equal(creatureKind({ tipo: "hum", items: [{ type: "poder", name: "Natureza Esquelética" }] }), UNDEAD);
  assert.equal(creatureKind({ tipo: "hum", items: [{ type: "poder", name: " natureza esqueletica " }] }), UNDEAD);
  assert.equal(creatureKind({ tipo: "hum", items: [{ type: "poder", name: "Criatura Artificial" }] }), null);
  assert.equal(creatureKind({ tipo: "hum", items: [{ type: "equipamento", name: "Natureza Esquelética" }] }), null);
  assert.equal(creatureKind({}), null);
});

test("isTypeImmune: by id and by category, as the system's test", () => {
  assert.equal(isTypeImmune(UNDEAD, { statusId: "fatigado" }), true);
  assert.equal(isTypeImmune(CONSTRUCT, { statusId: "x", category: "cansaco" }), true);
  assert.equal(isTypeImmune(CONSTRUCT, { statusId: "envenenado", category: "veneno" }), true);
  assert.equal(isTypeImmune(UNDEAD, { category: "trevas" }), true);
  assert.equal(isTypeImmune(CONSTRUCT, { category: "trevas" }), false);
  assert.equal(isTypeImmune(UNDEAD, { statusId: "fatigado", category: "cansaco", ignoreImunity: true }), false);
  assert.equal(isTypeImmune(UNDEAD, { statusId: "confuso", category: "mental" }), false);
  assert.equal(isTypeImmune(UNDEAD, { statusId: "abalado", category: "medo" }), false);
  assert.equal(isTypeImmune(null, { statusId: "fatigado" }), false);
});

test("resolveTerms: flavor inheritance, subtraction and the default type", () => {
  const curapv = [term(9, "curapv", { faces: 8, number: 2 }), op("+"), term(2, "curapv"), op("+"), term(1)];
  assert.deepEqual(
    resolveTerms(curapv).map(({ flavor, total }) => [flavor, total]),
    [["curapv", 9], ["curapv", 2], ["curapv", 1]]
  );
  assert.deepEqual(
    resolveTerms([term(10, "trevas"), op("-"), term(3, "trevas")]).map((e) => e.total),
    [10, -3]
  );
  assert.deepEqual(resolveTerms([term(5)], "dano").map((e) => e.flavor), ["dano"]);
});

test("needsLightChoice: only undead, healing click and curapv", () => {
  const entries = [entry("curapv", 9)];
  assert.equal(needsLightChoice(UNDEAD, entries, -1), true);
  assert.equal(needsLightChoice(UNDEAD, entries, 1), false);
  assert.equal(needsLightChoice(CONSTRUCT, entries, -1), false);
  assert.equal(needsLightChoice(UNDEAD, [entry("curapm", 3)], -1), false);
});

test("planDamage: darkness heals undead in one plan", () => {
  assert.deepEqual(strip(planDamage(UNDEAD, [entry("trevas", 9)], 1)), {
    entries: [entry("curapv", -9)], multiplier: 1, dropped: 0
  });
  assert.deepEqual(strip(planDamage(UNDEAD, [entry("trevas", 9)], 0.5)), {
    entries: [entry("curapv", -8)], multiplier: 0.5, dropped: 0
  });
  assert.deepEqual(strip(planDamage(UNDEAD, [entry("trevas", 9)], 2)), {
    entries: [entry("curapv", -9)], multiplier: 2, dropped: 0
  });
  assert.deepEqual(planDamage(UNDEAD, [entry("trevas", 3), entry("trevas", -3)], 1).entries, []);
  assert.deepEqual(planDamage(UNDEAD, [entry("trevas", 2), entry("trevas", -5)], 1).entries, []);
  assert.deepEqual(strip(planDamage(UNDEAD, [entry("corte", 20), entry("trevas", 20)], 1)).entries, [
    entry("corte", 20), entry("curapv", -20)
  ]);
});

test("planDamage: healing on undead becomes light damage (plan multiplier 1)", () => {
  const cure = [entry("curapv", 9), entry("curatpv", 4)];
  assert.deepEqual(strip(planDamage(UNDEAD, cure, -1, 1)), {
    entries: [entry("luz", 9), entry("curatpv", -4)], multiplier: 1, dropped: 0
  });
  assert.deepEqual(strip(planDamage(UNDEAD, cure, -1, 0.5)).entries, [entry("luz", 4), entry("curatpv", -4)]);
  assert.deepEqual(
    strip(planDamage(UNDEAD, [entry("curapv", 9), entry("curapm", 3), entry("curatpm", 2)], -1, 0.5)).entries,
    [entry("luz", 4), entry("curapm", -3), entry("curatpm", -2)]
  );
  assert.deepEqual(strip(planDamage(UNDEAD, [entry("curapv", 9), entry("perda", 5)], -1, 0.5)).entries, [
    entry("luz", 4), entry("curapv", -5)
  ]);
  assert.deepEqual(planDamage(UNDEAD, [entry("curapv", 1)], -1, 0.5).entries, []);
  assert.equal(planDamage(UNDEAD, cure, -1), null, "without an answer");
});

test("planDamage: pass-through cases and constructs", () => {
  assert.equal(planDamage(UNDEAD, [entry("curapv", 9)], 1), null);
  assert.equal(planDamage(UNDEAD, [entry("trevas", 9)], -1, 1), null);
  assert.equal(planDamage(CONSTRUCT, [entry("trevas", 9)], 1), null);
  assert.equal(planDamage(null, [entry("trevas", 9)], 1), null);
  assert.deepEqual(planDamage(CONSTRUCT, [entry("curapv", 9)], -1), { entries: [], multiplier: -1, dropped: 9 });
  const mixed = planDamage(CONSTRUCT, [entry("curapv", 9), entry("curapm", 3)], -1);
  assert.deepEqual(strip(mixed).entries, [entry("curapm", 3)]);
  assert.equal(mixed.dropped, 9);
});

test("presentDamage: one card per operation, with the system's sign convention", () => {
  assert.deepEqual(presentDamage({ damage: 20, heal: 20 }, 1), [
    { final: { damage: 20, loss: 0 }, multiplier: 1, withParts: true },
    { final: { heal: 20 }, multiplier: -1 }
  ]);
  assert.deepEqual(presentDamage({ heal: 9 }, 1), [{ final: { heal: 9 }, multiplier: -1 }]);
  assert.deepEqual(presentDamage({ damage: 4, tempHP: 4 }, -1), [
    { final: { damage: 4, loss: 0 }, multiplier: 1, withParts: true },
    { final: { tempHP: 4, mana: 0, manaGain: 0, tempMP: 0 }, multiplier: -1 }
  ]);
  const pm = presentDamage({ damage: 4, manaGain: 3, tempMP: 2 }, -1);
  assert.deepEqual(pm[1], { final: { tempHP: 0, mana: 0, manaGain: 3, tempMP: 2 }, multiplier: -1 });
  assert.deepEqual(presentDamage({ damage: 0, heal: 0 }, 1), []);
});

/* -------------------------------------------- */
/*  End-to-end arithmetic                       */
/* -------------------------------------------- */

/** Mirrors the accumulators of T20:7367-7447 (no RD), then the core's integer cleaner (Math.round). */
function sumApplyDamage(entries, multiplier, { pv, pm = { value: 10, temp: 0, min: 0, max: 10 } }) {
  const final = { damage: 0, loss: 0, heal: 0, tempHP: 0, mana: 0, manaGain: 0, tempMP: 0 };
  const damage = {};
  for (const { flavor, total } of entries) {
    damage[flavor] ??= { value: 0 };
    damage[flavor].value += total;
  }
  const map = { curapv: "heal", curatpv: "tempHP", curapm: "manaGain", curatpm: "tempMP" };
  for (const [key, value] of Object.entries(map)) {
    if (damage[key]) {
      final[value] += damage[key].value * -multiplier;
      delete damage[key];
    }
  }
  if (damage.perda) {
    if (multiplier > 0) final.loss += damage.perda.value * multiplier;
    else final.heal += damage.perda.value;
    delete damage.perda;
  }
  for (const dmg of Object.values(damage)) {
    if (multiplier > 0) final.damage += Math.max(dmg.value * multiplier, 0);
    else final.heal += dmg.value;
  }
  final.damage = Math.max(final.damage, 0);
  const hpt = Math.min(pv.temp, final.damage + final.loss);
  const mpt = Math.min(pm.temp, final.mana);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  return {
    pv: Math.round(clamp(pv.value + final.heal - (final.damage + final.loss - hpt), pv.min, pv.max)),
    pvTemp: Math.round(pv.temp - hpt + final.tempHP),
    pm: Math.round(clamp(pm.value + final.manaGain - (final.mana - mpt), pm.min, pm.max)),
    pmTemp: Math.round(pm.temp - mpt + final.tempMP),
    final
  };
}

test("end to end: the plans give the HP of the technical design table", () => {
  const zombie = (value) => ({ pv: { value, temp: 0, min: -10, max: 20 }, pm: { value: 0, temp: 0, min: 0, max: 10 } });
  const run = (entries, m, value, choice) => {
    const plan = planDamage(UNDEAD, entries, m, choice);
    for (const e of plan.entries.filter((e) => !entries.includes(e))) {
      assert.ok(Number.isInteger(e.total * plan.multiplier), `integer change ${e.flavor}`);
    }
    return sumApplyDamage(plan.entries, plan.multiplier, zombie(value));
  };
  assert.equal(run([entry("corte", 20), entry("trevas", 20)], 1, 5).pv, 5);
  assert.equal(run([entry("trevas", 9)], 0.5, 5).pv, 9);
  assert.equal(run([entry("trevas", 9)], 2, 1).pv, 19);
  assert.equal(run([entry("corte", 9), entry("trevas", 9)], 0.5, 5).pv, 5);
  const light = run([entry("curapv", 9), entry("curatpv", 4)], -1, 20, 0.5);
  assert.equal(light.pv, 16);
  assert.equal(light.pvTemp, 4);
  const mana = run([entry("curapv", 9), entry("curapm", 3), entry("curatpm", 2)], -1, 20, 0.5);
  assert.equal(mana.pm, 3);
  assert.equal(mana.pmTemp, 2);
  assert.equal(run([entry("curapv", 9), entry("perda", 5)], -1, 10, 0.5).pv, 11);
});

/* -------------------------------------------- */
/*  Wrapper                                     */
/* -------------------------------------------- */

function makeActor(tipo, { pv = 5 } = {}) {
  const log = { updates: [], cards: [] };
  const actor = {
    name: "Zumbi",
    isOwner: true,
    items: [],
    system: { detalhes: { tipo }, attributes: { pv: { value: pv, temp: 0, min: -10, max: 20 } } },
    async update(data) {
      log.updates.push({ self: this, data });
    },
    async displayDamageCard(parts, final, multiplier) {
      log.cards.push({ parts, final, multiplier });
    }
  };
  return { actor, log };
}

/** Fake system method: sums the terms like sumApplyDamage, then one update and one card. */
function makeOriginal(calls) {
  return async function (roll, multiplier = 1) {
    calls.push({ self: this, roll, multiplier });
    const entries = resolveTerms(roll.terms);
    const pv = this.system.attributes.pv;
    const { pv: value, final } = sumApplyDamage(entries, multiplier, { pv });
    await this.update({ "system.attributes.pv.value": value });
    await this.displayDamageCard({ parts: true }, final, multiplier);
  };
}

const mixedRoll = () => ({ options: { rd: 0 }, terms: [term(20, "corte"), op("+"), term(20, "trevas")] });

test("wrapper: a mixed roll on an undead is ONE inner call, one update and two real cards", async () => {
  fakeGame();
  const calls = [];
  const { actor, log } = makeActor("mor");
  const roll = mixedRoll();
  const termsBefore = JSON.stringify(roll.terms);
  const wrapped = wrapApplyDamage(makeOriginal(calls), { enabled: () => true });
  await wrapped.call(actor, roll, 1);
  assert.equal(calls.length, 1);
  assert.equal(log.updates.length, 1);
  assert.equal(log.updates[0].data["system.attributes.pv.value"], 5);
  assert.deepEqual(log.cards.map((c) => [c.final, c.multiplier]), [
    [{ damage: 20, loss: 0 }, 1],
    [{ heal: 20 }, -1]
  ]);
  assert.equal(calls[0].roll.options.rd, 0, "the derived roll keeps the options");
  assert.equal(JSON.stringify(roll.terms), termsBefore, "the original roll is untouched");
});

test("wrapper: the received `this` (another rule's Proxy) owns the update", async () => {
  fakeGame();
  const calls = [];
  const { actor } = makeActor("mor");
  const proxied = [];
  const outer = new Proxy(actor, {
    get(target, prop, receiver) {
      if (prop === "update") return async (data) => proxied.push(data);
      return Reflect.get(target, prop, receiver);
    }
  });
  await wrapApplyDamage(makeOriginal(calls), { enabled: () => true }).call(outer, mixedRoll(), 1);
  assert.equal(proxied.length, 1);
});

test("wrapper: the light dialog decides, closing it applies nothing", async () => {
  fakeGame();
  const cure = () => ({ options: {}, terms: [term(9, "curapv"), op("+"), term(4, "curatpv")] });

  let calls = [];
  let { actor, log } = makeActor("mor", { pv: 20 });
  await wrapApplyDamage(makeOriginal(calls), { enabled: () => true, ask: async () => null }).call(actor, cure(), -1);
  assert.equal(calls.length, 0);
  assert.equal(log.updates.length, 0);

  calls = [];
  ({ actor, log } = makeActor("mor", { pv: 20 }));
  let asked;
  await wrapApplyDamage(makeOriginal(calls), {
    enabled: () => true,
    ask: async (_actor, amount) => ((asked = amount), 0.5)
  }).call(actor, cure(), -1);
  assert.equal(asked, 9);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].multiplier, 1);
  assert.equal(log.updates[0].data["system.attributes.pv.value"], 16);

  calls = [];
  ({ actor } = makeActor("mor", { pv: 20 }));
  const roll = cure();
  await wrapApplyDamage(makeOriginal(calls), { enabled: () => true, ask: async () => "heal" }).call(actor, roll, -1);
  assert.equal(calls[0].roll, roll, "heal normally passes the original roll through");
});

test("wrapper: constructs drop the HP healing with a notice; off or other types pass through", async () => {
  fakeGame();
  const notes = [];
  let calls = [];
  const { actor, log } = makeActor("con", { pv: 10 });
  await wrapApplyDamage(makeOriginal(calls), { enabled: () => true, notify: (m) => notes.push(m) })
    .call(actor, { options: {}, terms: [term(9, "curapv")] }, -1);
  assert.equal(calls.length, 0);
  assert.equal(log.updates.length, 0);
  assert.equal(notes.length, 1);

  const roll = mixedRoll();
  calls = [];
  await wrapApplyDamage(makeOriginal(calls), { enabled: () => false }).call(makeActor("mor").actor, roll, 1);
  assert.equal(calls[0].roll, roll);
  calls = [];
  await wrapApplyDamage(makeOriginal(calls), { enabled: () => true }).call(makeActor("hum").actor, roll, 1);
  assert.equal(calls[0].roll, roll);
});

/* -------------------------------------------- */
/*  Immunity getter and notice                  */
/* -------------------------------------------- */

function makeEffect(actor, statusId, category, ignoreImunity = false) {
  return {
    name: statusId,
    parent: actor,
    statuses: new Set([statusId]),
    system: { status: { category, ignoreImunity } }
  };
}

test("typeImmunityGetter: the system's answer first, then the type", () => {
  fakeGame();
  const zombie = { system: { detalhes: { tipo: "mor" } }, items: [] };
  const model = (statusId, category, ignoreImunity) => ({
    parent: { actor: zombie, statuses: new Set([statusId]) },
    status: { category, ignoreImunity }
  });
  const getter = typeImmunityGetter(() => false);
  assert.equal(getter.call(model("fatigado", "cansaco")), true);
  assert.equal(getter.call(model("abalado", "medo")), false);
  assert.equal(getter.call(model("fatigado", "cansaco", true)), false);
  assert.equal(typeImmunityGetter(() => true).call(model("abalado", "medo")), true);
  fakeGame({ enabled: false });
  assert.equal(getter.call(model("fatigado", "cansaco")), false);
});

test("notice: only to the user who applied it, who can see the actor, for an immune condition", () => {
  const zombie = { documentName: "Actor", name: "Zumbi", system: { detalhes: { tipo: "mor" }, tracos: { ic: { value: [] } } }, items: [], testUserPermission: () => false };
  let notes = fakeGame();
  onCreateActiveEffect(makeEffect(zombie, "fatigado", "cansaco"), {}, "u1");
  assert.equal(notes.length, 1);

  const osteon = {
    documentName: "Actor",
    name: "Osteon",
    system: { detalhes: { tipo: "hum" }, tracos: { ic: { value: ["fatigado", "cansaco"] } } },
    items: [{ type: "poder", name: "Natureza Esquelética" }]
  };
  notes = fakeGame();
  onCreateActiveEffect(makeEffect(osteon, "fatigado", "cansaco"), {}, "u1");
  assert.equal(notes.length, 1);

  notes = fakeGame();
  onCreateActiveEffect(makeEffect(zombie, "fatigado", "cansaco"), {}, "other");
  assert.equal(notes.length, 0);

  notes = fakeGame({ isGM: false });
  onCreateActiveEffect(makeEffect(zombie, "fatigado", "cansaco"), {}, "u1");
  assert.equal(notes.length, 0);

  notes = fakeGame();
  onCreateActiveEffect(makeEffect(zombie, "abalado", "medo"), {}, "u1");
  assert.equal(notes.length, 0);

  notes = fakeGame({ enabled: false });
  onCreateActiveEffect(makeEffect(zombie, "fatigado", "cansaco"), {}, "u1");
  assert.equal(notes.length, 0);
});
