import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NAMED,
  KNOWN_SOURCES,
  armorStatus,
  diagnoseSource,
  installNonProficiencyRule,
  itemArmorPenalty,
  keyAbility,
  matchesName,
  maxMatching,
  normalizeName,
  parseCustom,
  resolveProficiencies,
  skillExtraPenalty,
  sourceFingerprint,
  unresolvedChoices,
  weaponRequirements,
  weaponStatus
} from "../scripts/rules/non-proficiency-penalties.mjs";
import { computePenaltyAdjustments } from "../scripts/patches/armor-penalty-reduction.mjs";
import { MODULE_ID, addTooltipLine } from "../scripts/utils.mjs";
import { CreatureData165, Item165 } from "./fixtures/non-proficiency-1.6.5.mjs";

const IDS = {
  arcanista: "TH7OIKaDqtLLQUrs",
  guerreiro: "DPhWNP689FygcOSZ",
  pistoleiro: "EMramxpu1YogEN9u",
  tradicao: "ZfvrgyuDZB7CAptc"
};

const ESPADA = { name: "Espada longa", proficiencia: "marcial", proposito: "corpo-a-corpo" };
const ARCO = { name: "Arco longo", proficiencia: "marcial", proposito: "disparo" };
const PISTOLA = { name: "Pistola", proficiencia: "fogo", proposito: "disparo" };
const ADAGA = { name: "Adaga", proficiencia: "simples", proposito: "corpo-a-corpo" };
const KATANA = { name: "Katana", proficiencia: "exotica", proposito: "corpo-a-corpo", adaptable: true, twoHanded: false };
const KATANA_2H = { ...KATANA, twoHanded: true };
const MACHADO = { name: "Machado de guerra", proficiencia: "marcial", proposito: "corpo-a-corpo" };
const TRIDENTE = { name: "Tridente", proficiencia: "marcial", proposito: "corpo-a-corpo" };
const COTA = { name: "Cota de malha", tipo: "pesada" };
const ESCUDO = { name: "Escudo pesado", tipo: "escudo" };
const COURACA = { name: "Couraça", tipo: "leve" };

const cls = (name, inicial = true, id) => ({ id, name, inicial });
const pw = (name, id) => ({ id, name });
const traits = ({ armas = [], armasCustom = "", armaduras = [], armadurasCustom = "" } = {}) => ({
  profArmas: { value: armas, custom: armasCustom },
  profArmaduras: { value: armaduras, custom: armadurasCustom }
});
const profsOf = (classes, powers = [], t = {}, race = "") =>
  resolveProficiencies({ classes, powers, race, traits: traits(t) });
const statuses = (profs, items) =>
  items.map((i) => (i.tipo ? armorStatus(i, profs) : weaponStatus(i, profs)));

/** Every permutation of a small array. */
function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]));
}

test("names: normalized, custom entries split by ';', an entry covers the same name or the name followed by a space", () => {
  assert.equal(normalizeName("  Machado   Anão "), "machado anao");
  assert.deepEqual(parseCustom("Katana; ;Machado anão"), ["katana", "machado anao"]);
  assert.equal(matchesName("Katana (obra-prima)", ["katana"]), true);
  assert.equal(matchesName("Katanas", ["katana"]), false);
  assert.equal(matchesName("", ["katana"]), false);
});

test("weaponRequirements: simple, natural, improvised and unknown need nothing; adaptable exotic two-handed takes martial", () => {
  for (const proficiencia of ["simples", "natural", "improvisada", "outra", undefined]) {
    assert.deepEqual(weaponRequirements({ proficiencia }), [], String(proficiencia));
  }
  assert.deepEqual(weaponRequirements(KATANA_2H), ["exotica", "marcial"]);
  assert.deepEqual(weaponRequirements(KATANA), ["exotica"]);
  assert.deepEqual(weaponRequirements({ proficiencia: "exotica", twoHanded: true }), ["exotica"]);
});

