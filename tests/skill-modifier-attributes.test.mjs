import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  MODIFIER_KEYS,
  combineDiagnosis,
  diagnoseProbe,
  formulaRefs,
  isAttributeRef,
  keepAttributeRefs,
  hasTemporaryBonus,
  modifierFormula,
  probeInput,
  refreshModifiers
} from "../scripts/patches/skill-modifier-attributes.mjs";

/** Test simplify: resolves @key from data and sums integer terms joined by "+"; returns a string, like the system. */
function simplify(formula, data) {
  if (!formula) return "";
  const sum = formula.split("+").map((t) => t.trim()).reduce((acc, t) => {
    if (t.startsWith("@")) {
      const v = data[t.slice(1)];
      if (v === undefined) throw new Error(`unknown ${t}`);
      return acc + Number(v);
    }
    return acc + Number(t);
  }, 0);
  return String(sum);
}

/** CreatureData#prepareAtributos of 1.6.5 (T20:19821-19827). */
function prepareAtributos165({ rollData = {} } = {}) {
  this.parent.flags.tormenta20 ?? {};
  for (const [key, atr] of Object.entries(this.atributos)) {
    atr.value += atr.bonus;
    rollData[key] = atr.value;
  }
}

test("hasTemporaryBonus: any nonzero numeric bonus", () => {
  assert.equal(hasTemporaryBonus({ des: { bonus: 2 } }), true);
  assert.equal(hasTemporaryBonus({ des: { bonus: -1 } }), true);
  assert.equal(hasTemporaryBonus({ des: { bonus: 0 }, car: {}, for: { bonus: "x" } }), false);
  assert.equal(hasTemporaryBonus(undefined), false);
});

test("modifierFormula: truthy entries joined like getRollData", () => {
  const system = { modificadores: { pericias: { geral: ["@des", "", null, "1"] } } };
  assert.equal(modifierFormula(system, "pericias", "geral"), "@des + 1");
  assert.equal(modifierFormula(system, "pericias", "ataque"), "");
  assert.equal(modifierFormula(system, "dano", "geral"), "");
});

const sys = (lists, extra = {}) => ({ atributos: { des: { value: 5 }, car: { value: 4 } }, modificadores: lists, ...extra });

test("refreshModifiers: reduces stale lists with the final attributes, in getRollData's order", () => {
  const rollData = { des: 5, pericia: "3", semataque: "3" };
  const changed = refreshModifiers(sys({ pericias: { geral: ["@des"], semataque: ["@pericia"] } }), rollData, simplify);
  assert.deepEqual(changed, ["pericia", "semataque"]);
  assert.equal(rollData.pericia, "5");
  assert.equal(rollData.semataque, "5");
});

test("refreshModifiers: empty lists and formulas without @ stay untouched", () => {
  const rollData = { des: 5, pericia: 0, ataque: "2" };
  assert.deepEqual(refreshModifiers(sys({ pericias: { geral: [], ataque: ["2"] } }), rollData, simplify), []);
  assert.deepEqual(rollData, { des: 5, pericia: 0, ataque: "2" });
});

test("refreshModifiers: actors without skills (no pericia key) are left alone", () => {
  const rollData = { des: 5 };
  assert.deepEqual(refreshModifiers(sys({ pericias: { geral: ["@des"] } }), rollData, simplify), []);
  assert.deepEqual(rollData, { des: 5 });
  assert.deepEqual(refreshModifiers(sys({}), undefined, simplify), []);
});

test("refreshModifiers: a failing formula keeps its old value; the others are refreshed", () => {
  const rollData = { des: 5, pericia: "3", resistencia: "3" };
  refreshModifiers(sys({ pericias: { geral: ["@nope"], resistencia: ["@des"] } }), rollData, simplify);
  assert.equal(rollData.pericia, "3");
  assert.equal(rollData.resistencia, "5");
});

