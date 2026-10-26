import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStatusEffectData,
  childStatusesOf,
  coversActor,
  createKeyedQueue,
  createPvTracker,
  isOrphanChild,
  isTracked,
  orphansOf,
  planDyingStates
} from "../scripts/rules/dying-states.mjs";
import { lethalSnapshot } from "../scripts/rules/nonlethal-damage.mjs";

const MODULE = "t20-community-patches";
const plan = (state) => planDyingStates({ max: 8, statuses: new Set(), owned: {}, ...state });
const EMPTY = { create: [], remove: [] };

/* -------------------------------------------- */
/*  Pure logic                                  */
/* -------------------------------------------- */

test("isTracked follows the mode", () => {
  assert.equal(isTracked("character", "characters"), true);
  assert.equal(isTracked("npc", "characters"), false);
  assert.equal(isTracked("npc", "all"), true);
  assert.equal(isTracked("simple", "all"), true);
  assert.equal(isTracked("hazard", "all"), false);
  assert.equal(isTracked("character", "off"), false);
});

test("coversActor reads the setting and is false without it", () => {
  const previous = globalThis.game;
  try {
    globalThis.game = { settings: { get() { throw new Error("not registered"); } } };
    assert.equal(coversActor({ type: "character" }), false);
    globalThis.game = { settings: { get: () => "characters" } };
    assert.equal(coversActor({ type: "character" }), true);
    assert.equal(coversActor({ type: "npc" }), false);
    globalThis.game = { settings: { get: () => "all" } };
    for (const type of ["character", "npc", "simple"]) assert.equal(coversActor({ type }), true);
  } finally {
    globalThis.game = previous;
  }
});

test("planDyingStates: falling, bleeding again and stabilizing", () => {
  assert.deepEqual(plan({ before: 3, after: 0 }), { create: ["inconsciente", "sangrando"], remove: [] });
  assert.deepEqual(plan({ before: 3, after: -2, statuses: new Set(["sangrando"]) }), { create: ["inconsciente"], remove: [] });
  assert.deepEqual(plan({ before: -2, after: -5 }), { create: ["sangrando"], remove: [] });
  assert.deepEqual(plan({ before: -2, after: -5, statuses: new Set(["sangrando"]) }), EMPTY);
  assert.deepEqual(plan({ before: -5, after: -3, owned: { sangrando: ["a"] } }), { create: [], remove: ["a"] });
  assert.deepEqual(plan({ before: -3, after: 2, owned: { inconsciente: ["i"], sangrando: ["s"] } }), { create: [], remove: ["i", "s"] });
  assert.deepEqual(plan({ before: -3, after: 2, statuses: new Set(["inconsciente"]) }), EMPTY);
});

test("planDyingStates: death threshold", () => {
  assert.deepEqual(plan({ before: -4, after: -10, owned: { sangrando: ["s"] } }), { create: ["morto"], remove: ["s"] });
  assert.deepEqual(plan({ before: 5, after: -12 }), { create: ["morto"], remove: [] });
  assert.deepEqual(plan({ before: -12, after: -11, statuses: new Set(["morto"]), owned: { sangrando: ["s"] } }), { create: [], remove: ["s"] });
  assert.deepEqual(plan({ before: -12, after: -11 }), EMPTY);
  assert.deepEqual(plan({ before: -11, after: -14 }), { create: ["morto"], remove: [] });
  assert.deepEqual(plan({ before: -10, after: 5, statuses: new Set(["morto"]) }), EMPTY);
  assert.deepEqual(plan({ before: -10, after: 5, statuses: new Set(["morto"]), owned: { inconsciente: ["i"] } }), EMPTY);
  assert.deepEqual(plan({ max: 30, before: -10, after: -14 }), { create: ["sangrando"], remove: [] });
  assert.deepEqual(plan({ max: 30, before: -14, after: -15 }), { create: ["morto"], remove: [] });
  // Below the threshold (#51 part 3): Morto once.
  assert.deepEqual(plan({ before: 5, after: -25 }), { create: ["morto"], remove: [] });
  assert.deepEqual(plan({ before: -25, after: -30, statuses: new Set(["morto"]) }), EMPTY);
  assert.deepEqual(plan({ before: -25, after: -30 }), { create: ["morto"], remove: [] });
});