test("classes: recognized by id or name; only the initial class counts", () => {
  const guerreiro = profsOf([cls("Qualquer nome", true, IDS.guerreiro)]);
  assert.deepEqual(statuses(guerreiro, [ESPADA, COTA, ESCUDO, PISTOLA]), ["ok", "ok", "ok", "penalty"]);
  assert.deepEqual(statuses(profsOf([cls("Paladino")]), [ESPADA, COTA]), ["ok", "ok"]);
  const arcanista = profsOf([cls("Arcanista")]);
  assert.deepEqual(statuses(arcanista, [ESPADA, COTA, ADAGA, COURACA]), ["penalty", "penalty", "ok", "ok"]);
  assert.deepEqual(statuses(profsOf([cls("Clérigo")]), [ESPADA, COTA]), ["penalty", "ok"]);

  const multi = profsOf([cls("Arcanista"), cls("Guerreiro", false)]);
  assert.deepEqual(statuses(multi, [ESPADA, COTA]), ["penalty", "penalty"]);
  assert.deepEqual(statuses(profsOf([cls("Guerreiro"), cls("Arcanista", false)]), [ESPADA, COTA]), ["ok", "ok"]);
  assert.deepEqual(statuses(profsOf([cls("Guerreiro", false)]), [ESPADA, COTA]), ["ok", "ok"]);
});

test("ambiguous class data never penalizes what it could cover", () => {
  const none = profsOf([cls("Arcanista", false), cls("Guerreiro", false)]);
  assert.deepEqual(none.warnings, [{ code: "no-initial-class" }]);
  assert.deepEqual(statuses(none, [ESPADA, COTA, PISTOLA]), ["indeterminate", "indeterminate", "penalty"]);

  const homebrew = profsOf([cls("Treinador")]);
  assert.deepEqual(homebrew.warnings, [{ code: "unknown-class", name: "Treinador" }]);
  assert.equal(weaponStatus(ESPADA, homebrew), "indeterminate");
  const marked = profsOf([cls("Treinador")], [], { armas: ["marcial"] });
  assert.deepEqual(statuses(marked, [ESPADA, COTA]), ["ok", "indeterminate"]);
});

test("fixed powers grant their proficiencies; Tradição requires a dwarf even by id", () => {
  const arc = [cls("Arcanista")];
  assert.deepEqual(statuses(profsOf(arc, [pw("Armeiro")]), [ESPADA, ARCO, KATANA_2H]), ["ok", "penalty", "ok"]);
  assert.equal(weaponStatus(PISTOLA, profsOf(arc, [pw("Outro nome", IDS.pistoleiro)])), "ok");
  assert.equal(weaponStatus(PISTOLA, profsOf(arc, [pw("Pistoleiro (Inventor)")])), "ok");
  const samurai = profsOf(arc, [pw("Tradição de Samurai")]);
  assert.deepEqual(statuses(samurai, [KATANA, { ...KATANA, name: "Katana (obra-prima)" }]), ["ok", "ok"]);
  assert.equal(weaponStatus(MACHADO, profsOf(arc, [pw("Tradição", IDS.tradicao)], {}, "Anão")), "ok");
  assert.equal(weaponStatus(MACHADO, profsOf(arc, [pw("Tradição", IDS.tradicao)], {}, "Humano")), "penalty");
  assert.equal(armorStatus(COTA, profsOf([cls("Inventor")], [pw("Couraceiro")])), "ok");
});

test("choices: pending until an unexplained Traits entry resolves them", () => {
  const arc = [cls("Arcanista")];
  const pending = profsOf(arc, [pw("Proficiência")]);
  assert.deepEqual(statuses(pending, [ESPADA, COTA, KATANA]), ["indeterminate", "indeterminate", "penalty"]);
  const shields = profsOf(arc, [pw("Proficiência")], { armaduras: ["esc"] });
  assert.deepEqual(shields.pending, []);
  assert.deepEqual(statuses(shields, [ESPADA, ESCUDO]), ["penalty", "ok"]);

  const redundant = profsOf([cls("Guerreiro")], [pw("Proficiência")], { armas: ["marcial"] });
  assert.equal(weaponStatus(PISTOLA, redundant), "indeterminate");

  const inv = [cls("Inventor")];
  assert.deepEqual(statuses(profsOf(inv, [pw("Balística")]), [ARCO, ESPADA]), ["indeterminate", "penalty"]);
  const ranged = profsOf(inv, [pw("Balística")], { armasCustom: "marciais à distância" });
  assert.deepEqual(statuses(ranged, [ARCO, PISTOLA]), ["ok", "penalty"]);

  const pal = [cls("Paladino")];
  const blessed = profsOf(pal, [pw("Abençoar Arma")]);
  assert.deepEqual(blessed.pending[0].candidates, [NAMED]);
  assert.equal(weaponStatus(KATANA, blessed), "indeterminate");
  const named = profsOf(pal, [pw("Abençoar Arma")], { armasCustom: "Katana" });
  assert.deepEqual(statuses(named, [KATANA, PISTOLA]), ["ok", "penalty"]);
});