test("refreshModifiers: atributoChave is refreshed before the modifiers that read it", () => {
  const rollData = { car: 4, pericia: 0, atributoChave: 2, danoMagico: "2" };
  const changed = refreshModifiers(sys({ dano: { mag: ["@atributoChave"] } }, { attributes: { conjuracao: "car" } }), rollData, simplify);
  assert.deepEqual(changed, ["atributoChave", "danoMagico"]);
  assert.equal(rollData.atributoChave, 4);
  assert.equal(rollData.danoMagico, "4");
  const noKey = { des: 5, pericia: 0 };
  refreshModifiers(sys({}), noKey, simplify);
  assert.equal("atributoChave" in noKey, false);
});

test("diagnoseProbe: stale, fresh, partial and unrecognized results", () => {
  const data = (v, des = 5) => {
    const d = { des, atributoChave: v };
    for (const [k] of MODIFIER_KEYS) d[k] = v;
    return d;
  };
  assert.deepEqual([diagnoseProbe(data(3)).bug, diagnoseProbe(data(3)).confidence], ["present", "high"]);
  assert.deepEqual([diagnoseProbe(data(5)).bug, diagnoseProbe(data(5)).confidence], ["fixed", "high"]);
  const mixed = { ...data(3), pericia: "5" };
  assert.deepEqual([diagnoseProbe(mixed).bug, diagnoseProbe(mixed).confidence], ["present", "low"]);
  assert.equal(diagnoseProbe(data(3, 3)).bug, "unknown");
  assert.equal(diagnoseProbe({ ...data(3), ataque: 7 }).bug, "unknown");
});

/** Foundry 14 Roll.replaceFormulaData (recursive, missing references kept as text). */
function replaceFormulaData(formula, data, _r = 0) {
  return formula.replace(/@{[-.\w]+}|@[-.\w]+/g, (match) => {
    const term = match.replace(/^@{?|}?$/g, "");
    const value = term.split(".").reduce((o, k) => o?.[k], data);
    if (value == null) return match;
    if (typeof value === "string" && value.includes("@") && _r < 3) return replaceFormulaData(value.trim(), data, _r + 1);
    return String(value);
  });
}

/** Foundry 14 StringField, as far as change application goes (DataField#_castChangeDelta, StringField#_replaceDataRefs). */
class StringField14 {
  _castChangeDelta(delta, replacementData = {}) {
    if (typeof delta === "string") delta = this._replaceDataRefs(delta, replacementData);
    return String(delta);
  }

  _replaceDataRefs(raw, data, { strict = true } = {}) {
    const resolved = replaceFormulaData(raw, data);
    if (strict && /@\{[^}\s]+\}/.test(resolved)) throw new Error(`Unable to replace all data references in ${JSON.stringify(raw)}`);
    return resolved;
  }
}

function fakeSchema() {
  const fields = new Map(MODIFIER_KEYS.map(([, g, f]) => [`modificadores.${g}.${f}`, { element: new StringField14() }]));
  return { getField: (path) => fields.get(path) };
}

function setup(prepareAtributos = prepareAtributos165, { withSimplify = true, withFields = true } = {}) {
  class Creature {
    get parent() {
      return this._parent;
    }
  }
  Creature.prototype.prepareAtributos = prepareAtributos;
  class Character extends Creature {}
  if (withFields) {
    const schema = fakeSchema();
    Object.defineProperty(Character, "schema", { get: () => schema });
  }
  globalThis.CONFIG = { Actor: { dataModels: { character: Character } } };
  if (withSimplify) globalThis.tormenta20 = { dice: { simplifyRollFormula: simplify } };
  return Character;
}

function teardown() {
  delete globalThis.CONFIG;
  delete globalThis.tormenta20;
}

test("isNeeded: 1.6.5 is present/high; refreshing with fields that keep references is fixed/high; a throwing one only counts the change application", () => {
  try {
    setup();
    assert.deepEqual([patch.isNeeded().bug, patch.isNeeded().confidence], ["present", "high"]);
    const Character = setup(function (options) {
      prepareAtributos165.call(this, options);
      refreshModifiers(this, options.rollData, simplify);
    });
    for (const [, g, f] of MODIFIER_KEYS) Character.schema.getField(`modificadores.${g}.${f}`).element._replaceDataRefs = (raw) => raw;
    assert.deepEqual([patch.isNeeded().bug, patch.isNeeded().confidence], ["fixed", "high"]);
    const boom = () => {
      throw new Error("boom");
    };
    setup(boom, { withFields: false });
    assert.equal(patch.isNeeded().bug, "unknown");
    setup(boom);
    assert.equal(patch.isNeeded().bug, "present");
  } finally {
    teardown();
  }
});