test("planDyingStates: unknown or stale before still reconciles, duplicates and bad input", () => {
  assert.deepEqual(plan({ after: -3 }), EMPTY);
  assert.deepEqual(plan({ after: 2, owned: { inconsciente: ["i"], sangrando: ["s"] } }), { create: [], remove: ["i", "s"] });
  assert.deepEqual(plan({ before: 3, after: 2, owned: { inconsciente: ["i"], sangrando: ["s"] } }), { create: [], remove: ["i", "s"] });
  assert.deepEqual(
    plan({ before: -1, after: -1, statuses: new Set(["inconsciente", "sangrando"]), owned: { inconsciente: ["i1", "i2"], sangrando: ["s1", "s2"] } }),
    { create: [], remove: ["i2", "s2"] }
  );
  assert.deepEqual(plan({ before: 3, after: "x" }), EMPTY);
});

test("planDyingStates: lethal HP (nonlethal damage contract)", () => {
  const nl = (before, after, lethalBefore, lethalAfter, extra = {}) =>
    plan({ max: 20, before, after, lethalBefore, lethalAfter, ...extra });
  const has = (...ids) => new Set(ids);
  assert.deepEqual(nl(10, -2, 10, 10), { create: ["inconsciente"], remove: [] });
  assert.deepEqual(nl(-2, -2, 2, -2, { statuses: has("inconsciente") }), { create: ["sangrando"], remove: [] });
  assert.deepEqual(nl(-3, -5, 1, -1, { statuses: has("inconsciente") }), { create: ["sangrando"], remove: [] });
  assert.deepEqual(nl(-5, -9, -2, -2, { statuses: has("inconsciente") }), EMPTY);
  assert.deepEqual(nl(-12, -14, -8, -8, { statuses: has("inconsciente", "sangrando") }), EMPTY);
  assert.deepEqual(nl(-12, -14, -8, -10, { statuses: has("sangrando"), owned: { sangrando: ["s"] } }), { create: ["morto"], remove: ["s"] });
  assert.deepEqual(nl(-3, -1, -1, -1, { statuses: has("sangrando"), owned: { sangrando: ["s"] } }), { create: [], remove: ["s"] });
  assert.deepEqual(nl(-2, -2, -1, 1, { statuses: has("sangrando"), owned: { sangrando: ["s"] } }), { create: [], remove: ["s"] });
  assert.deepEqual(nl(-1, 2, 4, 4, { owned: { inconsciente: ["i"] } }), { create: [], remove: ["i"] });
  // The #55 contract cases.
  assert.deepEqual(nl(10, 6, 10, 10), EMPTY);
  assert.deepEqual(nl(2, -3, 10, 10), { create: ["inconsciente"], remove: [] });
  assert.deepEqual(nl(-3, -8, 2, -3, { statuses: has("inconsciente") }), { create: ["sangrando"], remove: [] });
  assert.deepEqual(nl(-5, -3, -2, -2, { owned: { sangrando: ["s"] } }), { create: [], remove: ["s"] });
  assert.deepEqual(plan({ max: 10, before: -10, after: -12, lethalBefore: 5, lethalAfter: 5 }), EMPTY);
});

test("buildStatusEffectData flags the effect and makes Morto a permanent overlay", () => {
  const source = { name: "Morto", flags: { other: { a: 1 } }, duration: { expiry: "sceneEnd" }, showIcon: 1 };
  const dead = buildStatusEffectData(source, "morto", 2);
  assert.equal(dead.flags[MODULE].dyingState, "morto");
  assert.equal(dead.flags.core.overlay, true);
  assert.equal(dead.duration.expiry, null);
  assert.equal(dead.showIcon, 2);
  assert.deepEqual(dead.flags.other, { a: 1 });
  assert.equal(source.duration.expiry, "sceneEnd");
  assert.equal(source.flags[MODULE], undefined);
  const bleeding = buildStatusEffectData({ duration: { expiry: "sceneEnd" }, showIcon: 1 }, "sangrando", 2);
  assert.equal(bleeding.flags[MODULE].dyingState, "sangrando");
  assert.equal(bleeding.duration.expiry, "sceneEnd");
  assert.equal(bleeding.showIcon, 1);
  assert.equal(bleeding.flags.core, undefined);
});

