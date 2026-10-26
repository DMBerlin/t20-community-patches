import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  ABILITY_FLAG,
  FLAG,
  KNOWN_SORT,
  SYSTEM_FORMULA,
  compareInitiativeTie,
  diagnose,
  initiativeAbility,
  initiativeSkill,
  tiebreakValues
} from "../scripts/patches/initiative-tiebreak.mjs";
import { resolvePatchState } from "../scripts/registry.mjs";
import { MODULE_ID, markWrapper, sourceFingerprint } from "../scripts/utils.mjs";

// Copied verbatim from Foundry v14 client/documents/combat.mjs:569-573 (also public/scripts/foundry.mjs:51676-51680).
const CORE_SORT_SOURCE = `_sortCombatants(a, b) {
    const ia = Number.isNumeric(a.initiative) ? a.initiative : -Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : -Infinity;
    return (ib - ia) || (a.id > b.id ? 1 : -1);
  }`;

// Foundry's Number.isNumeric, used by the core sort.
Number.isNumeric ??= (n) => (typeof n === "number" || (typeof n === "string" && n.trim() !== "")) && !isNaN(n);
function coreSort(a, b) {
  const ia = Number.isNumeric(a.initiative) ? a.initiative : -Infinity;
  const ib = Number.isNumeric(b.initiative) ? b.initiative : -Infinity;
  return (ib - ia) || (a.id > b.id ? 1 : -1);
}

const combatant = (id, initiative, tiebreak, ability) => {
  const saved = {};
  if (tiebreak !== undefined) saved[FLAG] = tiebreak;
  if (ability !== undefined) saved[ABILITY_FLAG] = ability;
  return { id, initiative, flags: Object.keys(saved).length ? { [MODULE_ID]: saved } : {} };
};
const actorWith = (skill, abilities = { des: 3 }, atributo = "des") => ({
  system: {
    pericias: { inic: { value: skill, atributo } },
    atributos: Object.fromEntries(Object.entries(abilities).map(([k, value]) => [k, { value }]))
  }
});

test("initiativeSkill reads the numeric Initiative skill value", () => {
  for (const value of [null, undefined, "", "  ", "abc", NaN, true]) {
    assert.equal(initiativeSkill({ system: { pericias: { inic: { value } } } }), null);
  }
  assert.equal(initiativeSkill({ system: { pericias: { inic: { value: "3" } } } }), 3);
  assert.equal(initiativeSkill({ system: { pericias: { inic: { value: -2 } } } }), -2);
  assert.equal(initiativeSkill(null), null);
  assert.equal(initiativeSkill({ system: {} }), null);
});

test("initiativeAbility reads the skill's key attribute, Destreza by default", () => {
  assert.equal(initiativeAbility(actorWith(5, { des: 3, sab: 1 })), 3);
  assert.equal(initiativeAbility(actorWith(5, { des: 3, sab: 1 }, "sab")), 1);
  assert.equal(initiativeAbility(actorWith(5, { des: -1 }, "")), -1);
  assert.equal(initiativeAbility(actorWith(5, { des: 3 }, "car")), null);
  assert.equal(initiativeAbility(actorWith(5, { des: "x" })), null);
  assert.equal(initiativeAbility(null), null);
});

test("tiebreakValues saves skill and attribute with a result, nulls when cleared, nothing otherwise", () => {
  const actor = actorWith(5, { des: 2 });
  assert.deepEqual(tiebreakValues({ initiative: 15 }, actor), { skill: 5, ability: 2 });
  assert.deepEqual(tiebreakValues({ initiative: 15.5 }, actor), { skill: 5, ability: 2 });
  assert.deepEqual(tiebreakValues({ initiative: "15" }, actor), { skill: 5, ability: 2 });
  assert.deepEqual(tiebreakValues({ initiative: 15 }, null), { skill: null, ability: null });
  assert.deepEqual(tiebreakValues({ initiative: null }, actor), { skill: null, ability: null });
  assert.equal(tiebreakValues({ name: "x" }, actor), undefined);
  assert.equal(tiebreakValues(null, actor), undefined);
});

test("compareInitiativeTie only decides between equal numeric results, by the saved value", () => {
  assert.ok(compareInitiativeTie(combatant("a", 15, 1), combatant("b", 15, 5)) > 0);
  assert.ok(compareInitiativeTie(combatant("a", 15, 5), combatant("b", 15, 1)) < 0);
  assert.equal(compareInitiativeTie(combatant("a", 15, 1), combatant("b", 14, 9)), 0);
  assert.equal(compareInitiativeTie(combatant("a", null, 1), combatant("b", null, 9)), 0);
  assert.equal(compareInitiativeTie(combatant("a", 15, 4), combatant("b", 15, 4)), 0);
  assert.ok(compareInitiativeTie(combatant("a", 15, 0), combatant("b", 15)) < 0);
  assert.ok(compareInitiativeTie(combatant("a", 15, null), combatant("b", 15, -3)) > 0);
  assert.equal(compareInitiativeTie(combatant("a", 15), combatant("b", 15, null)), 0);
});

