import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidatesOf,
  diagnose,
  isCandidate,
  repairUpdate,
  sameStatus,
  statusFromFlags,
  undoPlan
} from "../scripts/features/legacy-condition-status/domain.mjs";
import { parentsOf, scan } from "../scripts/features/legacy-condition-status/integration/scan.mjs";
import { repairUpdates, runWrite, undoUpdates } from "../scripts/features/legacy-condition-status/integration/write.mjs";
import { install, lateProbe } from "../scripts/features/legacy-condition-status/integration/index.mjs";
import { undoableGroups } from "../scripts/features/legacy-condition-status/ui.mjs";
import { createFakePlatform } from "./support/fake-platform.mjs";

const MARK = "t20-community-patches";
const FATIGADO_FLAGS = { condition: true, durationScene: true, stack: "exausto", childEffect: ["fraco", "vulneravel"], category: "cansaco" };
const FATIGADO_STATUS = { category: "cansaco", ignoreImunity: false, upgrade: "exausto", childEffect: ["fraco", "vulneravel"] };

const legacy = (id, flags = FATIGADO_FLAGS, extra = {}) => ({
  _id: id,
  name: id,
  system: { status: null },
  flags: { tormenta20: structuredClone(flags) },
  ...extra
});
const repaired = (id, status = FATIGADO_STATUS) => ({
  ...legacy(id),
  system: { status: structuredClone(status) },
  flags: { tormenta20: structuredClone(FATIGADO_FLAGS), [MARK]: { legacyConditionStatus: { status: structuredClone(status) } } }
});

/** A world collection: iterable over its documents, with get(id). */
function collection(docs) {
  const map = new Map(docs.map((doc) => [doc.id, doc]));
  return { get: (id) => map.get(id), [Symbol.iterator]: () => map.values(), map };
}

function writable(effects, log) {
  return {
    async updateEmbeddedDocuments(type, updates) {
      log?.push({ type, updates });
      for (const update of updates) {
        const effect = effects.find((e) => e._id === update._id);
        if (effect && "system.status" in update) effect.system.status = update["system.status"];
      }
      return updates.map((update) => ({ id: update._id }));
    }
  };
}

function actorDoc(id, effects, items = []) {
  const itemDocs = items.map((item) => ({ id: item._id, _source: item, ...writable(item.effects) }));
  return { id, name: id, _source: { effects, items }, items: collection(itemDocs), ...writable(effects) };
}

function tokenDoc(id, { actorId, actorLink = false, effects = [], items = [] }) {
  const delta = { effects, items };
  const actor = { ...writable(effects), items: collection(items.map((i) => ({ id: i._id, ...writable(i.effects) }))) };
  return { id, name: id, _source: { actorLink, actorId, delta }, actor };
}

function world({ actors = [], scenes = [], items = [] } = {}) {
  return createFakePlatform({
    documents: { actors: () => collection(actors), scenes: () => collection(scenes), items: () => collection(items) }
  });
}

const sceneDoc = (id, tokens) => ({ id, name: id, tokens: collection(tokens) });

test("isCandidate: only 1.5 conditions left with a null status and no onuse", () => {
  assert.equal(isCandidate(legacy("a")), true);
  assert.equal(isCandidate(repaired("a")), false);
  assert.equal(isCandidate({ ...legacy("a"), flags: { tormenta20: {} } }), false);
  assert.equal(isCandidate({ ...legacy("a"), system: { status: null, onuse: { active: true } } }), false);
  assert.equal(isCandidate(undefined), false);
});

test("statusFromFlags rebuilds the schema shape from the 1.5 flags and cleans bad values", () => {
  assert.deepEqual(statusFromFlags(FATIGADO_FLAGS), FATIGADO_STATUS);
  assert.deepEqual(statusFromFlags({}), { category: "", ignoreImunity: false, upgrade: "", childEffect: [] });
  assert.deepEqual(statusFromFlags({ childEffect: ["fraco", "fraco", 3, " ", null, " vulneravel "], ignoreImunity: "yes" }), {
    category: "",
    ignoreImunity: false,
    upgrade: "",
    childEffect: ["fraco", "vulneravel"]
  });
});

