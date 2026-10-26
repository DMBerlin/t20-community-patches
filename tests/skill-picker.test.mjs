import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ActorQueue,
  PICKER_OPERATION,
  PICKER_SPECS,
  buildTrainingEffects,
  eligibleSkills,
  findPickerSpec,
  hasTrainingEffect,
  installSkillPickerRule,
  isPickerDone,
  isValidSelection,
  pendingTrainedSkills,
  selectionLimits,
  stalePicks
} from "../scripts/rules/skill-picker.mjs";

const MODULE_ID = "t20-community-patches";
const spec = (id) => PICKER_SPECS.find((s) => s.id === id);
const TP = spec("Vt6W9YWlxtGrZlUH");
const VERSATIL = spec("9QQnUgUh5ThF96Cd");
const MEMORIA = spec("Wj1J9EBK9tOe2hkz");
const ENCICLOPEDICO = spec("jjQgutXSxMtBrMWA");
const NOBRE = spec("QXK4T9fN4SGYyRph");
const PACK = "Compendium.tormenta20.poderes.Item.";

/* -------------------------------------------- */
/*  Pure functions                              */
/* -------------------------------------------- */

test("findPickerSpec: compendium source, flags.core.sourceId, race grant id and name", () => {
  assert.equal(findPickerSpec({ type: "poder", name: "x", _stats: { compendiumSource: `${PACK}Vt6W9YWlxtGrZlUH` } }), TP);
  assert.equal(findPickerSpec({ type: "poder", name: "x", flags: { core: { sourceId: `${PACK}jjQgutXSxMtBrMWA` } } }), ENCICLOPEDICO);
  assert.equal(findPickerSpec({ type: "poder", name: "x", _id: "9QQnUgUh5ThF96Cd" }), VERSATIL);
  assert.equal(findPickerSpec({ type: "poder", name: " versatil ", _id: "other" }), VERSATIL);
  assert.equal(findPickerSpec({ type: "poder", name: "MEMÓRIA PÓSTUMA" }), MEMORIA);
  assert.equal(findPickerSpec({ type: "magia", name: "Versátil" }), null);
  assert.equal(findPickerSpec({ type: "poder", name: "Versatilidade" }), null);
  assert.equal(findPickerSpec(undefined), null);
});

test("hasTrainingEffect and isPickerDone", () => {
  const v14 = { effects: [{ system: { changes: [{ key: "system.pericias.luta.treinado" }] } }] };
  const legacy = { effects: [{ changes: [{ key: "system.pericias.luta.treinado" }] }] };
  const bonus = { effects: [{ system: { changes: [{ key: "system.pericias.luta.bonus" }] } }] };
  assert.equal(hasTrainingEffect(v14), true);
  assert.equal(hasTrainingEffect(legacy), true);
  assert.equal(hasTrainingEffect(bonus), false);
  assert.equal(hasTrainingEffect({}), false);
  assert.equal(isPickerDone({ flags: { [MODULE_ID]: { skillPicker: { done: true, skills: [] } } } }), true);
  assert.equal(isPickerDone({ effects: [] }), false);
  assert.equal(isPickerDone(v14), true);
});

test("pendingTrainedSkills: active transfer effects that set a skill as trained", () => {
  const change = (skill, value = true) => ({ key: `system.pericias.${skill}.treinado`, value });
  const sources = [
    { effects: [{ transfer: true, system: { changes: [change("luta")] } }] },
    { effects: [{ changes: [change("atle", "true")] }] },
    { effects: [{ transfer: false, system: { changes: [change("perc")] } }] },
    { effects: [{ disabled: true, system: { changes: [change("inic")] } }] },
    { effects: [{ transfer: true, system: { onuse: true, changes: [change("acro")] } }] },
    { effects: [{ system: { changes: [change("vont", false), { key: "system.pericias.furt.bonus", value: true }] } }] },
    {}
  ];
  assert.deepEqual(pendingTrainedSkills(sources), ["luta", "atle"]);
  assert.deepEqual(pendingTrainedSkills(undefined), []);
});