test("choices: entries already explained by fixed sources do not resolve them", () => {
  const g = profsOf([cls("Guerreiro")], [pw("Balística")], { armasCustom: "marciais à distância" });
  assert.equal(g.pending.length, 1);
  assert.deepEqual(statuses(g, [PISTOLA, ARCO]), ["indeterminate", "ok"]);

  const p = profsOf([cls("Paladino")], [pw("Tradição de Samurai"), pw("Abençoar Arma")], { armasCustom: "Katana" });
  assert.equal(p.pending.length, 1);
  assert.deepEqual(statuses(p, [PISTOLA, KATANA, TRIDENTE]), ["indeterminate", "ok", "ok"]);

  const scopedMelee = profsOf([cls("Inventor")], [pw("Armeiro"), pw("Balística")], { armasCustom: "marciais corpo a corpo" });
  assert.equal(scopedMelee.pending.length, 1);
  const scopedRanged = profsOf([cls("Inventor")], [pw("Armeiro"), pw("Balística")], { armasCustom: "marciais a distancia" });
  assert.deepEqual(scopedRanged.pending, []);
  assert.deepEqual(statuses(scopedRanged, [ARCO, ESPADA, PISTOLA]), ["ok", "ok", "penalty"]);

  const dwarf = profsOf([cls("Paladino")], [pw("Tradição"), pw("Abençoar Arma")], { armasCustom: "Machado de guerra" }, "Anão");
  assert.equal(dwarf.pending.length, 1);
  const two = profsOf([cls("Paladino")], [pw("Tradição de Samurai"), pw("Abençoar Arma")], { armasCustom: "Katana; Tridente" });
  assert.deepEqual(two.pending, []);
});

test("choices: maximum matching, independent of the order of powers and entries", () => {
  for (const powers of permutations([pw("Balística"), pw("Proficiência")])) {
    for (const armasCustom of ["marciais à distância", "Adaga; marciais à distância"]) {
      const p = profsOf([cls("Inventor")], powers, { armas: ["fogo"], armasCustom });
      assert.deepEqual(p.pending, []);
      assert.deepEqual(statuses(p, [ESPADA, COTA, ARCO, PISTOLA]), ["penalty", "penalty", "ok", "ok"]);
    }
  }
  for (const powers of permutations([pw("Balística"), pw("Proficiência"), pw("Proficiência", "AD22Tx3t0ur2lL2e")])) {
    for (const armaduras of [["esc"]]) {
      const p = profsOf([cls("Arcanista")], powers, { armas: ["fogo"], armasCustom: "marciais à distância", armaduras });
      assert.deepEqual(p.pending, []);
      assert.deepEqual(statuses(p, [ESCUDO, ESPADA, COTA]), ["ok", "penalty", "penalty"]);
    }
  }
  for (const powers of permutations([pw("Balística"), pw("Proficiência")])) {
    const p = profsOf([cls("Inventor")], powers, { armas: ["fogo"] });
    assert.equal(p.pending.length, 2);
    assert.deepEqual(statuses(p, [ESPADA, ARCO, COTA, PISTOLA]), ["indeterminate", "indeterminate", "indeterminate", "ok"]);
  }
  assert.equal(maxMatching([["marcial-ranged", "fogo"], ["marcial", "fogo", "pes"]], ["fogo", "marcial-ranged"]), 2);
  assert.equal(maxMatching([["fogo"], ["fogo"]], ["fogo"]), 1);
  assert.deepEqual(unresolvedChoices([["fogo"], ["esc"]], ["esc"]), [0]);
  assert.deepEqual(unresolvedChoices([], ["esc"]), []);
});

