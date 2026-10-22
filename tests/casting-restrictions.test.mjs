import { test } from "node:test";
import assert from "node:assert/strict";
import { markCastFailed } from "../scripts/rules/cast-outcome.mjs";
import { markWrapper } from "../scripts/utils.mjs";
import {
  CAST_FLAG,
  activeSustainedCasts,
  castFromMessage,
  castHistory,
  castingConditionVerdict,
  dialogConditionBlock,
  executionDependsOnChoice,
  finalReaction,
  isReactionExecution,
  preUseConditionVerdict,
  validateCastingDialog,
  castsAfter,
  collectStampedEffects,
  concentrationCheck,
  createScanCache,
  effectSources,
  exceedsLimit,
  installCastingRestrictionsRule,
  isSpellCast,
  isSupersededCast,
  isSustainedSpell,
  markerSubject,
  parseSustainOrigin,
  pruneTimedMap,
  readCast,
  shouldWarn,
  stampSustainedCast,
  sustainedSpellCapacity
} from "../scripts/rules/casting-restrictions.mjs";

const MODULE_ID = "t20-community-patches";
const cast = (castId, casterUuid = "Actor.mago", spell = "Velocidade") => ({ castId, casterUuid, spell });
const sustained = (origin, flags = {}) => ({ name: "Velocidade", duration: { expiry: "sustainEnd" }, origin, flags });

/* -------------------------------------------- */
/*  Pure functions                              */
/* -------------------------------------------- */

test("isSpellCast and isSustainedSpell: spells and scrolls; sustained spells only", () => {
  assert.equal(isSpellCast({ type: "magia" }), true);
  assert.equal(isSpellCast({ type: "consumivel", system: { tipo: "scroll" } }), true);
  assert.equal(isSpellCast({ type: "consumivel", system: { tipo: "potion" } }), false);
  assert.equal(isSpellCast({ type: "poder" }), false);
  assert.equal(isSustainedSpell({ type: "magia", system: { duracao: { units: "sust" } } }), true);
  assert.equal(isSustainedSpell({ type: "poder", system: { duracao: { units: "sust" } } }), false);
  assert.equal(isSustainedSpell({ type: "magia", system: { duracao: { units: "scene" } } }), false);
  assert.equal(sustainedSpellCapacity(), 1);
  assert.equal(sustainedSpellCapacity({ manaFlow: true }), 2);
});

test("parseSustainOrigin and readCast reject malformed values", () => {
  assert.deepEqual(parseSustainOrigin("Actor.a.ActiveEffect.x"), { casterUuid: "Actor.a", markerId: "x" });
  for (const bad of ["Actor.a", "Actor.a.ActiveEffect.", "A.ActiveEffect.x.ActiveEffect.y", null]) assert.equal(parseSustainOrigin(bad), null);
  assert.equal(readCast({ casterUuid: "Actor.a" }), null);
  assert.equal(readCast({ castId: "c" }), null);
  assert.deepEqual(readCast({ castId: "c", casterUuid: "Actor.a" }), { castId: "c", casterUuid: "Actor.a", spell: "" });
});

test("stampSustainedCast: every sustained effect of the card, parent and child, with new flags objects", () => {
  const otherFlags = { tormenta20: { x: 1 } };
  const bonus = sustained("Actor.mago.ActiveEffect.m1", otherFlags);
  const child = sustained("Actor.mago.ActiveEffect.m1");
  const penalty = sustained("Actor.mago.ActiveEffect.m2");
  const turn = { duration: { expiry: "turnStart" }, origin: "Actor.mago.ActiveEffect.m3" };
  const region = sustained("Scene.s.Region.r.RegionBehavior.b");
  const entries = [[bonus, child], [penalty], [turn, region]];
  assert.equal(stampSustainedCast(entries, cast("c1")), 3);
  for (const effect of [bonus, child, penalty]) assert.deepEqual(effect.flags[MODULE_ID][CAST_FLAG], cast("c1"));
  assert.equal(bonus.flags.tormenta20.x, 1);
  assert.notEqual(bonus.flags, otherFlags);
  assert.equal(otherFlags[MODULE_ID], undefined);
  assert.equal(turn.flags, undefined);
  assert.equal(region.flags[MODULE_ID], undefined);
  assert.equal(stampSustainedCast(entries, { castId: "" }), 0);
  assert.equal(stampSustainedCast(undefined, cast("c1")), 0);
  assert.equal(stampSustainedCast([null, "x", [null]], cast("c1")), 0);
});

test("castFromMessage reads the stamp from any button with the server creation time", () => {
  const stamped = { flags: { [MODULE_ID]: { [CAST_FLAG]: cast("c1") } } };
  const message = { id: "m1", _stats: { createdTime: 50 }, flags: { tormenta20: { effects: [[{}], [stamped]] } } };
  assert.deepEqual(castFromMessage(message), { ...cast("c1"), messageId: "m1", createdTime: 50 });
  assert.equal(castFromMessage({ flags: {} }), null);
  assert.equal(castFromMessage({ flags: { tormenta20: { effects: [[{}]] } } }), null);
});

