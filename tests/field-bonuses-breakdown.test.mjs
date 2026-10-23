import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  annotateEntries,
  appendTooltipLine,
  pvMinimumCompensation,
  roundingDelta,
  applyDefenseSources,
  defenseAbilityDelta,
  defenseSourceLines,
  diagnoseHelperSource,
  evaluateValue,
  expandWildcards,
  helperParts,
  levelMultiplier,
  manualEntries,
  manualOverrideValue,
  normalizeModifiedFields,
  removeTooltipLine,
  simulateArray,
  simulateNumericChanges
} from "../scripts/patches/field-bonuses-breakdown.mjs";
import tooltipPatch, { hasConditionLines } from "../scripts/patches/field-bonuses-tooltip.mjs";
import { fieldBonuses165 } from "./fixtures/field-bonuses-1.6.5.mjs";

const HELPER_SOURCE = fieldBonuses165.toString();
const lines = (html) => [...html.matchAll(/<label>([^<]*):<\/label><span>([^<]*)/g)].map((m) => `${m[1]} ${m[2]}`);
const total = (html) => /<label>Total:<\/label><span>([^<]*)/.exec(html)?.[1];
const tooltip = (rows) => {
  const sum = rows.reduce((s, [, v]) => s + v, 0);
  const items = rows.map(([l, v]) => `<li class="flexrow"><label>${l}:</label><span>${v >= 0 ? "+" : ""}${v}</span></li>`).join("");
  return `\n\t\t<ul class="fieldBonuses">\n\t\t\t${items}\n\t\t\t<hr>\n\t\t\t<li class="flexrow"><label>Total:</label><span>${sum >= 0 ? "+" : ""}${sum}</span></li>\n\t\t</ul>\n\t\t`;
};

/* -------------------------------------------- */
/*  Source probe                                */
/* -------------------------------------------- */

test("helperParts recognizes every part in the 1.6.5 helper and ignores comments", () => {
  assert.ok(Object.values(helperParts(HELPER_SOURCE)).every(Boolean));
  assert.deepEqual(diagnoseHelperSource(HELPER_SOURCE).bug, "present");
  assert.deepEqual(diagnoseHelperSource(HELPER_SOURCE).confidence, "high");
  const fixedTypes = HELPER_SOURCE.replace("switch (item.mode)", "switch (item.type)");
  assert.equal(helperParts(fixedTypes).types, false);
  assert.deepEqual([diagnoseHelperSource(fixedTypes).bug, diagnoseHelperSource(fixedTypes).confidence], ["present", "low"]);
  const condiListed = HELPER_SOURCE.replace("...armaduras,", "...armaduras, defesa.condi ? { label: 'C', value: defesa.condi } : false,");
  assert.equal(helperParts(condiListed).defenseSources, false);
  const commented = "function () { /* Number(nivel[0]) + Number(nivelImpar[0]) + Number(nivelPar[0]) switch (item.mode) */ }";
  assert.equal(diagnoseHelperSource(commented).bug, "unknown");
  assert.equal(diagnoseHelperSource(undefined).bug, "unknown");
  assert.notEqual(diagnoseHelperSource(HELPER_SOURCE).bug, "fixed");
});

/* -------------------------------------------- */
/*  Pure functions                              */
/* -------------------------------------------- */

test("levelMultiplier and evaluateValue", () => {
  assert.equal(levelMultiplier("system.attributes.pv.bonus.nivel", 5), 5);
  assert.equal(levelMultiplier("system.attributes.pv.bonus.nivelPar", 5), 2);
  assert.equal(levelMultiplier("system.attributes.pm.bonus.nivelPar", 1), 0);
  assert.equal(levelMultiplier("system.attributes.pv.bonus.nivelImpar", 5), 3);
  assert.equal(levelMultiplier("system.attributes.pv.bonus.total", 5), 1);
  const ev = (f) => Function(`return (${f})`)();
  assert.equal(evaluateValue("2+1", ev), 3);
  assert.equal(evaluateValue("5", ev), 5);
  assert.equal(evaluateValue(3, ev), 3);
  assert.equal(evaluateValue("1d4", () => { throw new Error("dice"); }), "1d4");
  assert.equal(evaluateValue("", ev), "");
});

