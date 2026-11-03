/**
 * Composition order of every wrapper (#84): imports scripts/main.mjs over a minimal fake Foundry, fires "init" with
 * every patch forced on, and compares api.wraps() with tests/fixtures/wrap-order.json.
 *
 * The fake classes answer any method name with a no-op function, so each apply() finds what it wraps, and declare their
 * own members where the Tormenta20 1.6.6 bundle does. Any error, unexpected warning or patch in "error" fails the test (a partial
 * install would hide chains); the patches applied without any wrapper are listed in `noWraps`
 * (hooks or accessors only), and `status` keeps the state of every patch and rule. The patches that recognize the system's code first get the verbatim sources the other
 * tests already use. Regenerate with `UPDATE_WRAP_ORDER=1 node --test tests/wrap-order.test.mjs`, or in a real world with
 * `copy(JSON.stringify(game.modules.get("t20-community-patches").api.wraps()))`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

import { CreatureData165 } from "./fixtures/non-proficiency-1.6.5.mjs";
import { ON_DELETE, ON_UPDATE, PRE_CREATE } from "./fixtures/initial-class-1.6.5.mjs";
import { fieldBonuses165 } from "./fixtures/field-bonuses-1.6.5.mjs";
import { PARSE_DATA_1_6_5 } from "./fixtures/bestiary-parser-1.6.5.mjs";
import { APPLY_DAMAGE_V2 } from "./fixtures/apply-damage-v2-1.6.5.mjs";
import { Item166 } from "./fixtures/non-proficiency-1.6.6.mjs";
import { SYSTEM_FORMULA } from "../scripts/patches/initiative-tiebreak.mjs";

const FIXTURE = new URL("./fixtures/wrap-order.json", import.meta.url);
const SYSTEM = JSON.parse(
  readFileSync(new URL("../module.json", import.meta.url), "utf8")
).relationships.systems.find((s) => s.id === "tormenta20");

// Foundry v14 Combat#_sortCombatants (client/documents/combat.mjs:569-573), recognized by initiative-tiebreak.
const CORE_SORT = new Function(`return ({ _sortCombatants(a, b) {
    const ia = Number.isNumeric(a.initiative) ? a.initiative : -Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : -Infinity;
    return (ib - ia) || (a.id > b.id ? 1 : -1);
  } })._sortCombatants;`)();

// StatblockParser#parseData 1.6.5 up to the end of the type block (what bestiary-creature-type recognizes), closed.
const PARSE_DATA = new Function(`return ({ ${PARSE_DATA_1_6_5}\t} }).parseData;`)();

const APPLY_DAMAGE = new Function(`return ({ ${APPLY_DAMAGE_V2} }).applyDamageV2;`)();

/**
 * Warnings that only switch off behavior at run time, never a wrapper: the wrapper is installed anyway and there is
 * no verbatim source in tests/fixtures for what it checks. Any other warning fails the test.
 */
const EXPECTED_WARNINGS = [
  /ongoing-damage-conditions: _manageDOTEffects not recognized; the conditions are left to the system$/,
  /save-skill-bonus: no save shows the bug; nothing to fix$/,
  /nonlethal-damage: ActorT20 damage methods not recognized; the chat toggle is disabled$/
];

const SKIP = new Set(["then", "constructor", "toJSON", "valueOf", "toString", "prototype", "name", "length"]);
const noop = function () {};

/** Answers any missing method name with a no-op, so each apply() finds what it wraps. */
function vivify(target) {
  return new Proxy(target, {
    get(obj, key, receiver) {
      if (typeof key === "symbol" || SKIP.has(key) || key in obj) return Reflect.get(obj, key, receiver);
      return noop;
    }
  });
}

/**
 * A named class. Without `Base` it is a root whose prototype and statics answer any method; `own` and `getters` are
 * defined on the class itself, as the system does, for the patches that look for the class that owns a member.
 */
function stubClass(name, Base, { own = [], getters = [] } = {}) {
  let cls = Base ? { [name]: class extends Base {} }[name] : { [name]: class {} }[name];
  for (const key of own) cls.prototype[key] = function () {};
  for (const key of getters) Object.defineProperty(cls.prototype, key, { get() { return undefined; }, configurable: true });
  if (!Base) {
    Object.setPrototypeOf(cls.prototype, vivify(Object.prototype));
    cls = vivify(cls);
  }
  return cls;
}

/** Deep object that answers any key with another such object (settings, i18n, ui…), callable as a no-op. */
function anything() {
  const target = function () {};
  return new Proxy(target, {
    get(obj, key) {
      if (key === "then" || typeof key === "symbol") return undefined;
      if (!Object.hasOwn(obj, key) || key === "name" || key === "length") obj[key] = anything();
      return obj[key];
    },
    apply: () => undefined
  });
}