test("ActorQueue: FIFO per key, independent keys, idempotent release", async () => {
  const queue = new ActorQueue();
  const releaseA = await queue.acquire("A");
  assert.equal(queue.isBusy("A"), true);
  let second = false;
  const pending = queue.acquire("A").then((release) => ((second = true), release));
  const releaseB = await queue.acquire("B");
  releaseB();
  await new Promise(setImmediate);
  assert.equal(second, false);
  releaseA();
  releaseA();
  const releaseA2 = await pending;
  assert.equal(second, true);
  assert.equal(queue.isBusy("A"), true);
  releaseA2();
  assert.equal(queue.isBusy("A"), false);
  assert.equal(queue.isBusy("B"), false);
});

test("eligibleSkills: untrained, not reserved, filtered, sorted by label", () => {
  const config = {
    acro: { abl: "des", label: "Acrobacia" },
    alqu: { abl: "int", label: "Ofício (Alquimista)", crafting: true },
    conh: { abl: "int", label: "Conhecimento" },
    dipl: { abl: "car", label: "Diplomacia" },
    luta: { abl: "for", label: "Luta" },
    mist: { abl: "int", label: "Misticismo" },
    ofic: { abl: "int", label: "Ofício" },
    alfa: { abl: "sab", label: "Ofício (Alfaiate)", crafting: true }
  };
  const pericias = {
    acro: {}, alqu: {}, conh: {}, dipl: {}, luta: {}, mist: { treinado: true }, ofic: {}, alfa: {},
    ofi1: { label: "Ofício (Vidreiro)", atributo: "des" },
    _pc1: { label: "Herbalismo", atributo: "int" }
  };
  const all = eligibleSkills(pericias, TP, config);
  assert.deepEqual(all.map((o) => o.key), ["acro", "conh", "dipl", "_pc1", "luta", "alfa", "alqu", "ofi1"]);
  assert.equal(all.find((o) => o.key === "ofi1").label, "Ofício (Vidreiro)");
  assert.deepEqual(eligibleSkills(pericias, TP, config, (t) => t, new Set(["luta"])).some((o) => o.key === "luta"), false);
  assert.deepEqual(eligibleSkills({ ...pericias, mist: {} }, ENCICLOPEDICO, config).map((o) => o.key), ["conh", "_pc1", "mist", "alqu"]);
  assert.deepEqual(eligibleSkills(pericias, NOBRE, config).map((o) => o.key), ["conh", "dipl", "luta", "alfa", "alqu", "ofi1"]);
  const localized = eligibleSkills({ luta: {} }, TP, { luta: { label: "T20.Luta" } }, (t) => `L:${t}`);
  assert.equal(localized[0].label, "L:T20.Luta");
});

test("selectionLimits, isValidSelection and stalePicks", () => {
  assert.deepEqual(selectionLimits(VERSATIL, 5), { min: 1, max: 2 });
  assert.deepEqual(selectionLimits(ENCICLOPEDICO, 1), { min: 1, max: 1 });
  assert.equal(selectionLimits(TP, 0).max, 0);
  const versatil = selectionLimits(VERSATIL, 5);
  assert.equal(isValidSelection(0, versatil), false);
  assert.equal(isValidSelection(3, versatil), false);
  assert.equal(isValidSelection(1, versatil), true);
  assert.equal(isValidSelection(0, selectionLimits(MEMORIA, 5)), true);
  assert.deepEqual(stalePicks(["luta", "atle"], [{ key: "atle" }]), ["luta"]);
  assert.deepEqual(stalePicks(["atle"], [{ key: "atle" }]), []);
});