test("annotateEntries keeps each change's priority and order; expandWildcards follows the proxy keys", () => {
  const mod = { k: [{ label: "E", value: "2", type: "add" }, { label: "E", value: "2", type: "add" }], j: [{ label: "X", value: "1", type: "override" }] };
  const changes = [
    { key: "k", label: "E", value: "2", type: "add", priority: 5, phase: "initial" },
    { key: "k", label: "E", value: "2", type: "add", priority: 7, phase: "final" }
  ];
  const out = annotateEntries(mod, changes);
  assert.deepEqual(out.map((e) => [e.priority, e.phase, e.seq]), [[5, "initial", 0], [7, "final", 1], [50, "initial", 4]]);
  const wild = expandWildcards(
    [{ key: "system.pericias.*.bonus" }, { key: "system.foo.*.bar" }, { key: "system.pericias.luta.bonus" }],
    (p) => (p === "system.pericias" ? ["acro", "luta"] : [])
  );
  assert.deepEqual(wild.map((e) => e.key), ["system.pericias.acro.bonus", "system.pericias.luta.bonus", "system.foo.*.bar", "system.pericias.luta.bonus"]);
});

test("simulateArray applies ArrayField semantics in core order", () => {
  const e = (label, type, value, priority, seq, phase = "initial") => ({ label, type, value, priority, seq, phase });
  assert.deepEqual(simulateArray([], [e("B", "override", "5", 50, 0), e("A", "add", "2", 20, 1)]), [{ label: "B", value: "5" }]);
  assert.deepEqual(simulateArray([{ label: "M", value: "1" }], [e("B", "override", "5", 50, 0)]), [{ label: "B", value: "5" }]);
  assert.deepEqual(
    simulateArray([{ label: "M", value: "2" }, { label: "N", value: "2" }], [e("S", "subtract", 2, 20, 0)]).map((r) => r.label),
    ["N"]
  );
  assert.deepEqual(simulateArray([], [e("M", "multiply", "2", 10, 0), e("U", "upgrade", "2", 40, 1), e("D", "downgrade", "2", 30, 2)]), []);
  assert.deepEqual(simulateArray([], [e("C", "custom", "1", 0, 0)]), [{ label: "C", value: "1" }]);
  assert.deepEqual(
    simulateArray([], [e("F", "add", "1", 0, 0, "final"), e("O", "override", "9", 50, 1)]).map((r) => r.label),
    ["O", "F"]
  );
});

test("manualEntries and normalizeModifiedFields", () => {
  const seeds = manualEntries("pv", { nivel: ["1"], nivelPar: ["0"], nivelImpar: [""], total: ["3"] });
  assert.deepEqual(Object.keys(seeds), [
    "system.attributes.pv.bonus.nivel",
    "system.attributes.pv.bonus.nivelPar",
    "system.attributes.pv.bonus.nivelImpar",
    "system.attributes.pv.bonus.total"
  ]);
  assert.equal(seeds["system.attributes.pv.bonus.nivelPar"][0].hidden, true);
  assert.equal(seeds["system.attributes.pv.bonus.nivelImpar"][0].hidden, true);
  assert.equal(seeds["system.attributes.pv.bonus.nivel"][0].hidden, undefined);
  assert.equal(seeds["system.attributes.pv.bonus.total"][0].label, "T20CP.FieldBonuses.ManualTotal");
  const mod = {
    "system.attributes.defesa.outros": [{ label: "C", value: -5, type: "downgrade" }],
    "system.attributes.pv.bonus.nivelPar": [{ label: "P", value: "2", type: "add" }],
    "system.pericias.luta.bonus": [{ label: "A", value: "2", type: "add" }]
  };
  const frozen = structuredClone(mod);
  const all = { manual: true, zeroLevel: true, formula: true, types: true, wildcard: true };
  const out = normalizeModifiedFields(mod, { parts: all, level: 1 });
  assert.deepEqual(out["system.attributes.defesa.outros"], mod["system.attributes.defesa.outros"]);
  assert.deepEqual(out["system.attributes.pv.bonus.nivelPar"], []);
  assert.deepEqual(out["system.pericias.luta.bonus"], [{ label: "A", value: 2 }]);
  assert.deepEqual(mod, frozen);
  const noTypes = normalizeModifiedFields(mod, { parts: {}, level: 1 });
  assert.equal(noTypes["system.pericias.luta.bonus"][0].type, "add");
});

