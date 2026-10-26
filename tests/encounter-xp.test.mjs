import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditAwards,
  awardFromRecords,
  canLevelUp,
  collectAwards,
  computeAward,
  createQueue,
  encounterNd,
  escapeHtml,
  executorBlock,
  findOverlap,
  gmSummaryHtml,
  groupLevel,
  parseNd,
  partitionSnapshot,
  planMap,
  planRecord,
  publicSummaryHtml,
  recipientStatus,
  recipientsError,
  resolveEncounterNd,
  resumeAudience,
  runAward
} from "../scripts/rules/encounter-xp.mjs";

const XP_TABLE = [0, 1000, 3000, 6000, 10000, 15000, 21000, 28000, 36000, 45000, 55000, 66000, 78000, 91000, 105000, 120000, 136000, 153000, 171000, 190000];
const won = (key, nd) => ({ key, nd, won: true });

/**
 * In-memory world: actors with XP and the module flag, the active GM and the settings. client(userId) gives the deps
 * of one GM client (its own queue); hooks simulate slow or failing updates, concurrent edits and setting changes.
 * writeAward applies XP and the flag together, like one actor.update (atomic per document).
 */
function fakeWorld(xp = {}) {
  const state = { actors: {}, writes: [], activeGm: "gm", mode: "button", disabled: false, hooks: {} };
  for (const [uuid, value] of Object.entries(xp)) state.actors[uuid] = { xp: value, awards: {} };
  const client = (userId) => ({
    queue: createQueue(),
    guard: () => executorBlock({ isGm: true, isActiveGm: state.activeGm === userId, mode: state.mode, disabled: state.disabled }),
    readActor: async (uuid) => {
      await state.hooks.read?.(uuid, userId);
      const actor = state.actors[uuid];
      if (!actor) throw new Error(`missing ${uuid}`);
      return structuredClone(actor);
    },
    writeAward: async (uuid, value, id, record) => {
      await state.hooks.beforeWrite?.(uuid, userId);
      const actor = state.actors[uuid];
      if (!actor) throw new Error(`missing ${uuid}`);
      actor.xp = value;
      actor.awards[id] = structuredClone(record);
      state.writes.push([uuid, value, id]);
      await state.hooks.afterWrite?.(uuid, userId);
    }
  });
  return { state, client, holders: () => Object.entries(state.actors).map(([uuid, a]) => ({ uuid, awards: a.awards })) };
}

const award = (overrides = {}) => ({
  id: "X",
  at: 1,
  by: "gm",
  outcome: "victory",
  repeat: false,
  share: 100,
  challenges: ["Scene.s.Token.ogro"],
  recipients: [
    { uuid: "Actor.a", name: "Ana", level: 1 },
    { uuid: "Actor.b", name: "Bia", level: 1 }
  ],
  ...overrides
});

const statuses = (run) => run.results.map((r) => r.status);

test("parseNd: fractions, integers, S/S+ flagged as 20, invalid text → null", () => {
  assert.deepEqual(parseNd("1/4"), { value: 0.25, label: "1/4", special: false });
  assert.deepEqual(parseNd("½"), { value: 0.5, label: "1/2", special: false });
  assert.equal(parseNd(" 7 ").value, 7);
  assert.deepEqual(parseNd("s+"), { value: 20, label: "S+", special: true });
  for (const bad of ["", "abc", "21", "0", "1/3", null]) assert.equal(parseNd(bad), null);
});

test("encounterNd: book and Ameaças de Arton examples", () => {
  assert.equal(encounterNd([7, 6, 5, 3]), 8);
  assert.equal(encounterNd([8, 8]), 10);
  assert.equal(encounterNd([5, 5, 5, 5]), 9);
  assert.equal(encounterNd([0.25, 0.25, 0.25, 0.25]), 1);
  assert.equal(encounterNd([0.5, 0.5]), 1);
  assert.equal(encounterNd([1, 1]), 3);
  assert.equal(encounterNd([5, 5, 5]), 7);
  assert.equal(encounterNd([0.25, 0.25, 0.25]), 0.75);
  // 8+8 → 10, which then sits 1 above the 9: 10 + 1.
  assert.equal(encounterNd([8, 8, 9]), 11);
  assert.equal(encounterNd([]), 0);
});

