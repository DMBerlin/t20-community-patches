import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDefaults,
  evaluateMax,
  findViolations,
  installUsageEffectMaxRule,
  mergeLimits,
  nameKey,
  pseudoItemEffects,
  resolveMaxFormula,
  skipsDialog,
  sourceKey
} from "../scripts/rules/usage-effect-max.mjs";

const INSPIRACAO_SOURCE = "Compendium.tormenta20.poderes.Item.Uv6GW8R54wUtv3sm";
const INSPIRACAO_EFFECT = "gpuEqXYdlZr1nrNK";
const BARD_FORMULA = "floor((@nvl.bardo - 1) / 4)";

test("resolveMaxFormula: effect flag first, then default by source, then by names, then no limit", () => {
  const defaults = buildDefaults();
  const keys = { sourceKey: sourceKey(INSPIRACAO_SOURCE, INSPIRACAO_EFFECT), nameKey: nameKey("Outra", "Outro") };
  assert.deepEqual(resolveMaxFormula({ flag: " None ", defaults, ...keys }), { kind: "none", origin: "effect" });
  assert.deepEqual(resolveMaxFormula({ flag: "2", defaults, ...keys }), { kind: "formula", formula: "2", origin: "effect" });
  assert.deepEqual(resolveMaxFormula({ flag: "0", defaults, ...keys }), { kind: "formula", formula: "0", origin: "effect" });
  assert.deepEqual(resolveMaxFormula({ flag: " ", defaults, ...keys }), {
    kind: "formula",
    formula: BARD_FORMULA,
    origin: "default"
  });
  assert.deepEqual(resolveMaxFormula({ defaults, sourceKey: "", nameKey: nameKey(" Inspiração ", "Inspiração") }), {
    kind: "formula",
    formula: BARD_FORMULA,
    origin: "default"
  });
  assert.deepEqual(resolveMaxFormula({ defaults, sourceKey: sourceKey(INSPIRACAO_SOURCE, "other"), nameKey: "" }), {
    kind: "none",
    origin: "none"
  });
});

/** Dice-free evaluator for tests: replaces @paths, null when data is missing or the text is not arithmetic. */
function fakeEvaluate(formula, data) {
  const resolved = formula.replace(/@([\w.]+)/g, (match, path) => {
    const value = path.split(".").reduce((obj, key) => obj?.[key], data);
    return value == null ? match : String(value);
  });
  if (/d\d/.test(resolved) || resolved.includes("@")) return null;
  const expr = resolved.replace(/floor/g, "Math.floor");
  if (!/^(Math\.floor|[\d\s+\-*/().])+$/.test(expr)) throw new Error("invalid");
  return Function(`return (${expr})`)();
}

test("evaluateMax: Bard levels 1/5/9/17 → 0/1/2/4; negative, fractional, NaN, dice or junk → null", () => {
  const max = (level, formula = BARD_FORMULA) => evaluateMax(formula, { nvl: { bardo: level } }, fakeEvaluate);
  assert.deepEqual([1, 4, 5, 9, 13, 17].map((l) => max(l)), [0, 0, 1, 2, 3, 4]);
  assert.equal(max(1, "@nvl.bardo - 2"), null);
  assert.equal(max(5, "@nvl.bardo / 2"), null);
  assert.equal(max(5, "0 / 0"), null);
  assert.equal(max(5, "1d4"), null);
  assert.equal(max(5, "abc"), null);
  assert.equal(max(5, "@nvl.arcanista"), null);
});

test("findViolations: counters and checkboxes above the maximum; no limit never violates", () => {
  const limits = { aum: { max: 1, name: "Inspiração" }, chk: { max: 0, name: "Extra" } };
  assert.deepEqual(findViolations({ aum: { aplica: 1 }, chk: { aplica: false } }, limits), []);
  assert.deepEqual(findViolations({ aum: { aplica: 2 }, chk: { aplica: true } }, limits), [
    { id: "aum", name: "Inspiração", requested: 2, max: 1 },
    { id: "chk", name: "Extra", requested: 1, max: 0 }
  ]);
  // Repeated field names arrive as an array, which the system applies once.
  assert.deepEqual(findViolations({ chk: { aplica: [1, 0] } }, limits), [{ id: "chk", name: "Extra", requested: 1, max: 0 }]);
  assert.deepEqual(findViolations({ aum: { aplica: 9 } }, { aum: { max: null } }), []);
  assert.deepEqual(findViolations({ aum: { aplica: 9 } }, {}), []);
});