test("removeTooltipLine removes the helper's manual line and corrects the total", () => {
  const html = tooltip([["A", 50], ["T20.ManualOverride", 1]]);
  assert.equal(manualOverrideValue({ nivel: ["1"], nivelImpar: ["0"], nivelPar: ["0"] }), 1);
  assert.deepEqual(lines(removeTooltipLine(html, "T20.ManualOverride", 1)), ["A +50", "Total +50"]);
  assert.equal(removeTooltipLine(html, "T20.ManualOverride", 2), html);
  assert.equal(removeTooltipLine(html, "T20.ManualOverride", 0), html);
  assert.equal(removeTooltipLine(html, "T20.ManualOverride", NaN), html);
  const decimal = tooltip([["A", 50], ["X", 1.5]]);
  assert.equal(total(removeTooltipLine(decimal, "X", 1.5)), "+50");
});

test("pvMinimumCompensation, roundingDelta and appendTooltipLine", () => {
  const classes = [{ inicial: true, porNivel: 5, niveis: 2 }, { porNivel: 3, niveis: 1 }];
  assert.equal(pvMinimumCompensation({ classes, nivel: -10 }), 0 + 6 + 8);
  assert.equal(pvMinimumCompensation({ classes, nivelPar: -10 }), 6);
  assert.equal(pvMinimumCompensation({ classes }), 0);
  assert.equal(roundingDelta(tooltip([["A", 52.5]])), -0.5);
  assert.equal(roundingDelta(tooltip([["A", -2.5]])), -0.5);
  assert.equal(roundingDelta(tooltip([["A", 52]])), 0);
  assert.equal(roundingDelta("<b>no total</b>"), 0);
  assert.deepEqual(lines(appendTooltipLine(tooltip([["A", 0.1], ["B", 0.2]]), "<R>", -0.3)).slice(-2), ["&lt;R&gt; -0.3", "Total +0"]);
});

test("defenseAbilityDelta follows prepareDefense", () => {
  assert.equal(defenseAbilityDelta({ attribute: "des", rollValue: 4, abilityValue: 4, armorType: "pesada", maxAtr: 2, helperHeavy: true }), 2);
  assert.equal(defenseAbilityDelta({ attribute: "des", rollValue: 4, abilityValue: 4, armorType: "pesada", maxAtr: 0, helperHeavy: true }), 0);
  assert.equal(defenseAbilityDelta({ attribute: "des", rollValue: 4, abilityValue: 4, armorType: "leve", maxAtr: 0, helperHeavy: false }), 0);
  assert.equal(defenseAbilityDelta({ attribute: "des", rollValue: 4, abilityValue: 4, armorType: "pesada", maxAtr: 0, helperHeavy: false }), -4);
  assert.equal(defenseAbilityDelta({ rollValue: 4 }), 0);
});

test("simulateNumericChanges: marginal deltas, the winner of a downgrade run takes the whole contribution", () => {
  const c = (label, type, value, priority) => ({ label, type, value, priority });
  assert.deepEqual(simulateNumericChanges(3, [c("A", "add", 2), c("S", "subtract", "1"), c("O", "override", 10)]), {
    lines: [
      { label: "A", type: "add", value: 2, delta: 2 },
      { label: "S", type: "subtract", value: 1, delta: -1 },
      { label: "O", type: "override", value: 10, delta: 6 }
    ],
    result: 10
  });
  const down = simulateNumericChanges(0, [c("V", "downgrade", -2), c("D", "downgrade", -5), c("D2", "downgrade", -5)]);
  assert.deepEqual(down.lines.map((l) => [l.label, l.delta]), [["V", 0], ["D", -5], ["D2", 0]]);
  assert.equal(down.result, -5);
  assert.deepEqual(simulateNumericChanges(0, [c("U", "upgrade", 2), c("U2", "upgrade", 1)]).lines.map((l) => l.delta), [2, 0]);
  assert.deepEqual(simulateNumericChanges(0, [c("Late", "add", 1, 100), c("Early", "add", 2, 1)]).lines.map((l) => l.label), ["Early", "Late"]);
  assert.equal(simulateNumericChanges(0, [c("X", "custom", 1)]), null);
  assert.equal(simulateNumericChanges(0, [c("X", "add", "@nivel")]), null);
});