test("castHistory: one caster, publication order (id breaks ties), first message of a repeated cast", () => {
  const entry = (castId, createdTime, messageId, casterUuid) => ({ ...cast(castId, casterUuid), createdTime, messageId });
  const history = castHistory(
    [
      entry("late-start", 10, "b"), // started second, published first
      entry("early-start", 20, "a"),
      entry("tie", 20, "c"),
      entry("late-start", 30, "d"),
      entry("other", 5, "e", "Actor.outro")
    ],
    "Actor.mago"
  );
  assert.deepEqual(history.map((c) => [c.castId, c.messageId]), [["late-start", "b"], ["early-start", "a"], ["tie", "c"]]);
});

test("isSupersededCast and castsAfter: limit 1 and 2; unknown casts; ending the newer spell changes nothing", () => {
  const history = [cast("V"), cast("O")];
  assert.equal(isSupersededCast("V", history, 1), true);
  assert.deepEqual(castsAfter("V", history).map((c) => c.castId), ["O"]);
  assert.equal(isSupersededCast("O", history, 1), false);
  assert.equal(isSupersededCast("V", history, 2), false);
  assert.equal(isSupersededCast("V", [...history, cast("S")], 2), true);
  assert.equal(isSupersededCast("X", history, 1), false);
  assert.deepEqual(castsAfter("X", history), []);
});

test("markerSubject strips the marker prefix", () => {
  assert.equal(markerSubject("Sustentando (Oração (Bônus))"), "Oração (Bônus)");
  assert.equal(markerSubject("Sustentando"), "");
  assert.equal(markerSubject(undefined), "");
});

test("activeSustainedCasts groups by cast, owns markers by origin and flags look-alike markers as uncertain", () => {
  const effects = [
    { origin: "Actor.mago.ActiveEffect.m1", cast: cast("O", "Actor.mago", "Oração") },
    { origin: "Actor.mago.ActiveEffect.m2", cast: cast("O", "Actor.mago", "Oração") },
    { origin: "Actor.mago.ActiveEffect.m1", cast: cast("O", "Actor.mago", "Oração") },
    { origin: "Actor.outro.ActiveEffect.m9", cast: cast("X", "Actor.outro") },
    { origin: "Actor.outro.ActiveEffect.m8", cast: cast("Y", "Actor.mago") },
    { origin: "Actor.mago.ActiveEffect.m5", cast: cast("V", "Actor.mago", "Velocidade") } // applied by a player: no marker
  ];
  const markers = [
    { id: "m1", name: "Sustentando (Oração (Bônus))" },
    { id: "old", name: "Sustentando (Velocidade)" },
    { id: "aura", name: "Sustentando (Aura Sagrada)" }
  ];
  const { casts, uncertain } = activeSustainedCasts({ casterUuid: "Actor.mago", effects, markers, spellNames: ["Velocidade", "Oração"] });
  assert.deepEqual(casts, [
    { castId: "O", spell: "Oração", markerIds: ["m1", "m2"] },
    { castId: "V", spell: "Velocidade", markerIds: ["m5"] }
  ]);
  assert.deepEqual(uncertain, [{ id: "old", name: "Sustentando (Velocidade)" }]);
});

test("exceedsLimit: other casts and uncertain markers count; the cast itself does not", () => {
  const active = { casts: [{ castId: "V" }], uncertain: [] };
  assert.deepEqual(exceedsLimit(active, 1), [{ castId: "V" }]);
  assert.equal(exceedsLimit(active, 1, "V"), null);
  assert.equal(exceedsLimit(active, 2), null);
  assert.deepEqual(exceedsLimit({ casts: [], uncertain: [{ id: "old" }] }, 1, "O"), []);
});

test("shouldWarn and pruneTimedMap: same key once per window, bounded map", () => {
  const map = new Map();
  assert.equal(shouldWarn(map, "k", { now: 0 }), true);
  assert.equal(shouldWarn(map, "k", { now: 2999 }), false);
  assert.equal(shouldWarn(map, "k", { now: 3000 }), true);
  const big = new Map();
  for (let i = 0; i < 1000; i++) {
    shouldWarn(big, `k${i}`, { now: i });
    assert.ok(big.size <= 100);
  }
  pruneTimedMap(big, { now: 999 + 3000, ttl: 3000 });
  assert.equal(big.size, 0);
});