test("itemArmorPenalty: base made worse by own increases, lowered by reductions, never above 0", () => {
  assert.equal(itemArmorPenalty({ base: -2 }), -2);
  assert.equal(itemArmorPenalty({ base: 2 }), -2);
  assert.equal(itemArmorPenalty({ base: -2, increase: 1 }), -3);
  assert.equal(itemArmorPenalty({ base: -2, reduction: 1 }), -1);
  assert.ok(Object.is(itemArmorPenalty({ base: -2, reduction: 3 }), 0));
});

test("itemArmorPenalty equals the item's share of armor-penalty-reduction's computePenaltyAdjustments", () => {
  for (const [base, increase, reduction] of [[-2, 0, 1], [-2, 1, 1], [-1, 1, 3], [-5, 1, 2], [0, 1, 0], [-2, 2, 3], [-1, 0, 0]]) {
    const { items, actorDelta } = computePenaltyAdjustments(
      new Map([["a", base]]),
      new Map([["a", reduction]]),
      new Map([["a", increase]])
    );
    assert.equal(itemArmorPenalty({ base, increase, reduction }), items.get("a") - increase + actorDelta, `${[base, increase, reduction]}`);
  }
});

test("key ability and extra penalty: book table, custom skills, skills with pda never doubled", () => {
  const config = { luta: { abl: "for" } };
  assert.equal(keyAbility("luta", { atributo: "sab" }, config), "for");
  assert.equal(keyAbility("_pc1", { atributo: "des" }, config), "des");
  assert.equal(keyAbility("_pc1", { atributo: "int" }, config), "int");
  assert.equal(skillExtraPenalty({ ability: "for", penalty: -2 }), -2);
  assert.equal(skillExtraPenalty({ ability: "sab", penalty: -2 }), 0);
  assert.equal(skillExtraPenalty({ ability: "des", appliesArmorPenalty: true, penalty: -2 }), 0);
  assert.equal(skillExtraPenalty({ ability: "des", penalty: 0 }), 0);
});

test("fingerprints: the real 1.6.5 methods are recognized; partial fixes, helpers and foreign wrappers are not", () => {
  const attack = Item165.prototype.getAttackToHit.toString();
  const skill = CreatureData165.prototype.prepareSkill.toString();
  assert.equal(sourceFingerprint(attack), KNOWN_SOURCES.getAttackToHit["1.6.5"]);
  assert.equal(sourceFingerprint(skill), KNOWN_SOURCES.prepareSkill["1.6.5"]);
  assert.deepEqual(diagnoseSource("getAttackToHit", attack, "1.6.5").bug, "present");
  assert.equal(diagnoseSource("prepareSkill", skill, "1.6.5").confidence, "high");

  const fn = "f(a) {\n  // comment\n  return a + 1;\n}";
  assert.equal(sourceFingerprint(fn), sourceFingerprint("f(a) { /* other */ return a + 1;    }"));
  const partial = "f(a) {\n  const x = a.profArmas;\n  return a + 1;\n}";
  const helper = "f(a) { return applyProficiency(a); }";
  const wrapper = "function (...args) { return wrapped.apply(this, args); }";
  for (const other of [partial, helper, wrapper]) assert.notEqual(sourceFingerprint(other), sourceFingerprint(fn));
  const known = { f: { "1.0": sourceFingerprint(fn) } };
  assert.deepEqual(diagnoseSource("f", fn, "1.0", known).bug, "present");
  assert.deepEqual(diagnoseSource("f", partial, "1.0", known), {
    bug: "unknown",
    confidence: "low",
    evidence: `f not recognized (${sourceFingerprint(partial)})`
  });
  assert.equal(diagnoseSource("getAttackToHit", fn, "1.6.5").bug, "unknown");
  assert.equal(sourceFingerprint(undefined), null);
});

/* -------------------------------------------- */
/*  Integration with Foundry mocks              */
/* -------------------------------------------- */

/** Same markup as the system's fieldBonuses (T20:4429-4462). */
function systemTooltip(lines) {
  let total = 0;
  let list = "";
  for (const [label, value] of lines) {
    list += `<li class="flexrow"><label>${label}:</label><span>${value >= 0 ? `+${value}` : value}</span></li>`;
    total += value;
  }
  return `\n\t\t<ul class="fieldBonuses">\n\t\t\t${list}\n\t\t\t<hr>\n\t\t\t<li class="flexrow"><label>Total:</label><span>${total >= 0 ? `+${total}` : total}</span></li>\n\t\t</ul>\n\t\t`;
}