test("computeAward: ND × 1,000 split by characters, outcome factors, irrelevant challenges", () => {
  assert.equal(computeAward({ challenges: [won("o", 5)], recipientCount: 4 }).share, 1250);
  assert.equal(computeAward({ challenges: [won("g", 0.25)], recipientCount: 1 }).share, 250);
  assert.equal(computeAward({ challenges: [won("o", 5)], recipientCount: 4, outcome: "draw" }).share, 625);
  assert.equal(computeAward({ challenges: [won("o", 5)], recipientCount: 4, outcome: "defeat" }).share, 312);
  const mixed = computeAward({ challenges: [won("g", 0.25), won("l", 0.5), won("t", 1)], recipientCount: 4 });
  assert.deepEqual([mixed.total, mixed.share], [1750, 437]);
  const skipped = computeAward({ challenges: [won("o", 5)], recipientCount: 1, level: 10 });
  assert.deepEqual([skipped.total, skipped.rows[0].irrelevant, skipped.error], [0, true, "zero"]);
  assert.equal(computeAward({ challenges: [won("o", 5)], recipientCount: 1, level: 10, skipIrrelevant: false }).total, 5000);
  assert.equal(computeAward({ challenges: [won("o", 5), { key: "x", nd: 9, won: false }], recipientCount: 1 }).total, 5000);
});

test("computeAward: encounter mode uses the encounter rating (Ameaças de Arton p. 376)", () => {
  const award = computeAward({ challenges: [won("a", 8), won("b", 8)], recipientCount: 4, mode: "encounter" });
  assert.deepEqual([award.encounter, award.total, award.share], [10, 10000, 2500]);
  assert.equal(computeAward({ challenges: [won("a", 8)], recipientCount: 1, mode: "encounter", encounter: 6 }).total, 6000);
  const low = computeAward({ challenges: [won("a", 1)], recipientCount: 1, mode: "encounter", level: 6 });
  assert.deepEqual([low.irrelevant, low.error], [true, "zero"]);
});

test("computeAward: no recipients, no challenge or an invalid ND is an error, never Infinity/NaN", () => {
  assert.deepEqual(computeAward({ challenges: [won("o", 5)], recipientCount: 0 }), { error: "recipients" });
  assert.deepEqual(computeAward({ challenges: [{ key: "o", nd: 5, won: false }], recipientCount: 2 }), { error: "challenges" });
  assert.deepEqual(computeAward({ challenges: [won("o", null)], recipientCount: 2 }), { error: "nd" });
  assert.deepEqual(computeAward({ challenges: [won("o", 5)], recipientCount: 2, outcome: "x" }), { error: "outcome" });
  // 250 × ¼ ÷ 400 rounds down to 0: nothing to record.
  assert.equal(computeAward({ challenges: [won("g", 0.25)], recipientCount: 400, outcome: "defeat" }).error, "zero");
});

test("groupLevel and canLevelUp", () => {
  assert.equal(groupLevel([3, 4, 4, 5]), 4);
  assert.equal(groupLevel([]), 1);
  assert.equal(canLevelUp(1, 1000, XP_TABLE), true);
  assert.equal(canLevelUp(1, 999, XP_TABLE), false);
  assert.equal(canLevelUp(19, 190000, XP_TABLE), true);
  assert.equal(canLevelUp(20, 999999, XP_TABLE), false);
});

test("partitionSnapshot: challenges per token; recipients deduplicated by actor document", () => {
  const rows = [
    { key: "T.o1", actorUuid: "Actor.ogro", type: "npc", name: "Ogro", ndText: "5", hostile: true },
    { key: "T.o2", actorUuid: "Actor.ogro", type: "npc", name: "Ogro", ndText: "5", hostile: true },
    { key: "T.o2", actorUuid: "Actor.ogro", type: "npc", name: "Ogro", ndText: "5", hostile: true },
    { key: "T.ally", actorUuid: "Actor.guia", type: "npc", name: "Guia", ndText: "2", hostile: false },
    { key: "T.trap", actorUuid: "Actor.trap", type: "hazard", name: "Fosso", ndText: "1/2", hostile: true },
    { key: "T.a1", actorUuid: "Actor.ana", type: "character", name: "Ana", playerOwned: true },
    { key: "T.a2", actorUuid: "Actor.ana", type: "character", name: "Ana", playerOwned: true },
    { key: "Actor.ana", actorUuid: "Actor.ana", type: "character", name: "Ana", playerOwned: true },
    { key: "T.u", actorUuid: "Scene.s.Token.u.Actor.bia", type: "character", name: "Bia", playerOwned: true, unlinked: true },
    { key: "T.s", actorUuid: "Actor.lobo", type: "simple", name: "Lobo convocado" }
  ];
  const { challenges, recipients } = partitionSnapshot(rows);
  assert.deepEqual(challenges.map((c) => [c.key, c.nd, c.won]), [["T.o1", 5, true], ["T.o2", 5, true], ["T.ally", 2, false], ["T.trap", 0.5, true]]);
  assert.deepEqual(recipients.map((r) => [r.actorUuid, r.selected]), [["Actor.ana", true], ["Scene.s.Token.u.Actor.bia", false]]);
});