test("buildTrainingEffects copies the shape of the system's _applyTreinado", () => {
  let n = 0;
  const effects = buildTrainingEffects(["luta", "atle"], { img: "i.png", labelOf: (k) => k.toUpperCase(), randomID: () => `id${n++}` });
  assert.equal(effects.length, 2);
  assert.deepEqual(effects[0], {
    _id: "id0",
    name: "LUTA",
    img: "i.png",
    disabled: false,
    transfer: true,
    system: { changes: [{ key: "system.pericias.luta.treinado", type: "override", value: true, priority: 20 }] },
    flags: { tormenta20: { autoTrainedPericia: true }, [MODULE_ID]: { skillPicker: true } }
  });
  assert.equal(effects[1]._id, "id1");
});

/* -------------------------------------------- */
/*  Integration with a v14-like backend          */
/* -------------------------------------------- */

const tick = () => new Promise(setImmediate);
async function until(cond, label = "condition") {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await tick();
  }
  throw new Error(`timeout waiting for ${label}`);
}

const SKILLS = ["luta", "atle", "perc", "inic", "vont"];

/**
 * Fresh Foundry-like environment: Document.createDocuments → backend (per-document _preCreate and preCreateItem,
 * vetoed documents dropped, _preCreateOperation with the survivors, server, actor prepared with transfer effects).
 */
function setup({ mode = "on", skills = SKILLS, actorType = "character", dialog, server } = {}) {
  const notes = { warn: [], info: [] };
  const dialogs = [];
  const hooks = [];
  const actor = {
    documentName: "Actor",
    type: actorType,
    uuid: "Actor.A",
    name: "Teste",
    pack: null,
    items: [],
    base: Object.fromEntries(skills.map((k) => [k, false])),
    system: { pericias: {} }
  };
  actor.prepare = () => {
    actor.system.pericias = Object.fromEntries(Object.entries(actor.base).map(([k, t]) => [k, { treinado: t }]));
    for (const item of actor.items) {
      for (const effect of item._source.effects ?? []) {
        for (const change of effect.system?.changes ?? []) {
          const m = /^system\.pericias\.([^.]+)\.treinado$/.exec(change.key);
          if (m && actor.system.pericias[m[1]]) actor.system.pericias[m[1]].treinado = true;
        }
      }
    }
  };
  actor.prepare();

  const backend = {
    async create(cls, operation) {
      const { data, noHook, pack, parent, ...options } = operation;
      const user = game.user;
      const documents = [];
      for (const createData of data) {
        const doc = new cls(structuredClone(createData), { parent });
        let allowed = (await doc._preCreate(createData, options, user)) ?? true;
        allowed &&= noHook || Hooks.call("preCreateItem", doc, createData, options, user.id);
        if (allowed === false) continue;
        documents.push(doc);
      }
      if (!documents.length) return [];
      Object.assign(operation, options);
      if ((await cls._preCreateOperation(documents, operation, user)) === false) return [];
      await tick();
      if (server) await server(documents, operation);
      parent.items.push(...documents);
      parent.prepare();
      return documents;
    }
  };

  class Document {
    constructor(source, { parent } = {}) {
      this._source = source;
      this.parent = parent;
    }
    get name() {
      return this._source.name;
    }
    get type() {
      return this._source.type;
    }
    get img() {
      return this._source.img;
    }
    get system() {
      return this._source.system ?? {};
    }
    static get implementation() {
      return globalThis.CONFIG.Item.documentClass;
    }
    static async createDocuments(data = [], operation = {}) {
      operation.data = data;
      return backend.create(this.implementation, operation);
    }
    static async _preCreateOperation() {}
    async _preCreate() {}
    updateSource(changes) {
      for (const [path, value] of Object.entries(changes)) {
        const parts = path.split(".");
        let target = this._source;
        for (const part of parts.slice(0, -1)) target = target[part] ??= {};
        target[parts.at(-1)] = value;
      }
    }
  }
  class Item extends Document {}
  class ItemT20 extends Item {
    async _preCreate(data, options, user) {
      if (this.type !== "raca") return;
      await ItemT20.createDocuments(this._source.grants.map((g) => structuredClone(g)), { keepId: true, parent: this.parent });
    }
  }

  let ids = 0;
  globalThis.game = {
    user: { id: "u1" },
    settings: { get: (module, key) => (module === MODULE_ID && key === "skillPickerRule" ? mode : undefined) },
    i18n: { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d)}` }
  };
  globalThis.ui = { notifications: { warn: (m) => notes.warn.push(m), info: (m) => notes.info.push(m) } };
  globalThis.CONFIG = { Item: { documentClass: ItemT20 }, T20: { pericias: {} } };
  globalThis.Hooks = {
    call: (name, ...args) => {
      if (name !== "preCreateItem") return true;
      for (const fn of [...hooks]) if (fn(...args) === false) return false;
      return true;
    }
  };
  globalThis.foundry = {
    utils: { randomID: () => `r${ids++}`, escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`) },
    documents: { Item },
    applications: {
      api: {
        DialogV2: {
          wait: (config) =>
            new Promise((resolve) => {
              const entry = {
                title: config.window.title,
                options: [...config.content.matchAll(/value="([^"]+)"/g)].map((m) => m[1]),
                resolve
              };
              dialogs.push(entry);
              if (dialog) Promise.resolve().then(() => entry.resolve(dialog(entry, dialogs.length - 1)));
            })
        }
      }
    }
  };
  return { actor, Item, ItemT20, dialogs, notes, hooks, backend };
}

