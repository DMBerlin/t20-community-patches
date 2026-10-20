import { test } from "node:test";
import assert from "node:assert/strict";
import {
  automaticApplied,
  checkManaLimit,
  estimateUseCost,
  evaluateManaLimit,
  installManaLimitRule,
  manaLimitSource,
  resolveManaLimitFormula
} from "../scripts/rules/mana-limit.mjs";
import { runValidators } from "../scripts/rules/use-dialog-guard.mjs";

const slugify = (text) => String(text).trim().toLowerCase().replace(/\s+/g, "-");

test("manaLimitSource reads the class from type and subtype, character level for other powers", () => {
  const source = (system, classes, type = "poder") => manaLimitSource({ type, system }, classes, slugify);
  assert.deepEqual(source({ tipo: "ability", subtipo: "Bardo" }, ["bardo"]), { kind: "class", slug: "bardo" });
  assert.deepEqual(source({ tipo: "classe", subtipo: "inventor" }, [slugify("Inventor")]), {
    kind: "class",
    slug: "inventor"
  });
  assert.deepEqual(source({ tipo: "racial" }, []), { kind: "character" });
  assert.deepEqual(source({ tipo: "geral", subtipo: "Combate" }, ["bardo"]), { kind: "character" });
  assert.deepEqual(source({ tipo: "origem" }, []), { kind: "character" });
  assert.deepEqual(source({ tipo: "ability", subtipo: "Bardo" }, ["guerreiro"]), { kind: "unknown" });
  assert.deepEqual(source({ tipo: "classe", subtipo: "" }, ["bardo"]), { kind: "unknown" });
  assert.deepEqual(source({ tipo: "ability", subtipo: "Bardo" }, ["bardo"], "magia"), { kind: "unknown" });
});

test("resolveManaLimitFormula: item flag first, then source; unknown never enforces", () => {
  assert.deepEqual(resolveManaLimitFormula({ flag: " None ", source: { kind: "class", slug: "bardo" } }), {
    kind: "none"
  });
  assert.deepEqual(resolveManaLimitFormula({ flag: "@nvl.arcanista", source: { kind: "unknown" } }), {
    kind: "item",
    formula: "@nvl.arcanista",
    enforce: true
  });
  assert.deepEqual(resolveManaLimitFormula({ flag: "  ", source: { kind: "class", slug: "bardo" } }), {
    kind: "class",
    slug: "bardo",
    formula: "@nvl.bardo",
    enforce: true
  });
  assert.equal(resolveManaLimitFormula({ source: { kind: "character" } }).formula, "@nivel");
  assert.deepEqual(resolveManaLimitFormula({ source: { kind: "unknown" } }), {
    kind: "unknown",
    formula: "@nivel",
    enforce: false
  });
});

// Like the core Roll: replaceFormulaData keeps missing references, the constructor turns them into 0.
class FakeRoll {
  static replaceFormulaData(formula, data, { missing } = {}) {
    return formula.replace(/@([\w.]+)/g, (match, path) => {
      const value = path.split(".").reduce((obj, key) => obj?.[key], data);
      if (value == null) return missing !== undefined ? String(missing) : match;
      return String(value);
    });
  }
  constructor(formula, data = {}) {
    this.formula = FakeRoll.replaceFormulaData(formula, data, { missing: "0" });
    this.isDeterministic = !/\d*d\d/.test(this.formula);
  }
  evaluateSync() {
    if (!/^[\d\s+\-*/().]+$/.test(this.formula)) throw new Error("invalid");
    this.total = Function(`return (${this.formula})`)();
    return this;
  }
}

test("evaluateManaLimit returns the number, or null for dice, missing data and junk", () => {
  const data = { nivel: 5, nvl: { bardo: 3 } };
  assert.equal(evaluateManaLimit("@nvl.bardo", data, FakeRoll), 3);
  assert.equal(evaluateManaLimit("@nivel + 1", data, FakeRoll), 6);
  assert.equal(evaluateManaLimit("1d6", data, FakeRoll), null);
  assert.equal(evaluateManaLimit("@nvl.arcanista", data, FakeRoll), null);
  assert.equal(evaluateManaLimit("abc", data, FakeRoll), null);
});