const tooltipLines = (html) => [...html.matchAll(/<label>([^<]*):<\/label><span>([^<]*)/g)].map((m) => `${m[1]} ${m[2]}`);

test("addTooltipLine: line before the total, total corrected; no-op for 0 or unknown markup; label escaped", () => {
  const html = systemTooltip([["Destreza", 1]]);
  assert.deepEqual(tooltipLines(addTooltipLine(html, "Sem proficiência", -5)), ["Destreza +1", "Sem proficiência -5", "Total -4"]);
  assert.deepEqual(tooltipLines(addTooltipLine(systemTooltip([["Força", 7]]), "X", -5)), ["Força +7", "X -5", "Total +2"]);
  assert.deepEqual(tooltipLines(addTooltipLine(systemTooltip([["Força", 5]]), "X", -5)), ["Força +5", "X -5", "Total +0"]);
  assert.equal(addTooltipLine(html, "X", 0), html);
  assert.equal(addTooltipLine("<ul><li>sem total</li></ul>", "X", -5), "<ul><li>sem total</li></ul>");
  assert.equal(addTooltipLine(undefined, "X", -5), undefined);
  assert.match(addTooltipLine(html, "<b>", -2), /<label>&lt;b&gt;:<\/label>/);
});

class FakeItem {
  constructor(data) {
    Object.assign(this, data);
    this._source ??= { system: structuredClone(this.system ?? {}) };
  }
}

const PDA = "system.attributes.defesa.pda";
const effect = (parent, { name = "Efeito", value = 1, identifier, phase = "initial" } = {}) => ({
  active: true,
  parent,
  name,
  system: { identifier, changes: [{ key: PDA, type: "add", value, phase }] },
  shouldApplyChange: (change, options) => change.phase === options?.phase
});

/** Builds the module environment, installs the rule once per call and returns the patched methods. */
function setup({ rule = "on", reduction = "applied", slots = false, gm = true } = {}) {
  const hooks = {};
  const notifications = [];
  const calls = { attack: 0, skill: 0 };
  class Base {
    prepareSkill(skillId, { skillData } = {}) {
      calls.skill++;
      return skillData;
    }
  }
  class Character extends Base {}
  class Item {
    getAttackToHit() {
      calls.attack++;
      return this._attack === undefined ? { rollData: {}, parts: ["@skill"] } : this._attack;
    }
  }
  globalThis.CONFIG = {
    Item: { documentClass: Item },
    Actor: { dataModels: { character: Character } },
    T20: { pericias: { luta: { abl: "for" }, pont: { abl: "des" }, atle: { abl: "for" }, acro: { abl: "des" }, vont: { abl: "sab" } } }
  };
  const settings = { [`${MODULE_ID}.nonProficiencyRule`]: rule, "tormenta20.equipmentSlots": slots };
  globalThis.game = {
    settings: { get: (scope, key) => settings[`${scope}.${key}`] },
    system: { version: "1.6.5" },
    modules: { get: () => ({ api: { status: [{ id: "armor-penalty-reduction", state: reduction }] } }) },
    user: { isGM: gm },
    i18n: { format: (key, data) => `${key} ${JSON.stringify(data)}`, localize: (key) => key }
  };
  globalThis.foundry = { documents: { Item: FakeItem }, utils: { fromUuidSync: () => null } };
  globalThis.Hooks = {
    on: (name, fn) => (hooks[name] ??= []).push(fn),
    once: (name, fn) => (hooks[name] ??= []).push(fn)
  };
  globalThis.ui = { notifications: { warn: (message) => notifications.push(message) } };
  const helpers = { fieldBonuses: (path) => systemTooltip([["Força", 1]], path) };
  globalThis.Handlebars = { helpers, registerHelper: (name, fn) => (helpers[name] = fn) };
  const warnings = [];
  const warn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    installNonProficiencyRule();
  } finally {
    console.warn = warn;
  }
  return { Item, Character, hooks, notifications, calls, warnings, helpers };
}

function teardown() {
  for (const key of ["CONFIG", "game", "foundry", "Hooks", "ui", "Handlebars"]) delete globalThis[key];
}