const power = (id, name = "Treinamento em Perícia") => ({
  _id: id,
  name,
  type: "poder",
  img: "p.png",
  effects: [],
  _stats: { compendiumSource: `${PACK}${spec(id)?.id ?? id}` }
});
const tp = () => ({ ...power("Vt6W9YWlxtGrZlUH"), _id: undefined });
const firstOption = (entry) => [entry.options[0]];
const trainedSkills = (actor) => Object.entries(actor.system.pericias).filter(([, s]) => s.treinado).map(([k]) => k);

test("on: a recognized power on a character stores the training effects and the marker", async () => {
  const env = setup({ dialog: () => ["luta"] });
  installSkillPickerRule();
  const existing = { _id: "e0", name: "old", system: { changes: [] } };
  const [doc] = await env.Item.createDocuments([{ ...tp(), effects: [existing] }], { parent: env.actor });
  assert.equal(env.dialogs.length, 1);
  assert.equal(doc._source.effects.length, 2);
  assert.deepEqual(doc._source.effects[0], existing);
  assert.equal(doc._source.effects[1].system.changes[0].key, "system.pericias.luta.treinado");
  assert.deepEqual(doc._source.flags[MODULE_ID].skillPicker, { done: true, skills: ["luta"] });
  assert.deepEqual(trainedSkills(env.actor), ["luta"]);
});

test("Memória Póstuma confirmed with no skill keeps only the marker; its copy does not ask again", async () => {
  const env = setup({ dialog: () => [] });
  installSkillPickerRule();
  const [doc] = await env.ItemT20.createDocuments([power("Wj1J9EBK9tOe2hkz", "Memória Póstuma")], { parent: env.actor });
  assert.deepEqual(doc._source.effects, []);
  assert.deepEqual(doc._source.flags[MODULE_ID].skillPicker, { done: true, skills: [] });
  assert.equal(env.notes.info.length, 1);
  await env.ItemT20.createDocuments([structuredClone(doc._source)], { parent: env.actor });
  assert.equal(env.dialogs.length, 1);
});

test("closing the dialog creates the power without training or marker, with a warning", async () => {
  const env = setup({ dialog: () => null });
  installSkillPickerRule();
  const [doc] = await env.Item.createDocuments([tp()], { parent: env.actor });
  assert.deepEqual(doc._source.effects, []);
  assert.equal(doc._source.flags?.[MODULE_ID], undefined);
  assert.equal(env.notes.warn.length, 1);
  assert.match(env.notes.warn[0], /Cancelled/);
});