test("repairUpdate writes the status and the mark with the same status", () => {
  const update = repairUpdate(legacy("a"), { at: "2026-11-05T00:00:00.000Z", moduleVersion: "1.0.0" });
  assert.deepEqual(update["system.status"], FATIGADO_STATUS);
  assert.deepEqual(update[`flags.${MARK}.legacyConditionStatus`], {
    status: FATIGADO_STATUS,
    at: "2026-11-05T00:00:00.000Z",
    moduleVersion: "1.0.0"
  });
  assert.equal(update._id, "a");
});

test("sameStatus ignores child order and never confuses a joined id with two ids", () => {
  assert.equal(sameStatus(FATIGADO_STATUS, { ...FATIGADO_STATUS, childEffect: ["vulneravel", "fraco"] }), true);
  assert.equal(sameStatus(FATIGADO_STATUS, { ...FATIGADO_STATUS, category: "mental" }), false);
  assert.equal(sameStatus({ ...FATIGADO_STATUS, childEffect: ["fraco,vulneravel"] }, FATIGADO_STATUS), false);
  assert.equal(sameStatus(null, FATIGADO_STATUS), false);
});

test("undoPlan: undoes only what the tool wrote and still holds", () => {
  assert.equal(undoPlan(legacy("a")), null);
  const plan = undoPlan(repaired("a"));
  assert.equal(plan.kind, "undo");
  assert.deepEqual(plan.update, { _id: "a", "system.status": null, [`flags.${MARK}.-=legacyConditionStatus`]: null });
  const edited = repaired("a");
  edited.system.status.category = "mental";
  assert.deepEqual(undoPlan(edited), { kind: "changed" });
});

test("candidatesOf lists only candidates, with the status that will be written", () => {
  assert.deepEqual(candidatesOf([legacy("a"), repaired("b"), { _id: "c", flags: {} }]), [
    { id: "a", name: "a", status: FATIGADO_STATUS }
  ]);
  assert.deepEqual(candidatesOf(undefined), []);
});

test("diagnose: the 1.6.6 migration branch is present/low; anything else is unknown/low", () => {
  const buggy = `function migrateEffectsV2(doc, ops) {
    // condition branch
    if (flags?.condition) {
      Object.assign(updateData, {
        status: { category: flags.category, ignoreImunity: flags.ignoreImunity, upgrade: flags.stack }
      });
    }
  }`;
  assert.deepEqual(diagnose(buggy).bug, "present");
  assert.equal(diagnose(buggy).confidence, "low");
  const fixed = buggy.replace("status: {", "system: { status: {").replace("} }", "} } }");
  assert.deepEqual([diagnose(fixed).bug, diagnose(fixed).confidence], ["unknown", "low"]);
  assert.deepEqual([diagnose(null).bug, diagnose(null).confidence], ["unknown", "low"]);
});

test("scan finds candidates in actors, actor items, unlinked token deltas, token items and world items", () => {
  const platform = world({
    actors: [actorDoc("hero", [legacy("abalado"), repaired("fatigado")], [{ _id: "sword", name: "sword", effects: [legacy("swordFx")] }])],
    scenes: [
      sceneDoc("s1", [
        tokenDoc("npc", { actorId: "goblin", effects: [legacy("tokenFx")], items: [{ _id: "club", name: "club", effects: [legacy("clubFx")] }] }),
        tokenDoc("linked", { actorId: "hero", actorLink: true, effects: [legacy("linkedFx")] })
      ])
    ],
    items: [{ id: "potion", name: "potion", _source: { effects: [legacy("potionFx")] } }]
  });
  const { repair, repaired: done } = scan(platform);
  assert.deepEqual(
    repair.map((g) => [g.key, g.candidates.map((c) => c.id)]),
    [
      ["Actor.hero", ["abalado"]],
      ["Actor.hero.Item.sword", ["swordFx"]],
      ["Scene.s1.Token.npc", ["tokenFx"]],
      ["Scene.s1.Token.npc.Item.club", ["clubFx"]],
      ["Item.potion", ["potionFx"]]
    ]
  );
  assert.deepEqual(
    done.map((g) => [g.key, g.marks.map((m) => [m.id, m.plan.kind])]),
    [["Actor.hero", [["fatigado", "undo"]]]]
  );
});

