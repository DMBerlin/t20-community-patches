import { test } from "node:test";
import assert from "node:assert/strict";
import patch, { buggySaves, diagnoseProbe, numericSemataque, skipsSemataque } from "../scripts/patches/save-skill-bonus.mjs";

const SAVES = ["fort", "refl", "vont"];
const BOTH = { resistencia: ["1"], semataque: ["2"] };

test("skipsSemataque: saves with both kinds of bonus only", () => {
  assert.equal(skipsSemataque({ skillId: "fort", saves: SAVES, bonuses: BOTH }), true);
  assert.equal(skipsSemataque({ skillId: "vont", saves: SAVES, bonuses: BOTH }), true);
  assert.equal(skipsSemataque({ skillId: "fort", saves: SAVES, bonuses: { resistencia: [], semataque: ["2"] } }), false);
  assert.equal(skipsSemataque({ skillId: "fort", saves: SAVES, bonuses: { resistencia: ["1"], semataque: [""] } }), false);
  assert.equal(skipsSemataque({ skillId: "atle", saves: SAVES, bonuses: BOTH }), false);
  assert.equal(skipsSemataque({ skillId: "luta", saves: [...SAVES, "luta"], bonuses: BOTH }), false);
});

test("numericSemataque: nonzero numbers only", () => {
  assert.equal(numericSemataque({ semataque: "2.5" }), true);
  assert.equal(numericSemataque({ semataque: -1 }), true);
  assert.equal(numericSemataque({ semataque: "1d4+2" }), false);
  assert.equal(numericSemataque({ semataque: " " }), false);
  assert.equal(numericSemataque({ semataque: 0 }), false);
  assert.equal(numericSemataque(undefined), false);
});

test("buggySaves: only saves still at the buggy value", () => {
  assert.deepEqual([...buggySaves({ fort: 3, refl: 1, vont: 1 })], ["refl", "vont"]);
  assert.deepEqual([...buggySaves({ fort: 3, refl: 7 })], []);
});

const probe = (fort, refl, vont, skill = 2) => diagnoseProbe({ saves: { fort, refl, vont }, skill });

test("diagnoseProbe: every save must be fixed for fixed; control must match", () => {
  assert.deepEqual([probe(1, 1, 1).bug, probe(1, 1, 1).confidence], ["present", "high"]);
  assert.deepEqual([probe(3, 3, 3).bug, probe(3, 3, 3).confidence], ["fixed", "high"]);
  assert.deepEqual([probe(3, 1, 1).bug, probe(3, 1, 1).confidence], ["present", "high"]);
  assert.equal(probe(1, 1, 1, 0).bug, "unknown");
  assert.equal(probe(7, 3, 3).bug, "unknown");
});

/** The 1.6.5 formula (T20:19846-19871): own bonus terms, then the actor-wide bonus; sum, then parseInt. */
function prepareSkill165(skillId, { skillData, rollData } = {}) {
  const parts = [`@${skillData.atributo}`, ...(skillData.bonus ?? [])];
  const bonuses = foundry.utils.getProperty(this, "modificadores.pericias") || {};
  if (Object.keys(CONFIG.T20.resistencias).includes(skillId) && bonuses.resistencia?.filter(Boolean).length) parts.push("@resistencia");
  else if (!["luta", "pont"].includes(skillId) && bonuses.semataque?.filter(Boolean).length) parts.push("@semataque");
  else if (["luta", "pont"].includes(skillId) && bonuses.ataque?.filter(Boolean).length) parts.push("@ataque");
  const term = (p) => Number(p.startsWith("@") ? rollData[p.slice(1)] ?? 0 : p);
  skillData.value = parseInt(String(parts.reduce((sum, p) => sum + term(p), 0))) || 0;
  return skillData;
}

/** A system that fixed only Fortitude. */
function fortOnlyFixed(skillId, args) {
  const data = prepareSkill165.call(this, skillId, args);
  if (skillId === "fort") data.value += args.rollData.semataque;
  return data;
}

