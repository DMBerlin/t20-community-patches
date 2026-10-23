import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appliesToSelf,
  canonical,
  classify,
  effectSignature,
  embeddedItemFixes,
  findEntry,
  isAncestorKey,
  isPackDestination,
  passiveNumber,
  passiveSetHas,
  passiveText,
  sameSignature,
  sourceRef,
  summarize,
  wrapActorPreCreate,
  wrapPreCreate
} from "../scripts/compendium-copy.mjs";
import { unwrap } from "../scripts/utils.mjs";
import { cleanItem } from "./fixtures/clean-source.mjs";

const SYS = "Compendium.tormenta20.poderes.Item.PEn3CaxnaMEIAXUR";
const WORLD = "Compendium.world.custom.Item.PEn3CaxnaMEIAXUR";
const ENTRIES = [{ pack: "poderes", id: "PEn3CaxnaMEIAXUR", name: "Sentidos Élficos" }];

test("sourceRef: absent, system and foreign origins", () => {
  assert.deepEqual(sourceRef({}), { status: "absent" });
  assert.deepEqual(sourceRef({ _stats: { compendiumSource: null }, flags: { core: {} } }), { status: "absent" });
  assert.deepEqual(sourceRef({ _stats: { compendiumSource: SYS } }), {
    status: "system",
    pack: "poderes",
    documentName: "Item",
    id: "PEn3CaxnaMEIAXUR"
  });
  assert.equal(sourceRef({ flags: { core: { sourceId: SYS } } }).status, "system");
  assert.equal(sourceRef({ _stats: { compendiumSource: SYS }, flags: { core: { sourceId: SYS } } }).status, "system");
  assert.equal(sourceRef({ _stats: { compendiumSource: WORLD }, flags: { core: { sourceId: SYS } } }).status, "foreign");
  const other = "Compendium.tormenta20.poderes.Item.fLezjAZcNHYRx7rV";
  assert.equal(sourceRef({ _stats: { compendiumSource: SYS }, flags: { core: { sourceId: other } } }).status, "foreign");
  assert.equal(sourceRef({ _stats: { compendiumSource: "Item.abc" } }).status, "foreign");
});

test("findEntry: by system UUID, or by _id and name only without origin", () => {
  const [entry] = ENTRIES;
  assert.equal(findEntry({ _stats: { compendiumSource: SYS } }, ENTRIES, "Item"), entry);
  assert.equal(findEntry({ _id: entry.id, name: entry.name }, ENTRIES, "Item"), entry);
  assert.equal(findEntry({ _id: entry.id, name: "Outro" }, ENTRIES, "Item"), null);
  assert.equal(findEntry({ _id: entry.id, name: entry.name, _stats: { compendiumSource: WORLD } }, ENTRIES, "Item"), null);
  assert.equal(findEntry({ _stats: { compendiumSource: SYS } }, ENTRIES, "Actor"), null);
  assert.equal(findEntry({ _stats: { compendiumSource: SYS.replace("poderes", "racas") } }, ENTRIES, "Item"), null);
});

test("canonical: key order does not matter; undefined and null are the same", () => {
  assert.equal(canonical({ a: 1, b: [2, { c: null }] }), canonical({ b: [2, { c: undefined }], a: 1 }));
  assert.notEqual(canonical([1, 2]), canonical([2, 1]));
});

test("effectSignature: value as text, default phase, sorted sets and unknown system fields", () => {
  const base = cleanItem({
    effects: [{ _id: "e", name: "E", system: { changes: [{ key: "k", type: "add", value: 2 }], targets: ["self", "ally"] } }]
  }).effects[0];
  const same = structuredClone(base);
  same.system.changes[0].value = "2";
  delete same.system.changes[0].phase;
  same.system.targets = ["ally", "self"];
  assert.ok(sameSignature(effectSignature(base), effectSignature(same)));
  const extra = structuredClone(base);
  extra.system.newField = 1;
  assert.ok(!sameSignature(effectSignature(base), effectSignature(extra)));
  const described = structuredClone(base);
  described.description = "outra";
  described.system.abilityUse.description = "outra";
  assert.ok(sameSignature(effectSignature(base), effectSignature(described)));
});

test("isPackDestination: operation pack, own pack or parent pack", () => {
  assert.equal(isPackDestination({}, {}), false);
  assert.equal(isPackDestination({}, { pack: "world.x" }), true);
  assert.equal(isPackDestination({ pack: "world.x" }, {}), true);
  assert.equal(isPackDestination({ parent: { pack: "world.x" } }, {}), true);
});

