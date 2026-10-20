import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abilityIdentity,
  compareMagnitude,
  decideStacking,
  findSameAbility,
  installSameAbilityRule,
  planReconcile,
  sustainMarker
} from "../scripts/rules/same-ability-stacking.mjs";

const SOURCE = "Compendium.tormenta20.poderes.Item.Uv6GW8R54wUtv3sm";
const FLAG = "t20-community-patches";
const slugify = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "-");

test("abilityIdentity: compendium source first, then the slugified item name; the effect name is part of it", () => {
  assert.equal(
    abilityIdentity({ compendiumSource: SOURCE, itemName: "Inspiração", effectName: "Inspiração", slugify }),
    `${SOURCE}#Inspiração`
  );
  assert.equal(
    abilityIdentity({ compendiumSource: null, itemName: "Inspiração", effectName: "Inspiração", slugify }),
    "Item:inspiracao#Inspiração"
  );
  assert.notEqual(
    abilityIdentity({ compendiumSource: SOURCE, effectName: "Inspiração (Arte Mágica)" }),
    abilityIdentity({ compendiumSource: SOURCE, effectName: "Inspiração" })
  );
  assert.equal(abilityIdentity({ compendiumSource: SOURCE, effectName: "" }), "");
  assert.equal(abilityIdentity({ itemName: "", effectName: "Inspiração" }), "");
});

test("findSameAbility: only entries with the same identity", () => {
  const entries = [{ id: "a", identity: "x" }, { id: "b", identity: "y" }, { id: "c", identity: "x" }];
  assert.deepEqual(findSameAbility(entries, "x").map((e) => e.id), ["a", "c"]);
  assert.deepEqual(findSameAbility(entries, ""), []);
});

test("compareMagnitude: sums the numeric changes, ignores @ keys, ties on doubt", () => {
  const ch = (key, value) => ({ key, value });
  assert.equal(compareMagnitude([ch("pericias.geral", "2")], [ch("pericias.geral", "1")]), 1);
  assert.equal(compareMagnitude([ch("pericias.geral", "1")], [ch("pericias.geral", 3)]), -1);
  assert.equal(compareMagnitude([ch("pericias.geral", "1")], [ch("pericias.geral", "1")]), 0);
  assert.equal(compareMagnitude([ch("cd", "2")], [ch("pericias.geral", "1")]), 1);
  assert.equal(compareMagnitude([ch("pericias.geral", "1"), ch("@modificador", "9")], [ch("pericias.geral", "1"), ch("@modificador", "1")]), 0);
  assert.equal(compareMagnitude([ch("dano", "1d6")], [ch("dano", "2")]), 0);
  assert.equal(compareMagnitude([ch("cd", "2"), ch("pericias.geral", "1")], [ch("pericias.geral", "2")]), 1);
  assert.equal(compareMagnitude([ch("dano", "1d6"), ch("cd", "5")], [ch("cd", "1")]), 0);
});

test("decideStacking: off allows, replace replaces, highest refuses unless greater", () => {
  assert.equal(decideStacking("off", { previous: true, comparison: -1 }), "allow");
  assert.equal(decideStacking("replace", { previous: false }), "allow");
  assert.equal(decideStacking("replace", { previous: true, comparison: -1 }), "replace");
  assert.equal(decideStacking("highest", { previous: true, comparison: 0 }), "refuse");
  assert.equal(decideStacking("highest", { previous: true, comparison: -1 }), "refuse");
  assert.equal(decideStacking("highest", { previous: true, comparison: 1 }), "replace");
  assert.equal(decideStacking("highest", { previous: true, comparison: null }), "replace");
});

test("sustainMarker: caster uuid and marker id of a sustained origin", () => {
  assert.deepEqual(sustainMarker("Actor.b1.ActiveEffect.m1"), { casterUuid: "Actor.b1", markerId: "m1" });
  assert.equal(sustainMarker("Actor.b1"), null);
  assert.equal(sustainMarker(undefined), null);
});