test("createScanCache: one build per generation and window; own creations keep the snapshot; bounded", () => {
  const cache = createScanCache();
  let builds = 0;
  const build = () => ({ n: ++builds, effects: [] });
  cache.get("A", build, 0);
  cache.get("A", build, 100);
  assert.equal(builds, 1);
  cache.invalidate();
  cache.get("A", build, 200);
  assert.equal(builds, 2);
  cache.noteCreated("A", { id: "e1" });
  const entry = cache.get("A", build, 300);
  assert.equal(builds, 2);
  assert.deepEqual(entry.effects, [{ id: "e1" }]);
  cache.noteCreated("B", { id: "e2" });
  cache.get("A", build, 400);
  assert.equal(builds, 3);
  cache.invalidate();
  cache.noteCreated("A", { id: "e3" }); // stale snapshot is not revived
  cache.get("A", build, 500);
  assert.equal(builds, 4);
  cache.get("A", build, 5000); // expired
  assert.equal(builds, 5);
  for (let i = 0; i < 150; i++) cache.get(`c${i}`, build, 6000);
  assert.ok(cache.size <= 100);
});

test("effectSources and collectStampedEffects never materialize lazy tokens and skip tombstones", () => {
  const stamp = { [MODULE_ID]: { [CAST_FLAG]: cast("V") } };
  const effect = sustained("Actor.mago.ActiveEffect.m1", stamp);
  let lazy = 0;
  const token = (source) => ({
    _source: source,
    get actor() {
      lazy++;
      return null;
    },
    get delta() {
      lazy++;
      return null;
    }
  });
  const scenes = [
    {
      tokens: [
        token({ actorLink: false, delta: { effects: [effect, { _id: "x", _tombstone: true }] } }),
        token({ actorLink: true, delta: { effects: [effect] } }),
        token({ actorLink: false, delta: null })
      ]
    }
  ];
  const fromTokens = collectStampedEffects(effectSources({ scenes }), "Actor.mago");
  const fromActors = collectStampedEffects(effectSources({ actors: [{ effects: [effect, { ...effect, duration: {} }] }] }), "Actor.mago");
  assert.equal(lazy, 0);
  assert.deepEqual(fromTokens, [{ origin: effect.origin, cast: cast("V") }]);
  assert.deepEqual(fromActors, fromTokens);
  assert.deepEqual(collectStampedEffects(effectSources({ scenes }), "Actor.outro"), []);
});

test("castingConditionVerdict: reactions under no-action conditions; Inconsciente, Petrificado, Paralisado; Magia Discreta", () => {
  assert.deepEqual(castingConditionVerdict({ statuses: ["atordoado"], activation: "action" }), { block: ["atordoado"], warn: [] });
  assert.deepEqual(castingConditionVerdict({ statuses: new Set(["atordoado"]), activation: "reaction" }), { block: [], warn: [] });
  assert.deepEqual(castingConditionVerdict({ statuses: ["pasmo", "fascinado", "surpreendido"], activation: "reaction" }), { block: [], warn: [] });
  assert.deepEqual(castingConditionVerdict({ statuses: ["inconsciente"], activation: "reaction" }).block, ["inconsciente"]);
  assert.deepEqual(castingConditionVerdict({ statuses: ["petrificado"], activation: "reaction" }).block, ["petrificado"]);
  assert.deepEqual(castingConditionVerdict({ statuses: ["paralisado"], activation: "reaction" }), { block: ["paralisado"], warn: [] });
  assert.deepEqual(castingConditionVerdict({ statuses: ["paralisado"], activation: "action", subtleSpell: true }), { block: [], warn: ["paralisado"] });
  assert.deepEqual(castingConditionVerdict({ statuses: ["caido", "abalado"], activation: "action" }), { block: [], warn: [] });
});

test("concentrationCheck: DC 15 + PM spent for Caído and Surdo", () => {
  assert.deepEqual(concentrationCheck({ statuses: ["caido"], manaCost: 6 }), { dc: 21, reasons: ["caido"] });
  assert.deepEqual(concentrationCheck({ statuses: new Set(["surdo", "caido"]), manaCost: 3 }), { dc: 18, reasons: ["caido", "surdo"] });
  assert.equal(concentrationCheck({ statuses: ["caido"], manaCost: null }).dc, 15);
  assert.equal(concentrationCheck({ statuses: ["abalado"], manaCost: 3 }), null);
});

/* -------------------------------------------- */
/*  Foundry integration (mocks)                 */
/* -------------------------------------------- */

let uid = 0;
const STATUS_NAMES = { atordoado: "Atordoado", paralisado: "Paralisado", inconsciente: "Inconsciente", caido: "Caído", surdo: "Surdo", pasmo: "Pasmo" };