function fakeDoc(source, extra = {}) {
  const doc = { _source: structuredClone(source), updates: [], ...extra };
  doc.updateSource = (update) => {
    doc.updates.push(update);
    Object.assign(doc._source, update);
  };
  return doc;
}

test("wrapPreCreate: corrects only outside packs and from a known origin, preserving this, args and return", async () => {
  const calls = [];
  const original = async function (...args) {
    calls.push({ self: this, args });
    return "result";
  };
  const entries = [{ pack: "poderes", id: "PEn3CaxnaMEIAXUR", name: "Sentidos Élficos", fix: () => ({ fixed: true }) }];
  const wrapped = wrapPreCreate(original, "Item", entries, "test");
  assert.equal(unwrap(wrapped), original);

  const fromSystem = fakeDoc({ _stats: { compendiumSource: SYS } });
  const args = [{ data: 1 }, { opt: 2 }, "user"];
  assert.equal(await wrapped.apply(fromSystem, args), "result");
  assert.equal(fromSystem.updates.length, 1);
  assert.equal(calls[0].self, fromSystem);
  assert.deepEqual(calls[0].args, args);

  const granted = fakeDoc({ _id: "PEn3CaxnaMEIAXUR", name: "Sentidos Élficos" });
  await wrapped.call(granted, {}, {}, "user");
  assert.equal(granted.updates.length, 1);

  for (const [doc, options] of [
    [fakeDoc({ _stats: { compendiumSource: SYS } }), { pack: "world.p" }],
    [fakeDoc({ _stats: { compendiumSource: SYS } }, { pack: "world.p" }), {}],
    [fakeDoc({ _stats: { compendiumSource: SYS } }, { parent: { pack: "world.p" } }), {}],
    [fakeDoc({ _id: "PEn3CaxnaMEIAXUR", name: "Sentidos Élficos", _stats: { compendiumSource: WORLD } }), {}]
  ]) {
    await wrapped.call(doc, {}, options, "user");
    assert.equal(doc.updates.length, 0);
  }
  assert.equal(calls.length, 6);
});

test("wrapPreCreate: a failing correction still runs the original", async (t) => {
  t.mock.method(console, "warn", () => {});
  let ran = false;
  const entries = [{ pack: "poderes", id: "PEn3CaxnaMEIAXUR", fix: () => { throw new Error("boom"); } }];
  const wrapped = wrapPreCreate(async () => { ran = true; }, "Item", entries, "test");
  await wrapped.call(fakeDoc({ _stats: { compendiumSource: SYS } }), {}, {}, "user");
  assert.ok(ran);
});

test("embeddedItemFixes: only recognized items, by id", () => {
  const entries = [{ pack: "poderes", id: "PEn3CaxnaMEIAXUR", name: "Sentidos Élficos", fix: (src) => (src.edited ? null : { fixed: src._id }) }];
  const items = [
    { _id: "AAAAAAAAAAAAAAAA", name: "Sentidos Élficos", _stats: { compendiumSource: SYS } },
    { _id: "PEn3CaxnaMEIAXUR", name: "Sentidos Élficos" },
    { _id: "BBBBBBBBBBBBBBBB", name: "Sentidos Élficos", _stats: { compendiumSource: SYS }, edited: true },
    { _id: "CCCCCCCCCCCCCCCC", name: "Sentidos Élficos", _stats: { compendiumSource: WORLD } },
    { _id: "DDDDDDDDDDDDDDDD", name: "Outro" }
  ];
  assert.deepEqual(embeddedItemFixes(items, entries), [
    { id: "AAAAAAAAAAAAAAAA", update: { fixed: "AAAAAAAAAAAAAAAA" } },
    { id: "PEn3CaxnaMEIAXUR", update: { fixed: "PEn3CaxnaMEIAXUR" } }
  ]);
  assert.deepEqual(embeddedItemFixes(undefined, entries), []);
  const guarded = [{ ...entries[0], embedded: (actor) => actor?.fresh === true }];
  assert.deepEqual(embeddedItemFixes(items.slice(0, 1), guarded, { fresh: false }), []);
  assert.equal(embeddedItemFixes(items.slice(0, 1), guarded, { fresh: true }).length, 1);
});

