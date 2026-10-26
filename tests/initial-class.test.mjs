import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  diagnoseInitialClass,
  initialMarksOnCreate,
  initialUpdatesOnChange,
  pickInitialClass,
  recognizeParts,
  sourceFingerprint
} from "../scripts/patches/initial-class.mjs";
import { ON_DELETE, ON_UPDATE, PRE_CREATE } from "./fixtures/initial-class-1.6.5.mjs";

const cls = (id, inicial = false) => ({ id, inicial });

/* -------------------------------------------- */
/*  Pure functions                              */
/* -------------------------------------------- */

test("sourceFingerprint ignores comments and whitespace, but not code", () => {
  const a = sourceFingerprint("f(x) {\n  // note\n  return x + 1; /* sum */\n}");
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(sourceFingerprint("f(x){return x+1;}"), a);
  assert.notEqual(sourceFingerprint("f(x){return x+2;}"), a);
});

test("recognizeParts recognizes the 1.6.5 methods and the empty class branch of _preCreate", () => {
  assert.deepEqual(recognizeParts({ onUpdate: ON_UPDATE, onDelete: ON_DELETE, preCreate: PRE_CREATE }), {
    _onUpdate: true,
    _onDelete: true,
    _preCreate: true
  });
  const handled = PRE_CREATE.replace("/* TODO */", "updates = this._onCreateOwnedClass(data);");
  assert.equal(recognizeParts({ preCreate: handled })._preCreate, false);
  const changed = ON_UPDATE.replace("!i.system.inicial", "i.system.inicial");
  assert.equal(recognizeParts({ onUpdate: changed })._onUpdate, false);
  assert.deepEqual(recognizeParts(undefined), { _onUpdate: false, _onDelete: false, _preCreate: false });
});

test("diagnoseInitialClass: present/high only when every part is recognized", () => {
  assert.deepEqual(diagnoseInitialClass({ _onUpdate: true, _onDelete: true, _preCreate: true }).bug, "present");
  assert.equal(diagnoseInitialClass({ _onUpdate: true, _onDelete: true, _preCreate: true }).confidence, "high");
  const partial = diagnoseInitialClass({ _onUpdate: true, _onDelete: false, _preCreate: true });
  assert.equal(partial.bug, "unknown");
  assert.equal(partial.confidence, "low");
  assert.match(partial.evidence, /_onDelete/);
  assert.equal(diagnoseInitialClass({ _onUpdate: false, _onDelete: false, _preCreate: false }).bug, "unknown");
});

test("pickInitialClass moves the mark only when no class is initial", () => {
  assert.equal(pickInitialClass([cls("g"), cls("a", true), cls("p")]), null);
  assert.equal(pickInitialClass([]), null);
  assert.equal(pickInitialClass([cls("g"), cls("a")]), "g");
  assert.equal(pickInitialClass([cls("g"), cls("a")], "g"), "a");
  assert.equal(pickInitialClass([cls("g")], "g"), "g");
});

test("initialUpdatesOnChange stops the cascade and keeps one initial class", () => {
  // Marking the third class only unmarks the old initial one.
  assert.deepEqual(initialUpdatesOnChange([cls("g", true), cls("p"), cls("a", true)], "a", true), [
    { _id: "g", "system.inicial": false }
  ]);
  // The cascade: the old initial class is unmarked while another one is initial.
  assert.deepEqual(initialUpdatesOnChange([cls("g"), cls("p"), cls("a", true)], "g", false), []);
  // Unmarking the initial class of two gives the mark to the other one.
  assert.deepEqual(initialUpdatesOnChange([cls("g"), cls("a")], "g", false), [{ _id: "a", "system.inicial": true }]);
  // Unmarking the only class marks it again.
  assert.deepEqual(initialUpdatesOnChange([cls("g")], "g", false), [{ _id: "g", "system.inicial": true }]);
  // Two initial classes saved before the patch: unmarking the extra one leaves the other.
  assert.deepEqual(initialUpdatesOnChange([cls("g"), cls("a", true)], "g", false), []);
});

test("initialMarksOnCreate marks only the first class of an actor without classes", () => {
  assert.deepEqual(initialMarksOnCreate(false, 2), [true, false]);
  assert.deepEqual(initialMarksOnCreate(true, 2), [false, false]);
  assert.deepEqual(initialMarksOnCreate(false, 0), []);
});

/* -------------------------------------------- */
/*  Integration with the 1.6.5 methods          */
/* -------------------------------------------- */