function setupFoundry(modes = {}) {
  const settings = { UsageConfig: "default", sustainedSpellRule: "off", castingConditionRule: "off", concentrationRule: "off", ...modes };
  const hooks = {};
  const notes = { warn: [], error: [] };
  const created = [];
  const calls = { roll: [], display: [] };
  const actors = new Map();
  const messages = [];
  const sceneList = [];
  let sceneReads = 0;
  let clock = 0;
  const fire = (name, ...args) => (hooks[name] ?? []).map((fn) => fn(...args));

  class ItemT20 {
    _allApplicableOnUseEffects() {
      return this.useEffects ?? [];
    }
    clone() {
      return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    }
    async roll(...args) {
      calls.roll.push({ self: this, args });
      return "rolled";
    }
    async displayCard(config) {
      calls.display.push(config);
      if (this.failCast) {
        markCastFailed(config.options, { rule: "arcane-armor-casting", reason: "misticismo" });
        return null;
      }
      const flags = { tormenta20: { effects: config.options.effects } };
      if (config.createMessage === false) return { content: "card", flags };
      const message = { documentName: "ChatMessage", id: `m${++uid}`, _stats: { createdTime: ++clock }, flags: JSON.parse(JSON.stringify(flags)) };
      messages.push(message);
      fire("createChatMessage", message, {}, "u1");
      return message;
    }
  }

  globalThis.CONFIG = {
    Item: { documentClass: ItemT20 },
    statusEffects: Object.entries(STATUS_NAMES).map(([id, name]) => ({ id, name }))
  };
  globalThis.game = {
    get actors() {
      return [...actors.values()];
    },
    get scenes() {
      sceneReads++;
      return sceneList;
    },
    messages,
    settings: { get: (module, key) => settings[key], register() {} },
    i18n: {
      localize: (key) => key,
      format: (key, data) => `${key}${JSON.stringify(data)}`,
      getListFormatter: () => ({ format: (items) => [...items].join(" | ") })
    }
  };
  globalThis.ui = { notifications: { warn: (m) => notes.warn.push(m), error: (m) => notes.error.push(m) } };
  globalThis.Hooks = { on: (name, fn) => (hooks[name] ??= []).push(fn) };
  globalThis.ChatMessage = {
    getSpeaker: ({ actor }) => ({ alias: actor.name }),
    applyMode: (data, mode) => {
      data.mode = mode;
      return data;
    },
    create: async (data) => {
      created.push(data);
      return data;
    }
  };
  globalThis.foundry = {
    utils: {
      getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj),
      expandObject: (flat) => {
        const out = {};
        for (const [path, value] of Object.entries(flat)) {
          const keys = path.split(".");
          let node = out;
          for (const key of keys.slice(0, -1)) node = node[key] ??= {};
          node[keys.at(-1)] = value;
        }
        return out;
      },
      fromUuidSync: (uuid) => actors.get(uuid),
      randomID: () => `r${++uid}`,
      escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    }
  };
  installCastingRestrictionsRule();

  const makeActor = (name, { statuses = [], powers = [] } = {}) => {
    const actor = { name, uuid: `Actor.${name}-${++uid}`, statuses: new Set(statuses), effects: [], items: [] };
    for (const power of powers) actor.items.push({ type: "poder", name: power, _stats: {} });
    actors.set(actor.uuid, actor);
    return actor;
  };
  const makeItem = (actor, name, { type = "magia", units = "sust", execucao = "action", tipo } = {}) => {
    const item = Object.assign(new ItemT20(), { actor, name, type, system: { tipo, duracao: { units }, ativacao: { execucao } } });
    actor.items.push(item);
    return item;
  };
  /** The card options built by applyOnUseEffects for a sustained spell: one button per effect. */
  const useOptions = (item, buttons = [item.name], manaCost = 3) => ({
    manaCost,
    effects: buttons.map((name) => [{ name, duration: { expiry: item.system.duracao.units === "sust" ? "sustainEnd" : "scene" }, origin: `${item.actor.uuid}.ActiveEffect.${foundry.utils.randomID()}`, flags: {} }])
  });
  const castSpell = (item, { buttons, manaCost, rollMode = "gm", createMessage } = {}) =>
    item.displayCard({ options: useOptions(item, buttons, manaCost), rollMode, createMessage });
  /** _onChatCardApplyEffect: the GM's _preCreate creates the marker first, then the client's preCreate hook runs. */
  const apply = (message, index, target, { gm = true } = {}) => {
    const results = [];
    for (const raw of message.flags.tormenta20.effects[index]) {
      const data = JSON.parse(JSON.stringify(raw));
      if (gm) {
        const { casterUuid, markerId } = parseSustainOrigin(data.origin);
        const caster = actors.get(casterUuid);
        if (!caster.effects.some((e) => e.id === markerId)) {
          caster.effects.push({ id: markerId, name: `Sustentando (${data.name})`, statuses: new Set(["sustentando"]), flags: {}, duration: {} });
        }
      }
      results.push(...fire("preCreateActiveEffect", data, data, {}, "u1"));
      const doc = { ...data, id: `e${++uid}` };
      target.effects.push(doc);
      fire("createActiveEffect", doc, {}, "u1");
    }
    return results;
  };
  const endCast = (actor, spell) => {
    for (const a of actors.values()) a.effects = a.effects.filter((e) => e.flags?.[MODULE_ID]?.[CAST_FLAG]?.spell !== spell && e.name !== `Sustentando (${spell})`);
    fire("deleteActiveEffect", { duration: { expiry: "sustainEnd" }, flags: { [MODULE_ID]: { [CAST_FLAG]: { castId: "any", casterUuid: actor.uuid } } } });
  };
  return {
    settings, hooks, notes, created, calls, actors, messages, sceneList, fire, ItemT20, makeActor, makeItem, castSpell, apply, endCast, useOptions,
    get sceneReads() {
      return sceneReads;
    }
  };
}