test("wrapActorPreCreate: corrects the embedded items outside packs, then runs the original", async (t) => {
  const entries = [{ pack: "poderes", id: "PEn3CaxnaMEIAXUR", name: "Sentidos Élficos", fix: () => ({ fixed: true }) }];
  const actor = (options = {}) => {
    const items = [fakeDoc({ _id: "AAAAAAAAAAAAAAAA", _stats: { compendiumSource: SYS } }), fakeDoc({ _id: "BBBBBBBBBBBBBBBB" })];
    const doc = { _source: { items: items.map((i) => i._source) }, items: new Map(items.map((i) => [i._source._id, i])), ...options };
    return { doc, items };
  };
  const calls = [];
  const original = async function (...args) {
    calls.push({ self: this, args });
    return "result";
  };
  const wrapped = wrapActorPreCreate(original, entries, "test");
  assert.equal(unwrap(wrapped), original);
  const { doc, items } = actor();
  const args = [{}, {}, "user"];
  assert.equal(await wrapped.apply(doc, args), "result");
  assert.deepEqual(items.map((i) => i.updates.length), [1, 0]);
  assert.equal(calls[0].self, doc);
  assert.deepEqual(calls[0].args, args);

  const inPack = actor({ pack: "world.p" });
  await wrapped.call(inPack.doc, {}, {}, "user");
  assert.deepEqual(inPack.items.map((i) => i.updates.length), [0, 0]);

  t.mock.method(console, "warn", () => {});
  const failing = wrapActorPreCreate(original, [{ ...entries[0], fix: () => { throw new Error("boom"); } }], "test");
  await failing.call(actor().doc, {}, {}, "user");
  assert.equal(calls.length, 3);
});

const SENSES = "system.attributes.sentidos.value";
const WALK = "system.attributes.movement.walk.base";
const item = (...effects) =>
  cleanItem({ effects: effects.map((changes, i) => ({ _id: `e${i}`, name: "E", system: { changes } })) });
const c = (key, type, value, priority, phase) => ({ key, type, value, priority, phase });

test("passiveNumber: core order (priority, then position) and undetermined cases", () => {
  assert.equal(passiveNumber(item([c(WALK, "override", 6), c(WALK, "override", 9, 60)]), [WALK]), 9);
  assert.equal(passiveNumber(item([c(WALK, "override", 6), c(WALK, "override", 9, 10)]), [WALK]), 6);
  assert.equal(passiveNumber(item([c(WALK, "override", 6)], [c(WALK, "add", 3)]), [WALK]), 6);
  assert.equal(passiveNumber(item([c(WALK, "override", 6)], [c(WALK, "add", 3, 60)]), [WALK]), 9);
  assert.equal(passiveNumber(item([c(WALK, "override", 6), c(WALK, "override", 9, null, "final")]), [WALK]), null);
  assert.equal(passiveNumber(item([c(WALK, "override", 6), c(WALK, "multiply", 2, 60)]), [WALK]), null);
  assert.equal(passiveNumber(item([c(WALK, "override", [9])]), [WALK]), null);
  assert.equal(passiveNumber(item([c(WALK, "add", 3)]), [WALK]), null);
});

test("passiveNumber: add with default priority runs before an override", () => {
  assert.equal(passiveNumber(item([c(WALK, "add", 3), c(WALK, "override", 6)]), [WALK]), 6);
});

test("passive*: disabled and usage effects are ignored", () => {
  const src = item([c(WALK, "override", 6)], [c(WALK, "override", 9, 60)]);
  src.effects[1].disabled = true;
  assert.equal(passiveNumber(src, [WALK]), 6);
  src.effects[1].disabled = false;
  src.effects[1].system.onuse = true;
  assert.equal(passiveNumber(src, [WALK]), 6);
  src.effects[1].system.onuse = false;
  src.effects[1].transfer = false;
  assert.equal(passiveNumber(src, [WALK]), 6);
});

test("passiveText: only overrides", () => {
  assert.equal(passiveText(item([c("system.tracos.tamanho", "override", "peq")]), ["system.tracos.tamanho"]), "peq");
  assert.equal(passiveText(item([c("system.tracos.tamanho", "add", "peq")]), ["system.tracos.tamanho"]), null);
  assert.equal(passiveText(item([]), ["system.tracos.tamanho"]), null);
});