const STATUS_EFFECTS = {
  inconsciente: { _source: { system: { status: { childEffect: ["indefeso"] } } } },
  indefeso: { _source: { system: { status: { childEffect: ["desprevenido"] } } } },
  desprevenido: { _source: { system: { status: { childEffect: [] } } } },
  sangrando: { _source: { system: { status: { childEffect: [], category: "metabolismo" } } } },
  morto: { _source: { system: { status: { childEffect: [] } } } }
};

test("childStatusesOf follows the chain", () => {
  assert.deepEqual(childStatusesOf(STATUS_EFFECTS, ["inconsciente", "sangrando", "morto"]), new Set(["indefeso", "desprevenido"]));
});

test("isOrphanChild and orphansOf", () => {
  const children = new Set(["indefeso", "desprevenido"]);
  const base = { actorUuid: "Actor.a", effectIds: new Set(["live"]), childStatuses: children };
  assert.equal(isOrphanChild({ ...base, statuses: ["indefeso"], origin: "Actor.a.ActiveEffect.gone" }), true);
  assert.equal(isOrphanChild({ ...base, statuses: ["indefeso"], origin: "Actor.a.ActiveEffect.live" }), false);
  assert.equal(isOrphanChild({ ...base, statuses: ["indefeso"], origin: "Actor.a.Item.x" }), false);
  assert.equal(isOrphanChild({ ...base, statuses: ["indefeso"], origin: "Actor.b.ActiveEffect.gone" }), false);
  assert.equal(isOrphanChild({ ...base, statuses: ["indefeso"] }), false);
  assert.equal(isOrphanChild({ ...base, statuses: ["cego"], origin: "Actor.a.ActiveEffect.gone" }), false);
  const effects = [
    { id: "c1", origin: "Actor.a.ActiveEffect.p", statuses: ["indefeso"] },
    { id: "c2", origin: "Actor.a.ActiveEffect.q", statuses: ["indefeso"] },
    { id: "c3", origin: "Actor.a.ActiveEffect.p", statuses: ["cego"] }
  ];
  assert.deepEqual(orphansOf({ deletedId: "p", actorUuid: "Actor.a", effects, childStatuses: children }), ["c1"]);
});

test("createKeyedQueue orders per key, runs keys in parallel and survives rejections", async () => {
  const enqueue = createKeyedQueue();
  const log = [];
  const slow = enqueue("a", async () => {
    await new Promise((r) => setTimeout(r, 20));
    log.push("a1");
  });
  const fast = enqueue("a", async () => log.push("a2"));
  const other = enqueue("b", async () => log.push("b1"));
  await Promise.all([slow, fast, other]);
  assert.deepEqual(log, ["b1", "a1", "a2"]);
  const failing = enqueue("c", async () => { throw new Error("boom"); });
  const next = enqueue("c", async () => "ok");
  await assert.rejects(failing, /boom/);
  assert.equal(await next, "ok");
});

test("createPvTracker returns the confirmed snapshot, not a stale fallback", () => {
  const s = (value, nonlethal = 0, nonlethalOn = false) => lethalSnapshot({ value, nonlethal, max: 10, nonlethalOn });
  const tracker = createPvTracker();
  assert.equal(tracker.observe("x", s(1)), undefined);
  assert.deepEqual(tracker.observe("a", s(-1), s(3)), s(3));
  assert.deepEqual(tracker.observe("a", s(2), s(3)), s(-1));
  const first = tracker.observe("b", s(4, 2, true));
  assert.equal(first, undefined);
  const seen = tracker.observe("b", s(4, 0, false));
  assert.equal(seen.rawNonlethal, 2);
  assert.equal(seen.nonlethalOn, true);
  assert.ok(Object.isFrozen(seen));
});

/* -------------------------------------------- */
/*  Integration: a FIFO server and N clients    */
/* -------------------------------------------- */

const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));
let effectSeq = 0;

