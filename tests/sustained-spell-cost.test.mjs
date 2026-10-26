import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSustainOrigin,
  queueByKey,
  relabelPendingMarker,
  relabelSustainMarker,
  sustainCostIsPerMarker,
  unifySustainedOrigins,
  wrapSustainedPreCreate
} from "../scripts/patches/sustained-spell-cost.mjs";

const FLAG = "t20-community-patches";
const sustained = (name, origin, extra = {}) => ({ name, origin, duration: { expiry: "sustainEnd" }, ...extra });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const withTimeout = (promise, ms = 500) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

test("parseSustainOrigin: splits caster and marker id; rejects malformed origins", () => {
  assert.deepEqual(parseSustainOrigin("Actor.a.ActiveEffect.x"), { casterUuid: "Actor.a", markerId: "x" });
  for (const bad of ["Actor.a", "Actor.a.ActiveEffect.", "A.ActiveEffect.x.ActiveEffect.y", null, undefined, 3]) {
    assert.equal(parseSustainOrigin(bad), null, String(bad));
  }
});

test("unifySustainedOrigins: Oração bonus and penalty share the first origin and get the spell label", () => {
  const bonus = sustained("Oração (Bônus)", "Actor.a.ActiveEffect.x");
  const penalty = sustained("Oração (Penalidade)", "Actor.a.ActiveEffect.y");
  assert.equal(unifySustainedOrigins([[bonus], [penalty]], "Oração"), 1);
  assert.equal(bonus.origin, "Actor.a.ActiveEffect.x");
  assert.equal(penalty.origin, "Actor.a.ActiveEffect.x");
  assert.equal(bonus.flags[FLAG].sustainLabel, "Oração");
  assert.equal(penalty.flags[FLAG].sustainLabel, "Oração");
});

test("unifySustainedOrigins: keeps other flags and never mutates the original flags object", () => {
  const original = { tormenta20: { a: 1 }, [FLAG]: { sameAbility: "id" } };
  const bonus = sustained("B", "Actor.a.ActiveEffect.x", { flags: original });
  const penalty = sustained("P", "Actor.a.ActiveEffect.y");
  unifySustainedOrigins([[bonus], [penalty]], "Oração");
  assert.deepEqual(original, { tormenta20: { a: 1 }, [FLAG]: { sameAbility: "id" } });
  assert.notEqual(bonus.flags, original);
  assert.deepEqual(bonus.flags.tormenta20, { a: 1 });
  assert.deepEqual(bonus.flags[FLAG], { sameAbility: "id", sustainLabel: "Oração" });
});

test("unifySustainedOrigins: a single sustained effect or an already shared origin is left alone", () => {
  const only = sustained("Velocidade", "Actor.a.ActiveEffect.x");
  assert.equal(unifySustainedOrigins([[only]], "Velocidade"), 0);
  assert.equal(only.flags, undefined);
  const a = sustained("A", "Actor.a.ActiveEffect.x");
  const b = sustained("B", "Actor.a.ActiveEffect.x");
  assert.equal(unifySustainedOrigins([[a], [b]], "Spell"), 0);
  assert.equal(a.flags, undefined);
  assert.equal(b.flags, undefined);
});

test("unifySustainedOrigins: ignores non-sustained, other casters and region origins; children take part", () => {
  const timed = { name: "T", origin: "Actor.a", duration: { expiry: "turnStart" } };
  const otherA = sustained("A", "Actor.a.ActiveEffect.x");
  const otherB = sustained("B", "Actor.b.ActiveEffect.y");
  const region = sustained("R", "Scene.s.Region.r.RegionBehavior.b");
  assert.equal(unifySustainedOrigins([[timed], [otherA], [otherB], [region]], "S"), 0);
  assert.equal(otherB.origin, "Actor.b.ActiveEffect.y");
  assert.equal(region.origin, "Scene.s.Region.r.RegionBehavior.b");

  const parent = { name: "Pai", origin: "Actor.a", duration: { expiry: "turnStart" } };
  const child = sustained("Filho", "Actor.a.ActiveEffect.c");
  const other = sustained("Outro", "Actor.a.ActiveEffect.d");
  assert.equal(unifySustainedOrigins([[parent, child], [other]], "S"), 1);
  assert.equal(other.origin, "Actor.a.ActiveEffect.c");
  assert.equal(parent.origin, "Actor.a");
});

test("unifySustainedOrigins: tolerates missing or malformed entries", () => {
  assert.equal(unifySustainedOrigins(undefined, "S"), 0);
  assert.equal(unifySustainedOrigins([], "S"), 0);
  assert.equal(unifySustainedOrigins([null, "x", {}, [null]], "S"), 0);
});

test("relabelSustainMarker: swaps the applied effect suffix for the spell name", () => {
  assert.equal(relabelSustainMarker("Sustentando (Oração (Bônus))", "Oração (Bônus)", "Oração"), "Sustentando (Oração)");
  assert.equal(relabelSustainMarker("Sustentando (Outro)", "Oração (Bônus)", "Oração"), null);
  assert.equal(relabelSustainMarker("Sustentando (Oração)", "Oração", "Oração"), null);
  assert.equal(relabelSustainMarker(null, "a", "b"), null);
  assert.equal(relabelSustainMarker("x (a)", 1, "b"), null);
});