test("defenseSourceLines splits Outros and conditions, or gives up when it does not match", () => {
  const prone = { label: "Caído", type: "add", value: -5 };
  const condi = [{ label: "Desprevenido", type: "downgrade", value: -5 }, { label: "Vulnerável", type: "downgrade", value: -2 }];
  const lines = defenseSourceLines({ sourceOutros: 3, outrosChanges: [prone], preparedOutros: -2, condiChanges: condi, preparedCondi: -5 });
  assert.deepEqual(lines.outros, [
    { label: "Outros (manual)", value: 3, muted: false },
    { label: "Caído", value: -5, muted: false }
  ]);
  assert.deepEqual(lines.condi, [
    { label: "Desprevenido", value: -5, muted: false },
    { label: "Vulnerável", value: -2, muted: true }
  ]);
  const legacy = defenseSourceLines({ sourceOutros: 0, outrosChanges: [{ ...prone, type: "downgrade" }], preparedOutros: -5, preparedCondi: 0 });
  assert.deepEqual(legacy.outros, [{ label: "Caído", value: -5, muted: false }]);
  assert.equal(defenseSourceLines({ sourceOutros: 3, outrosChanges: [prone], preparedOutros: -5, preparedCondi: 0 }), null);
  assert.equal(defenseSourceLines({ sourceOutros: 0, condiChanges: [{ label: "X", type: "custom", value: 1 }], preparedOutros: 0, preparedCondi: 1 }), null);
});

test("applyDefenseSources replaces the Outros line, marks the conditions and corrects the total", () => {
  const html = tooltip([["Base", 10], ["Outros", -2]]);
  const out = applyDefenseSources(html, {
    preparedOutros: -2,
    outros: [{ label: "Outros (manual)", value: 3 }, { label: "Caído", value: -5 }],
    condi: [{ label: "Desprevenido", value: -5 }, { label: "<b>V</b>", value: -2, muted: true }],
    notStacking: "não acumula"
  });
  assert.deepEqual(lines(out), ["Base +10", "Outros (manual) +3", "Caído -5", "Desprevenido -5", "&lt;b&gt;V&lt;/b&gt; (-2) não acumula", "Total +3"]);
  assert.ok(hasConditionLines(out));
  assert.match(out, /class="flexrow t20cp-muted" data-t20cp="condi"/);
  assert.equal(applyDefenseSources(tooltip([["Base", 10], ["Other", -2]]), { preparedOutros: -2, outros: [] }), tooltip([["Base", 10], ["Other", -2]]));
  const noOutros = applyDefenseSources(tooltip([["Base", 10]]), { preparedOutros: 0, outros: [], condi: [{ label: "D", value: -5 }] });
  assert.deepEqual(lines(noOutros), ["Base +10", "D -5", "Total +5"]);
});

/* -------------------------------------------- */
/*  Integration with the real 1.6.5 helper      */
/* -------------------------------------------- */

const evalArithmetic = (formula, data = {}) => {
  const resolved = String(formula).replace(/@(\w+)/g, (_, k) => String(data[k] ?? 0));
  if (!/^[\d\s+\-*/().]+$/.test(resolved)) throw new Error(`not arithmetic: ${resolved}`);
  return Function(`return (${resolved})`)();
};

class FakeRoll {
  constructor(formula, data) {
    this.formula = formula;
    this.data = data;
  }
  static create(formula, data) {
    return new FakeRoll(formula, data);
  }
  static replaceFormulaData(formula, data) {
    return String(formula).replace(/@(\w+)/g, (_, k) => String(data[k] ?? `@${k}`));
  }
  evaluateSync() {
    return { total: evalArithmetic(this.formula, this.data) };
  }
}
FakeRoll.defaultImplementation = FakeRoll;

class FakeActor {
  get modifiedFields() {
    return this.appliedEffects.reduce((acc, ef) => {
      if (ef.modifiesActor) {
        for (const ch of ef.changes) {
          if ([3, 4].includes(ch.value)) continue;
          (acc[ch.key] ??= []).push({ label: ef.name, value: ch.value, type: ch.type });
        }
      }
      return acc;
    }, {});
  }
  get appliedEffects() {
    return this.effects.filter((e) => e.active);
  }
  allApplicableEffects() {
    return this.effects;
  }
  getRollData() {
    const a = this.system.atributos;
    return { meionivel: Math.floor(this.system.attributes.nivel.value / 2), treino: 2, for: a.for.value, des: a.des.value, con: a.con.value };
  }
}