/** A character (or threat) with the given class, equipped armor and effects. */
function makeActor({ type = "character", className = "Arcanista", armor = [], effects = () => [], tracos = traits() } = {}) {
  const actor = { type, system: { tracos }, effectCalls: 0 };
  const equipment = armor.map(
    (a, i) => new FakeItem({ id: `eq${i}`, name: a.name, parent: actor, system: { tipo: a.tipo, equipado: 1, armadura: { penalidade: a.penalty } } })
  );
  actor.itemTypes = { classe: [{ name: className, system: { inicial: true } }], poder: [], race: [], equipamento: equipment };
  actor.items = new Map(equipment.map((i) => [i.id, i]));
  const list = effects(equipment, actor);
  actor.allApplicableEffects = function* () {
    actor.effectCalls++;
    yield* list;
  };
  actor.getRollData = () => ({});
  return actor;
}

function skills(env, actor, ids = ["luta", "pont", "atle", "acro", "vont"], { pericias = {} } = {}) {
  const data = { parent: actor, pericias };
  Object.setPrototypeOf(data, env.Character.prototype);
  const rollData = {};
  const out = {};
  for (const id of ids) {
    const skillData = { value: 10, pda: id === "acro", atributo: pericias[id]?.atributo };
    out[id] = data.prepareSkill(id, { skillData, rollData }).value;
  }
  return out;
}

test("attack: -5 only for a character's weapon without proficiency, with the rule on", () => {
  const env = setup();
  try {
    const actor = makeActor();
    const weapon = (system, owner = actor, extra = {}) => {
      const item = Object.assign(Object.create(env.Item.prototype), { type: "arma", name: "Espada longa", isOwned: true, actor: owner, system, ...extra });
      return item.getAttackToHit();
    };
    assert.deepEqual(weapon({ proficiencia: "marcial", proposito: "corpo-a-corpo" }).parts, ["@skill", "-5"]);
    assert.deepEqual(weapon({ proficiencia: "simples" }).parts, ["@skill"]);
    assert.deepEqual(weapon({ proficiencia: "marcial" }, makeActor({ type: "npc" })).parts, ["@skill"]);
    assert.deepEqual(weapon({ proficiencia: "marcial" }, actor, { type: "equipamento" }).parts, ["@skill"]);
    assert.equal(weapon({ proficiencia: "marcial" }, actor, { _attack: null }), null);
    const pending = makeActor({ className: "Treinador" });
    assert.deepEqual(weapon({ proficiencia: "marcial" }, pending).parts, ["@skill"]);
    game.settings.get = (scope, key) => (key === "nonProficiencyRule" ? "off" : false);
    assert.deepEqual(weapon({ proficiencia: "marcial" }).parts, ["@skill"]);
  } finally {
    teardown();
  }
});

test("attack: an adaptable exotic weapon wielded with two hands accepts martial (equipado 2 or slot 12)", () => {
  for (const [slots, system] of [[false, { equipado: 2 }], [true, { equipado2: { slot: "12" } }]]) {
    const env = setup({ slots });
    try {
      const actor = makeActor({ className: "Guerreiro" });
      const katana = (hands) =>
        Object.assign(Object.create(env.Item.prototype), {
          type: "arma",
          name: "Katana",
          isOwned: true,
          actor,
          system: { proficiencia: "exotica", proposito: "corpo-a-corpo", propriedades: { ada: true }, ...hands }
        }).getAttackToHit().parts;
      assert.deepEqual(katana(system), ["@skill"]);
      assert.deepEqual(katana({}), ["@skill", "-5"]);
    } finally {
      teardown();
    }
  }
});

test("skills: the armor penalty reaches Str/Dex skills by the book's key ability, once per preparation", () => {
  const env = setup();
  try {
    const actor = makeActor({ armor: [{ name: "Cota de malha", tipo: "pesada", penalty: -2 }] });
    const values = skills(env, actor, undefined, { pericias: { luta: { atributo: "sab" } } });
    assert.deepEqual(values, { luta: 8, pont: 8, atle: 8, acro: 10, vont: 10 });
    assert.equal(actor.effectCalls, 1);
    const custom = skills(env, actor, ["_pc1", "_pc2"], { pericias: { _pc1: { atributo: "des" }, _pc2: { atributo: "int" } } });
    assert.deepEqual(custom, { _pc1: 8, _pc2: 10 });
    const guerreiro = makeActor({ className: "Guerreiro", armor: [{ name: "Cota de malha", tipo: "pesada", penalty: -2 }] });
    assert.deepEqual(skills(env, guerreiro, ["atle"]), { atle: 10 });
    const threat = makeActor({ type: "npc", armor: [{ name: "Cota de malha", tipo: "pesada", penalty: -2 }] });
    assert.deepEqual(skills(env, threat, ["atle"]), { atle: 10 });
  } finally {
    teardown();
  }
});