test("planReconcile: every view keeps the survivor of one total order (time, then id)", () => {
  const e = (id, createdTime, value, disabled = false) => ({ id, createdTime, disabled, changes: [{ key: "pericias.geral", value }] });
  // replace: the last one survives; a creator that sees a later one deletes its own effect.
  assert.deepEqual(planReconcile("replace", "b", [e("a", 1, "1"), e("b", 2, "1")]), { remove: ["a"], selfRemoved: false });
  assert.deepEqual(planReconcile("replace", "a", [e("b", 2, "1"), e("a", 1, "1")]), { remove: ["a"], selfRemoved: true });
  assert.deepEqual(planReconcile("replace", "a", [e("a", 1, "1")]), { remove: [], selfRemoved: false });
  assert.deepEqual(planReconcile("replace", "a", [e("z", 1, "1"), e("a", 1, "1")]), { remove: ["a"], selfRemoved: true });
  // highest: the first of the greatest active ones survives.
  assert.deepEqual(planReconcile("highest", "b", [e("a", 1, "2"), e("b", 2, "2")]), { remove: ["b"], selfRemoved: true });
  assert.deepEqual(planReconcile("highest", "b", [e("a", 1, "1"), e("b", 2, "3")]), { remove: ["a"], selfRemoved: false });
  assert.deepEqual(planReconcile("highest", "a", [e("a", 1, "1"), e("b", 2, "3")]), { remove: ["a"], selfRemoved: true });
  assert.deepEqual(planReconcile("highest", "b", [e("a", 1, "9", true), e("b", 2, "1")]), { remove: ["a"], selfRemoved: false });
  assert.deepEqual(planReconcile("off", "b", [e("a", 1, "1"), e("b", 2, "1")]), { remove: [], selfRemoved: false });
});

test("planReconcile: highest converges with incomparable values and different keys, with deletions still pending", () => {
  const ch = (key, value) => ({ key, value });
  const effects = {
    a: { id: "a", createdTime: 1, changes: [ch("bonus", "1")] },
    b: { id: "b", createdTime: 1, changes: [ch("bonus", "1d6")] },
    c: { id: "c", createdTime: 1, changes: [ch("bonus", "2")] },
    d: { id: "d", createdTime: 1, changes: [ch("cd", "3")] },
    e: { id: "e", createdTime: 1, changes: [ch("bonus", "1"), ch("cd", "1")] }
  };
  const orders = (ids) => (ids.length <= 1 ? [ids] : ids.flatMap((id, i) => orders([...ids.slice(0, i), ...ids.slice(i + 1)]).map((rest) => [id, ...rest])));
  for (const arrival of orders(Object.keys(effects))) {
    const removed = new Set();
    const seen = [];
    for (const id of arrival) {
      seen.push(effects[id]);
      for (const r of planReconcile("highest", id, seen).remove) removed.add(r);
    }
    assert.deepEqual(arrival.filter((id) => !removed.has(id)), ["d"], arrival.join(","));
  }
});

test("planReconcile: tied creations converge in any arrival order, with deletions still pending", () => {
  const e = (id, value = "2") => ({ id, createdTime: 1000, changes: [{ key: "pericias.geral", value }] });
  for (const policy of ["replace", "highest"]) {
    for (const arrival of [["z", "a", "m"], ["a", "m", "z"], ["m", "z", "a"], ["z", "m", "a"]]) {
      const removed = new Set();
      const seen = [];
      for (const id of arrival) {
        seen.push(e(id));
        for (const r of planReconcile(policy, id, seen).remove) removed.add(r);
      }
      const left = arrival.filter((id) => !removed.has(id));
      assert.equal(left.length, 1, `${policy} ${arrival.join(",")}`);
    }
  }
});

/* -------------------------------------------- */
/*  Foundry integration (mocks)                 */
/* -------------------------------------------- */

class EffectCollection extends Map {
  *[Symbol.iterator]() {
    yield* this.values();
  }
}