const DEFAULT_PRIORITY = { custom: 0, multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50 };
function effect(name, changes, statuses = []) {
  const list = changes.map(([key, type, value]) => ({ key, type, value, phase: "initial", priority: DEFAULT_PRIORITY[type] }));
  return {
    name,
    active: true,
    modifiesActor: true,
    statuses: new Set(statuses),
    changes: list,
    system: { changes: list },
    shouldApplyChange: (change, { phase }) => change.phase === phase
  };
}

function makeActor({ level = 5, bonus = {}, effects = [], defesa = {}, sourceDefesa = {}, armor = null, skill = {} } = {}) {
  const actor = new FakeActor();
  const pvBonus = { nivel: [], nivelPar: [], nivelImpar: [], total: [], ...bonus };
  actor._id = "a1";
  actor.uuid = "Actor.a1";
  actor.type = "character";
  actor.flags = {};
  actor.effects = effects;
  actor.items = [{ type: "classe", name: "Guerreiro", system: { inicial: true, pvPorNivel: 5, pmPorNivel: 3, niveis: level } }];
  actor.itemTypes = { equipamento: armor ? [armor] : [] };
  actor.system = {
    attributes: {
      nivel: { value: level },
      pv: { bonus: pvBonus, atributos: {} },
      pm: { bonus: { nivel: [], nivelPar: [], nivelImpar: [], total: [] }, atributos: {} },
      defesa: { base: 10, atributo: "des", outros: 0, condi: 0, bonus: [], ...defesa }
    },
    atributos: { for: { value: 3, bonus: 0 }, des: { value: 4, bonus: 0 }, con: { value: 2, bonus: 0 } },
    pericias: {
      luta: { treinado: true, atributo: "for", outros: 0, size: false, condi: 0, pda: false, ...skill },
      acro: { treinado: false, atributo: "des", outros: 0, size: false, condi: 0, pda: false }
    }
  };
  actor._source = { system: { attributes: { pv: { bonus: structuredClone(pvBonus) }, defesa: { outros: 0, condi: 0, ...sourceDefesa } } } };
  return actor;
}

function setup(actor, status = []) {
  const helpers = { fieldBonuses: fieldBonuses165 };
  globalThis.Handlebars = { helpers, registerHelper: (name, fn) => (helpers[name] = fn) };
  globalThis.game = {
    actors: { get: (id) => (id === actor._id ? actor : undefined) },
    i18n: { localize: (key) => key },
    settings: { get: () => false },
    modules: { get: () => ({ api: { status } }) }
  };
  globalThis.fromUuidSync = (uuid) => (uuid === actor.uuid ? actor : null);
  globalThis.Roll = FakeRoll;
  globalThis.CONFIG = { T20: { atributos: { for: "Força", des: "Destreza", con: "Constituição" } } };
  globalThis.foundry = {
    utils: {
      fromUuidSync: globalThis.fromUuidSync,
      getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj)
    },
    dice: { Roll: FakeRoll }
  };
  return helpers;
}

function teardown() {
  for (const key of ["Handlebars", "game", "fromUuidSync", "Roll", "CONFIG", "foundry"]) delete globalThis[key];
}

function render(helpers, actor, path) {
  return helpers.fieldBonuses.call({ system: actor.system }, path, { data: { root: { actor: { _id: actor._id }, uuid: actor.uuid } } });
}

function scenario(options, path, { status = [], patches = [patch], mutate } = {}) {
  const actor = makeActor(options);
  mutate?.(actor);
  const helpers = setup(actor, status);
  try {
    const before = render(helpers, actor, path);
    for (const p of patches) p.apply();
    const after = render(helpers, actor, path);
    assert.equal(Object.hasOwn(actor, "modifiedFields"), false);
    return { before, after };
  } finally {
    teardown();
  }
}

const PV = "system.attributes.pv";
const LUTA = "system.pericias.luta.bonus";
const DEF = "system.attributes.defesa.bonus";