test("mergeLimits keeps the lowest maximum of effects sharing an id, in any order", () => {
  const a = { id: "same", max: 2, name: "A" };
  const b = { id: "same", max: 0, name: "B" };
  assert.deepEqual(mergeLimits([a, b]), { same: { max: 0, name: "B" } });
  assert.deepEqual(mergeLimits([b, a]), { same: { max: 0, name: "B" } });
});

test("pseudoItemEffects filters like rollPericia/rollAtributo", () => {
  const ef = (id, { onuse = true, types = ["skill"], names = [], isTemporary = false } = {}) => ({
    id,
    documentName: "ActiveEffect",
    isTemporary,
    system: { onuse, abilityUse: { types: new Set(types), names: new Set(names) } }
  });
  const entries = [
    ["effects", ef("ok")],
    ["items.effects", ef("temp-on-item", { isTemporary: true })],
    ["effects", ef("temp-on-actor", { isTemporary: true })],
    ["effects", ef("off", { onuse: false })],
    ["effects", ef("attr", { types: ["ability"] })],
    ["effects", ef("named", { names: ["Luta"] })],
    ["effects", ef("other-name", { names: ["Pontaria"] })],
    ["items", { documentName: "Item" }]
  ];
  assert.deepEqual(pseudoItemEffects(entries, { type: "skill", name: "Luta" }).map((e) => e.id), [
    "ok",
    "temp-on-actor",
    "named"
  ]);
});

test("skipsDialog follows the system's UsageConfig and Shift rule", () => {
  assert.equal(skipsDialog({ usageDefault: true, shiftKey: false, hasEffectsOrRolls: true }), false);
  assert.equal(skipsDialog({ usageDefault: true, shiftKey: true, hasEffectsOrRolls: true }), true);
  assert.equal(skipsDialog({ usageDefault: false, shiftKey: true, hasEffectsOrRolls: true }), false);
  assert.equal(skipsDialog({ usageDefault: false, shiftKey: false, hasEffectsOrRolls: true }), true);
  assert.equal(skipsDialog({ usageDefault: true, shiftKey: false, hasEffectsOrRolls: false }), true);
});

/* Integration with fake Foundry globals: the shared guard wraps submit and the rule validates the dialog form. */