test("a token's group only holds its own delta effects, never the base actor's", () => {
  const platform = world({
    actors: [actorDoc("goblin", [repaired("baseFx")])],
    scenes: [sceneDoc("s1", [tokenDoc("npc", { actorId: "goblin", effects: [repaired("ownFx")] })])]
  });
  const token = scan(platform).repaired.find((g) => g.key === "Scene.s1.Token.npc");
  assert.deepEqual(token.marks.map((m) => m.id), ["ownFx"]);
});

test("a token's locate() returns null once it is relinked or rebuilt on another actor", () => {
  const token = tokenDoc("npc", { actorId: "goblin", effects: [legacy("fx")] });
  const platform = world({ scenes: [sceneDoc("s1", [token])] });
  const group = [...parentsOf(platform)].find((p) => p.key === "Scene.s1.Token.npc");
  assert.equal(group.locate().doc, token.actor);
  token._source.actorId = "orc";
  assert.equal(group.locate(), null);
  token._source.actorId = "goblin";
  token._source.actorLink = true;
  assert.equal(group.locate(), null);
});

test("repairUpdates writes only previewed effects that would still get the approved status", () => {
  const group = { candidates: [{ id: "a", status: FATIGADO_STATUS }, { id: "b", status: FATIGADO_STATUS }, { id: "c", status: FATIGADO_STATUS }, { id: "gone", status: FATIGADO_STATUS }] };
  const changed = legacy("b");
  changed.flags.tormenta20.category = "mental";
  const sources = [legacy("a"), changed, repaired("c"), legacy("extra")];
  const { updates, skipped } = repairUpdates(group, sources, { at: "t", moduleVersion: "v" });
  assert.deepEqual(updates.map((u) => u._id), ["a"]);
  assert.equal(skipped, 3);
});

test("undoUpdates only touches previewed marks found in the parent's own sources", () => {
  const edited = repaired("b");
  edited.system.status.upgrade = "";
  const { updates, skipped } = undoUpdates({ marks: [{ id: "a" }, { id: "b" }, { id: "missing" }] }, [repaired("a"), edited, repaired("inherited")]);
  assert.deepEqual(updates.map((u) => u._id), ["a"]);
  assert.equal(skipped, 2);
});

function writeCtx(gm = { isGM: true, isActiveGM: true }) {
  const errors = [];
  return {
    gm,
    errors,
    platform: { user: { isGM: () => gm.isGM, isActiveGM: () => gm.isActiveGM } },
    log: { error: (...args) => errors.push(args) }
  };
}

const build = (group) => ({ updates: group.candidates.map(({ id }) => ({ _id: id })), skipped: 0 });
const groupOf = (label, ids, doc) => ({ label, candidates: ids.map((id) => ({ id })), locate: () => (doc ? { doc, sources: [] } : null) });
const recorder = (calls, result = (updates) => updates.map((u) => ({ id: u._id }))) => ({
  async updateEmbeddedDocuments(_type, updates) {
    calls.push(updates.map((u) => u._id));
    return result(updates);
  }
});

test("runWrite refuses users that are not the active GM and writes nothing", async () => {
  const calls = [];
  for (const gm of [{ isGM: false, isActiveGM: false }, { isGM: true, isActiveGM: false }]) {
    assert.equal(await runWrite(writeCtx(gm), { busy: false }, [groupOf("a", ["x"], recorder(calls))], build), null);
  }
  assert.deepEqual(calls, []);
});

test("runWrite stops when the user stops being the active GM in the middle of a run", async () => {
  const calls = [];
  const ctx = writeCtx();
  const first = { async updateEmbeddedDocuments(_t, updates) {
    calls.push("first");
    ctx.gm.isActiveGM = false;
    return updates.map((u) => ({ id: u._id }));
  } };
  const result = await runWrite(ctx, { busy: false }, [groupOf("a", ["x"], first), groupOf("b", ["y"], recorder(calls))], build);
  assert.deepEqual(calls, ["first"]);
  assert.equal(result.stopped, true);
  assert.equal(result.done, 1);
});