test("part 1a: manual per-level and total bonuses match the sheet (58)", () => {
  const { before, after } = scenario({ bonus: { nivel: ["1"], nivelPar: ["0"], nivelImpar: ["0"], total: ["3"] } }, PV);
  assert.equal(total(before), "+51");
  assert.deepEqual(lines(after), [
    "Guerreiro 5 +40",
    "Constituição +10",
    "T20CP.FieldBonuses.ManualPerLevel +5",
    "T20CP.FieldBonuses.ManualTotal +3",
    "Total +58"
  ]);
  const even = scenario({ bonus: { nivel: ["0"], nivelPar: ["2"], nivelImpar: ["0"] } }, PV);
  assert.equal(total(even.after), "+54");
  assert.equal(total(scenario({ level: 1, bonus: { nivel: ["0"], nivelPar: ["2"], nivelImpar: ["0"] } }, PV).after), "+22");
});

test("part 1b: a per-even-level effect at level 1 is left out (22)", () => {
  const { before, after } = scenario({ level: 1, effects: [effect("Par", [["system.attributes.pv.bonus.nivelPar", "add", "2"]])] }, PV);
  assert.equal(total(before), "+24");
  assert.equal(total(after), "+22");
});

test("part 2: formulas without @ are evaluated", () => {
  const skill = scenario({ effects: [effect("F", [[LUTA, "add", "2+1"]])] }, LUTA);
  assert.equal(total(skill.before), "NaN");
  assert.deepEqual(lines(skill.after).slice(-2), ["F +3", "Total +10"]);
  const pv = scenario({ effects: [effect("N", [["system.attributes.pv.bonus.nivel", "add", "1+1"]])] }, PV);
  assert.equal(total(pv.before), "+56");
  assert.equal(total(pv.after), "+60");
});

test("part 3: Override replaces the list and Multiply does nothing", () => {
  const over = scenario({ effects: [effect("A", [[LUTA, "add", "2"]]), effect("B", [[LUTA, "override", "5"]])] }, LUTA);
  assert.equal(total(over.before), "+14");
  assert.deepEqual(lines(over.after).slice(-2), ["B +5", "Total +12"]);
  const mult = scenario({ effects: [effect("M", [[LUTA, "multiply", "2"]])] }, LUTA);
  assert.equal(total(mult.before), "+9");
  assert.equal(total(mult.after), "+7");
});

test("part 3: subtract compares the raw text, as the core does, before formulas are evaluated", () => {
  const { after } = scenario({ effects: [effect("A", [[LUTA, "add", "2+1"]]), effect("B", [[LUTA, "subtract", "3"]])] }, LUTA);
  assert.deepEqual(lines(after).slice(-2), ["A +3", "Total +10"]);
});

test("part 3: subtract resolves @ references like StringField before comparing", () => {
  const { after } = scenario({ effects: [effect("A", [[LUTA, "add", "@for"]]), effect("B", [[LUTA, "subtract", "3"]])] }, LUTA);
  assert.equal(total(after), "+7");
});

test("PV: fractional manual bonuses get preparePVPM's rounding", () => {
  const { after } = scenario({ bonus: { nivel: ["0.5"], nivelPar: ["0"], nivelImpar: ["0"] } }, PV);
  assert.deepEqual(lines(after).slice(-2), ["T20CP.FieldBonuses.Rounding -0.5", "Total +52"]);
});

test("PV: with Constituição 0, the minimum of 1 PV per level is listed (14)", () => {
  const actor = { bonus: { nivel: ["-10"], nivelPar: ["0"], nivelImpar: ["0"] } };
  const fixed = scenario(actor, PV, { mutate: (a) => (a.system.atributos.con.value = 0) });
  assert.deepEqual(lines(fixed.after).slice(-2), ["Constituição (T20CP.FieldBonuses.MinimumPV) +24", "Total +14"]);
});

test("PV/PM lists keep their minimum length: subtracting the last element is ignored, as the core rejects it", () => {
  const e = (value) => ({ label: "S", type: "subtract", value, priority: 20, seq: 0 });
  assert.deepEqual(simulateArray([{ label: "M", value: "1" }], [e("1")], { min: 1 }), [{ label: "M", value: "1" }]);
  assert.deepEqual(simulateArray([{ label: "M", value: "1" }, { label: "Z", value: "0", hidden: true }], [e("1")], { min: 1 }), [
    { label: "Z", value: "0", hidden: true }
  ]);
  const last = scenario({ bonus: { nivel: ["1"] }, effects: [effect("S", [["system.attributes.pv.bonus.nivel", "subtract", "1"]])] }, PV);
  assert.equal(total(last.after), "+55");
  const zero = scenario(
    { bonus: { nivel: ["1", "0"] }, effects: [effect("S", [["system.attributes.pv.bonus.nivel", "subtract", "1"]])] },
    PV
  );
  assert.equal(total(zero.after), "+50");
});