test("estimateUseCost reproduces the cost the system spends", () => {
  const aumento = { id: "a", custo: 2 };
  const half = { id: "h", changes: [{ key: "custo", value: "/2" }] };
  const base = { itemType: "poder", baseCost: 2, effects: [aumento, half] };
  assert.equal(estimateUseCost({ ...base, applied: {} }), 2);
  assert.equal(estimateUseCost({ ...base, applied: { a: { aplica: 2, custo: 2 } } }), 6);
  assert.equal(estimateUseCost({ ...base, applied: { a: { aplica: 2, custo: 2 }, h: { aplica: 1 } } }), 3);
  assert.equal(estimateUseCost({ ...base, applied: { a: { aplica: 2, custo: 2 } }, extraCost: 1 }), 7);
  assert.equal(estimateUseCost({ ...base, applied: { a: { aplica: 0, custo: 2 } } }), 2);

  const truque = { itemType: "magia", baseCost: 1, effects: [{ id: "t", custo: "Truque" }] };
  assert.equal(estimateUseCost({ ...truque, applied: { t: { aplica: 1, custo: "Truque" } } }), 0);

  const reducer = { itemType: "poder", baseCost: 0, effects: [{ id: "r", custo: -1 }] };
  assert.equal(estimateUseCost({ ...reducer, applied: { r: { aplica: 1, custo: -1 } } }), 0);
  assert.equal(estimateUseCost({ itemType: "poder", baseCost: 1, applied: {}, extraCost: -1 }), 0);
});

test("automaticApplied keeps only the always-applied effects, as the dialog-less path", () => {
  const effects = [
    { id: "auto", automatic: true, custo: 1 },
    { id: "free", automatic: true },
    { id: "manual", custo: 2 }
  ];
  assert.deepEqual(automaticApplied(effects), { auto: { aplica: 1, custo: 1 }, free: { aplica: 1, custo: 0 } });
});

test("checkManaLimit allows the minimum cost even above the limit", () => {
  assert.deepEqual(checkManaLimit({ cost: 2, minimumCost: 2, limit: 1 }), { ok: true, exceededBy: 0 });
  assert.deepEqual(checkManaLimit({ cost: 4, minimumCost: 2, limit: 5 }), { ok: true, exceededBy: 0 });
  assert.deepEqual(checkManaLimit({ cost: 6, minimumCost: 2, limit: 5 }), { ok: false, exceededBy: 1 });
  assert.deepEqual(checkManaLimit({ cost: 9, minimumCost: 2, limit: null }), { ok: true, exceededBy: 0 });
});

test("runValidators merges messages, blocks on any blocking result and ignores a throwing validator", () => {
  const errors = [];
  const result = runValidators(
    [
      () => ({ message: "a" }),
      () => {
        throw new Error("boom");
      },
      () => [{ message: "b", block: true }, null, { block: true }],
      () => null
    ],
    {},
    (err) => errors.push(err.message)
  );
  assert.deepEqual(result, { block: true, messages: ["a", "b"] });
  assert.deepEqual(errors, ["boom"]);
});

/* Integration with fake Foundry globals: the guard wraps submit and the rule validates the dialog form. */

let foundryFakes;

function setupFoundry() {
  if (foundryFakes) {
    foundryFakes.settings.mode = "block";
    foundryFakes.warnings.length = 0;
    return foundryFakes;
  }
  const settings = { mode: "block" };
  const warnings = [];
  const hooks = {};
  class Element {
    querySelector(selector) {
      return selector === "form" ? this.form : null;
    }
  }
  class AbilityUseDialog {
    constructor(item, formData) {
      this.item = item;
      this.element = Object.assign(new Element(), { form: { formData } });
      this.submitted = 0;
    }
    submit() {
      this.submitted++;
      return "submitted";
    }
  }
  Object.assign(globalThis, {
    HTMLElement: Element,
    tormenta20: { applications: { AbilityUseDialog } },
    game: {
      settings: { get: () => settings.mode },
      i18n: {
        localize: (key) => key,
        format: (key, data) => `${key}${JSON.stringify(data)}`
      }
    },
    ui: { notifications: { warn: (msg) => warnings.push(msg) } },
    Hooks: { on: (name, fn) => (hooks[name] = fn) },
    foundry: {
      dice: { Roll: FakeRoll },
      applications: {
        ux: {
          FormDataExtended: class {
            constructor(form) {
              this.object = form.formData;
            }
          }
        }
      },
      utils: {
        getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj),
        expandObject: (flat) => {
          const out = {};
          for (const [path, value] of Object.entries(flat)) {
            const keys = path.split(".");
            const last = keys.pop();
            keys.reduce((o, k) => (o[k] ??= {}), out)[last] = value;
          }
          return out;
        }
      }
    }
  });
  if (!String.prototype.slugify) {
    Object.defineProperty(String.prototype, "slugify", {
      value() {
        return slugify(this);
      },
      configurable: true
    });
  }
  installManaLimitRule();

  const actor = (level, extra = {}) => ({
    items: [{ type: "classe", name: "Bardo" }],
    system: { modificadores: { custoPM: 0 } },
    getRollData: () => ({ nivel: level, nvl: { bardo: level } }),
    ...extra
  });
  const inspiracao = (owner, flags) => ({
    name: "Inspiração",
    type: "poder",
    actor: owner,
    flags,
    system: { tipo: "ability", subtipo: "Bardo", ativacao: { custo: 2 } },
    applicableOnUseEffects: [{ id: "aum", system: { abilityUse: { custo: 2 }, changes: [] } }]
  });
  const use = (item, aumentos) => {
    const dialog = new AbilityUseDialog(item, { "aprs.aum.aplica": aumentos, "aprs.aum.custo": 2 });
    const result = dialog.submit();
    return { result, submitted: dialog.submitted };
  };
  foundryFakes = { settings, warnings, hooks, actor, inspiracao, use };
  return foundryFakes;
}