test("queueByKey: same key runs in order, a failure does not block, other keys run in parallel, map empties", async () => {
  const queues = new Map();
  const log = [];
  let release;
  const first = queueByKey(queues, "k", async () => {
    log.push("1 start");
    await new Promise((r) => (release = r));
    log.push("1 end");
    throw new Error("boom");
  });
  const second = queueByKey(queues, "k", () => {
    log.push("2");
    return "ok";
  });
  const other = queueByKey(queues, "j", () => {
    log.push("other");
    return "j";
  });
  await tick();
  assert.deepEqual(log, ["1 start", "other"]);
  release();
  await assert.rejects(first, /boom/);
  assert.equal(await second, "ok");
  assert.equal(await other, "j");
  assert.deepEqual(log, ["1 start", "other", "1 end", "2"]);
  await tick();
  assert.equal(queues.size, 0);
});

/** Simulates BaseEffect#_preCreate (T20:17897-17907) and the core preCreate hook for the nested marker. */
function simulateSystem({ wrap }) {
  const markers = new Map();
  const state = { queues: new Map(), labels: new Map() };
  const caster = { uuid: "Actor.c" };
  let preCreate;
  async function original(data) {
    if (data.duration?.expiry === "sustainEnd" && data.origin) {
      if (markers.has(data.origin)) return;
      const [, id] = data.origin.split(".ActiveEffect.");
      await tick();
      const marker = {
        _id: id,
        name: `Sustentando (${data.name})`,
        statuses: ["sustentando"],
        duration: { expiry: "sustainEnd" },
        origin: null
      };
      await create(marker);
    }
  }
  async function create(data) {
    const doc = {
      id: data._id,
      name: data.name,
      parent: caster,
      statuses: new Set(data.statuses ?? []),
      updateSource(changes) {
        Object.assign(data, changes);
        Object.assign(this, changes);
      }
    };
    await preCreate.call(doc, data);
    relabelPendingMarker(doc, data, state.labels);
    const origin = `${caster.uuid}.ActiveEffect.${data._id}`;
    if (markers.has(origin)) throw new Error(`duplicate id ${data._id}`);
    markers.set(origin, data);
  }
  preCreate = wrap ? wrapSustainedPreCreate(original, state) : original;
  return { markers, state, preCreate };
}

test("wrapSustainedPreCreate: overlapping applications of one cast create a single, relabeled marker", async () => {
  const sim = simulateSystem({ wrap: true });
  const flags = { [FLAG]: { sustainLabel: "Oração" } };
  const bonus = sustained("Oração (Bônus)", "Actor.c.ActiveEffect.m", { flags });
  const penalty = sustained("Oração (Penalidade)", "Actor.c.ActiveEffect.m", { flags });
  await withTimeout(Promise.all([sim.preCreate.call({}, bonus), sim.preCreate.call({}, penalty)]));
  assert.equal(sim.markers.size, 1);
  assert.equal(sim.markers.get("Actor.c.ActiveEffect.m").name, "Sustentando (Oração)");
  assert.equal(sim.state.labels.size, 0);
  await tick();
  assert.equal(sim.state.queues.size, 0);
});

test("simulation without the wrapper reproduces the duplicate marker race", async () => {
  const sim = simulateSystem({ wrap: false });
  const bonus = sustained("Oração (Bônus)", "Actor.c.ActiveEffect.m");
  const penalty = sustained("Oração (Penalidade)", "Actor.c.ActiveEffect.m");
  const results = await Promise.allSettled([sim.preCreate.call({}, bonus), sim.preCreate.call({}, penalty)]);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
});

test("wrapSustainedPreCreate: non-sustained effects and plain actor origins pass straight through", () => {
  const sentinel = Promise.resolve("same");
  const state = { queues: new Map(), labels: new Map() };
  const calls = [];
  const wrapped = wrapSustainedPreCreate(function (data) {
    calls.push([this, data]);
    return sentinel;
  }, state);
  const self = {};
  assert.equal(wrapped.call(self, { duration: { expiry: "turnStart" }, origin: "Actor.a.ActiveEffect.x" }), sentinel);
  assert.equal(wrapped.call(self, sustained("S", "Actor.a")), sentinel);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], self);
  assert.equal(state.queues.size, 0);
});

test("relabelPendingMarker: ignores non-markers, orphans and unknown origins", () => {
  const labels = new Map([["Actor.c.ActiveEffect.m", { appliedName: "A", label: "S" }]]);
  let updated = 0;
  const base = { id: "m", name: "Sustentando (A)", parent: { uuid: "Actor.c" }, updateSource: () => updated++ };
  assert.equal(relabelPendingMarker({ ...base, statuses: new Set() }, {}, labels), false);
  assert.equal(relabelPendingMarker({ ...base, statuses: new Set(["sustentando"]), parent: null }, {}, labels), false);
  assert.equal(relabelPendingMarker({ ...base, statuses: new Set(["sustentando"]), id: "z" }, {}, labels), false);
  assert.equal(updated, 0);
  assert.equal(relabelPendingMarker({ ...base, statuses: new Set(["sustentando"]) }, {}, labels), true);
  assert.equal(updated, 1);
});

test("sustainCostIsPerMarker: recognizes the 1.6.5 per-marker charge, ignoring comments", () => {
  const system = `const effects = actor.effects.filter((e) => e.statuses.first() == "sustentando");
    if (toUpdate.length) await actor.spendMana(toUpdate.length, 0, false);`;
  assert.equal(sustainCostIsPerMarker(system), true);
  assert.equal(
    sustainCostIsPerMarker(`e.statuses.first() == "sustentando"; // spendMana(toUpdate.length, 0, false)`),
    false
  );
  assert.equal(sustainCostIsPerMarker(`"sustentando"; actor.spendMana(casts.size, 0, false)`), false);
  assert.equal(sustainCostIsPerMarker(42), false);
});