test("part 4: wildcard effects reach every skill", () => {
  const options = { effects: [effect("W", [["system.pericias.*.bonus", "add", "2"]])] };
  const luta = scenario(options, LUTA);
  assert.equal(total(luta.before), "+7");
  assert.deepEqual(lines(luta.after).slice(-2), ["W +2", "Total +9"]);
  assert.equal(total(scenario(options, "system.pericias.acro.bonus").after), "+8");
});

test("part 5: heavy armor lists the capped attribute (22)", () => {
  const armor = { name: "Armadura completa", system: { tipo: "pesada", equipado: true, armadura: { value: 10, maxAtr: 2 } } };
  const { before, after } = scenario({ level: 1, armor }, DEF);
  assert.equal(total(before), "+20");
  assert.deepEqual(lines(after), ["Base +10", "Armadura completa +10", "Destreza (T20CP.FieldBonuses.HeavyArmorLimit) +2", "Total +22"]);
});

const APPLIED = (...ids) => ids.map((id) => ({ id, state: "applied" }));
const CAIDO = () => effect("Caído", [["system.attributes.defesa.outros", "downgrade", -5]], ["caido"]);
const DESPREVENIDO = () => effect("Desprevenido", [["system.attributes.defesa.condi", "downgrade", -5]]);
const VULNERAVEL = () => effect("Vulnerável", [["system.attributes.defesa.condi", "downgrade", -2]]);

test("defenseSources: manual Outros, Caído (prone-defense on) and conditions by name, with field-bonuses-tooltip", () => {
  const options = {
    effects: [CAIDO(), DESPREVENIDO(), VULNERAVEL()],
    defesa: { outros: -2, condi: -5 },
    sourceDefesa: { outros: 3 }
  };
  const { after } = scenario(options, DEF, {
    status: APPLIED("prone-defense", "field-bonuses-tooltip", "field-bonuses-breakdown"),
    patches: [patch, tooltipPatch]
  });
  assert.deepEqual(lines(after), [
    "Base +10",
    "Destreza +4",
    "T20CP.FieldBonuses.ManualOther +3",
    "Caído -5",
    "Desprevenido -5",
    "Vulnerável (-2) T20CP.FieldBonuses.NotStacking",
    "Total +7"
  ]);
});

test("defenseSources: prone-defense off shows Caído's real effect; tooltip off keeps the conditions out", () => {
  const options = { effects: [CAIDO(), DESPREVENIDO()], defesa: { outros: -5, condi: -5 }, sourceDefesa: { outros: 3 } };
  const { after } = scenario(options, DEF);
  assert.deepEqual(lines(after), ["Base +10", "Destreza +4", "T20CP.FieldBonuses.ManualOther +3", "Caído -8", "Total +9"]);
});

test("defenseSources: a mismatch keeps the helper's lines and the tooltip adds its Condição line", () => {
  const options = { effects: [CAIDO(), DESPREVENIDO()], defesa: { outros: -7, condi: -5 }, sourceDefesa: { outros: 3 } };
  const { after } = scenario(options, DEF, { status: APPLIED("prone-defense", "field-bonuses-tooltip"), patches: [patch, tooltipPatch] });
  assert.deepEqual(lines(after), ["Base +10", "Destreza +4", "Outros -7", "T20CP.FieldBonuses.Condition -5", "Total +2"]);
});

test("defenseSources: a persisted condi base gets its own line", () => {
  const options = { effects: [DESPREVENIDO()], defesa: { condi: -5 }, sourceDefesa: { condi: -2 } };
  const { after } = scenario(options, DEF, { status: APPLIED("field-bonuses-tooltip"), patches: [patch, tooltipPatch] });
  assert.deepEqual(lines(after), ["Base +10", "Destreza +4", "T20CP.FieldBonuses.Condition -2", "Desprevenido -3", "Total +9"]);
});

test("the shadow is removed when the helper throws", () => {
  const actor = makeActor();
  const helpers = setup(actor);
  try {
    patch.apply();
    game.settings.get = () => {
      throw new Error("boom");
    };
    assert.throws(() => render(helpers, actor, DEF), /boom/);
    assert.equal(Object.hasOwn(actor, "modifiedFields"), false);
  } finally {
    teardown();
  }
});