class ClientEffect {
  constructor(data, actor) {
    this.actor = actor;
    this.parent = actor;
    this.documentName = "ActiveEffect";
    Object.assign(this, structuredClone(data));
    this.id = this._id;
    this.statuses = new Set(data.statuses ?? []);
  }
  get uuid() {
    return `${this.parent.uuid}.ActiveEffect.${this.id}`;
  }
  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  }
  get suppressed() {
    const ic = this.parent.system.tracos.ic.value;
    const category = STATUS_EFFECTS[[...this.statuses][0]]?._source?.system?.status?.category;
    return [...this.statuses].some((s) => ic.includes(s)) || (!!category && ic.includes(category));
  }
}

class EffectCollection extends Map {
  filter(fn) {
    return [...this.values()].filter(fn);
  }
  [Symbol.iterator]() {
    return this.values();
  }
}

class ClientActor {
  constructor(client, data) {
    this.client = client;
    this.documentName = "Actor";
    this.id = data.id;
    this.uuid = `Actor.${data.id}`;
    this.name = data.name;
    this.type = data.type;
    this.owners = data.owners;
    this.system = structuredClone(data.system);
    this.flags = structuredClone(data.flags ?? {});
    this.effects = new EffectCollection();
  }
  get statuses() {
    const set = new Set();
    for (const e of this.effects) if (!e.suppressed) for (const s of e.statuses) set.add(s);
    return set;
  }
  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  }
  testUserPermission(user, level) {
    assert.equal(level, "OWNER");
    return user.isGM || this.owners.includes(user.id);
  }
  update(changes, options = {}) {
    this.client.activate();
    this.client.call("preUpdateActor", this, changes, options, this.client.user.id);
    return this.client.server.submit({ type: "update", actorId: this.id, changes, options, userId: this.client.user.id });
  }
  createEmbeddedDocuments(name, data) {
    assert.equal(name, "ActiveEffect");
    return this.client.server.submit({ type: "create", actorId: this.id, data: structuredClone(data), userId: this.client.user.id });
  }
  deleteEmbeddedDocuments(name, ids) {
    assert.equal(name, "ActiveEffect");
    return this.client.server.submit({ type: "delete", actorId: this.id, ids: [...ids], userId: this.client.user.id });
  }
}