test("passiveSetHas: add, later subtract, override and non-scalar values", () => {
  assert.equal(passiveSetHas(item([c(SENSES, "add", "penumbra")]), [SENSES], "penumbra"), true);
  assert.equal(passiveSetHas(item([c(SENSES, "add", "penumbra")], [c(SENSES, "subtract", "penumbra")]), [SENSES], "penumbra"), false);
  assert.equal(passiveSetHas(item([c(SENSES, "add", "penumbra")], [c(SENSES, "override", "escuro", 60)]), [SENSES], "penumbra"), null);
  assert.equal(passiveSetHas(item([c(SENSES, "add", "penumbra")], [c(SENSES, "subtract", ["penumbra", "escuro"], 60)]), [SENSES], "penumbra"), null);
  assert.equal(passiveSetHas(item([c(SENSES, "add", "penumbra")], [c(SENSES, "subtract", '["penumbra","escuro"]', 60)]), [SENSES], "penumbra"), null);
  assert.equal(passiveSetHas(item([c(SENSES, "add", "@x")]), [SENSES], "penumbra"), null);
  assert.equal(passiveSetHas(item([c(SENSES, "add", "penumbra")], [c("system.attributes.sentidos", "override", '{"value":[]}', 60)]), [SENSES], "penumbra"), null);
  assert.equal(passiveSetHas(item([c(SENSES, "add", "penumbra")], [c("system.attributes.sentidos.custom", "override", "x", 60)]), [SENSES], "penumbra"), true);
  assert.equal(passiveSetHas(item([c(SENSES, "add", "penumbra", null, "final")]), [SENSES], "penumbra"), null);
});

test("isAncestorKey: strict ancestors, with * matching any segment", () => {
  assert.ok(isAncestorKey("system.attributes.sentidos", SENSES));
  assert.ok(isAncestorKey("system", SENSES));
  assert.ok(isAncestorKey("system.attributes.movement.*", WALK));
  assert.ok(!isAncestorKey(SENSES, SENSES));
  assert.ok(!isAncestorKey("system.attributes.sentidos.custom", SENSES));
});

function auraItem(targets, behaviors) {
  const src = item([c(SENSES, "add", "penumbra")]);
  src.effects[0].system.targets = targets;
  src.effects[0].system.aura = { isAura: true, range: 3 };
  if (behaviors !== undefined) src.effects[0].system.aura.behaviors = behaviors;
  return src;
}

test("appliesToSelf: auras with applyActiveEffect need self in targets; behaviors are JSON text", () => {
  const ally = auraItem(["ally"], JSON.stringify({ a: { type: "applyActiveEffect" } }));
  assert.equal(typeof ally.effects[0].system.aura.behaviors, "string");
  assert.equal(appliesToSelf(ally.effects[0]), false);
  assert.equal(passiveSetHas(ally, [SENSES], "penumbra"), null);
  assert.equal(appliesToSelf(auraItem(["self", "ally"], JSON.stringify({ a: { type: "applyActiveEffect" } })).effects[0]), true);
  const asSet = auraItem([], JSON.stringify({ a: { type: "applyActiveEffect" } })).effects[0];
  asSet.system.targets = new Set(["self"]);
  assert.equal(appliesToSelf(asSet), true);
  assert.equal(appliesToSelf(auraItem(["ally"], JSON.stringify({ a: { type: "other" } })).effects[0]), true);
  assert.equal(appliesToSelf(auraItem(["ally"], JSON.stringify([{ type: "applyActiveEffect" }])).effects[0]), false);
  assert.equal(appliesToSelf(auraItem(["ally"], undefined).effects[0]), null);
  assert.equal(appliesToSelf(auraItem(["ally"], "{not json").effects[0]), null);
  assert.equal(appliesToSelf(auraItem(["ally"], JSON.stringify({ a: null })).effects[0]), null);
});

test("classify: present, fixed, unknown and missing", () => {
  const entry = { fix: (s) => (s.wrong ? {} : null), isCorrect: (s) => s.right === true };
  assert.equal(classify(entry, { wrong: true }), "present");
  assert.equal(classify(entry, { right: true }), "fixed");
  assert.equal(classify(entry, {}), "unknown");
  assert.equal(classify(entry, undefined), "missing");
});

test("summarize: confidence follows what was verified", () => {
  const r = (...states) => states.map((state, i) => ({ name: `e${i}`, state }));
  assert.deepEqual(
    [summarize(r("present")).bug, summarize(r("present")).confidence],
    ["present", "high"]
  );
  assert.equal(summarize(r("present", "fixed")).confidence, "high");
  const missing = summarize(r("present", "missing"));
  assert.deepEqual([missing.bug, missing.confidence], ["present", "low"]);
  assert.match(missing.evidence, /unverified: e1/);
  assert.equal(summarize(r("present", "unknown")).confidence, "low");
  assert.deepEqual([summarize(r("fixed", "fixed")).bug, summarize(r("fixed")).confidence], ["fixed", "high"]);
  assert.equal(summarize(r("fixed"), "low").confidence, "low");
  assert.deepEqual([summarize(r("fixed", "missing")).bug, summarize(r("fixed", "unknown")).confidence], ["unknown", "low"]);
  assert.equal(summarize([]), undefined);
});