test("recipientsError: an unlinked token is only awarded after explicit confirmation", () => {
  const selected = [{ actorUuid: "Actor.ana" }, { actorUuid: "Scene.s.Token.u.Actor.bia", unlinked: true }];
  assert.equal(recipientsError(selected, false), "unlinked");
  assert.equal(recipientsError(selected, true), null);
  assert.equal(recipientsError(selected.slice(0, 1), false), null);
});

test("resolveEncounterNd: only an empty field uses the suggestion; invalid text is an error", () => {
  assert.deepEqual(resolveEncounterNd("", 6), { value: 6 });
  assert.deepEqual(resolveEncounterNd("  ", 0), { value: null });
  assert.deepEqual(resolveEncounterNd("1/2", 6), { value: 0.5 });
  assert.deepEqual(resolveEncounterNd("abc", 6), { error: "encounterNd" });
  assert.deepEqual(resolveEncounterNd("21", 6), { error: "encounterNd" });
});


test("runAward: XP and the award record are written together, once per recipient", async () => {
  const { state, client } = fakeWorld({ "Actor.a": 0, "Actor.b": 500 });
  const run = await runAward(award(), client("gm"));
  assert.deepEqual(statuses(run), ["done", "done"]);
  assert.deepEqual(state.writes, [["Actor.a", 100, "X"], ["Actor.b", 600, "X"]]);
  assert.deepEqual([state.actors["Actor.b"].awards.X.before, state.actors["Actor.b"].awards.X.xp], [500, 100]);
  assert.deepEqual(state.actors["Actor.a"].awards.X.recipients.map((r) => r.uuid), ["Actor.a", "Actor.b"]);
});

test("runAward: the same award id again (second click, resume) writes nothing", async () => {
  const { state, client } = fakeWorld({ "Actor.a": 0, "Actor.b": 0 });
  const gm = client("gm");
  await runAward(award(), gm);
  const again = await runAward(award(), gm);
  assert.deepEqual(statuses(again), ["already", "already"]);
  assert.equal(state.writes.length, 2);
});

test("runAward: another award of the same challenge is skipped unless repeated explicitly (button, then end of combat)", async () => {
  const { state, client } = fakeWorld({ "Actor.a": 0, "Actor.b": 0 });
  const gm = client("gm");
  await runAward(award({ id: "X", recipients: [{ uuid: "Actor.a", name: "Ana" }] }), gm);
  const combat = await runAward(award({ id: "Y", challenges: ["Scene.s.Token.ogro", "Scene.s.Token.lobo"] }), gm);
  assert.deepEqual(statuses(combat), ["duplicate", "done"]);
  const repeated = await runAward(award({ id: "Z", repeat: true }), gm);
  assert.deepEqual(statuses(repeated), ["done", "done"]);
  assert.deepEqual([state.actors["Actor.a"].xp, state.actors["Actor.b"].xp], [200, 200]);
});

test("runAward: two dialogs of one client confirming at once pay once", async () => {
  const { state, client } = fakeWorld({ "Actor.a": 0, "Actor.b": 0 });
  const gm = client("gm");
  const runs = await Promise.all([runAward(award({ id: "X" }), gm), runAward(award({ id: "Y" }), gm)]);
  assert.deepEqual(runs.map(statuses), [["done", "done"], ["duplicate", "duplicate"]]);
  assert.deepEqual([state.actors["Actor.a"].xp, state.actors["Actor.b"].xp], [100, 100]);
});