test("compareInitiativeTie breaks an equal skill by the saved attribute", () => {
  assert.ok(compareInitiativeTie(combatant("a", 15, 4, 1), combatant("b", 15, 4, 3)) > 0);
  assert.ok(compareInitiativeTie(combatant("a", 15, 4, 3), combatant("b", 15, 4, 1)) < 0);
  assert.ok(compareInitiativeTie(combatant("a", 15, 4, 0), combatant("b", 15, 4)) < 0);
  assert.equal(compareInitiativeTie(combatant("a", 15, 4, 2), combatant("b", 15, 4, 2)), 0);
  // The skill decides first, whatever the attribute.
  assert.ok(compareInitiativeTie(combatant("a", 15, 5, -1), combatant("b", 15, 4, 5)) < 0);
  // Different results are never decided here.
  assert.equal(compareInitiativeTie(combatant("a", 15, 4, 5), combatant("b", 14, 4, 1)), 0);
});

function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((item, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [item, ...p]));
}

test("the wrapped order is a total order: same result for every input permutation", () => {
  const sort = (a, b) => compareInitiativeTie(a, b) || coreSort(a, b);
  const list = [
    combatant("c", 15, 1),
    combatant("b", 15),
    combatant("a", 15, 5),
    combatant("d", 15, null),
    combatant("e", 16),
    combatant("f", null, 9),
    combatant("g", 15, 5, 2),
    combatant("h", 15, 5, 4)
  ];
  for (const perm of permutations(list)) {
    assert.deepEqual(perm.sort(sort).map((c) => c.id), ["e", "h", "g", "a", "c", "b", "d", "f"]);
  }
});

test("diagnose recognizes only the verified code and never returns fixed", () => {
  const facts = { sortFingerprint: KNOWN_SORT, sortOverridden: false, formula: SYSTEM_FORMULA, formulaOverridden: false };
  assert.deepEqual(
    { ...diagnose(facts), evidence: undefined },
    { bug: "present", confidence: "high", evidence: undefined }
  );
  for (const change of [
    { sortOverridden: true },
    { sortFingerprint: "00000000:1" },
    { sortFingerprint: null },
    { formula: "1d20 + @pericias.inic.value + @pericias.inic.value / 100" },
    { formulaOverridden: true }
  ]) {
    const d = diagnose({ ...facts, ...change });
    assert.equal(d.bug, "unknown");
    assert.equal(d.confidence, "low");
  }
});

test("KNOWN_SORT is the fingerprint of the Foundry v14 core sort", () => {
  assert.equal(sourceFingerprint(CORE_SORT_SOURCE), KNOWN_SORT);
});

/* -------------------------------------------- */
/*  Foundry integration with fakes              */
/* -------------------------------------------- */

function setProperty(object, key, value) {
  const parts = key.split(".");
  let target = object;
  for (const part of parts.slice(0, -1)) target = target[part] ??= {};
  target[parts.at(-1)] = value;
}

/** Fake globals: a core Combat whose sort has the core source, a system subclass, and a Hooks registry. */
function installFakes({ sort } = {}) {
  const hooks = {};
  // Build a method with the exact core source so Function#toString matches.
  const core = sort ?? new Function(`return ({ ${CORE_SORT_SOURCE} })._sortCombatants;`)();
  class Combat {}
  Combat.prototype._sortCombatants = core;
  class CombatT20 extends Combat {}
  class Combatant {
    _getInitiativeFormula() {}
  }
  globalThis.Hooks = { on: (name, fn) => (hooks[name] ??= []).push(fn) };
  globalThis.foundry = { documents: { Combat, Combatant }, utils: { setProperty } };
  globalThis.CONFIG = {
    Combat: { documentClass: CombatT20, initiative: { formula: SYSTEM_FORMULA, decimals: 2 } },
    Combatant: { documentClass: Combatant }
  };
  return { hooks, CombatT20 };
}

test("isNeeded reads the core sort without running it", () => {
  let calls = 0;
  const fake = function _sortCombatants() {
    calls++;
    return 0;
  };
  installFakes({ sort: fake });
  for (const [mode, systemVersion] of [["auto", "1.6.5"], ["off", "1.6.5"], ["auto", "1.7.0"], ["force", "1.7.0"]]) {
    const { diagnosis } = resolvePatchState({ patch, mode, systemId: "tormenta20", systemVersion, probe: patch.isNeeded });
    assert.equal(diagnosis.bug, "unknown");
    assert.equal(diagnosis.confidence, "low");
  }
  installFakes();
  const { state, diagnosis } = resolvePatchState({
    patch, mode: "auto", systemId: "tormenta20", systemVersion: "1.6.5", probe: patch.isNeeded
  });
  assert.equal(state, "applied");
  assert.equal(diagnosis.bug, "present");
  assert.equal(diagnosis.confidence, "high");
  assert.equal(calls, 0);
});

