import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  diagnoseSource,
  fromToInitiative,
  initiativeTargets,
  rollTotal,
  suppressesSetInitiative
} from "../scripts/patches/sheet-initiative-token.mjs";

const combatant = (id, actorId, tokenId, extra = {}) => ({
  id, actorId, tokenId, sceneId: "s1", linked: false, initiative: null, isOwner: true, ...extra
});
const A = combatant("A", "esq", "tA");
const B = combatant("B", "esq", "tB");
const P = combatant("P", "pc", "tP", { linked: true });
const tokenB = { id: "esq", isToken: true, tokenId: "tB", sceneId: "s1" };

test("initiativeTargets picks the rolling token, not the first token of the same actor", () => {
  assert.deepEqual(initiativeTargets({ actor: tokenB, combatants: [A, B, P] }), ["B"]);
});

test("initiativeTargets skips combatants that already have initiative or that the user does not own", () => {
  assert.deepEqual(initiativeTargets({ actor: tokenB, combatants: [A, { ...B, initiative: 15 }] }), []);
  assert.deepEqual(initiativeTargets({ actor: tokenB, combatants: [A, { ...B, isOwner: false }] }), []);
});

test("initiativeTargets for a world actor uses its linked combatants", () => {
  assert.deepEqual(initiativeTargets({ actor: { id: "pc", isToken: false }, combatants: [A, B, P] }), ["P"]);
  const noToken = combatant("N", "pc", null);
  assert.deepEqual(initiativeTargets({ actor: { id: "pc", isToken: false }, combatants: [noToken] }), ["N"]);
});

test("initiativeTargets for a world actor with only unlinked tokens writes only when unambiguous", () => {
  const actor = { id: "esq", isToken: false };
  assert.deepEqual(initiativeTargets({ actor, combatants: [A, B] }), []);
  assert.deepEqual(initiativeTargets({ actor, combatants: [A] }), ["A"]);
});

test("initiativeTargets ignores combatants without actor and tokens from other scenes", () => {
  const orphan = combatant("O", null, null);
  assert.deepEqual(initiativeTargets({ actor: tokenB, combatants: [orphan, B] }), ["B"]);
  const elsewhere = { ...B, id: "B2", sceneId: "s2" };
  assert.deepEqual(initiativeTargets({ actor: tokenB, combatants: [elsewhere, B] }), ["B"]);
});

test("rollTotal reads the roll, then the system flag", () => {
  assert.equal(rollTotal({ rolls: [{ total: 17 }] }), 17);
  assert.equal(rollTotal({ flags: { tormenta20: { rollTotal: 12 } } }), 12);
  assert.equal(rollTotal(undefined), null);
  assert.equal(rollTotal({ rolls: [] }), null);
  assert.equal(rollTotal({ rolls: [{ total: NaN }] }), null);
});

test("suppressesSetInitiative matches only the system call", () => {
  const base = { pending: ["esq"], actorId: "esq", initiative: null, active: true };
  assert.equal(suppressesSetInitiative(base), true);
  assert.equal(suppressesSetInitiative({ ...base, active: false }), false);
  assert.equal(suppressesSetInitiative({ ...base, initiative: 10 }), false);
  assert.equal(suppressesSetInitiative({ ...base, actorId: "pc" }), false);
  assert.equal(suppressesSetInitiative({ ...base, actorId: undefined }), false);
});

test("fromToInitiative recognizes the system closure frame only", () => {
  const url = "http://localhost:30000/systems/tormenta20/tormenta20.mjs";
  assert.equal(fromToInitiative(`Error\n    at Combat.setInitiative (x.mjs:1:1)\n    at toInitiative (${url}:7670:15)`), true);
  assert.equal(fromToInitiative(`setInitiative@x.mjs:1:1\ntoInitiative@${url}:7670:15`), true);
  assert.equal(fromToInitiative("Error\n    at Combat.setInitiative (x.mjs:1:1)\n    at eval (macro:1:1)"), false);
  assert.equal(fromToInitiative("Error\n    at rollToInitiative (m.mjs:1:1)\n    at toInitiativeX (m.mjs:1:1)"), false);
  assert.equal(fromToInitiative(undefined), true);
});

const ORIGINAL = `async rollPericia(key, options = {}) {
  let toInitiative = function (actor) {
    try {
      let combate = game.combats.active;
      if (pericia.label === "Iniciativa" && combate) {
        let roll = rConfig.itemData.rolled;
        let combatente = combate.combatants.find((combatant) => combatant.actor.id === actor.id);
        if (combatente && combatente.initiative === null) {
          combate.setInitiative(combatente.id, roll.total);
        }
      }
    } catch (error) { console.error(error); }
  };
}`;
const BY_ACTOR = ORIGINAL.replace(
  "combate.combatants.find((combatant) => combatant.actor.id === actor.id)",
  "combate.getCombatantsByActor(actor)[0]"
);
const FIXED = BY_ACTOR.replace('pericia.label === "Iniciativa"', 'key === "inic"');