function setupFoundry() {
  const settings = { mode: "replace" };
  const hooks = {};
  const warnings = [];
  const infos = [];
  const deleted = [];
  const markers = [];
  const actors = new EffectCollection();
  class ItemT20 {
    _allApplicableOnUseEffects() {
      return ["usage"];
    }
  }
  /** Stands in for ActiveEffectT20: its _preCreate has a side effect (the "Sustentando" marker). */
  class ActiveEffectT20 {
    constructor(data, parent) {
      Object.assign(this, JSON.parse(JSON.stringify(data)));
      this.parent = parent;
    }
    async _preCreate(data) {
      if (data.duration?.expiry !== "sustainEnd") return undefined;
      markers.push(data.name);
      const [uuid, id] = data.origin?.split(".ActiveEffect.") ?? [];
      const caster = actors.get(uuid);
      if (caster && !caster.effects.has(id)) {
        caster.effects.set(id, { id, name: "Sustentando", delete: async () => caster.effects.delete(id) });
      }
      return undefined;
    }
  }
  Object.assign(globalThis, {
    CONFIG: { Item: { documentClass: ItemT20 }, ActiveEffect: { documentClass: ActiveEffectT20 } },
    game: {
      actors,
      scenes: [],
      user: { id: "u1", isActiveGM: true },
      settings: { get: () => settings.mode },
      i18n: { localize: (key) => `<${key}>`, format: (key, data) => `${key}${JSON.stringify(data)}` }
    },
    ui: { notifications: { warn: (msg) => warnings.push(msg), info: (msg) => infos.push(msg) } },
    Hooks: { on: (name, fn) => (hooks[name] = fn) },
    foundry: {
      utils: {
        getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj),
        fromUuidSync: (uuid) => actors.get(uuid)
      }
    }
  });
  installSameAbilityRule();

  let nextId = 0;
  let clock = 0;
  const makeActor = (name) => {
    const actor = { documentName: "Actor", name, uuid: `Actor.${name}`, effects: new EffectCollection() };
    actors.set(actor.uuid, actor);
    actor.deleteEmbeddedDocuments = async (type, ids) => {
      deleted.push(...ids);
      for (const id of ids) actor.effects.delete(id);
    };
    return actor;
  };
  /** Mirrors ClientDatabaseBackend#preCreateDocumentArray: _preCreate per entry with a shared options object. */
  const preCreate = async (actor, datas) => {
    const options = { toChat: true };
    const accepted = [];
    for (const data of datas) {
      const pending = new ActiveEffectT20(data, actor);
      if ((await pending._preCreate(data, options, { id: "u1" })) === false) continue;
      accepted.push(data);
    }
    return { accepted, response: JSON.parse(JSON.stringify(options)) };
  };
  /** Mirrors #handleCreateDocuments: every document joins the collection, then onCreate runs per document. */
  const commit = async (actor, { accepted, response }, userId = "u1") => {
    const docs = accepted.map((data) => {
      const doc = new ActiveEffectT20({ ...data, disabled: !!data.disabled }, actor);
      doc.id = `e${++nextId}`;
      doc._stats = { createdTime: ++clock };
      actor.effects.set(doc.id, doc);
      return doc;
    });
    for (const doc of docs) hooks.createActiveEffect(doc, response, userId);
    await null;
    return docs;
  };
  const create = async (actor, datas, userId = "u1") => commit(actor, await preCreate(actor, datas), userId);
  /** Card effect as the system builds it from a stamped clone effect (flags copied, `temp` added). */
  const cardEffect = (cloneEffect, value = "1") => ({
    name: cloneEffect.name,
    flags: { ...JSON.parse(JSON.stringify(cloneEffect.flags)), temp: true },
    system: { changes: [{ key: "pericias.geral", value, type: "add" }] }
  });
  const liveItem = {};
  const clone = ({ type = "poder", source = SOURCE, effects = ["Inspiração"], flags = {} } = {}) => {
    const actorItems = { get: () => liveItem };
    return {
      type,
      name: "Inspiração",
      isEmbedded: true,
      id: "i1",
      _stats: { compendiumSource: source },
      actor: { items: actorItems },
      effects: effects.map((name) => ({ name, flags: JSON.parse(JSON.stringify(flags)), _source: { flags: JSON.parse(JSON.stringify(flags)) } }))
    };
  };
  const use = (item) => {
    const result = ItemT20.prototype._allApplicableOnUseEffects.call(item);
    assert.deepEqual(result, ["usage"]);
    return item.effects;
  };
  return { settings, hooks, warnings, infos, deleted, markers, actors, makeActor, preCreate, commit, create, cardEffect, clone, use, liveItem, ItemT20 };
}