test("an invalid count reopens the dialog", async () => {
  const env = setup({ dialog: (entry, i) => (i === 0 ? ["luta", "atle"] : ["atle"]) });
  installSkillPickerRule();
  const [doc] = await env.Item.createDocuments([tp()], { parent: env.actor });
  assert.equal(env.dialogs.length, 2);
  assert.deepEqual(doc._source.flags[MODULE_ID].skillPicker.skills, ["atle"]);
});

test("composes with an external _preCreateOperation wrapper in both install orders", async () => {
  for (const externalFirst of [true, false]) {
    const env = setup({ dialog: firstOption });
    const wrapExternal = () => {
      const original = env.ItemT20._preCreateOperation;
      env.ItemT20._preCreateOperation = async function (documents, operation, user) {
        const allowed = await original.call(this, documents, operation, user);
        if (allowed === false) return allowed;
        documents.filter((d) => d.type === "classe").forEach((d, i) => d.updateSource({ "system.inicial": i === 0 }));
        return allowed;
      };
    };
    if (externalFirst) wrapExternal();
    installSkillPickerRule();
    if (!externalFirst) wrapExternal();
    const docs = await env.ItemT20.createDocuments(
      [{ name: "Guerreiro", type: "classe" }, tp(), { name: "Arcanista", type: "classe" }],
      { parent: env.actor }
    );
    assert.equal(docs.length, 3, `externalFirst=${externalFirst}`);
    assert.equal(env.dialogs.length, 1);
    assert.equal(docs[0]._source.system.inicial, true);
    assert.equal(docs[2]._source.system.inicial, false);
    assert.equal(docs[1]._source.flags[MODULE_ID].skillPicker.done, true);
  }
});

test("race grant (nested createDocuments with keepId) asks for Versátil, with a class in the same batch", async () => {
  const env = setup({ dialog: (entry) => entry.options.slice(0, 2) });
  installSkillPickerRule();
  const versatil = { _id: "9QQnUgUh5ThF96Cd", name: "Versátil", type: "poder", effects: [] };
  const docs = await env.ItemT20.createDocuments(
    [{ name: "Humano", type: "raca", grants: [versatil] }, { name: "Guerreiro", type: "classe" }],
    { parent: env.actor }
  );
  assert.equal(docs.length, 2);
  assert.equal(env.dialogs.length, 1);
  assert.match(env.dialogs[0].title, /Versátil/);
  assert.equal(env.actor.items.length, 3);
  assert.equal(trainedSkills(env.actor).length, 2);
});

test("a mixed batch reserves the training of an already configured power, in both orders", async () => {
  for (const configuredFirst of [true, false]) {
    const env = setup({ dialog: firstOption });
    installSkillPickerRule();
    const configured = {
      ...tp(),
      effects: [{ transfer: true, system: { changes: [{ key: "system.pericias.luta.treinado", value: true }] } }]
    };
    const batch = configuredFirst ? [configured, tp()] : [tp(), configured];
    await env.Item.createDocuments(batch, { parent: env.actor });
    assert.equal(env.dialogs.length, 1);
    assert.equal(env.dialogs[0].options.includes("luta"), false, `configuredFirst=${configuredFirst}`);
  }
});

test("a usage effect in the same batch does not reserve its skill", async () => {
  const env = setup({ dialog: firstOption });
  installSkillPickerRule();
  const usage = {
    name: "Golpe", type: "poder", effects: [{ transfer: true, system: { onuse: true, changes: [{ key: "system.pericias.luta.treinado", value: true }] } }]
  };
  await env.Item.createDocuments([usage, tp()], { parent: env.actor });
  assert.equal(env.dialogs.length, 1);
  assert.equal(env.dialogs[0].options.includes("luta"), true);
});