test("skills: a condition penalty already in the skill and the armor penalty both apply", () => {
  const env = setup();
  try {
    const actor = makeActor({ armor: [{ name: "Cota de malha", tipo: "pesada", penalty: -2 }] });
    const data = Object.setPrototypeOf({ parent: actor, pericias: {} }, env.Character.prototype);
    const blind = { value: 10 - 5, condi: -5, pda: false };
    assert.equal(data.prepareSkill("atle", { skillData: blind, rollData: {} }).value, 3);
  } finally {
    teardown();
  }
});

test("skills: shield and armor add up; light armor never penalizes", () => {
  const env = setup();
  try {
    const both = makeActor({ armor: [{ name: "Cota de malha", tipo: "pesada", penalty: -2 }, { name: "Escudo pesado", tipo: "escudo", penalty: -2 }] });
    assert.deepEqual(skills(env, both, ["atle"]), { atle: 6 });
    both.system.tracos = traits({ armaduras: ["pes"] });
    assert.deepEqual(skills(env, both, ["atle"]), { atle: 8 });
    const light = makeActor({ armor: [{ name: "Couraça", tipo: "leve", penalty: -1 }] });
    assert.deepEqual(skills(env, light, ["atle"]), { atle: 10 });
  } finally {
    teardown();
  }
});

test("item penalty: Reforçada always, Ajustada only with #19 applied, Sobrecarregado never", () => {
  const cota = [{ name: "Cota de malha", tipo: "pesada", penalty: -2 }];
  const adjusted = (items) => [effect(items[0], { name: "Ajustada", identifier: "adjusted", value: -1 })];
  const reinforced = (items) => [effect(items[0], { name: "Reforçada", value: 1 })];
  const encumbered = (items, actor) => [effect(actor, { name: "Sobrecarregado", value: 5 })];
  for (const [reduction, effects, expected] of [
    ["applied", adjusted, 9],
    ["disabled", adjusted, 8],
    ["applied", reinforced, 7],
    ["applied", (items) => [...reinforced(items), ...adjusted(items)], 8],
    ["applied", encumbered, 8],
    ["applied", (items) => [effect(items[0], { name: "Sob medida", identifier: "undermeasure", value: 2 })], 10]
  ]) {
    const env = setup({ reduction });
    try {
      assert.deepEqual(skills(env, makeActor({ armor: cota, effects }), ["atle"]), { atle: expected }, `${reduction} ${expected}`);
    } finally {
      teardown();
    }
  }
});