test("delayed write of the old GM: no record is erased and nobody is paid twice", async () => {
  const { state, client, holders } = fakeWorld({ "Actor.a": 0, "Actor.b": 0 });
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  state.hooks.beforeWrite = async (uuid, userId) => {
    if (userId === "gm" && uuid === "Actor.a") await gate;
  };
  const old = runAward(award({ id: "X" }), client("gm"));
  await new Promise((resolve) => setImmediate(resolve));
  state.activeGm = "gm2";
  const fresh = await runAward(award({ id: "Y", by: "gm2", recipients: [{ uuid: "Actor.b", name: "Bia" }] }), client("gm2"));
  assert.deepEqual(statuses(fresh), ["done"]);
  release();
  const late = await old;
  // Bia already holds Y for the same challenge: skipped before the guard is even needed.
  assert.deepEqual(statuses(late), ["done", "duplicate"]);
  assert.deepEqual([state.actors["Actor.a"].xp, state.actors["Actor.b"].xp], [100, 100]);
  assert.deepEqual([Object.keys(state.actors["Actor.a"].awards), Object.keys(state.actors["Actor.b"].awards)], [["X"], ["Y"]]);
  const x = collectAwards(holders()).find((a) => a.id === "X");
  assert.deepEqual(x.pending, []);
  const resumed = await runAward(awardFromRecords(x, "gm2", 2), client("gm2"));
  assert.deepEqual(statuses(resumed), ["already", "duplicate"]);
  assert.equal(state.writes.length, 2);
});

test("failure in the middle: no lock; another GM resumes from the actor records after the challenges are gone", async () => {
  const { state, client, holders } = fakeWorld({ "Actor.a": 0, "Actor.b": 0 });
  state.hooks.beforeWrite = async (uuid) => {
    if (uuid === "Actor.b") throw new Error("offline");
  };
  const run = await runAward(award(), client("gm"));
  assert.deepEqual([statuses(run), run.pending], [["done", "error"], ["Bia"]]);
  delete state.hooks.beforeWrite;
  // gm is still connected; gm2 is now the active GM. Only the actor flags survive (no tokens, combat or dialog).
  state.activeGm = "gm2";
  const [pending] = collectAwards(holders()).filter((a) => a.pending.length);
  assert.deepEqual(pending.pending.map((r) => r.uuid), ["Actor.b"]);
  const resumed = await runAward(awardFromRecords(pending, "gm2", 2), client("gm2"));
  assert.deepEqual(statuses(resumed), ["already", "done"]);
  assert.deepEqual([state.actors["Actor.a"].xp, state.actors["Actor.b"].xp], [100, 100]);
  assert.deepEqual(collectAwards(holders())[0].pending, []);
});

test("guard: checked right before each update; a change after the last read stops without writing", async () => {
  const { state, client } = fakeWorld({ "Actor.a": 0, "Actor.b": 0 });
  state.mode = "off";
  assert.equal((await runAward(award(), client("gm"))).refused, "off");
  state.mode = "button";
  state.hooks.read = async (uuid) => {
    if (uuid === "Actor.b") state.disabled = true;
  };
  const run = await runAward(award(), client("gm"));
  assert.deepEqual([run.stopped, statuses(run), run.pending], ["disabled", ["done", "pending"], ["Bia"]]);
  assert.deepEqual(state.writes, [["Actor.a", 100, "X"]]);
  assert.equal((await runAward(award(), client("gm"))).refused, "disabled");
});

test("runAward: a concurrent edit after the update is reported as a conflict, with the record kept", async () => {
  const { state, client } = fakeWorld({ "Actor.a": 0 });
  state.hooks.afterWrite = async (uuid) => {
    state.actors[uuid].xp = 9999;
  };
  const run = await runAward(award({ recipients: [{ uuid: "Actor.a", name: "Ana" }] }), client("gm"));
  assert.deepEqual([run.results[0].status, run.results[0].target, run.results[0].after], ["conflict", 100, 9999]);
  assert.ok(state.actors["Actor.a"].awards.X);
});