test("stamp: power clones get the ability identity on instance and source; live items and non-powers do not", () => {
  const { clone, use, liveItem, ItemT20 } = setupFoundry();
  const [effect, linked] = use(clone({ effects: ["Inspiração", "Inspiração (Arte Mágica)"] }));
  assert.equal(effect.flags[FLAG].ability, `${SOURCE}#Inspiração`);
  assert.equal(effect._source.flags[FLAG].ability, `${SOURCE}#Inspiração`);
  assert.equal(linked.flags[FLAG].ability, `${SOURCE}#Inspiração (Arte Mágica)`);

  const [noSource] = use(clone({ source: null }));
  assert.match(noSource.flags[FLAG].ability, /^Item:.+#Inspiração$/);

  const potion = clone({ type: "consumivel", flags: { [FLAG]: { ability: `${SOURCE}#Inspiração` } } });
  const [potionEffect] = use(potion);
  assert.equal(potionEffect.flags[FLAG].ability, undefined);
  assert.equal(potionEffect._source.flags[FLAG].ability, undefined);

  const live = Object.assign(liveItem, clone());
  live.actor = { items: { get: () => live } };
  ItemT20.prototype._allApplicableOnUseEffects.call(live);
  assert.equal(live.effects[0].flags[FLAG], undefined);
});

test("replace: a second Inspiration (another bard too) replaces the first; different effects coexist", async () => {
  const { create, cardEffect, clone, use, makeActor, deleted, infos } = setupFoundry();
  const ally = makeActor("Guerreiro");
  const [bardA] = use(clone());
  const [bardB] = use(clone());
  const [first] = await create(ally, [cardEffect(bardA)]);
  assert.equal(infos.length, 0);
  const [second] = await create(ally, [cardEffect(bardB)]);
  assert.deepEqual(deleted, [first.id]);
  assert.equal(infos.length, 1);
  assert.match(infos[0], /Replaced.*"actor":"Guerreiro".*"reference":"<T20CP\.SameAbility\.Reference>"/);
  assert.deepEqual([...ally.effects.keys()], [second.id]);

  const [, arteMagica] = use(clone({ effects: ["Inspiração", "Inspiração (Arte Mágica)"] }));
  await create(ally, [cardEffect(arteMagica)]);
  assert.equal(ally.effects.size, 2);
});

test("highest: refuses an equal or smaller effect with a warning, replaces with a greater one", async () => {
  const { settings, create, cardEffect, clone, use, makeActor, warnings, deleted } = setupFoundry();
  settings.mode = "highest";
  const ally = makeActor("Guerreiro");
  const [effect] = use(clone());
  const [plus2] = await create(ally, [cardEffect(effect, "2")]);
  assert.deepEqual(await create(ally, [cardEffect(effect, "1")]), []);
  assert.deepEqual(await create(ally, [cardEffect(effect, "2")]), []);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Refused.*"actor":"Guerreiro".*"reference":"<T20CP\.SameAbility\.Reference>"/);
  const [plus3] = await create(ally, [cardEffect(effect, "3")]);
  assert.deepEqual(deleted, [plus2.id]);
  assert.deepEqual([...ally.effects.keys()], [plus3.id]);
});