test("roll: Bloquear stops the use before the original; Avisar warns and keeps this and the arguments", async () => {
  const env = setupFoundry({ castingConditionRule: "block" });
  const mago = env.makeActor("Mago", { statuses: ["atordoado"] });
  const fireball = env.makeItem(mago, "Bola de Fogo", { units: "inst" });
  assert.equal(await fireball.roll({ event: { shiftKey: true } }), undefined);
  assert.equal(env.calls.roll.length, 0);
  assert.equal(env.notes.error.length, 1);
  assert.match(env.notes.error[0], /Conditions\.Warning.*Atordoado/);
  assert.match(env.notes.error[0], /Conditions\.Blocked/);

  env.settings.castingConditionRule = "warn";
  const args = { event: { shiftKey: false }, createMessage: false };
  assert.equal(await fireball.roll(args), "rolled");
  assert.equal(env.calls.roll[0].self, fireball);
  assert.equal(env.calls.roll[0].args[0], args);
  assert.equal(env.notes.warn.length, 1);

  env.settings.castingConditionRule = "off";
  await fireball.roll({});
  assert.equal(env.notes.warn.length, 1);
});

test("roll: reactions pass under Atordoado; Inconsciente blocks them; Paralisado with Magia Discreta only warns; scrolls count", async () => {
  const env = setupFoundry({ castingConditionRule: "block" });
  const mago = env.makeActor("Mago", { statuses: ["atordoado"] });
  const shield = env.makeItem(mago, "Escudo da Fé", { units: "inst", execucao: "reaction" });
  await shield.roll({});
  assert.equal(env.calls.roll.length, 1);
  assert.deepEqual([env.notes.warn, env.notes.error], [[], []]);

  mago.statuses = new Set(["inconsciente"]);
  await shield.roll({});
  assert.equal(env.calls.roll.length, 1);

  const scroll = env.makeItem(mago, "Pergaminho", { type: "consumivel", tipo: "scroll", units: "inst" });
  await scroll.roll({});
  assert.equal(env.calls.roll.length, 1);
  const potion = env.makeItem(mago, "Poção", { type: "consumivel", tipo: "potion", units: "inst" });
  await potion.roll({});
  assert.equal(env.calls.roll.length, 2);

  const discreto = env.makeActor("Discreto", { statuses: ["paralisado"], powers: ["Magia Discreta"] });
  await env.makeItem(discreto, "Bola de Fogo", { units: "inst" }).roll({});
  assert.equal(env.calls.roll.length, 3);
  assert.match(env.notes.warn.at(-1), /Conditions\.Subtle/);
  assert.doesNotMatch(env.notes.warn.at(-1), /Blocked/);
});

const LABELS = ["Reação"];
const reactionEnh = (id, value = "reação", automatic = false) => ({ id, automatic, changes: [{ key: "execucao", type: "override", value }] });

test("execution: overrides as written in the compendium; the last applied override wins, override effects first", () => {
  for (const v of ["reaction", "reação", "reacao", " Reação "]) assert.equal(isReactionExecution(v, LABELS), true, v);
  for (const v of ["action", "Padrão", "ação padrão", "", undefined]) assert.equal(isReactionExecution(v, LABELS), false, String(v));

  const effects = [{ id: "pm", changes: [{ key: "custo", type: "add", value: "1" }] }, reactionEnh("cf")];
  assert.equal(finalReaction({ base: "action", effects, applied: { cf: { aplica: true } }, labels: LABELS }), true);
  assert.equal(finalReaction({ base: "action", effects, applied: { pm: { aplica: true } }, labels: LABELS }), false);
  const both = [reactionEnh("a", "Padrão"), reactionEnh("b")];
  assert.equal(finalReaction({ base: "reaction", effects: both, applied: { a: { aplica: 1 }, b: { aplica: 1 } } }), true);
  assert.equal(finalReaction({ base: "reaction", effects: both, applied: { a: { aplica: 1 } } }), false);

  assert.equal(executionDependsOnChoice({ base: "action", effects }), true);
  assert.equal(executionDependsOnChoice({ base: "action", effects: [reactionEnh("x", "ação completa")] }), false);
});