test("same batch never offers a skill twice, through the base class and the system class", async () => {
  for (const which of ["Item", "ItemT20"]) {
    const env = setup({ dialog: firstOption });
    installSkillPickerRule();
    await env[which].createDocuments([tp(), tp()], { parent: env.actor });
    assert.equal(env.dialogs.length, 2);
    const [first] = env.dialogs[0].options;
    assert.equal(env.dialogs[1].options.includes(first), false, which);
  }
});

test("a power vetoed by preCreateItem (registered before or after install) never asks nor reserves", async () => {
  for (const before of [true, false]) {
    const env = setup({ skills: ["luta"], dialog: firstOption });
    let vetoed = false;
    const veto = () => (vetoed ? true : ((vetoed = true), false));
    if (before) env.hooks.push(veto);
    installSkillPickerRule();
    if (!before) env.hooks.push(veto);
    const docs = await env.Item.createDocuments([tp(), tp()], { parent: env.actor });
    assert.equal(docs.length, 1);
    assert.equal(env.dialogs.length, 1);
    assert.deepEqual(env.dialogs[0].options, ["luta"]);
    assert.deepEqual(docs[0]._source.flags[MODULE_ID].skillPicker.skills, ["luta"]);
    assert.equal(env.notes.warn.length, 0);
  }
});

test("Hooks.call replaced after install still never repeats a skill in the batch", async () => {
  const env = setup({ dialog: firstOption });
  installSkillPickerRule();
  globalThis.Hooks.call = () => true;
  await env.Item.createDocuments([tp(), tp()], { parent: env.actor });
  assert.notEqual(env.dialogs[0].options[0], env.dialogs[1].options[0]);
  assert.equal(env.dialogs[1].options.includes(env.dialogs[0].options[0]), false);
});

test("noHook with an external _preCreate veto: one dialog, skill kept for the next power", async () => {
  const env = setup({ skills: ["luta"], dialog: firstOption });
  installSkillPickerRule();
  const original = env.ItemT20.prototype._preCreate;
  let first = true;
  env.ItemT20.prototype._preCreate = async function (...args) {
    if (this.type === "poder" && first) {
      first = false;
      return false;
    }
    return original.apply(this, args);
  };
  const docs = await env.Item.createDocuments([tp(), tp()], { parent: env.actor, noHook: true });
  assert.equal(docs.length, 1);
  assert.equal(env.dialogs.length, 1);
  assert.deepEqual(docs[0]._source.flags[MODULE_ID].skillPicker.skills, ["luta"]);
  assert.equal(env.notes.warn.length, 0);
});

test("concurrent operations on the same actor: the second waits and sees the first's choice", async () => {
  const env = setup();
  installSkillPickerRule();
  const one = env.Item.createDocuments([tp()], { parent: env.actor });
  await until(() => env.dialogs.length === 1, "first dialog");
  const two = env.Item.createDocuments([tp()], { parent: env.actor });
  await until(() => env.notes.info.length === 1, "waiting notice");
  assert.match(env.notes.info[0], /Waiting/);
  await tick();
  assert.equal(env.dialogs.length, 1);
  env.dialogs[0].resolve(["luta"]);
  await one;
  await until(() => env.dialogs.length === 2, "second dialog");
  assert.equal(env.dialogs[1].options.includes("luta"), false);
  env.dialogs[1].resolve(["atle"]);
  await two;
  assert.deepEqual(trainedSkills(env.actor).sort(), ["atle", "luta"]);
});

test("server failure releases the queue; reusing the caller's options never leaks the operation id", async () => {
  let fail = true;
  const env = setup({
    skills: ["luta"],
    dialog: firstOption,
    server: async () => {
      if (fail) {
        fail = false;
        throw new Error("refused");
      }
    }
  });
  installSkillPickerRule();
  const options = { parent: env.actor };
  await assert.rejects(env.Item.createDocuments([tp()], options), /refused/);
  const docs = await env.Item.createDocuments([tp()], options);
  assert.equal(docs.length, 1);
  assert.deepEqual(env.dialogs[1].options, ["luta"]);
  assert.equal(PICKER_OPERATION in options, false);
});