function setup(prepareSkill = prepareSkill165) {
  class Creature {}
  Creature.prototype.prepareSkill = prepareSkill;
  class Character extends Creature {}
  globalThis.CONFIG = { Actor: { dataModels: { character: Character } }, T20: { resistencias: { fort: {}, refl: {}, vont: {} } } };
  globalThis.foundry = {
    utils: {
      deepClone: (v) => structuredClone(v),
      getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj)
    }
  };
  return Character;
}

function teardown() {
  delete globalThis.CONFIG;
  delete globalThis.foundry;
}

test("isNeeded runs the original on synthetic data: 1.6.5 logic is present/high, a fixed one is fixed/high", () => {
  try {
    setup();
    assert.deepEqual([patch.isNeeded().bug, patch.isNeeded().confidence], ["present", "high"]);
    setup(function (skillId, args) {
      const data = prepareSkill165.call(this, skillId, args);
      if (skillId in { fort: 1, refl: 1, vont: 1 }) data.value += args.rollData.semataque;
      return data;
    });
    assert.deepEqual([patch.isNeeded().bug, patch.isNeeded().confidence], ["fixed", "high"]);
    setup(fortOnlyFixed);
    assert.deepEqual([patch.isNeeded().bug, patch.isNeeded().confidence], ["present", "high"]);
    setup(() => {
      throw new Error("boom");
    });
    assert.equal(patch.isNeeded().bug, "unknown");
  } finally {
    teardown();
  }
});

function character(Character) {
  return Object.assign(new Character(), { modificadores: { pericias: { resistencia: ["1"], semataque: ["2"], ataque: ["4"] } } });
}

test("apply: saves get semataque with resistencia bonuses; other skills and roll data stay the same", () => {
  try {
    const Character = setup();
    patch.apply();
    const actor = character(Character);
    const rollData = { con: 1, for: 1, resistencia: 1, semataque: 2, ataque: 4 };
    const prep = (id, atributo, bonus = []) => actor.prepareSkill(id, { skillData: { atributo, bonus }, rollData }).value;
    assert.equal(prep("fort", "con"), 4);
    assert.equal(prep("atle", "for"), 3);
    assert.equal(prep("luta", "for"), 5);
    assert.deepEqual(rollData, { con: 1, for: 1, resistencia: 1, semataque: 2, ataque: 4 });
    actor.modificadores.pericias.resistencia = [];
    assert.equal(prep("fort", "con"), 3);
  } finally {
    teardown();
  }
});

test("apply: the term joins before the integer conversion; own bonuses keep their meaning and are restored", () => {
  try {
    const Character = setup();
    patch.apply();
    const actor = character(Character);
    const skillData = { atributo: "con", bonus: ["@resistencia"] };
    const rollData = { con: 0, resistencia: 1, semataque: 2 };
    assert.equal(actor.prepareSkill("vont", { skillData, rollData }).value, 4);
    assert.deepEqual(skillData.bonus, ["@resistencia"]);
    assert.deepEqual(rollData, { con: 0, resistencia: 1, semataque: 2 });
    assert.equal(actor.prepareSkill("refl", { skillData: { atributo: "con", bonus: [] }, rollData: { con: 0, resistencia: 1, semataque: "2.5" } }).value, 3);
    assert.equal(actor.prepareSkill("refl", { skillData: { atributo: "con", bonus: [] }, rollData: { con: 0, resistencia: 1, semataque: "1d4" } }).value, 1);
  } finally {
    teardown();
  }
});

test("apply after a partial upstream fix touches only the saves still buggy", () => {
  try {
    const Character = setup(fortOnlyFixed);
    patch.apply();
    const actor = character(Character);
    const prep = (id) => actor.prepareSkill(id, { skillData: { atributo: "con", bonus: [] }, rollData: { con: 0, resistencia: 1, semataque: 2 } }).value;
    assert.deepEqual([prep("fort"), prep("refl"), prep("vont")], [3, 3, 3]);
  } finally {
    teardown();
  }
});