test("late write from an old read: the lost XP is detected and the next award does not build on it", async () => {
  const { state, client, holders } = fakeWorld({ "Actor.a": 0, "Actor.b": 0 });
  let release, blocked;
  const gate = new Promise((resolve) => (release = resolve));
  const inFlight = new Promise((resolve) => (blocked = resolve));
  state.hooks.beforeWrite = async (uuid, userId) => {
    if (userId === "gm" && uuid === "Actor.b") {
      blocked();
      await gate;
    }
  };
  // The old GM wrote X on Ana; its update of Bia (computed from XP 0) is in flight.
  const old = runAward(award({ id: "X" }), client("gm"));
  await inFlight;
  state.activeGm = "gm2";
  const gm2 = client("gm2");
  const [x] = collectAwards(holders()).filter((a) => a.id === "X");
  assert.deepEqual(statuses(await runAward(awardFromRecords(x, "gm2", 2), gm2)), ["already", "done"]);
  const y = award({ id: "Y", share: 200, challenges: ["Scene.s.Token.lobo"], recipients: [{ uuid: "Actor.b", name: "Bia" }] });
  assert.deepEqual(statuses(await runAward(y, gm2)), ["done"]);
  assert.equal(state.actors["Actor.b"].xp, 300);
  release();
  // The late update lands: Bia drops to 100 with both records, and the old run sees exactly what it wrote.
  assert.deepEqual(statuses(await old), ["done", "done"]);
  assert.equal(state.actors["Actor.b"].xp, 100);
  assert.deepEqual(Object.keys(state.actors["Actor.b"].awards).sort(), ["X", "Y"]);
  assert.deepEqual(auditAwards(100, state.actors["Actor.b"].awards), { status: "lost", expected: 300 });
  const z = award({ id: "Z", challenges: ["Scene.s.Token.orc"], recipients: [{ uuid: "Actor.b", name: "Bia" }] });
  const refused = await runAward(z, gm2);
  assert.deepEqual([statuses(refused), refused.results[0].expected, refused.pending], [["diverged"], 300, ["Bia"]]);
  assert.equal(state.actors["Actor.b"].xp, 100);
  // The GM fixes the sheet; the same award id then writes on the right base.
  state.actors["Actor.b"].xp = 300;
  assert.deepEqual(statuses(await runAward(z, gm2)), ["done"]);
  assert.deepEqual([state.actors["Actor.b"].xp, auditAwards(400, state.actors["Actor.b"].awards).status], [400, "ok"]);
});

test("auditAwards: ok, lost (a recorded value), edited (any other) and awards written from the same read", () => {
  const rec = (seq, before, xp) => ({ seq, before, after: before + xp, xp });
  assert.deepEqual(auditAwards(500, {}), { status: "ok", expected: null });
  const chain = { X: rec(1, 0, 100), Y: rec(2, 100, 200) };
  assert.equal(auditAwards(300, chain).status, "ok");
  assert.deepEqual(auditAwards(100, chain), { status: "lost", expected: 300 });
  assert.deepEqual(auditAwards(350, chain), { status: "edited", expected: 300 });
  // Two awards computed from the same read (both seq 1, base 0): the later one overwrote the other.
  const same = { Y: rec(1, 0, 200), X: rec(1, 0, 100) };
  assert.deepEqual(auditAwards(100, same), { status: "lost", expected: 300 });
  assert.equal(auditAwards(300, same).status, "ok");
  // With acceptDivergence the next record starts from the current XP and becomes the reference.
  assert.equal(auditAwards(150, { ...chain, Z: rec(3, 100, 50) }).status, "ok");
});

test("a private award interrupted and resumed keeps its summary audience unless changed explicitly", async () => {
  const { state, client, holders } = fakeWorld({ "Actor.a": 0, "Actor.b": 0 });
  state.hooks.beforeWrite = async (uuid) => {
    if (uuid === "Actor.b") throw new Error("offline");
  };
  await runAward(award({ toPlayers: false }), client("gm"));
  delete state.hooks.beforeWrite;
  const [found] = collectAwards(holders());
  assert.equal(found.toPlayers, false);
  assert.equal(resumeAudience(found, undefined), false);
  assert.equal(resumeAudience(found, true), true);
  assert.equal(resumeAudience({ toPlayers: true }, undefined), true);
  await runAward({ ...awardFromRecords(found, "gm", 2), toPlayers: resumeAudience(found) }, client("gm"));
  assert.equal(state.actors["Actor.b"].awards.X.toPlayers, false);
});

test("recipientStatus, collectAwards and findOverlap", () => {
  const records = { X: { challenges: ["T.o"], recipients: [{ uuid: "A" }, { uuid: "B" }, { uuid: "C" }], xp: 100, at: 1 } };
  assert.equal(recipientStatus(records, { id: "X", challenges: ["T.o"] }), "already");
  assert.equal(recipientStatus(records, { id: "Y", challenges: ["T.o"] }), "duplicate");
  assert.equal(recipientStatus(records, { id: "Y", challenges: ["T.o"], repeat: true }), null);
  assert.equal(recipientStatus({}, { id: "Y", challenges: ["T.o"] }), null);
  const awards = collectAwards([
    { uuid: "A", awards: records },
    { uuid: "B", awards: { Y: { challenges: ["T.o"], recipients: [{ uuid: "B" }], xp: 50, at: 2 } } }
  ]);
  assert.deepEqual(awards.map((a) => [a.id, a.pending.map((r) => r.uuid)]), [["Y", []], ["X", ["C"]]]);
  assert.deepEqual(findOverlap(awards, ["T.o"], "X").map((a) => a.id), ["Y"]);
});