test("runWrite: a second run with the same lock is refused while the first is running", async () => {
  const lock = { busy: false };
  let release;
  const slow = { updateEmbeddedDocuments: (_t, updates) => new Promise((resolve) => (release = () => resolve(updates.map((u) => ({ id: u._id }))))) };
  const first = runWrite(writeCtx(), lock, [groupOf("a", ["x"], slow)], build);
  assert.equal(await runWrite(writeCtx(), lock, [groupOf("b", ["y"], recorder([]))], build), null);
  release();
  assert.equal((await first).done, 1);
  assert.equal(lock.busy, false);
});

test("runWrite skips missing parents, isolates failures and only counts what the core returned", async () => {
  const calls = [];
  const ctx = writeCtx();
  const broken = { updateEmbeddedDocuments: async () => {
    throw new Error("boom");
  } };
  const result = await runWrite(
    ctx,
    { busy: false },
    [
      groupOf("gone", ["a", "b"], null),
      groupOf("broken", ["c"], broken),
      groupOf("cancelled", ["d"], recorder(calls, () => [])),
      groupOf("partial", ["e", "f"], recorder(calls, (updates) => [{ id: updates[0]._id }])),
      groupOf("ok", ["g"], recorder(calls))
    ],
    build
  );
  assert.deepEqual(result, { done: 2, skipped: 2, failed: ["broken", "cancelled (1)", "partial (1)"], stopped: false });
  assert.deepEqual(calls, [["d"], ["e", "f"], ["g"]]);
  assert.equal(ctx.errors.length, 1);
});

test("repair through runWrite writes the status into a token delta, and a second run writes nothing", async () => {
  const effects = [legacy("fx")];
  const platform = world({ scenes: [sceneDoc("s1", [tokenDoc("npc", { actorId: "goblin", effects })])] });
  const ctx = { platform, log: { error: () => {} } };
  const groups = scan(platform).repair;
  const meta = { at: "t", moduleVersion: "v" };
  const first = await runWrite(ctx, { busy: false }, groups, (g, s) => repairUpdates(g, s, meta));
  assert.equal(first.done, 1);
  assert.deepEqual(effects[0].system.status, FATIGADO_STATUS);
  assert.deepEqual(scan(platform).repair, []);
});

test("undoableGroups drops changed marks and empty groups", () => {
  const groups = undoableGroups([
    { key: "a", marks: [{ id: "x", plan: { kind: "undo" } }, { id: "y", plan: { kind: "changed" } }] },
    { key: "b", marks: [{ id: "z", plan: { kind: "changed" } }] }
  ]);
  assert.deepEqual(groups.map((g) => [g.key, g.marks.map((m) => m.id)]), [["a", ["x"]]]);
});

test("lateProbe reports the affected data to GMs and says nothing when there is none", async () => {
  const withData = world({ actors: [actorDoc("hero", [legacy("a"), legacy("b")])] });
  const diagnosis = await lateProbe({ platform: withData });
  assert.deepEqual([diagnosis.bug, diagnosis.confidence], ["present", "high"]);
  assert.match(diagnosis.evidence, /2 conditions .* 1 documents/);
  assert.equal(await lateProbe({ platform: world({ actors: [actorDoc("hero", [repaired("a")])] }) }), undefined);
  const player = createFakePlatform({ isGM: false, documents: withData.documents });
  assert.equal(await lateProbe({ platform: player }), undefined);
});

test("install registers a restricted menu and fails early without the items port", () => {
  class ApplicationV2 {}
  const platform = createFakePlatform({ core: { ApplicationV2 }, documents: { items: () => collection([]) } });
  install({ platform, log: { error: () => {} } });
  const menu = platform.registered.get("menu:legacyConditionStatus");
  assert.ok(menu, "menu registered");
  assert.equal(menu.restricted, true);
  assert.equal(Object.getPrototypeOf(menu.type), ApplicationV2);
  assert.throws(() => install({ platform: createFakePlatform({ core: { ApplicationV2 } }), log: {} }), /items port/);
});