test("diagnoseSource reads the 1.6.5 source and never proves a fix", () => {
  assert.deepEqual(diagnoseSource(ORIGINAL).bug, "present");
  assert.equal(diagnoseSource(ORIGINAL).confidence, "high");
  assert.deepEqual([diagnoseSource(BY_ACTOR).bug, diagnoseSource(BY_ACTOR).confidence], ["present", "low"]);
  assert.deepEqual([diagnoseSource(FIXED).bug, diagnoseSource(FIXED).confidence], ["fixed", "low"]);
  const commented = FIXED.replace("let toInitiative", '// combatant.actor.id === actor.id; x.label === "Iniciativa"\n  let toInitiative');
  assert.equal(diagnoseSource(commented).bug, "fixed");
  assert.equal(diagnoseSource(ORIGINAL.replace("combate.setInitiative", "combate.update")).bug, "unknown");
  assert.equal(diagnoseSource(undefined).bug, "unknown");
});

test("apply writes the card total to the rolling token and suppresses the system's write", async () => {
  const updates = [];
  const sets = [];
  class Combat {
    async setInitiative(id, value) { sets.push([id, value]); }
  }
  const make = (id, tokenId) => ({
    id, actorId: "esq", tokenId, sceneId: "s1", initiative: null, isOwner: true,
    token: { actorLink: false }, actor: { id: "esq" }
  });
  const combat = Object.assign(new Combat(), {
    combatants: new Map([["A", make("A", "tA")], ["B", make("B", "tB")]]),
    async updateEmbeddedDocuments(type, data) { updates.push([type, data]); }
  });
  combat.combatants.contents = [...combat.combatants.values()];
  class Actor {
    constructor(token) { this.id = "esq"; this.isToken = !!token; this.token = token; }
    async rollPericia(key, options = {}) {
      options.message ??= true;
      if (options.dialog) await options.dialog;
      const label = key === "inic" || key === "custom" ? "Iniciativa" : "Percepção";
      if (options.message && label === "Iniciativa") {
        const first = combat.combatants.contents.find((c) => c.actor.id === this.id);
        const toInitiative = function () { combat.setInitiative(first.id, 14); };
        toInitiative();
        return this.displayCard({ options: { itemData: { rolled: { total: 14 } } } });
      }
      return this.displayCard({ options: { itemData: { rolled: { total: 3 } } } });
    }
    async displayCard({ options }) { return { rolls: [{ total: options.itemData.rolled.total }] }; }
  }
  globalThis.CONFIG = { Actor: { documentClass: Actor } };
  globalThis.foundry = { documents: { Combat } };
  globalThis.game = { combats: { active: combat, *[Symbol.iterator]() { yield combat; } } };
  try {
    patch.apply();
    const message = await new Actor({ id: "tB", parent: { id: "s1" } }).rollPericia("inic", {});
    assert.deepEqual(message, { rolls: [{ total: 14 }] });
    assert.deepEqual(sets, []);
    assert.deepEqual(updates, [["Combatant", [{ _id: "B", initiative: 14 }]]]);

    await new Actor({ id: "tB", parent: { id: "s1" } }).rollPericia("perc", {});
    await new Actor({ id: "tB", parent: { id: "s1" } }).rollPericia("custom", {});
    assert.equal(updates.length, 1);
    assert.deepEqual(sets, []);

    await combat.setInitiative("A", 9);
    assert.deepEqual(sets, [["A", 9]]);

    // A macro call while a roll dialog of the same actor is open goes through.
    sets.length = 0;
    let close;
    const rolling = new Actor({ id: "tB", parent: { id: "s1" } }).rollPericia("perc", { dialog: new Promise((r) => (close = r)) });
    await combat.setInitiative("A", 14);
    assert.deepEqual(sets, [["A", 14]]);
    close();
    await rolling;
    assert.deepEqual(sets, [["A", 14]]);
    assert.equal(Object.hasOwn(combat, "setInitiative"), false);

    // Another module wrapping Combat#setInitiative asynchronously does not let the system write through.
    const wrapped = Combat.prototype.setInitiative;
    Combat.prototype.setInitiative = async function (...args) { await null; return wrapped.apply(this, args); };
    sets.length = 0;
    updates.length = 0;
    await new Actor({ id: "tB", parent: { id: "s1" } }).rollPericia("inic", {});
    await new Promise((r) => setTimeout(r));
    assert.deepEqual(sets, []);
    assert.deepEqual(updates, [["Combatant", [{ _id: "B", initiative: 14 }]]]);
  } finally {
    delete globalThis.CONFIG;
    delete globalThis.foundry;
    delete globalThis.game;
  }
});