test("a resume trusts only the GM plan: a record forged by a player is never pending and cannot inflate XP", () => {
  const forged = { F: { challenges: ["T.x"], recipients: [{ uuid: "A" }, { uuid: "B" }], xp: 2000000, at: 3 } };
  const real = { X: { challenges: ["T.o"], recipients: [{ uuid: "A" }, { uuid: "B" }], xp: 9999, at: 1 } };
  const plan = planRecord({ id: "X", share: 100, outcome: "victory", repeat: false, toPlayers: false, challenges: ["T.o"], recipients: [{ uuid: "A", name: "Ana", level: 1, extra: 1 }, { uuid: "B", name: "Bia", level: 1 }] });
  assert.deepEqual(plan.recipients[0], { uuid: "A", name: "Ana", level: 1 });
  const plans = planMap([{ gm: false, plan: { ...plan, share: 5000 } }, { gm: true, plan }, { gm: true, plan: { id: "X", share: 1 } }]);
  assert.equal(plans.get("X").share, 100);
  const awards = collectAwards([{ uuid: "A", awards: { ...forged, ...real } }, { uuid: "B", awards: {} }], plans);
  const f = awards.find((a) => a.id === "F");
  const x = awards.find((a) => a.id === "X");
  assert.deepEqual([f.verified, f.pending], [false, []]);
  assert.deepEqual([x.verified, x.share, x.toPlayers, x.pending.map((r) => r.uuid)], [true, 100, false, ["B"]]);
  assert.equal(awardFromRecords(x, "gm", 2).share, 100);
});

test("a GM plan whose writes all failed is pending, without any record on the actors", () => {
  const plan = planRecord({ id: "Z", at: 5, share: 300, outcome: "victory", challenges: ["T.z"], recipients: [{ uuid: "A", name: "Ana", level: 1 }, { uuid: "B", name: "Bia", level: 1 }] });
  const done = planRecord({ id: "D", at: 4, share: 50, outcome: "victory", challenges: ["T.d"], recipients: [{ uuid: "A", name: "Ana", level: 1 }] });
  const actors = [{ uuid: "A", awards: { D: { challenges: ["T.d"], recipients: done.recipients, xp: 50, at: 4 } } }, { uuid: "B", awards: {} }];
  const awards = collectAwards(actors, planMap([{ gm: true, plan }, { gm: true, plan: done }]));
  assert.deepEqual(awards.map((a) => [a.id, a.verified, a.share, a.pending.map((r) => r.uuid)]), [["Z", true, 300, ["A", "B"]], ["D", true, 50, []]]);
  assert.deepEqual(collectAwards(actors).map((a) => a.id), ["D"]);
});

test("summaries: public message has no threat data, skips recipients already paid; names are escaped", () => {
  const t = (key, data) => (data ? `${key}:${JSON.stringify(data)}` : key);
  const results = [
    { name: "<b>Ana</b>", level: 1, delta: 1250, before: 0, after: 1250, status: "done" },
    { name: "Bia", level: 1, delta: 1250, before: 0, after: 0, status: "duplicate" }
  ];
  const html = publicSummaryHtml("victory", results, t, XP_TABLE);
  assert.ok(html.includes("&lt;b&gt;Ana&lt;/b&gt;"));
  assert.ok(html.includes("T20CP.EncounterXp.Chat.LevelUp"));
  assert.ok(!html.includes("Ogro") && !html.includes("Bia"));
  assert.equal(publicSummaryHtml("victory", results.slice(1), t, XP_TABLE), null);
  const gm = gmSummaryHtml({ repeat: false }, results, [{ key: "o", name: "Ogro <i>", ndLabel: "5", treasure: "Padrão.", type: "npc" }], { total: 5000, encounter: null, rows: [{ key: "o", xp: 5000 }] }, t);
  assert.ok(gm.includes("Ogro &lt;i&gt;") && gm.includes("Padrão.") && gm.includes("Skipped") && gm.includes("Bia"));
  assert.equal(escapeHtml(`"'&`), "&quot;&#39;&amp;");
});