test("conditions with enhancements: deferred to the dialog only when the choice changes the execution", () => {
  const cf = [reactionEnh("cf")];
  const stunned = { statuses: ["atordoado"], base: "action", effects: cf, labels: LABELS };
  assert.deepEqual(preUseConditionVerdict({ ...stunned, dialog: true }), { block: [], warn: [], deferred: true });
  assert.deepEqual(preUseConditionVerdict({ ...stunned, dialog: false }).block, ["atordoado"]);
  assert.deepEqual(preUseConditionVerdict({ ...stunned, effects: [reactionEnh("cf", "reação", true)], dialog: false }).block, []);
  assert.deepEqual(preUseConditionVerdict({ ...stunned, statuses: ["inconsciente"], dialog: true }).block, ["inconsciente"]);

  assert.deepEqual(dialogConditionBlock({ ...stunned, applied: {} }), ["atordoado"]);
  assert.deepEqual(dialogConditionBlock({ ...stunned, applied: { cf: { aplica: true } } }), []);
  const shield = { statuses: ["atordoado"], base: "reaction", effects: [reactionEnh("p", "Padrão")], labels: LABELS };
  assert.deepEqual(dialogConditionBlock({ ...shield, applied: { p: { aplica: true } } }), ["atordoado"]);
  assert.deepEqual(dialogConditionBlock({ ...shield, applied: {} }), []);
  assert.deepEqual(dialogConditionBlock({ ...stunned, effects: [], applied: {} }), [], "no choice: checked before the dialog");
});

test("roll + dialog: Campo de Força under Atordoado opens the dialog; the submit blocks without the reaction enhancement", async () => {
  const env = setupFoundry({ castingConditionRule: "block" });
  const mago = env.makeActor("Mago", { statuses: ["atordoado"] });
  const field = env.makeItem(mago, "Campo de Força", { units: "cena" });
  field.useEffects = [{ id: "cf", system: { abilityUse: { automatic: false }, changes: [{ key: "execucao", type: "override", value: "reação" }] } }];

  await field.roll({ event: { shiftKey: false } });
  assert.equal(env.calls.roll.length, 1);
  assert.deepEqual(env.notes.error, []);

  const clone = { ...field, actor: mago, system: field.system, type: "magia", applicableOnUseEffects: field.useEffects };
  const refused = validateCastingDialog({ item: clone, formData: { "aprs.cf.aplica": false } });
  assert.equal(refused.block, true);
  assert.match(refused.message, /Atordoado.*Conditions\.Reaction.*Conditions\.Blocked/);
  assert.equal(validateCastingDialog({ item: clone, formData: { "aprs.cf.aplica": true } }), null);
  env.settings.castingConditionRule = "warn";
  assert.equal(validateCastingDialog({ item: clone, formData: {} }).block, false);
  env.settings.castingConditionRule = "block";

  await field.roll({ event: { shiftKey: true } });
  assert.equal(env.calls.roll.length, 1, "Shift skips the dialog: no reaction, blocked before");
  assert.match(env.notes.error[0], /Atordoado/);
});

test("roll: the execution follows the effects the roll offers, after the patches' filters (suppressed item)", async () => {
  const env = setupFoundry({ castingConditionRule: "block" });
  const original = env.ItemT20.prototype._allApplicableOnUseEffects;
  env.ItemT20.prototype._allApplicableOnUseEffects = markWrapper(function () {
    return original.call(this).filter((ef) => !ef.suppressed);
  }, original);
  const mago = env.makeActor("Mago", { statuses: ["atordoado"] });
  const fireball = env.makeItem(mago, "Bola de Fogo", { units: "inst" });
  const wand = { id: "w", suppressed: true, system: { abilityUse: { automatic: true }, changes: [{ key: "execucao", type: "override", value: "reação" }] } };
  fireball.useEffects = [wand];
  await fireball.roll({ event: { shiftKey: true } });
  await fireball.roll({ event: { shiftKey: false } });
  assert.equal(env.calls.roll.length, 0);
  assert.equal(env.notes.error.length, 2);

  wand.suppressed = false;
  await fireball.roll({ event: { shiftKey: true } });
  assert.equal(env.calls.roll.length, 1, "the automatic reaction enhancement applies");
});

test("sustained: casting a second spell warns with the first; abilities never count; nothing is ended", async () => {
  const env = setupFoundry({ sustainedSpellRule: "warn" });
  const mago = env.makeActor("Mago");
  const aliado = env.makeActor("Aliado");
  const velocidade = env.makeItem(mago, "Velocidade");
  const oracao = env.makeItem(mago, "Oração");
  env.apply(await env.castSpell(velocidade), 0, aliado);
  assert.deepEqual(env.notes.warn, []);
  await oracao.roll({});
  assert.equal(env.notes.warn.length, 1);
  assert.match(env.notes.warn[0], /Sustained\.Warning.*Sustained\.Held.*Velocidade/);
  assert.equal(aliado.effects.length, 1);

  const paladino = env.makeActor("Paladino");
  const aura = env.makeItem(paladino, "Aura Sagrada", { type: "poder" });
  env.apply(await env.castSpell(aura), 0, aliado);
  await env.makeItem(paladino, "Velocidade").roll({});
  assert.equal(env.notes.warn.length, 1);

  env.endCast(mago, "Velocidade");
  await oracao.roll({});
  assert.equal(env.notes.warn.length, 1);
});