test("an outer _preCreateOperation cancelling after the choice creates nothing and releases the queue", async () => {
  const env = setup({ skills: ["luta"], dialog: firstOption });
  installSkillPickerRule();
  const inner = env.ItemT20._preCreateOperation;
  let cancel = true;
  env.ItemT20._preCreateOperation = async function (...args) {
    const allowed = await inner.apply(this, args);
    if (cancel) {
      cancel = false;
      return false;
    }
    return allowed;
  };
  assert.deepEqual(await env.Item.createDocuments([tp()], { parent: env.actor }), []);
  const docs = await env.Item.createDocuments([tp()], { parent: env.actor });
  assert.equal(docs.length, 1);
  assert.deepEqual(env.dialogs[1].options, ["luta"]);
});

test("nested race grant inside an operation with another picker power: no deadlock, no repeated skill", async () => {
  const env = setup({ dialog: firstOption });
  installSkillPickerRule();
  const versatil = { _id: "9QQnUgUh5ThF96Cd", name: "Versátil", type: "poder", effects: [] };
  await env.Item.createDocuments([tp(), { name: "Humano", type: "raca", grants: [versatil] }], { parent: env.actor });
  assert.equal(env.dialogs.length, 2);
  assert.match(env.dialogs[0].title, /Versátil/);
  assert.equal(env.dialogs[1].options.includes(env.dialogs[0].options[0]), false);
});

test("_preCreateOperation called without the operation id releases the queue itself", async () => {
  const env = setup({ dialog: firstOption });
  installSkillPickerRule();
  const doc = new env.ItemT20(tp(), { parent: env.actor });
  await env.ItemT20._preCreateOperation([doc], { parent: env.actor }, game.user);
  const docs = await env.Item.createDocuments([tp()], { parent: env.actor });
  assert.equal(docs.length, 1);
  assert.equal(env.dialogs.length, 2);
});

test("does not ask when off, for npc, in a pack, for another user, or when the item is already trained", async () => {
  const cases = [
    ["off", () => setup({ mode: "off", dialog: firstOption })],
    ["npc", () => setup({ actorType: "npc", dialog: firstOption })],
    ["pack", () => {
      const env = setup({ dialog: firstOption });
      env.actor.pack = "world.actors";
      return env;
    }]
  ];
  for (const [label, make] of cases) {
    const env = make();
    installSkillPickerRule();
    const docs = await env.Item.createDocuments([tp()], { parent: env.actor });
    assert.equal(docs.length, 1, label);
    assert.equal(env.dialogs.length, 0, label);
  }
  const env = setup({ dialog: firstOption });
  installSkillPickerRule();
  const doc = new env.ItemT20(tp(), { parent: env.actor });
  await env.ItemT20._preCreateOperation([doc], { parent: env.actor }, { id: "other" });
  const trained = { ...tp(), effects: [{ system: { changes: [{ key: "system.pericias.luta.treinado" }] } }] };
  await env.Item.createDocuments([trained], { parent: env.actor });
  assert.equal(env.dialogs.length, 0);
});

test("an original _preCreateOperation returning false stops without asking; its value is preserved", async () => {
  const env = setup({ dialog: firstOption });
  const sentinel = { kept: true };
  let result = false;
  env.ItemT20._preCreateOperation = async () => result;
  installSkillPickerRule();
  const doc = new env.ItemT20(tp(), { parent: env.actor });
  assert.equal(await env.ItemT20._preCreateOperation([doc], { parent: env.actor }, game.user), false);
  assert.equal(env.dialogs.length, 0);
  result = sentinel;
  assert.equal(await env.ItemT20._preCreateOperation([doc], { parent: env.actor }, game.user), sentinel);
  assert.equal(env.dialogs.length, 1);
});