test("isNeeded is unknown when the system or another module overrides the sort or the formula", () => {
  const { CombatT20 } = installFakes();
  CombatT20.prototype._sortCombatants = function (a, b) {
    return 0;
  };
  assert.equal(patch.isNeeded().bug, "unknown");

  const fakes = installFakes();
  const wrapped = fakes.CombatT20.prototype._sortCombatants;
  fakes.CombatT20.prototype._sortCombatants = markWrapper((a, b) => wrapped(a, b), wrapped);
  assert.equal(patch.isNeeded().bug, "present");

  installFakes();
  CONFIG.Combat.initiative.formula = "2d20kh";
  assert.equal(patch.isNeeded().bug, "unknown");

  installFakes();
  CONFIG.Combatant.documentClass = class extends foundry.documents.Combatant {
    _getInitiativeFormula() {}
  };
  assert.equal(patch.isNeeded().bug, "unknown");
});

test("apply does nothing on unrecognized code", () => {
  const { hooks, CombatT20 } = installFakes();
  CONFIG.Combat.initiative.formula = "2d20kh";
  const before = CombatT20.prototype._sortCombatants;
  const warn = console.warn;
  console.warn = () => {};
  try {
    patch.apply();
  } finally {
    console.warn = warn;
  }
  assert.equal(CombatT20.prototype._sortCombatants, before);
  assert.deepEqual(hooks, {});
});

test("the saved skill keeps the order when the skill changes; a new result saves the new skill", () => {
  const { hooks, CombatT20 } = installFakes();
  patch.apply();
  const sort = CombatT20.prototype._sortCombatants;
  const make = (id, skill, des = 0) => ({ id, initiative: null, flags: {}, actor: actorWith(skill, { des }) });
  const a = make("a", 2);
  const b = make("b", 9);
  const c = make("c", 5);
  const d = make("d", 1);
  const all = [a, b, c, d];
  const write = (combatant, initiative) => {
    const changed = { initiative };
    for (const hook of hooks.preUpdateCombatant) hook(combatant, changed, {}, "user");
    combatant.initiative = changed.initiative;
    combatant.flags = { [MODULE_ID]: { ...combatant.flags[MODULE_ID], ...changed.flags?.[MODULE_ID] } };
  };
  // Unbound, as setupTurns passes it to Array#sort.
  const order = () => [...all].sort(sort).map((x) => x.id).join(",");

  write(a, 15);
  write(b, 15);
  write(c, 15);
  write(d, 18);
  assert.equal(order(), "d,b,c,a");

  b.actor = actorWith(0, { des: 0 });
  assert.equal(order(), "d,b,c,a");

  write(b, 15);
  assert.equal(order(), "d,c,a,b");

  write(a, null);
  assert.equal(a.flags[MODULE_ID][FLAG], null);
  assert.equal(a.flags[MODULE_ID][ABILITY_FLAG], null);
  assert.equal(order(), "d,c,b,a");

  // Equal skill: the attribute saved with the result decides, and keeps deciding after it changes.
  const x = make("x", 4, 1);
  const y = make("y", 4, 3);
  all.push(x, y);
  write(x, 15);
  write(y, 15);
  assert.deepEqual(y.flags[MODULE_ID], { [FLAG]: 4, [ABILITY_FLAG]: 3 });
  assert.equal(order(), "d,c,y,x,b,a");
  y.actor = actorWith(4, { des: 0 });
  assert.equal(order(), "d,c,y,x,b,a");

  const changed = { name: "Renamed" };
  for (const hook of hooks.preUpdateCombatant) hook(c, changed, {}, "user");
  assert.deepEqual(changed, { name: "Renamed" });
});

test("preCreateCombatant saves the skill when the combatant is created with a result", () => {
  const { hooks } = installFakes();
  patch.apply();
  const updates = [];
  const combatant = { actor: actorWith(7, { des: 2 }), updateSource: (u) => updates.push(u) };
  for (const hook of hooks.preCreateCombatant) hook(combatant, { initiative: 12 }, {}, "user");
  for (const hook of hooks.preCreateCombatant) hook(combatant, { tokenId: "t" }, {}, "user");
  assert.deepEqual(updates, [{ [`flags.${MODULE_ID}.${FLAG}`]: 7, [`flags.${MODULE_ID}.${ABILITY_FLAG}`]: 2 }]);
});

test("the wrapped sort falls back to the original when the tie check throws", () => {
  const { CombatT20 } = installFakes();
  patch.apply();
  const sort = CombatT20.prototype._sortCombatants;
  const hostile = { id: "z", initiative: 15, get flags() { throw new Error("boom"); } };
  assert.ok(sort(hostile, { id: "a", initiative: 15, flags: {} }) > 0);
});