function setup() {
  const hooks = new Map();
  const make = stubClass;

  // Patches that recognize the system's code before wrapping get the verbatim 1.6.5 sources of the other tests.
  const helpers = { fieldBonuses: fieldBonuses165 };
  globalThis.Handlebars = { helpers, registerHelper: (n, fn) => (helpers[n] = fn) };
  globalThis.Hooks = {
    on: (name, fn) => hooks.set(name, [...(hooks.get(name) ?? []), fn]),
    once: (name, fn) => hooks.set(name, [...(hooks.get(name) ?? []), fn]),
    call: () => true,
    callAll: () => true
  };

  const Actor = make("Actor");
  const Item = make("Item");
  const ActiveEffect = make("ActiveEffect", undefined, { getters: ["isSuppressed", "isExpiryTrackable"] });
  const Combat = make("Combat", undefined, { own: ["_sortCombatants"] });
  Combat.prototype._sortCombatants = CORE_SORT;
  const Combatant = make("Combatant");
  const ChatMessage = make("ChatMessage");
  const ActiveEffectT20 = make("ActiveEffectT20", ActiveEffect, { getters: ["isSuppressed"] });

  // Own members as declared in the Tormenta20 1.6.6 bundle: the loops over data models only wrap a model that
  // declares prepareDerivedData itself (Object.hasOwn), and the lookups walk up to the class that declares a method.
  const prepare = ["prepareBaseData", "prepareDerivedData"];
  const TypeData = make("Tormenta20TypeData", undefined, { own: prepare });
  const CreatureData = make("CreatureData", TypeData, { own: ["prepareSkill", "prepareAtributos"] });
  CreatureData.prototype.prepareSkill = CreatureData165.prototype.prepareSkill;
  const ItemData = make("Tormenta20ItemData", TypeData, { own: [...prepare, "prepareFinalAttributes"] });
  const IdentityData = make("IdentityData", ItemData);
  const element = new Map();
  const ElementField = make("StringField");
  CreatureData.schema = {
    getField: (path) => {
      if (!element.has(path)) element.set(path, { element: new ElementField() });
      return element.get(path);
    }
  };

  const ActorT20 = make("ActorT20", Actor, { getters: ["modifiedFields"] });
  ActorT20.prototype.applyDamageV2 = APPLY_DAMAGE;
  const ItemT20 = new Function("Item", `return class ItemT20 extends Item {
${PRE_CREATE}
${ON_UPDATE}
${ON_DELETE}
}`)(Item);
  ItemT20.prototype.getAttackToHit = Item166.prototype.getAttackToHit;

  const CONFIG = {
    Actor: { documentClass: ActorT20, dataModels: {
      bases: make("BasesData", TypeData, { own: ["prepareDerivedData"] }),
      character: make("CharacterData", CreatureData, { own: prepare }),
      npc: make("MenaceData", CreatureData, { own: prepare }),
      simple: make("SimpleData", CreatureData, { own: prepare }),
      hazard: make("HazardData", TypeData)
    } },
    Item: { documentClass: ItemT20, dataModels: {
      arma: make("WeaponData", ItemData),
      classe: make("ClassData", IdentityData, { own: ["prepareDerivedData"] }),
      consumivel: make("ConsumableData", ItemData),
      equipamento: make("EquipmentData", ItemData),
      magia: make("SpellData", ItemData),
      poder: make("PowerData", ItemData),
      race: make("RaceData", IdentityData)
    } },
    ActiveEffect: { documentClass: ActiveEffectT20, dataModels: { base: make("BaseEffect", make("ActiveEffectTypeDataModel"), { own: prepare, getters: ["isSuppressed", "isSuppressedByImunity"] }) } },
    Token: { documentClass: make("TokenDocumentT20", make("TokenDocument")), dataModels: {} },
    ChatMessage: { documentClass: make("ChatMessageT20", ChatMessage), dataModels: {} },
    Combat: { documentClass: make("CombatT20", Combat), dataModels: {}, initiative: { formula: SYSTEM_FORMULA } },
    Combatant: { documentClass: make("CombatantT20", Combatant), dataModels: {} },
    statusEffects: [],
    T20: { pericias: {}, conditions: {}, atributos: {}, resistencias: {}, creatureTypes: {}, creatureRoles: {},
      actorSizes: {}, sizeModifiers: {}, movementTypes: {}, xpPorNivel: {} }
  };
  globalThis.CONFIG = CONFIG;

  const settings = { patches: null };
  const modules = new Map([["t20-community-patches", { id: "t20-community-patches", relationships: { systems: [] } }]]);
  const lazy = (obj) => new Proxy(obj, { get: (o, key) => (key in o || typeof key === "symbol" ? o[key] : (o[key] = anything())) });
  globalThis.game = lazy({
    system: { id: "tormenta20", version: SYSTEM.compatibility.verified, title: "Tormenta20" },
    modules,
    user: { isGM: true, isActiveGM: true },
    settings: lazy({
      menus: new Map(),
      settings: new Map([["tormenta20.segmentedScene", { config: true, type: Object }]]),
      get: (m, key) => settings[key]
    })
  });

  const ActorSheet = make("ActorSheet");
  const ActorSheetT20 = make("ActorSheetT20", ActorSheet, { own: ["getData", "_onDragStart"] });
  globalThis.foundry = lazy({
    utils: anything(),
    data: { fields: new Proxy({ DataField: make("DataField") }, { get: (o, key) => (o[key] ??= make(String(key))) }), operators: {} },
    documents: { Item, Actor, Combat, Combatant, ActiveEffect, ChatMessage },
    dice: { Roll: make("Roll") },
    appv1: { sheets: { ActorSheet } },
    applications: {
      api: { ApplicationV2: class ApplicationV2 {}, HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2: anything() },
      ux: anything()
    }
  });

  const StatblockParser = make("StatblockParser", make("FormApplication"), { own: ["getData"] });
  StatblockParser.prototype.parseData = PARSE_DATA;
  globalThis.tormenta20 = {
    entities: { ActiveEffectT20 },
    documents: { ActiveEffectT20 },
    dice: { simplifyRollFormula: (formula) => formula },
    applications: {
      AbilityUseDialog: make("AbilityUseDialog", make("Dialog"), { own: ["_onInputChange"] }),
      StatblockParser,
      ActorSheetT20Character: make("ActorSheetT20Character", ActorSheetT20, { own: ["getData"] })
    }
  };
  globalThis.ui = anything();
  return { hooks, settings, modules };
}