function setupFoundry({ patches = [] } = {}) {
  const settings = { mode: "block", usage: "default" };
  const warnings = [];
  const consoleWarnings = [];
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
  class ItemT20 {
    _allApplicableOnUseEffects() {
      return [];
    }
    roll() {
      return "rolled";
    }
  }
  // Like the system: the effects are collected synchronously before the first await.
  class ActorT20 {
    *traverseEmbeddedDocuments() {
      yield* this.entries;
    }
    async rollPericia(key, options) {
      this.collected = [...this.traverseEmbeddedDocuments()].map(([, doc]) => doc.id);
      await null;
      return `pericia:${key}:${!!options}`;
    }
    async rollAtributo(key) {
      this.collected = [...this.traverseEmbeddedDocuments()].map(([, doc]) => doc.id);
      await null;
      return `atributo:${key}`;
    }
  }
  class FakeRoll {
    static replaceFormulaData(formula, data) {
      return formula.replace(/@([\w.]+)/g, (match, path) => {
        const value = path.split(".").reduce((obj, key) => obj?.[key], data);
        return value == null ? match : String(value);
      });
    }
    constructor(formula) {
      this.formula = formula;
      this.isDeterministic = !/\d*d\d/.test(formula);
    }
    evaluateSync() {
      const expr = this.formula.replace(/floor/g, "Math.floor");
      if (!/^(Math\.floor|[\d\s+\-*/().])+$/.test(expr)) throw new Error("invalid");
      this.total = Function(`return (${expr})`)();
      return this;
    }
  }
  Object.assign(globalThis, {
    HTMLElement: Element,
    tormenta20: { applications: { AbilityUseDialog } },
    CONFIG: { Item: { documentClass: ItemT20 }, Actor: { documentClass: ActorT20 } },
    game: {
      settings: { get: (scope) => (scope === "tormenta20" ? settings.usage : settings.mode) },
      i18n: { localize: (key) => key, format: (key, data) => `${key}${JSON.stringify(data)}` }
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
  const originalWarn = console.warn;
  console.warn = (msg) => consoleWarnings.push(msg);
  for (const patch of patches) patch.apply();
  installUsageEffectMaxRule();

  const actor = (level) => ({ name: "Bardo", getRollData: () => ({ nvl: { bardo: level } }) });
  const owner = (source, name = "Inspiração") => ({ documentName: "Item", name, _stats: { compendiumSource: source } });
  const effect = ({ source = INSPIRACAO_SOURCE, flag, automatic = false, name = "Inspiração" } = {}) => ({
    id: INSPIRACAO_EFFECT,
    uuid: `Actor.a.Item.i.ActiveEffect.${INSPIRACAO_EFFECT}`,
    name,
    parent: owner(source),
    flags: flag === undefined ? {} : { "t20-community-patches": { maxApplications: flag } },
    system: { abilityUse: { automatic } }
  });
  const item = (level, ef = effect()) => ({ name: "Inspiração", actor: actor(level), applicableOnUseEffects: [ef] });
  const use = (it, aplica) => {
    const dialog = new AbilityUseDialog(it, { [`aprs.${INSPIRACAO_EFFECT}.aplica`]: aplica });
    return { result: dialog.submit(), submitted: dialog.submitted };
  };
  return { settings, warnings, consoleWarnings, hooks, ItemT20, ActorT20, actor, effect, item, use, restore: () => (console.warn = originalWarn) };
}

test("dialog: block keeps it open above the maximum, warn goes on, off ignores; flags override the default", () => {
  const { settings, warnings, consoleWarnings, ItemT20, actor, effect, item, use, restore } = setupFoundry();
  try {
    assert.deepEqual(use(item(1), 0), { result: "submitted", submitted: 1 });
    assert.deepEqual(use(item(1), 1), { result: undefined, submitted: 0 });
    assert.match(warnings.at(-1), /Exceeded.*"requested":1,"max":0.*T20CP\.UsageEffectMax\.Blocked/);

    assert.equal(use(item(5), 1).submitted, 1);
    assert.equal(use(item(5), 2).submitted, 0);
    assert.equal(use(item(17), 4).submitted, 1);
    assert.equal(use(item(17), 5).submitted, 0);

    // Item without compendium origin: default by names.
    assert.equal(use(item(1, effect({ source: undefined })), 1).submitted, 0);
    // Flags: "none" removes the limit, "2" overrides the default.
    assert.equal(use(item(1, effect({ flag: "none" })), 4).submitted, 1);
    assert.equal(use(item(1, effect({ flag: "2" })), 2).submitted, 1);
    assert.equal(use(item(1, effect({ flag: "2" })), 3).submitted, 0);

    // Invalid formulas never block and warn once in the console.
    warnings.length = 0;
    assert.equal(use(item(1, effect({ flag: "1d4" })), 3).submitted, 1);
    assert.equal(use(item(1, effect({ flag: "1d4" })), 3).submitted, 1);
    assert.equal(use(item(1, effect({ flag: "abc" })), 3).submitted, 1);
    assert.equal(warnings.length, 0);
    assert.equal(consoleWarnings.filter((m) => m.includes('"1d4"')).length, 1);
    assert.equal(consoleWarnings.filter((m) => m.includes('"abc"')).length, 1);

    settings.mode = "warn";
    assert.equal(use(item(1), 1).submitted, 1);
    assert.match(warnings.at(-1), /Exceeded/);
    assert.doesNotMatch(warnings.at(-1), /Blocked/);

    warnings.length = 0;
    settings.mode = "off";
    assert.equal(use(item(1), 3).submitted, 1);
    assert.equal(warnings.length, 0);

    // Dialog-less rolls: never blocked, warned only when an "Aplicar Sempre" effect has maximum 0.
    settings.mode = "block";
    const rolled = (level, automatic, shiftKey) => {
      const doc = Object.assign(new ItemT20(), {
        name: "Inspiração",
        actor: actor(level),
        system: { rolls: [] },
        _allApplicableOnUseEffects: () => [effect({ automatic })]
      });
      return doc.roll({ event: { shiftKey } });
    };
    assert.equal(rolled(1, true, true), "rolled");
    assert.match(warnings.at(-1), /Exceeded.*"max":0/);
    warnings.length = 0;
    assert.equal(rolled(1, true, false), "rolled");
    assert.equal(rolled(1, false, true), "rolled");
    assert.equal(rolled(5, true, true), "rolled");
    assert.equal(warnings.length, 0);

    // Same id on two items: the lowest maximum is checked whatever the order.
    const twoOwners = (first, second) =>
      Object.assign(new ItemT20(), {
        name: "Inspiração",
        actor: actor(1),
        system: { rolls: [] },
        _allApplicableOnUseEffects: () => [
          effect({ automatic: true, flag: first }),
          effect({ automatic: true, flag: second, source: "Compendium.x.y.Item.z" })
        ]
      }).roll({ event: { shiftKey: true } });
    twoOwners("0", "2");
    twoOwners("2", "0");
    assert.equal(warnings.length, 2);
  } finally {
    restore();
  }
});

test("skill and attribute rolls without the dialog warn at maximum 0; with the dialog or other modes, nothing", async () => {
  const { settings, warnings, ActorT20, effect, restore } = setupFoundry();
  try {
    const skillEffect = (id, extra = {}) =>
      Object.assign(effect({ automatic: true, flag: "0", name: "Foco" }), {
        id,
        documentName: "ActiveEffect",
        system: { onuse: true, abilityUse: { automatic: true, types: new Set(["skill", "ability"]), names: new Set() } },
        ...extra
      });
    const actor = Object.assign(new ActorT20(), {
      name: "Guerreiro",
      system: { pericias: { luta: { label: "Luta" } }, atributos: { for: { name: "Força" } } },
      getRollData: () => ({}),
      entries: [["effects", skillEffect("auto")]]
    });
    assert.equal(await actor.rollPericia("luta", { event: { shiftKey: true } }), "pericia:luta:true");
    assert.match(warnings.at(-1), /Exceeded.*"item":"Luta".*"max":0/);
    assert.equal(await actor.rollAtributo("for", { event: { shiftKey: true } }), "atributo:for");
    assert.match(warnings.at(-1), /"item":"Força"/);
    warnings.length = 0;
    await actor.rollPericia("luta", { event: { shiftKey: false } });
    await actor.rollPericia("luta");
    assert.equal(warnings.length, 0);
    settings.usage = "shift";
    await actor.rollPericia("luta");
    assert.equal(warnings.length, 1);

    // A non-automatic effect sharing the id of an automatic one is applied too, so its maximum counts.
    const pair = (first, second) => {
      actor.entries = [
        ["effects", skillEffect("same", { flags: { "t20-community-patches": { maxApplications: first.max } } })],
        ["items.effects", skillEffect("same", { flags: { "t20-community-patches": { maxApplications: second.max } } })]
      ];
      actor.entries[first.automatic ? 1 : 0][1].system.abilityUse.automatic = false;
      return actor.rollPericia("luta");
    };
    warnings.length = 0;
    await pair({ max: "2", automatic: true }, { max: "0", automatic: false });
    await pair({ max: "0", automatic: false }, { max: "2", automatic: true });
    assert.equal(warnings.length, 2);

    settings.mode = "off";
    await actor.rollPericia("luta");
    assert.equal(warnings.length, 2);
  } finally {
    restore();
  }
});

test("skill rolls only check the effects the system collects (suppressed-usage-effects applied)", async () => {
  const { default: suppressed } = await import("../scripts/patches/suppressed-usage-effects.mjs");
  const { warnings, ActorT20, effect, restore } = setupFoundry({ patches: [suppressed] });
  try {
    const held = (equipped) => ({
      documentName: "Item",
      areEffectsSuppressed: !equipped,
      name: "Escudo"
    });
    const onEquipment = (equipped) =>
      Object.assign(effect({ automatic: true, flag: "0", name: "Foco" }), {
        documentName: "ActiveEffect",
        parent: held(equipped),
        system: { onuse: true, abilityUse: { automatic: true, types: new Set(["skill", "ability"]), names: new Set() } }
      });
    const actor = Object.assign(new ActorT20(), {
      name: "Guerreiro",
      system: { pericias: { luta: { label: "Luta" } }, atributos: { for: { name: "Força" } } },
      getRollData: () => ({}),
      entries: [["items.effects", onEquipment(false)]]
    });
    await actor.rollPericia("luta", { event: { shiftKey: true } });
    await actor.rollAtributo("for", { event: { shiftKey: true } });
    assert.deepEqual(actor.collected, []);
    assert.equal(warnings.length, 0);
    actor.entries = [["items.effects", onEquipment(true)]];
    await actor.rollPericia("luta", { event: { shiftKey: true } });
    assert.equal(warnings.length, 1);
  } finally {
    restore();
  }
});