class Client {
  constructor(server, user, { childDelay = 0 } = {}) {
    this.server = server;
    this.user = user;
    this.childDelay = childDelay;
    this.hooks = {};
    this.actors = new Map();
    this.users = null;
    this.warnings = [];
  }
  get usersView() {
    return this.users ?? this.server.users;
  }
  activate() {
    const users = this.usersView;
    globalThis.game.user = this.user;
    globalThis.game.users = {
      getDesignatedUser(condition) {
        const qualifying = users.filter(condition);
        if (!qualifying.length) return null;
        return qualifying.reduce((best, u) => ((u.role - best.role) || (u.id < best.id ? 1 : -1)) > 0 ? u : best);
      }
    };
    globalThis.Hooks = { on: (name, fn) => (this.hooks[name] ??= []).push(fn) };
  }
  call(name, ...args) {
    for (const fn of this.hooks[name] ?? []) fn(...args);
  }
  async load() {
    this.activate();
    const mod = await import(`../scripts/rules/dying-states.mjs?client=${this.user.id}-${Math.random()}`);
    mod.installDyingStatesRule();
  }
  actor(id) {
    return this.actors.get(id);
  }
  /** The system's BaseEffect#_onCreate / _onDelete, only on the client that made the change. */
  systemOnCreate(effect, userId) {
    if (userId !== this.user.id) return;
    const children = [...effect.statuses].flatMap((s) => STATUS_EFFECTS[s]?._source?.system?.status?.childEffect ?? []);
    if (!children.length) return;
    const actor = effect.parent;
    const origin = effect.uuid;
    (async () => {
      await sleep(this.childDelay);
      await actor.createEmbeddedDocuments("ActiveEffect", children.map((s) => ({ name: s, statuses: [s], origin })));
    })();
  }
  systemOnDelete(effect, userId) {
    if (userId !== this.user.id) return;
    const ids = effect.parent.effects.filter((e) => e.origin === effect.uuid).map((e) => e.id);
    if (ids.length) effect.parent.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
}

class Server {
  constructor() {
    this.users = [];
    this.clients = [];
    this.actors = new Map();
    this.chain = Promise.resolve();
    this.pending = 0;
  }
  addActor(data) {
    this.actors.set(data.id, { ...structuredClone(data), effects: new Map() });
  }
  async connect(user, options) {
    const client = new Client(this, user, options);
    for (const data of this.actors.values()) {
      const actor = new ClientActor(client, data);
      for (const e of data.effects.values()) actor.effects.set(e._id, new ClientEffect(e, actor));
      client.actors.set(data.id, actor);
    }
    this.clients.push(client);
    await client.load();
    return client;
  }
  disconnect(client) {
    this.clients = this.clients.filter((c) => c !== client);
    client.user.active = false;
  }
  submit(op) {
    this.pending++;
    const run = this.chain.then(async () => {
      await sleep(1);
      try {
        return this.apply(op);
      } finally {
        this.pending--;
      }
    });
    this.chain = run.catch(() => {});
    return run;
  }
  apply(op) {
    const actor = this.actors.get(op.actorId);
    if (op.type === "update") {
      for (const [path, value] of Object.entries(op.changes)) setPath(actor, path, value);
      for (const client of [...this.clients]) {
        const doc = client.actor(op.actorId);
        for (const [path, value] of Object.entries(op.changes)) setPath(doc, path, value);
        client.activate();
        client.call("updateActor", doc, structuredClone(op.changes), structuredClone(op.options), op.userId);
      }
    } else if (op.type === "create") {
      const created = op.data.map((d) => ({ ...d, _id: `e${++effectSeq}` }));
      for (const e of created) actor.effects.set(e._id, e);
      for (const client of [...this.clients]) {
        const doc = client.actor(op.actorId);
        const effects = created.map((e) => new ClientEffect(e, doc));
        for (const e of effects) doc.effects.set(e.id, e);
        client.activate();
        for (const e of effects) {
          client.systemOnCreate(e, op.userId);
          client.call("createActiveEffect", e, {}, op.userId);
        }
      }
    } else if (op.type === "delete") {
      const ids = op.ids.filter((id) => actor.effects.has(id));
      for (const id of ids) actor.effects.delete(id);
      for (const client of [...this.clients]) {
        const doc = client.actor(op.actorId);
        const effects = ids.map((id) => doc.effects.get(id)).filter(Boolean);
        for (const e of effects) doc.effects.delete(e.id);
        client.activate();
        for (const e of effects) {
          client.systemOnDelete(e, op.userId);
          client.call("deleteActiveEffect", e, {}, op.userId);
        }
      }
    }
  }
  async settle() {
    let idle = 0;
    while (idle < 5) {
      await sleep(5);
      idle = this.pending ? 0 : idle + 1;
    }
  }
  statuses(actorId) {
    const counts = {};
    for (const e of this.actors.get(actorId).effects.values()) for (const s of e.statuses) counts[s] = (counts[s] ?? 0) + 1;
    return counts;
  }
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  let node = obj;
  for (const key of parts.slice(0, -1)) node = node[key] ??= {};
  node[parts.at(-1)] = value;
}

const settings = new Map();
function installGlobals() {
  settings.clear();
  settings.set("dyingStatesRule", "characters");
  settings.set("nonlethalDamageRule", "off");
  globalThis.game = {
    settings: {
      get(module, key) {
        assert.equal(module, MODULE);
        if (!settings.has(key)) throw new Error(`not registered: ${key}`);
        return settings.get(key);
      }
    }
  };
  globalThis.CONST = { ACTIVE_EFFECT_SHOW_ICON: { ALWAYS: 2 } };
  globalThis.CONFIG = {
    statusEffects: STATUS_EFFECTS,
    ActiveEffect: {
      documentClass: {
        async fromStatusEffect(id) {
          return { toObject: () => ({ name: id, statuses: [id], duration: { expiry: "sceneEnd" }, showIcon: 1, flags: {} }) };
        }
      }
    }
  };
}

async function world({ gm = true, value = 3, max = 20, ic = [], childDelay = 0, playerChildDelay = childDelay } = {}) {
  installGlobals();
  const server = new Server();
  const gmUser = { id: "gm0000", role: 4, isGM: true, active: gm };
  const player = { id: "pl0000", role: 1, isGM: false, active: true };
  server.users.push(gmUser, player);
  server.addActor({
    id: "oberon", name: "Oberon", type: "character", owners: [player.id],
    system: { attributes: { pv: { value, max, min: -10, temp: 0 } }, tracos: { ic: { value: ic } } }, flags: {}
  });
  const clients = { server, gmUser, player };
  if (gm) clients.gm = await server.connect(gmUser, { childDelay });
  clients.pl = await server.connect(player, { childDelay: playerChildDelay });
  return clients;
}

const HP = "system.attributes.pv.value";
const setHp = (client, value, options) => client.actor("oberon").update({ [HP]: value }, options);

test("integration: only the GM client acts while a GM is connected", async () => {
  const { server, gm, pl } = await world();
  const created = { gm: 0, pl: 0 };
  const count = (c, key) => {
    const original = c.actor("oberon").createEmbeddedDocuments.bind(c.actor("oberon"));
    c.actor("oberon").createEmbeddedDocuments = (n, d) => {
      if (d.some((x) => x.flags?.[MODULE]?.dyingState)) created[key]++;
      return original(n, d);
    };
  };
  count(gm, "gm");
  count(pl, "pl");
  await setHp(pl, -2);
  await server.settle();
  assert.deepEqual(created, { gm: 1, pl: 0 });
  assert.deepEqual(server.statuses("oberon"), { inconsciente: 1, sangrando: 1, indefeso: 1, desprevenido: 1 });
  await setHp(gm, 3);
  await server.settle();
  assert.deepEqual(server.statuses("oberon"), {});
});

test("integration: without a GM the owner acts", async () => {
  const { server, pl } = await world({ gm: false });
  await setHp(pl, -2);
  await server.settle();
  assert.deepEqual(server.statuses("oberon"), { inconsciente: 1, sangrando: 1, indefeso: 1, desprevenido: 1 });
  await setHp(pl, 3);
  await server.settle();
  assert.deepEqual(server.statuses("oberon"), {});
});

test("integration: rule off does nothing", async () => {
  const { server, gm } = await world();
  settings.set("dyingStatesRule", "off");
  await setHp(gm, -2);
  await server.settle();
  assert.deepEqual(server.statuses("oberon"), {});
});

test("integration: GM and player change HP at once → one copy each", async () => {
  const { server, gm, pl } = await world();
  await Promise.all([setHp(gm, -2), setHp(pl, -3)]);
  await server.settle();
  assert.deepEqual(server.statuses("oberon"), { inconsciente: 1, sangrando: 1, indefeso: 1, desprevenido: 1 });
});

test("integration: two clients both believing they execute end with one copy of each", async () => {
  const { server, gm, pl } = await world();
  // The player still sees no GM; the GM sees itself.
  pl.users = [{ ...server.users[0], active: false }, server.users[1]];
  await setHp(gm, -2);
  await server.settle();
  // Reconciled by the creation of the duplicates themselves, without another HP change.
  assert.deepEqual(server.statuses("oberon"), { inconsciente: 1, sangrando: 1, indefeso: 1, desprevenido: 1 });
  pl.users = null;
  await setHp(gm, -3);
  await server.settle();
  const counts = server.statuses("oberon");
  assert.equal(counts.inconsciente, 1);
  assert.equal(counts.sangrando, 1);
  assert.equal(counts.indefeso, 1);
  assert.equal(counts.desprevenido, 1);
});

test("integration: two pre-updates before the answers (3 → -1, then 2) end clean", async () => {
  const { server, gm } = await world({ value: 3 });
  await Promise.all([setHp(gm, -1), setHp(gm, 2)]);
  await server.settle();
  assert.equal(server.actors.get("oberon").system.attributes.pv.value, 2);
  assert.deepEqual(server.statuses("oberon"), {});
});

test("integration: recovery then a new fall before the answers (-1 → 2 → -3)", async () => {
  const { server, gm } = await world({ value: 3 });
  await setHp(gm, -1);
  await server.settle();
  await Promise.all([setHp(gm, 2), setHp(gm, -3)]);
  await server.settle();
  assert.deepEqual(server.statuses("oberon"), { inconsciente: 1, sangrando: 1, indefeso: 1, desprevenido: 1 });
});

test("integration: delayed children and an immediate cure leave no orphans", async () => {
  const { server, gm } = await world({ childDelay: 30 });
  await setHp(gm, -2);
  await sleep(8);
  await setHp(gm, 8);
  await server.settle();
  await sleep(80);
  await server.settle();
  assert.deepEqual(server.statuses("oberon"), {});
});

for (const [label, opts] of [["player slow", { playerChildDelay: 30 }], ["GM slow", { childDelay: 30, playerChildDelay: 0 }]]) {
  test(`integration: player creates Inconsciente, GM deletes it before the child (${label})`, async () => {
    const { server, gm, pl } = await world({ value: 20, ...opts });
    const [id] = await pl.actor("oberon").createEmbeddedDocuments("ActiveEffect", [{ name: "inc", statuses: ["inconsciente"] }])
      .then(() => [...server.actors.get("oberon").effects.keys()]);
    await gm.actor("oberon").deleteEmbeddedDocuments("ActiveEffect", [id]);
    await sleep(80);
    await server.settle();
    assert.deepEqual(server.statuses("oberon"), {});
  });
}

test("integration: the client that deleted the parent disconnects before its cascade", async () => {
  const { server, gm, pl } = await world({ value: 20 });
  await pl.actor("oberon").createEmbeddedDocuments("ActiveEffect", [{ name: "inc", statuses: ["inconsciente"] }]);
  await server.settle();
  assert.equal(server.statuses("oberon").desprevenido, 1);
  const parent = [...server.actors.get("oberon").effects.values()].find((e) => e.statuses.includes("inconsciente"));
  pl.systemOnDelete = () => {};
  await pl.actor("oberon").deleteEmbeddedDocuments("ActiveEffect", [parent._id]);
  server.disconnect(pl);
  await server.settle();
  assert.deepEqual(server.statuses("oberon"), {});
  assert.ok(gm);
});

test("integration: executor changes (GM leaves) between the parent deletion and the late child", async () => {
  const { server, gm, pl } = await world({ value: 20, childDelay: 40, playerChildDelay: 40 });
  await gm.actor("oberon").createEmbeddedDocuments("ActiveEffect", [{ name: "inc", statuses: ["inconsciente"] }]);
  const parent = [...server.actors.get("oberon").effects.values()][0];
  await pl.actor("oberon").deleteEmbeddedDocuments("ActiveEffect", [parent._id]);
  server.disconnect(gm);
  await sleep(100);
  await server.settle();
  assert.deepEqual(server.statuses("oberon"), {});
});

test("integration: a late child after 61 s is still removed (no deadline)", async () => {
  const realNow = Date.now;
  try {
    const { server, gm, pl } = await world({ value: 20, playerChildDelay: 30 });
    await pl.actor("oberon").createEmbeddedDocuments("ActiveEffect", [{ name: "inc", statuses: ["inconsciente"] }]);
    const parent = [...server.actors.get("oberon").effects.values()][0];
    await gm.actor("oberon").deleteEmbeddedDocuments("ActiveEffect", [parent._id]);
    Date.now = () => realNow() + 61000;
    await sleep(80);
    await server.settle();
    assert.deepEqual(server.statuses("oberon"), {});
  } finally {
    Date.now = realNow;
  }
});

test("integration: switching the nonlethal mode compares snapshots under one mode", async () => {
  const NL = `flags.${MODULE}.nonlethal`;
  {
    const { server, gm } = await world({ value: 10, max: 10 });
    settings.set("nonlethalDamageRule", "on");
    await gm.actor("oberon").update({ [HP]: -2, [NL]: 12 });
    await server.settle();
    assert.deepEqual(server.statuses("oberon"), { inconsciente: 1, indefeso: 1, desprevenido: 1 });
    settings.set("nonlethalDamageRule", "off");
    await gm.actor("oberon").update({ [HP]: -1, [NL]: 11 });
    await server.settle();
    assert.equal(server.statuses("oberon").sangrando, undefined);
  }
  {
    const { server, gm } = await world({ value: 10, max: 10 });
    await gm.actor("oberon").update({ [HP]: -2, [NL]: 12 });
    await server.settle();
    assert.equal(server.statuses("oberon").sangrando, 1);
    settings.set("nonlethalDamageRule", "on");
    await server.settle();
    assert.equal(server.statuses("oberon").sangrando, 1);
    await gm.actor("oberon").update({ [HP]: -1, [NL]: 11 });
    await server.settle();
    assert.equal(server.statuses("oberon").sangrando, undefined);
    assert.equal(server.statuses("oberon").inconsciente, 1);
  }
});

test("integration: nonlethal rule on (20 HP)", async () => {
  const NL = `flags.${MODULE}.nonlethal`;
  const { server, gm } = await world({ value: 10, max: 20 });
  settings.set("nonlethalDamageRule", "on");
  await gm.actor("oberon").update({ [HP]: -2, [NL]: 12 });
  await server.settle();
  assert.deepEqual(server.statuses("oberon"), { inconsciente: 1, indefeso: 1, desprevenido: 1 });
  await gm.actor("oberon").update({ [NL]: 0 });
  await server.settle();
  assert.equal(server.statuses("oberon").sangrando, 1);
  await gm.actor("oberon").update({ [HP]: -12, [NL]: 4 });
  await gm.actor("oberon").update({ [HP]: -14, [NL]: 4 });
  await server.settle();
  assert.equal(server.statuses("oberon").morto, 1);
  assert.equal(server.statuses("oberon").sangrando, undefined);
});

test("integration: nonlethal healing that only pays back N stabilizes", async () => {
  const NL = `flags.${MODULE}.nonlethal`;
  const { server, gm } = await world({ value: 10, max: 20 });
  settings.set("nonlethalDamageRule", "on");
  await gm.actor("oberon").update({ [HP]: -3, [NL]: 2 });
  await server.settle();
  assert.equal(server.statuses("oberon").sangrando, 1);
  await gm.actor("oberon").update({ [HP]: -1, [NL]: 0 });
  await server.settle();
  assert.equal(server.statuses("oberon").sangrando, undefined);
});

test("integration: a suppressed Sangrando is not created again on each hit", async () => {
  const { server, gm } = await world({ ic: ["metabolismo"] });
  await setHp(gm, -1);
  await server.settle();
  await setHp(gm, -2);
  await server.settle();
  await setHp(gm, -3);
  await server.settle();
  assert.equal(server.statuses("oberon").sangrando, 1);
});

test("integration: a status missing from CONFIG.statusEffects is skipped with one warning", async () => {
  const { server, gm } = await world();
  CONFIG.statusEffects = { ...STATUS_EFFECTS };
  delete CONFIG.statusEffects.sangrando;
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    await setHp(gm, -1);
    await server.settle();
    await setHp(gm, 2);
    await setHp(gm, -1);
    await server.settle();
  } finally {
    console.warn = warn;
  }
  assert.equal(server.statuses("oberon").sangrando, undefined);
  assert.equal(server.statuses("oberon").inconsciente, 1);
  assert.equal(warnings.filter((w) => w.includes("sangrando")).length, 1);
});

test("integration: reaching the threshold applies Morto, a permanent overlay", async () => {
  const { server, gm } = await world({ value: 20, max: 20 });
  await setHp(gm, -2);
  await server.settle();
  await setHp(gm, -10);
  await server.settle();
  const counts = server.statuses("oberon");
  assert.equal(counts.morto, 1);
  assert.equal(counts.sangrando, undefined);
  const dead = [...server.actors.get("oberon").effects.values()].find((e) => e.statuses.includes("morto"));
  assert.equal(dead.flags.core.overlay, true);
  assert.equal(dead.duration.expiry, null);
  await setHp(gm, 10);
  await server.settle();
  assert.equal(server.statuses("oberon").morto, 1);
});