test("highest: a disabled previous effect does not block, and is replaced", async () => {
  const { settings, create, cardEffect, clone, use, makeActor } = setupFoundry();
  settings.mode = "highest";
  const ally = makeActor("Guerreiro");
  const [effect] = use(clone());
  const [old] = await create(ally, [{ ...cardEffect(effect, "5"), disabled: true }]);
  const [fresh] = await create(ally, [cardEffect(effect, "1")]);
  assert.deepEqual([...ally.effects.keys()], [fresh.id]);
  assert.notEqual(old.id, fresh.id);
});

test("off, unstamped effects, other users and duplicates in one batch", async () => {
  const { settings, create, cardEffect, clone, use, makeActor, deleted } = setupFoundry();
  const ally = makeActor("Guerreiro");
  const [effect] = use(clone());

  settings.mode = "off";
  await create(ally, [cardEffect(effect)]);
  await create(ally, [cardEffect(effect)]);
  assert.equal(ally.effects.size, 2);

  settings.mode = "replace";
  const spell = { name: "Resistência à Energia", flags: { temp: true }, system: { changes: [] } };
  await create(ally, [spell]);
  await create(ally, [spell]);
  assert.equal(ally.effects.size, 4);

  const other = makeActor("Outro");
  await create(other, [cardEffect(effect)]);
  await create(other, [cardEffect(effect)], "u2");
  assert.equal(other.effects.size, 2, "only the creating user deletes");

  const batchTarget = makeActor("Lote");
  const created = await create(batchTarget, [cardEffect(effect, "1"), cardEffect(effect, "2")]);
  assert.equal(created.length, 1);
  assert.equal(batchTarget.effects.size, 1);
  assert.deepEqual(deleted, []);
});

test("concurrent applications converge: replace keeps the newest, highest keeps the oldest of equals", async () => {
  const { settings, preCreate, commit, cardEffect, clone, use, makeActor, warnings } = setupFoundry();
  const [effect] = use(clone());

  const ally = makeActor("Guerreiro");
  const first = await preCreate(ally, [cardEffect(effect)]);
  const second = await preCreate(ally, [cardEffect(effect)]);
  await commit(ally, first);
  const [newest] = await commit(ally, second);
  assert.deepEqual([...ally.effects.keys()], [newest.id]);

  settings.mode = "highest";
  const other = makeActor("Outro");
  const a = await preCreate(other, [cardEffect(effect, "2")]);
  const b = await preCreate(other, [cardEffect(effect, "2")]);
  const [oldest] = await commit(other, a);
  await commit(other, b);
  assert.deepEqual([...other.effects.keys()], [oldest.id]);
  assert.match(warnings.at(-1), /Refused/);
});

test("highest: a refused sustained effect never reaches the system's _preCreate (no orphan marker)", async () => {
  const { settings, create, cardEffect, clone, use, makeActor, markers } = setupFoundry();
  settings.mode = "highest";
  const ally = makeActor("Guerreiro");
  const [effect] = use(clone());
  const sustained = (value) => ({ ...cardEffect(effect, value), duration: { expiry: "sustainEnd" } });
  await create(ally, [sustained("2")]);
  assert.deepEqual(await create(ally, [sustained("1")]), []);
  assert.equal(markers.length, 1);
});

test("highest: a sustained effect lost to a concurrent one removes its orphan marker, not a shared one", async () => {
  const { settings, preCreate, commit, cardEffect, clone, use, makeActor } = setupFoundry();
  settings.mode = "highest";
  const bardA = makeActor("BardoA");
  const bardB = makeActor("BardoB");
  const ally = makeActor("Guerreiro");
  const [effect] = use(clone());
  const sustained = (caster, marker) => ({
    ...cardEffect(effect, "2"),
    origin: `${caster.uuid}.ActiveEffect.${marker}`,
    duration: { expiry: "sustainEnd" }
  });
  const a = await preCreate(ally, [sustained(bardA, "mA")]);
  const b = await preCreate(ally, [sustained(bardB, "mB")]);
  assert.ok(bardA.effects.has("mA") && bardB.effects.has("mB"));
  await commit(ally, a);
  await commit(ally, b);
  await new Promise((r) => setTimeout(r));
  assert.equal(ally.effects.size, 1);
  assert.ok(bardA.effects.has("mA"));
  assert.ok(!bardB.effects.has("mB"), "the loser's marker is removed");

  // A card applied to two targets shares its origin: losing on one target keeps the marker the other one uses.
  const third = makeActor("Terceiro");
  const second = makeActor("Outro");
  await commit(third, await preCreate(third, [sustained(bardB, "mC")]));
  const winner = await preCreate(second, [sustained(bardA, "mE")]);
  const loser = await preCreate(second, [sustained(bardB, "mC")]);
  await commit(second, winner);
  await commit(second, loser);
  await new Promise((r) => setTimeout(r));
  assert.equal(second.effects.size, 1);
  assert.ok(bardB.effects.has("mC"), "the shared marker stays");
});