test("sheet marker: names from user data reach the tooltip as literal text, never as HTML", () => {
  const env = setup();
  class FakeElement {
    constructor(tag) {
      this.tagName = tag;
      this.dataset = {};
      this.children = [];
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    querySelector() {
      return null;
    }
  }
  globalThis.HTMLElement = FakeElement;
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  try {
    const actor = makeActor({ className: "<strong>Treinador</strong>" });
    const weapon = Object.assign(Object.create(env.Item.prototype), {
      id: "w1", type: "arma", name: "Espada longa", isOwned: true, actor, system: { proficiencia: "marcial" }
    });
    actor.items.set(weapon.id, weapon);
    const label = new FakeElement("label");
    const li = new FakeElement("li");
    li.dataset.itemId = weapon.id;
    li.querySelector = () => label;
    const root = new FakeElement("div");
    root.querySelectorAll = () => [li];
    env.hooks.renderActorSheetT20.at(-1)({ actor }, root);
    const icon = label.children.at(-1);
    assert.match(icon.className, /fa-circle-question t20cp-nonprof/);
    assert.equal(icon.dataset.tooltip, undefined);
    assert.equal(icon.dataset.tooltipHtml, undefined);
    assert.match(icon.dataset.tooltipText, /<strong>Treinador<\/strong>/);
  } finally {
    delete globalThis.HTMLElement;
    delete globalThis.document;
    teardown();
  }
});

test("skill breakdown: the system's tooltip shows the armor penalty and the prepared total, only for skills that got it", () => {
  const env = setup();
  try {
    const actor = makeActor({ armor: [{ name: "Armadura completa", tipo: "pesada", penalty: -5 }] });
    const data = { parent: actor, pericias: {}, tracos: actor.system.tracos };
    Object.setPrototypeOf(data, env.Character.prototype);
    actor.system = data;
    const rollData = {};
    const values = {};
    for (const id of ["luta", "acro", "vont"]) values[id] = data.prepareSkill(id, { skillData: { value: 1, pda: id === "acro" }, rollData }).value;
    game.actors = { get: (id) => (id === "a1" ? actor : undefined) };
    const tip = (key) => tooltipLines(env.helpers.fieldBonuses(`system.pericias.${key}.bonus`, { data: { root: { actor: { _id: "a1" } } } }));
    assert.deepEqual(values, { luta: -4, acro: 1, vont: 1 });
    assert.deepEqual(tip("luta"), ["Força +1", "T20CP.NonProficiency.TooltipLabel -5", "Total -4"]);
    assert.deepEqual(tip("acro"), ["Força +1", "Total +1"]);
    assert.deepEqual(tip("vont"), ["Força +1", "Total +1"]);
    assert.deepEqual(tooltipLines(env.helpers.fieldBonuses("system.attributes.defesa.bonus", { data: { root: { actor: { _id: "a1" } } } })), ["Força +1", "Total +1"]);
    // Unlinked token: same _id as a base actor without armor; the line follows the sheet's own (synthetic) actor.
    const base = makeActor();
    const baseData = Object.setPrototypeOf({ parent: base, pericias: {}, tracos: base.system.tracos }, env.Character.prototype);
    base.system = baseData;
    baseData.prepareSkill("luta", { skillData: { value: 1 }, rollData: {} });
    game.actors = { get: (id) => (id === "a1" ? base : undefined) };
    const tokenTip = (root) => tooltipLines(env.helpers.fieldBonuses("system.pericias.luta.bonus", { data: { root } }));
    assert.deepEqual(tokenTip({ actor: actor, uuid: "Scene.s.Token.t.Actor.a1" }), ["Força +1", "T20CP.NonProficiency.TooltipLabel -5", "Total -4"]);
    foundry.utils.fromUuidSync = (uuid) => (uuid === "Scene.s.Token.t.Actor.a1" ? actor : null);
    assert.deepEqual(tokenTip({ actor: { _id: "a1" }, uuid: "Scene.s.Token.t.Actor.a1" }), ["Força +1", "T20CP.NonProficiency.TooltipLabel -5", "Total -4"]);
    game.settings.get = (scope, key) => (key === "nonProficiencyRule" ? "off" : false);
    assert.deepEqual(tip("luta"), ["Força +1", "Total +1"]);
  } finally {
    teardown();
  }
});

test("rule off: wrappers return the original values", () => {
  const env = setup({ rule: "off" });
  try {
    const actor = makeActor({ armor: [{ name: "Cota de malha", tipo: "pesada", penalty: -2 }] });
    assert.deepEqual(skills(env, actor, ["atle"]), { atle: 10 });
    assert.equal(actor.effectCalls, 0);
  } finally {
    teardown();
  }
});

test("unrecognized system code: still installed, console warning and a GM notification when the rule is on", () => {
  const env = setup();
  try {
    assert.equal(env.warnings.length, 2);
    assert.match(env.warnings[0], /getAttackToHit not recognized/);
    assert.ok(env.hooks.ready?.length);
    env.hooks.ready.at(-1)();
    assert.equal(env.notifications.length, 1);
    assert.match(env.notifications[0], /getAttackToHit, prepareSkill/);
    const actor = makeActor();
    const item = Object.assign(Object.create(env.Item.prototype), { type: "arma", name: "Espada longa", isOwned: true, actor, system: { proficiencia: "marcial" } });
    assert.deepEqual(item.getAttackToHit().parts, ["@skill", "-5"]);
  } finally {
    teardown();
  }
});