test("probeInput: the 1.6.5 method leaves every key stale", () => {
  const { system, rollData } = probeInput();
  prepareAtributos165.call(system, { rollData });
  assert.equal(diagnoseProbe(rollData).bug, "present");
});

/** A fake prepareDerivedData with the 1.6.5 order (T20:20096-20103). */
function prepareDerived(actor) {
  const rollData = { con: actor.atributos.con.value, des: actor.atributos.des.value };
  rollData.pericia = simplify(modifierFormula(actor, "pericias", "geral"), rollData) || 0;
  actor.pv = 10 + rollData.con;
  actor.prepareAtributos({ rollData });
  actor.acro = Number(rollData.des) + Number(rollData.pericia);
}

function makeActor(Character) {
  return Object.assign(new Character(), {
    _parent: { flags: {} },
    atributos: { con: { value: 0, bonus: 2 }, des: { value: 3, bonus: 2 } },
    modificadores: { pericias: { geral: ["@des"] } }
  });
}

test("integration: the skill uses the final attribute; PV keeps ignoring the temporary bonus", () => {
  try {
    const Character = setup();
    const before = makeActor(Character);
    prepareDerived(before);
    assert.equal(before.acro, 8);
    patch.apply();
    const actor = makeActor(Character);
    prepareDerived(actor);
    assert.equal(actor.acro, 10);
    assert.equal(actor.pv, 10);
    const noBonus = Object.assign(makeActor(Character), { atributos: { con: { value: 0, bonus: 0 }, des: { value: 3, bonus: 0 } } });
    prepareDerived(noBonus);
    assert.equal(noBonus.acro, 6);
  } finally {
    teardown();
  }
});

test("apply: requires the system's simplifyRollFormula; the wrapper keeps this/return and never throws", () => {
  try {
    setup(prepareAtributos165, { withSimplify: false });
    assert.throws(() => patch.apply(), /simplifyRollFormula/);
    const sentinel = {};
    let seen;
    const Character = setup(function (options) {
      seen = this;
      prepareAtributos165.call(this, options);
      return sentinel;
    });
    globalThis.tormenta20.dice.simplifyRollFormula = () => {
      throw new Error("boom");
    };
    patch.apply();
    const actor = makeActor(Character);
    actor.modificadores = new Proxy({}, { get() { throw new Error("broken"); } });
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.equal(actor.prepareAtributos({ rollData: { pericia: 0 } }), sentinel);
    } finally {
      console.warn = warn;
    }
    assert.equal(seen, actor);
  } finally {
    teardown();
  }
});

test("formulaRefs/isAttributeRef: attribute keys, atributoChave and atributos paths defined in the data", () => {
  assert.deepEqual(formulaRefs("@des + @UUID[Actor.x]{y} + @atributos.car.value + @{con} + 2"), ["des", "atributos.car.value", "con"]);
  const data = { des: 3, nivel: 4, atributoChave: 2, atributos: { des: { value: 3 } } };
  assert.equal(isAttributeRef("des", data), true);
  assert.equal(isAttributeRef("atributoChave", data), true);
  assert.equal(isAttributeRef("atributos.des.value", data), true);
  assert.equal(isAttributeRef("nivel", data), false);
  assert.equal(isAttributeRef("car", data), false);
  assert.equal(isAttributeRef("atributos.car.value", data), false);
  assert.equal(isAttributeRef("atributoChave", { des: 3, atributos: { des: {} } }), false);
});