test("sustained: a superseded card warns as such; the newer one warns the limit; both effects are created", async () => {
  const env = setupFoundry({ sustainedSpellRule: "warn" });
  const mago = env.makeActor("Mago");
  const aliado = env.makeActor("Aliado");
  const velocidade = await env.castSpell(env.makeItem(mago, "Velocidade"));
  const oracao = await env.castSpell(env.makeItem(mago, "Oração"));
  const results = env.apply(velocidade, 0, aliado);
  assert.match(env.notes.warn[0], /Sustained\.Stale.*Oração/);
  results.push(...env.apply(oracao, 0, aliado));
  assert.match(env.notes.warn[1], /Sustained\.Apply.*Velocidade/);
  assert.equal(aliado.effects.length, 2);
  assert.ok(results.every((r) => r === undefined));

  env.endCast(mago, "Oração");
  const count = env.notes.warn.length;
  const realNow = Date.now;
  try {
    const t = realNow() + 10_000; // past the dedup window of the first stale warning
    Date.now = () => t;
    env.apply(velocidade, 0, env.makeActor("Outro"));
  } finally {
    Date.now = realNow;
  }
  assert.equal(env.notes.warn.length, count + 1);
  assert.match(env.notes.warn.at(-1), /Sustained\.Stale/);
});

test("sustained: Fluxo de Mana keeps two; the third warns and supersedes the first card", async () => {
  const env = setupFoundry({ sustainedSpellRule: "warn" });
  const mago = env.makeActor("Mago", { powers: ["Fluxo de Mana"] });
  const aliado = env.makeActor("Aliado");
  const velocidade = await env.castSpell(env.makeItem(mago, "Velocidade"));
  env.apply(velocidade, 0, aliado);
  const oracao = env.makeItem(mago, "Oração");
  await oracao.roll({});
  env.apply(await env.castSpell(oracao), 0, aliado);
  assert.deepEqual(env.notes.warn, []);
  const silencio = env.makeItem(mago, "Silêncio");
  await silencio.roll({});
  assert.match(env.notes.warn[0], /"capacity":2/);
  await env.castSpell(silencio);
  env.apply(velocidade, 0, env.makeActor("Outro"));
  assert.match(env.notes.warn.at(-1), /Sustained\.Stale/);
});

test("sustained: one cast is one spell, one warning for many targets, and the GM's own marker is not uncertain", async () => {
  const env = setupFoundry({ sustainedSpellRule: "warn" });
  const mago = env.makeActor("Mago");
  const oracao = await env.castSpell(env.makeItem(mago, "Oração"), { buttons: ["Oração (Bônus)", "Oração (Penalidade)"] });
  env.apply(oracao, 0, env.makeActor("Aliado"));
  env.apply(oracao, 1, env.makeActor("Inimigo"));
  env.apply(oracao, 0, env.makeActor("A2"));
  assert.deepEqual(env.notes.warn, []);

  const velocidade = await env.castSpell(env.makeItem(mago, "Velocidade"));
  for (const name of ["T1", "T2", "T3"]) env.apply(velocidade, 0, env.makeActor(name));
  assert.equal(env.notes.warn.length, 1);
  assert.match(env.notes.warn[0], /Sustained\.Apply/);
  assert.match(env.notes.warn[0], /Sustained\.Held.*Oração/);
  assert.doesNotMatch(env.notes.warn[0], /Uncertain/);
});

test("sustained: effects applied by a player, without the GM, still count", async () => {
  const env = setupFoundry({ sustainedSpellRule: "warn" });
  const mago = env.makeActor("Mago");
  env.apply(await env.castSpell(env.makeItem(mago, "Velocidade")), 0, env.makeActor("Aliado"), { gm: false });
  assert.equal(mago.effects.length, 0);
  env.apply(await env.castSpell(env.makeItem(mago, "Oração")), 0, env.makeActor("Aliado2"), { gm: false });
  assert.match(env.notes.warn[0], /Sustained\.Apply.*Velocidade/);
});

test("sustained: unstamped markers named after a sustained spell are reported apart", async () => {
  const env = setupFoundry({ sustainedSpellRule: "warn" });
  const mago = env.makeActor("Mago");
  env.makeItem(mago, "Velocidade");
  const oracao = env.makeItem(mago, "Oração");
  mago.effects.push({ id: "old", name: "Sustentando (Velocidade)", statuses: new Set(["sustentando"]) });
  await oracao.roll({});
  assert.match(env.notes.warn[0], /Sustained\.Uncertain.*Sustentando \(Velocidade\)/);
  assert.doesNotMatch(env.notes.warn[0], /Sustained\.Held/);

  env.apply(await env.castSpell(env.makeItem(mago, "Silêncio")), 0, env.makeActor("Aliado"));
  await oracao.roll({});
  assert.match(env.notes.warn.at(-1), /Sustained\.Held.*Silêncio.*Sustained\.Uncertain/);
});