const USER = "gm";
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** Item class built from the verbatim 1.6.5 methods, over a minimal core Item. */
function makeItemClass() {
  class Item {
    _onUpdate() {}
    _onDelete() {}
    async _preCreate() {}
    static async _preCreateOperation() {}
  }
  const ItemT20 = new Function("Item", `return class ItemT20 extends Item {\n${PRE_CREATE}\n${ON_UPDATE}\n${ON_DELETE}\n}`)(
    Item
  );
  return ItemT20;
}

/**
 * Actor with the core's update flow: updates are applied asynchronously, updates without a difference are dropped
 * (client-backend.mjs:262), and a deleted item leaves the collection before _onDelete (client-backend.mjs:463-465).
 */
function makeWorld(ItemClass, { patched }) {
  globalThis.game = { userId: USER };
  globalThis.foundry = {
    utils: { hasProperty: (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key) }
  };
  globalThis.CONFIG = { Item: { documentClass: ItemClass } };
  const errors = [];
  if (patched) patch.apply();
  const actor = {
    documentName: "Actor",
    type: "character",
    name: "Teste",
    items: [],
    update() {},
    _checkEncumbered() {},
    get nivel() {
      return this.items.filter((i) => i.type === "classe").reduce((sum, i) => sum + i.system.niveis, 0);
    },
    async updateEmbeddedDocuments(_name, updates) {
      await Promise.resolve();
      for (const update of updates) {
        const item = this.items.find((i) => i.id === update._id);
        const value = update["system.inicial"];
        if (!item || item.system.inicial === value) continue;
        item.system.inicial = value;
        try {
          item._onUpdate({ system: { inicial: value } }, {}, USER);
        } catch (err) {
          errors.push(err);
        }
      }
    }
  };
  const add = (id, inicial = false) => {
    const item = Object.assign(new ItemClass(), { id, type: "classe", system: { inicial, niveis: 1 }, parent: actor });
    Object.defineProperty(item, "actor", { get: () => item.parent });
    actor.items.push(item);
    return item;
  };
  const mark = async (id, value) => {
    await actor.updateEmbeddedDocuments("Item", [{ _id: id, "system.inicial": value }]);
    await flush();
  };
  const remove = async (id) => {
    const item = actor.items.find((i) => i.id === id);
    actor.items.splice(actor.items.indexOf(item), 1);
    try {
      item._onDelete({}, USER);
    } catch (err) {
      errors.push(err);
    }
    await flush();
  };
  const initial = () => actor.items.filter((i) => i.system.inicial).map((i) => i.id);
  return { actor, add, mark, remove, initial, errors };
}

test("baseline: without the patch the simulation reproduces cases A and C of the issue", async () => {
  const a = makeWorld(makeItemClass(), { patched: false });
  a.add("guerreiro", true);
  a.add("paladino");
  a.add("arcanista");
  await a.mark("arcanista", true);
  assert.notDeepEqual(a.initial(), ["arcanista"]);

  const c = makeWorld(makeItemClass(), { patched: false });
  c.add("guerreiro", true);
  await c.mark("guerreiro", false);
  assert.equal(c.errors.length, 1);
});

test("case A: marking the third class leaves only it initial", async () => {
  const w = makeWorld(makeItemClass(), { patched: true });
  w.add("guerreiro", true);
  w.add("paladino");
  w.add("arcanista");
  await w.mark("arcanista", true);
  assert.deepEqual(w.initial(), ["arcanista"]);
  assert.deepEqual(w.errors, []);
});

test("case B: deleting a class that is not initial keeps the initial one", async () => {
  const w = makeWorld(makeItemClass(), { patched: true });
  w.add("guerreiro", true);
  w.add("arcanista");
  w.add("paladino");
  await w.mark("arcanista", true);
  assert.deepEqual(w.initial(), ["arcanista"]);
  await w.remove("paladino");
  assert.deepEqual(w.initial(), ["arcanista"]);
});

test("case C: unmarking the only class marks it again without errors", async () => {
  const w = makeWorld(makeItemClass(), { patched: true });
  w.add("guerreiro", true);
  await w.mark("guerreiro", false);
  assert.deepEqual(w.initial(), ["guerreiro"]);
  assert.deepEqual(w.errors, []);
});

test("common flow: marking the second class and deleting the initial one still work", async () => {
  const w = makeWorld(makeItemClass(), { patched: true });
  w.add("guerreiro", true);
  w.add("arcanista");
  await w.mark("arcanista", true);
  assert.deepEqual(w.initial(), ["arcanista"]);
  await w.remove("arcanista");
  assert.deepEqual(w.initial(), ["guerreiro"]);
});