test("keepAttributeRefs: keeps attribute references, resolves the rest, still strict on missing ones", () => {
  const field = new StringField14();
  const replace = (raw, data, options) => field._replaceDataRefs(raw, data, options);
  const data = { des: 3, con: 1, nivel: 4, atributoChave: 3, atributos: { des: { value: 3 }, con: { value: 1 } } };
  assert.equal(keepAttributeRefs("@des + @nivel", data, replace), "@des + 4");
  assert.equal(keepAttributeRefs("@atributoChave", data, replace), "@atributoChave");
  assert.equal(keepAttributeRefs("@atributos.con.value + 1", data, replace), "@atributos.con.value + 1");
  assert.equal(keepAttributeRefs("2", data, replace), "2");
  assert.equal(keepAttributeRefs("@{des} + @{nivel}", data, replace), "@{des} + 4");
  assert.equal(keepAttributeRefs("@{atributos.des.value}", data, replace), "@{atributos.des.value}");
  assert.throws(() => keepAttributeRefs("@{foo}", data, replace), /Unable to replace/);
  assert.equal(keepAttributeRefs("2 + @foo", data, replace), "2 + @foo");
  assert.equal(keepAttributeRefs("@des + @foo", data, replace), "@des + @foo");
  assert.throws(() => keepAttributeRefs("@des + @{foo}", data, replace), /Unable to replace/);
  assert.throws(() => keepAttributeRefs("@{atributoChave}", { des: 3, atributos: { des: {} } }, replace), /Unable to replace/);
  assert.equal(keepAttributeRefs("@des + @{foo}", data, replace, { strict: false }), "@des + @{foo}");
});

test("combineDiagnosis: change application that resolves attributes is present/high regardless of prepareAtributos", () => {
  const fixed = { bug: "fixed", confidence: "high" };
  const present = { bug: "present", confidence: "high" };
  assert.deepEqual([combineDiagnosis("resolves", fixed).bug, combineDiagnosis("resolves", fixed).confidence], ["present", "high"]);
  assert.equal(combineDiagnosis("keeps", fixed), fixed);
  assert.equal(combineDiagnosis("keeps", present), present);
  assert.equal(combineDiagnosis("unknown", present), present);
  assert.equal(combineDiagnosis("unknown", fixed).bug, "unknown");
});

/**
 * Foundry 14 + 1.6.5: the change "@des" to pericias.geral is applied with the rollData of the initial phase (no
 * temporary bonus yet), then prepareDerivedData reduces the list and prepareAtributos adds the bonus.
 */
function prepareDerived14(Character) {
  const actor = makeActor(Character);
  actor.modificadores = { pericias: { geral: [] } };
  const initial = { des: actor.atributos.des.value, con: actor.atributos.con.value, atributos: actor.atributos };
  const field = Character.schema.getField("modificadores.pericias.geral").element;
  actor.modificadores.pericias.geral.push(field._castChangeDelta("@des", initial));
  prepareDerived(actor);
  return actor;
}

test("integration (Foundry 14): the change keeps @des and the skill uses the final attribute", () => {
  try {
    const Character = setup();
    const before = prepareDerived14(Character);
    assert.deepEqual(before.modificadores.pericias.geral, ["3"]);
    assert.equal(before.acro, 8);
    patch.apply();
    const actor = prepareDerived14(Character);
    assert.deepEqual(actor.modificadores.pericias.geral, ["@des"]);
    assert.equal(actor.acro, 10);
    assert.equal(actor.pv, 10);
  } finally {
    teardown();
  }
});

test("isNeeded (Foundry 14): a refreshing prepareAtributos is still present while changes resolve attributes", () => {
  try {
    const refreshing = function (options) {
      prepareAtributos165.call(this, options);
      refreshModifiers(this, options.rollData, simplify);
    };
    setup(refreshing);
    assert.deepEqual([patch.isNeeded().bug, patch.isNeeded().confidence], ["present", "high"]);
    setup(refreshing, { withFields: false });
    assert.equal(patch.isNeeded().bug, "unknown");
  } finally {
    teardown();
  }
});

test("apply: fails when the modifier list fields are missing", () => {
  try {
    setup(prepareAtributos165, { withFields: false });
    assert.throws(() => patch.apply(), /list fields not found/);
  } finally {
    teardown();
  }
});