test("sustained: one scan per application, without touching lazy tokens; invalidation by messages, scenes and updates", async () => {
  const env = setupFoundry({ sustainedSpellRule: "warn" });
  const mago = env.makeActor("Mago");
  let lazy = 0;
  const lazyToken = (source) => ({
    _source: source,
    get actor() {
      lazy++;
      return null;
    },
    get delta() {
      lazy++;
      return null;
    }
  });
  for (let i = 0; i < 3; i++) env.sceneList.push({ tokens: [lazyToken({ actorLink: false, delta: { effects: [] } })] });

  const velocidadeItem = env.makeItem(mago, "Velocidade");
  const oracao = await env.castSpell(env.makeItem(mago, "Oração"), { buttons: ["Bônus", "Penalidade"] });
  const before = env.sceneReads;
  for (const name of ["T1", "T2", "T3"]) {
    const target = env.makeActor(name);
    env.apply(oracao, 0, target);
    env.apply(oracao, 1, target);
  }
  assert.equal(env.sceneReads - before, 1);
  assert.equal(lazy, 0);
  assert.deepEqual(env.notes.warn, []);

  // A new scene with an unlinked token that holds a stamped Velocidade: only createScene fires.
  const velocidade = await env.castSpell(velocidadeItem);
  const stamped = JSON.parse(JSON.stringify(velocidade.flags.tormenta20.effects[0][0]));
  env.messages.length = 0; // the chat was cleared: no history, only the limit
  env.fire("deleteChatMessage", {});
  env.apply(oracao, 0, env.makeActor("T0"));
  assert.deepEqual(env.notes.warn, []);
  env.sceneList.push({ tokens: [lazyToken({ actorLink: false, delta: { effects: [stamped] } })] });
  env.fire("createScene", {});
  env.apply(oracao, 0, env.makeActor("T4"));
  assert.match(env.notes.warn[0], /Sustained\.Apply.*Velocidade/);

  // The token effect loses its stamp: updateActiveEffect invalidates and it stops counting.
  delete stamped.flags[MODULE_ID];
  env.fire("updateActiveEffect", stamped, {});
  const realNow = Date.now;
  try {
    const t = realNow() + 10_000; // past the warning window
    Date.now = () => t;
    env.apply(oracao, 0, env.makeActor("T5"));
  } finally {
    Date.now = realNow;
  }
  assert.equal(env.notes.warn.length, 1);
  assert.equal(lazy, 0);
});

test("sustained: reapplying an older card after a newer cast inside the window sees the new history", async () => {
  const env = setupFoundry({ sustainedSpellRule: "warn" });
  const mago = env.makeActor("Mago");
  const velocidade = await env.castSpell(env.makeItem(mago, "Velocidade"));
  env.apply(velocidade, 0, env.makeActor("Aliado"));
  env.apply(await env.castSpell(env.makeItem(mago, "Oração")), 0, env.makeActor("Aliado2"));
  env.apply(velocidade, 0, env.makeActor("Aliado3"));
  assert.match(env.notes.warn.at(-1), /Sustained\.Stale.*Oração/);
});

test("displayCard: stamps only real uses (also with the rule off); 'Mostrar no Chat' keeps the system's options", async () => {
  const env = setupFoundry();
  const mago = env.makeActor("Mago");
  const velocidade = env.makeItem(mago, "Velocidade");
  const message = await env.castSpell(velocidade);
  const stamp = message.flags.tormenta20.effects[0][0].flags[MODULE_ID][CAST_FLAG];
  assert.equal(stamp.casterUuid, mago.uuid);
  assert.equal(stamp.spell, "Velocidade");
  const options = { itemId: "i1" };
  await velocidade.displayCard({ options });
  assert.deepEqual(options, { itemId: "i1" });
});

test("concentration: real published uses only, in the card's roll mode, never on failure or without a message", async () => {
  const env = setupFoundry({ concentrationRule: "warn" });
  const mago = env.makeActor("Mago <b>", { statuses: ["caido"] });
  const fireball = env.makeItem(mago, "Bola de Fogo", { units: "inst" });

  await fireball.displayCard({ options: { itemId: "i1", manaCost: 3 } });
  assert.equal(env.created.length, 0);

  await env.castSpell(fireball, { manaCost: 3, rollMode: "gm" });
  assert.equal(env.created.length, 1);
  assert.match(env.created[0].content, /Concentration\.Message.*"dc":18/);
  assert.match(env.created[0].content, /Mago &lt;b&gt;/);
  assert.equal(env.created[0].mode, "gm");

  const options = env.useOptions(fireball, [], 3);
  const data = await fireball.displayCard({ options, createMessage: false });
  assert.equal(env.created.length, 1);
  assert.equal(data.content, "card");

  fireball.failCast = true;
  assert.equal(await env.castSpell(fireball), null);
  assert.equal(env.created.length, 1);
  fireball.failCast = false;

  mago.statuses = new Set();
  await env.castSpell(fireball);
  env.settings.concentrationRule = "off";
  mago.statuses = new Set(["surdo"]);
  await env.castSpell(fireball);
  assert.equal(env.created.length, 1);
});