test("block mode: minimum cost passes, a class-limit violation keeps the dialog open; warn and off go on", () => {
  const { settings, warnings, actor, inspiracao, use } = setupFoundry();

  const bardo1 = inspiracao(actor(1));
  assert.deepEqual(use(bardo1, 0), { result: "submitted", submitted: 1 });
  assert.equal(warnings.length, 0);
  assert.deepEqual(use(bardo1, 1), { result: undefined, submitted: 0 });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /T20CP\.ManaLimit\.Exceeded.*"cost":4.*"limit":1.*T20CP\.ManaLimit\.Blocked/);

  const bardo5 = inspiracao(actor(5));
  assert.equal(use(bardo5, 1).submitted, 1);
  assert.equal(use(bardo5, 2).submitted, 0);

  warnings.length = 0;
  settings.mode = "warn";
  assert.equal(use(bardo1, 1).submitted, 1);
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings[0], /Blocked/);

  warnings.length = 0;
  settings.mode = "off";
  assert.equal(use(bardo1, 3).submitted, 1);
  assert.equal(warnings.length, 0);
});

test("block mode: unknown source and invalid formula only warn; item flag enforces or removes the limit", () => {
  const { warnings, actor, inspiracao, use } = setupFoundry();
  const flag = (value) => ({ "t20-community-patches": { manaLimit: value } });

  const magia = { ...inspiracao(actor(1)), type: "magia" };
  assert.equal(use(magia, 3).submitted, 1);
  assert.match(warnings.at(-1), /T20CP\.ManaLimit\.Unknown/);

  assert.equal(use(inspiracao(actor(1), flag("@nvl.arcanista")), 3).submitted, 1);
  assert.match(warnings.at(-1), /Source\.invalid.*T20CP\.ManaLimit\.Unknown/);

  assert.equal(use(inspiracao(actor(1), flag("1d4")), 3).submitted, 1);
  assert.match(warnings.at(-1), /Source\.invalid.*T20CP\.ManaLimit\.Unknown/);

  const count = warnings.length;
  assert.equal(use(inspiracao(actor(1), flag("none")), 3).submitted, 1);
  assert.equal(warnings.length, count);

  assert.equal(use({ ...magia, flags: flag("@nivel + 1") }, 1).submitted, 0);
  assert.equal(use({ ...magia, flags: flag("@nivel + 1") }, 0).submitted, 1);

  const withCustoPM = (custoPM) => inspiracao(actor(10, { system: { modificadores: { custoPM } } }));
  assert.equal(use(withCustoPM(0), 4).submitted, 1);
  assert.equal(use(withCustoPM(1), 4).submitted, 0);
});

test("skill and attribute rolls, which share the dialog, are not checked", () => {
  const { warnings, actor, inspiracao, use } = setupFoundry();
  for (const type of ["pericia", "atributo"]) {
    const pseudo = { ...inspiracao(actor(1)), type, system: { ativacao: { custo: 0 } } };
    assert.equal(use(pseudo, 3).submitted, 1);
  }
  assert.equal(warnings.length, 0);
});

test("a validator failure never stops the use", () => {
  const { use } = setupFoundry();
  const broken = { type: "poder", get actor() {
    throw new Error("broken");
  } };
  assert.equal(use(broken, 1).submitted, 1);
});