test("two initial classes saved before the patch: unmarking the extra one keeps the other", async () => {
  const w = makeWorld(makeItemClass(), { patched: true });
  w.add("guerreiro", true);
  w.add("arcanista", true);
  await w.mark("guerreiro", false);
  assert.deepEqual(w.initial(), ["arcanista"]);
});

test("non-initial changes still go through the system method", async () => {
  const w = makeWorld(makeItemClass(), { patched: true });
  const item = w.add("guerreiro", true);
  const updates = [];
  w.actor.update = (data) => updates.push(data);
  item.system.niveis = 2;
  item._onUpdate({ system: { niveis: 2 } }, {}, USER);
  assert.deepEqual(updates, [{ "system.attributes.nivel.value": 2 }]);
});

const createDoc = (type, inicial = false) => ({
  type,
  system: { inicial },
  updateSource(changes) {
    if ("system.inicial" in changes) this.system.inicial = changes["system.inicial"];
  }
});

test("creation: only the first accepted class of an actor without classes is initial (cases D and veto)", async () => {
  const ItemClass = makeItemClass();
  const w = makeWorld(ItemClass, { patched: true });
  // Guerreiro was vetoed by a preCreateItem hook, so it is absent; both classes came marked (folder drop).
  const arcanista = createDoc("classe", true);
  const arma = createDoc("arma");
  const paladino = createDoc("classe", true);
  const allowed = await ItemClass._preCreateOperation([arcanista, arma, paladino], { parent: w.actor }, {});
  assert.notEqual(allowed, false);
  assert.equal(arcanista.system.inicial, true);
  assert.equal(paladino.system.inicial, false);
  assert.equal(arma.system.inicial, false);
});

test("creation: the original _preCreateOperation runs with every document and can veto", async () => {
  const ItemClass = makeItemClass();
  const calls = [];
  Object.getPrototypeOf(ItemClass)._preCreateOperation = async (docs) => {
    calls.push(docs.length);
    return false;
  };
  const w = makeWorld(ItemClass, { patched: true });
  const doc = createDoc("classe", false);
  assert.equal(await ItemClass._preCreateOperation([doc, createDoc("arma")], { parent: w.actor }, {}), false);
  assert.deepEqual(calls, [2]);
  assert.equal(doc.system.inicial, false);
});

test("creation: a class copied with the mark loses it on an actor that has a class (case E)", async () => {
  const ItemClass = makeItemClass();
  const w = makeWorld(ItemClass, { patched: true });
  w.add("guerreiro", true);
  const copied = createDoc("classe", true);
  await ItemClass._preCreateOperation([copied], { parent: w.actor }, {});
  assert.equal(copied.system.inicial, false);
});

test("creation: vehicles and statblock imports are left alone", async () => {
  const ItemClass = makeItemClass();
  const w = makeWorld(ItemClass, { patched: true });
  const vehicleDoc = createDoc("classe", true);
  await ItemClass._preCreateOperation([vehicleDoc, createDoc("classe", true)], { parent: { ...w.actor, type: "vehicle" } }, {});
  assert.equal(vehicleDoc.system.inicial, true);
  const npcDoc = createDoc("classe", false);
  const npc = { documentName: "Actor", type: "npc", items: [] };
  await ItemClass._preCreateOperation([npcDoc], { parent: npc, statblockParsing: true }, {});
  assert.equal(npcDoc.system.inicial, false);
});

test("apply leaves unrecognized system code untouched", () => {
  const Base = Object.getPrototypeOf(makeItemClass());
  const changed = new Function(
    "Item",
    `return class ItemT20 extends Item {
${PRE_CREATE.replace("/* TODO */", "updates = {};")}
${ON_UPDATE.replace("!i.system.inicial", "i.system.inicial")}
${ON_DELETE}
}`
  )(Base);
  const { _onUpdate: onUpdate, _onDelete: onDelete } = changed.prototype;
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    makeWorld(changed, { patched: true });
  } finally {
    console.warn = warn;
  }
  assert.equal(changed.prototype._onUpdate, onUpdate);
  assert.notEqual(changed.prototype._onDelete, onDelete);
  assert.equal(Object.prototype.hasOwnProperty.call(changed, "_preCreateOperation"), false);
  assert.match(warnings.join("\n"), /_onUpdate, _preCreate/);
});