async function installAll() {
  const { hooks, settings, modules } = setup();
  const { PATCHES } = await import("../scripts/patches/index.mjs");
  settings.patches = Object.fromEntries(PATCHES.map((p) => [p.id, "force"]));
  const errors = [];
  const warnings = [];
  const error = console.error;
  const log = console.log;
  const warn = console.warn;
  console.error = (...args) => errors.push(args.map((a) => a?.message ?? String(a)).join(" "));
  console.log = noop;
  console.warn = (...args) => warnings.push(args.map((a) => a?.message ?? String(a)).join(" "));
  try {
    await import("../scripts/main.mjs");
    for (const fn of hooks.get("init") ?? []) fn();
  } finally {
    console.error = error;
    console.log = log;
    console.warn = warn;
  }
  const api = modules.get("t20-community-patches").api;
  const list = api.wraps();
  const owners = new Set(list.flatMap((w) => w.owners));
  const skipped = api.status.filter((s) => s.state === "error").map((s) => ({ id: s.id, reason: s.reason }));
  // Patches only: the rules without wrappers (hooks only) and death-threshold-floor (owner death-threshold) are not listed.
  const noWraps = api.status.filter((s) => s.kind === "patch" && s.state !== "error" && !owners.has(s.id)).map((s) => s.id);
  // Baseline of api.status (#87): moving code between lib, services and features must not change any state.
  const status = api.status.map(({ id, kind, group, mode, state }) => JSON.parse(JSON.stringify({ id, kind, group, mode, state })));
  return { wraps: list, skipped, noWraps, status, errors, warnings };
}

test("api.wraps lists every wrapper chain in the order the patches and rules compose them", async () => {
  const actual = await installAll();
  // A warning or an error means a patch or rule installed only part of its wrappers (code not recognized, target
  // missing…), so the snapshot would silently miss chains.
  assert.deepEqual(actual.errors, []);
  const unexpected = actual.warnings.filter((w) => !EXPECTED_WARNINGS.some((re) => re.test(w)));
  assert.deepEqual(unexpected, []);
  assert.deepEqual(actual.skipped, []);
  const chain = (label) => actual.wraps.filter((w) => w.label === label).map((w) => w.owners);
  assert.deepEqual(chain("BasesData#prepareDerivedData"), [["armor-penalty-reduction", "source-stacking"]]);
  assert.deepEqual(chain("StatblockParser#parseData"), [["bestiary-creature-type"]]);
  const snapshot = { wraps: actual.wraps, noWraps: actual.noWraps, status: actual.status };
  if (process.env.UPDATE_WRAP_ORDER) writeFileSync(FIXTURE, `${JSON.stringify(snapshot, null, 2)}\n`);
  const expected = JSON.parse(readFileSync(FIXTURE, "utf8"));
  assert.deepEqual(snapshot, expected);
});