test("marker cleanup waits for a pending creation of the same card and sees tokens of other scenes", async () => {
  const { settings, preCreate, commit, cardEffect, clone, use, makeActor } = setupFoundry();
  settings.mode = "highest";
  const bardA = makeActor("BardoA");
  const bardB = makeActor("BardoB");
  const [effect] = use(clone());
  const sustained = (caster, marker) => ({
    ...cardEffect(effect, "2"),
    origin: `${caster.uuid}.ActiveEffect.${marker}`,
    duration: { expiry: "sustainEnd" }
  });
  const race = async (target, marker) => {
    const winner = await preCreate(target, [sustained(bardA, `w-${marker}`)]);
    const loser = await preCreate(target, [sustained(bardB, marker)]);
    await commit(target, winner);
    await commit(target, loser);
  };

  // Next target of the same card already in _preCreate when the first target's loser is cleaned up.
  const next = makeActor("Proximo");
  const pending = await preCreate(next, [sustained(bardB, "mP")]);
  await race(makeActor("Primeiro"), "mP");
  await new Promise((r) => setTimeout(r));
  assert.ok(bardB.effects.has("mP"), "a pending application keeps the marker");
  await commit(next, pending);
  assert.ok(bardB.effects.has("mP"));

  // A synthetic actor of an unlinked token in another scene still uses the origin.
  const synthetic = { effects: new EffectCollection([["x", { id: "x", origin: `${bardB.uuid}.ActiveEffect.mS` }]]) };
  game.scenes.push({ tokens: [{ actorLink: false, actor: synthetic }] });
  await race(makeActor("Outro"), "mS");
  await new Promise((r) => setTimeout(r));
  assert.ok(bardB.effects.has("mS"), "the marker used in another scene stays");
});

test("a creation that starts while the marker is being deleted waits, so the system recreates the marker", async () => {
  const { settings, preCreate, commit, cardEffect, clone, use, makeActor } = setupFoundry();
  settings.mode = "highest";
  const bardA = makeActor("BardoA");
  const bardB = makeActor("BardoB");
  const [effect] = use(clone());
  const sustained = (caster, marker) => ({
    ...cardEffect(effect, "2"),
    origin: `${caster.uuid}.ActiveEffect.${marker}`,
    duration: { expiry: "sustainEnd" }
  });
  const target = makeActor("Alvo");
  const winner = await preCreate(target, [sustained(bardA, "w")]);
  const loser = await preCreate(target, [sustained(bardB, "mD")]);
  let release;
  let started = false;
  const marker = bardB.effects.get("mD");
  marker.delete = async () => {
    started = true;
    await new Promise((r) => (release = r));
    bardB.effects.delete("mD");
  };
  await commit(target, winner);
  await commit(target, loser);
  for (let i = 0; i < 5 && !started; i++) await new Promise((r) => setTimeout(r));
  assert.ok(started, "the orphan marker deletion started");

  const later = preCreate(makeActor("Proximo"), [sustained(bardB, "mD")]);
  await new Promise((r) => setTimeout(r));
  release();
  const pending = await later;
  assert.equal(pending.accepted.length, 1);
  assert.ok(bardB.effects.has("mD"), "the marker is recreated after the deletion");
});
