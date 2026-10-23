import { test } from "node:test";
import assert from "node:assert/strict";
import {
  USE_PURPOSES,
  addDefenseAdjustments,
  canSeeTokenName,
  defenseAdjustmentsFor,
  installUseTargets,
  registerTargetConsumer,
  targetRecord,
  usePurposeOf,
  useTargetRecords,
  useTargets,
  withUsePurpose
} from "../scripts/rules/shared/targets.mjs";

const state = { on: true };
registerTargetConsumer(() => state.on);

const token = (id, name = id, displayName = 50) => ({ document: { uuid: `Scene.s.Token.${id}`, name, displayName } });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A fake ItemT20 whose roll mirrors the system's body: a synchronous clone first (T20:8545), then awaited
 * rollAttack, rollDamage and displayCard on the clone. Hooks let a test act in the middle of each step.
 */
function setup({ on = true } = {}) {
  state.on = on;
  const seen = [];
  const hooks = {};
  class ItemT20 {
    constructor(name = "Relâmpago") {
      this.name = name;
    }
    clone() {
      hooks.onClone?.(this);
      const copy = new ItemT20(this.name);
      copy.isClone = true;
      return copy;
    }
    async roll(...args) {
      seen.push({ args });
      const item = this.clone({}, { keepId: true });
      hooks.afterClone?.(this, item);
      await tick();
      await item.rollAttack();
      await item.rollDamage();
      return item.displayCard();
    }
    async rollAttack() {
      hooks.duringAttack?.(this);
      await tick();
      seen.push({ step: "attack", item: this, tokens: useTargets(this), records: useTargetRecords(this) });
    }
    async rollDamage() {
      await tick();
      hooks.duringDamage?.(this);
      seen.push({ step: "damage", item: this, tokens: useTargets(this), records: useTargetRecords(this) });
    }
    async displayCard() {
      seen.push({ step: "card", item: this, tokens: useTargets(this), records: useTargetRecords(this) });
      return "card";
    }
  }
  globalThis.CONFIG = { Item: { documentClass: ItemT20 } };
  globalThis.game = { user: { targets: new Set() } };
  installUseTargets();
  const step = (name) => seen.find((entry) => entry.step === name);
  return { ItemT20, seen, hooks, step, setTargets: (...tokens) => (game.user.targets = new Set(tokens)) };
}

test("inside a use the same frozen arrays reach rollAttack, rollDamage and displayCard", async () => {
  const { ItemT20, step, setTargets } = setup();
  const A = token("A", "Guerreiro");
  setTargets(A);
  assert.equal(await new ItemT20().roll(), "card");
  const attack = step("attack");
  for (const name of ["damage", "card"]) {
    assert.equal(step(name).tokens, attack.tokens);
    assert.equal(step(name).records, attack.records);
  }
  assert.deepEqual(attack.tokens, [A]);
  assert.deepEqual(attack.records, [{ uuid: "Scene.s.Token.A", name: "Guerreiro", displayName: 50 }]);
  assert.ok(Object.isFrozen(attack.tokens) && Object.isFrozen(attack.records) && Object.isFrozen(attack.records[0]));
});

test("changing the targets during the attack or the damage does not change the use", async () => {
  for (const when of ["duringAttack", "duringDamage"]) {
    const { ItemT20, hooks, step, setTargets } = setup();
    const A = token("A");
    setTargets(A);
    hooks[when] = () => setTargets(token("B"));
    await new ItemT20().roll();
    assert.deepEqual(step("card").tokens, [A], when);
    assert.deepEqual(step("card").records.map((r) => r.uuid), ["Scene.s.Token.A"], when);
  }
});

test("renaming the token during the use keeps the name recorded at the click", async () => {
  for (const when of ["afterClone", "duringDamage"]) {
    const { ItemT20, hooks, step, setTargets } = setup();
    const A = token("A", "Guerreiro");
    setTargets(A);
    hooks[when] = () => (A.document.name = "Outro");
    await new ItemT20().roll();
    assert.equal(step("attack").records[0].name, "Guerreiro", when);
    assert.equal(step("card").records[0], step("attack").records[0], when);
  }
});

test("a roll started synchronously inside the clone gets its own targets and leaves the outer frame intact", async () => {
  for (const same of [false, true]) {
    const { ItemT20, hooks, seen, setTargets } = setup();
    const outer = new ItemT20("Externo");
    const inner = same ? outer : new ItemT20("Interno");
    setTargets(token("A"));
    let nested = null;
    hooks.onClone = (source) => {
      if (nested) return;
      hooks.onClone = null;
      setTargets(token("B"));
      nested = inner.roll();
    };
    const first = outer.roll();
    await Promise.all([first, nested]);
    const cards = seen.filter((entry) => entry.step === "card");
    const uuids = cards.map((entry) => entry.records.map((r) => r.uuid).join());
    assert.deepEqual(uuids.sort(), ["Scene.s.Token.A", "Scene.s.Token.B"], `same item: ${same}`);
  }
});

test("only the clone returned by the reserved call is bound; extra clones and other items get a fresh copy", async () => {
  // Extra clone nested inside the system's clone.
  {
    const { ItemT20, hooks, setTargets } = setup();
    setTargets(token("A"));
    let extra = null;
    hooks.onClone = (source) => {
      hooks.onClone = null;
      extra = source.clone();
    };
    const item = new ItemT20();
    let bound = null;
    hooks.afterClone = (_source, clone) => (bound = clone);
    const pending = item.roll();
    setTargets(token("B"));
    await pending;
    assert.equal(useTargetRecords(extra)[0].uuid, "Scene.s.Token.B");
    assert.notEqual(useTargets(extra), useTargets(extra));
    assert.equal(bound.isClone, true);
  }
  // Second clone after the first one, and a clone of another item, during the synchronous part.
  {
    const { ItemT20, hooks, step, setTargets } = setup();
    setTargets(token("A"));
    const other = new ItemT20("Outro");
    const late = [];
    hooks.afterClone = (source) => {
      late.push(source.clone(), other.clone());
    };
    const pending = new ItemT20().roll();
    setTargets(token("B"));
    await pending;
    for (const copy of late) assert.equal(useTargetRecords(copy)[0].uuid, "Scene.s.Token.B");
    assert.equal(step("card").records[0].uuid, "Scene.s.Token.A");
  }
});

test("outside a use each call reads the current targets, and the clone loses its context when the use ends", async () => {
  const { ItemT20, hooks, setTargets } = setup();
  const item = new ItemT20();
  setTargets(token("A"));
  const first = useTargets(item);
  assert.notEqual(useTargets(item), first);
  setTargets(token("B"));
  assert.equal(useTargetRecords(item)[0].uuid, "Scene.s.Token.B");

  let clone = null;
  hooks.afterClone = (_s, c) => (clone = c);
  await item.roll();
  setTargets(token("C"));
  assert.equal(useTargetRecords(clone)[0].uuid, "Scene.s.Token.C");

  // A rejected use also releases the clone.
  ItemT20.prototype.rollDamage = async function () {
    throw new Error("boom");
  };
  setTargets(token("D"));
  await assert.rejects(item.roll(), /boom/);
  setTargets(token("E"));
  assert.equal(useTargetRecords(clone)[0].uuid, "Scene.s.Token.E");
});

test("a roll that throws synchronously after the clone releases the clone", async () => {
  state.on = true;
  let copy = null;
  class SyncItem {
    clone() {
      return new SyncItem();
    }
    roll() {
      copy = this.clone();
      throw new Error("sync");
    }
  }
  globalThis.CONFIG = { Item: { documentClass: SyncItem } };
  globalThis.game = { user: { targets: new Set([token("A")]) } };
  installUseTargets();
  await assert.rejects(new SyncItem().roll(), /sync/);
  game.user.targets = new Set([token("B")]);
  assert.equal(useTargetRecords(copy)[0].uuid, "Scene.s.Token.B");
});

test("a foreign roll wrapper that awaits before the system roll leads to a fresh copy", async () => {
  const { ItemT20, step, setTargets } = setup();
  const wrapped = ItemT20.prototype.roll;
  ItemT20.prototype.roll = async function (...args) {
    await tick();
    return wrapped.apply(this, args);
  };
  setTargets(token("A"));
  const pending = new ItemT20().roll();
  setTargets(token("B"));
  await pending;
  assert.equal(step("card").records[0].uuid, "Scene.s.Token.B");
});

test("purpose: MANEUVER_RESISTANCE empties the targets, is consumed by one roll and restored on errors", async () => {
  const { ItemT20, hooks, seen, setTargets } = setup({ on: false });
  setTargets(token("A"));
  const item = new ItemT20();
  let clone = null;
  let nested = null;
  hooks.afterClone = (_s, c) => {
    if (clone) return;
    clone = c;
    nested = new ItemT20("Aninhado");
  };
  let purposeInUse = null;
  ItemT20.prototype.rollAttack = async function () {
    purposeInUse ??= usePurposeOf(this);
    seen.push({ step: "attack", item: this, tokens: useTargets(this), records: useTargetRecords(this) });
  };
  await withUsePurpose(USE_PURPOSES.MANEUVER_RESISTANCE, () => item.roll());
  assert.equal(purposeInUse, USE_PURPOSES.MANEUVER_RESISTANCE);
  const attack = seen.find((e) => e.step === "attack");
  assert.deepEqual([attack.tokens.length, attack.records.length], [0, 0]);

  // The next roll outside withUsePurpose has no purpose (and no consumer on: no context at all).
  purposeInUse = null;
  hooks.afterClone = (_s, c) => (clone = c);
  await nested.roll();
  assert.equal(purposeInUse, null);

  // Nested withUsePurpose restores the outer value, also when fn throws; fn without a roll leaves nothing pending.
  withUsePurpose("outer", () => {
    assert.throws(() => withUsePurpose("inner", () => {
      throw new Error("x");
    }));
    purposeInUse = null;
  });
  withUsePurpose(USE_PURPOSES.MANEUVER_RESISTANCE, () => null);
  purposeInUse = null;
  await item.roll();
  assert.equal(purposeInUse, null);
});

test("a roll nested in a purposed use has no purpose and normal targets", async () => {
  const { ItemT20, hooks, setTargets } = setup();
  setTargets(token("A"));
  const purposes = [];
  ItemT20.prototype.displayCard = async function () {
    purposes.push([this.name, usePurposeOf(this), useTargetRecords(this).length]);
  };
  const inner = new ItemT20("Interno");
  hooks.onClone = (source) => {
    if (source !== outer) return;
    hooks.onClone = null;
    pendingInner = inner.roll();
  };
  const outer = new ItemT20("Externo");
  let pendingInner = null;
  await withUsePurpose(USE_PURPOSES.MANEUVER_RESISTANCE, () => outer.roll());
  await pendingInner;
  assert.deepEqual(purposes.sort(), [["Externo", USE_PURPOSES.MANEUVER_RESISTANCE, 0], ["Interno", null, 1]]);
});

test("no consumer on and no purpose: the original runs with the same arguments and no context; installs once", async () => {
  const { ItemT20, seen, setTargets, step } = setup({ on: false });
  const wrapped = ItemT20.prototype.roll;
  installUseTargets();
  assert.equal(ItemT20.prototype.roll, wrapped);
  setTargets(token("A"));
  const args = { event: { shiftKey: true } };
  const pending = new ItemT20().roll(args);
  setTargets(token("B"));
  await pending;
  assert.equal(seen[0].args[0], args);
  assert.equal(step("card").records[0].uuid, "Scene.s.Token.B");
});

test("targetRecord accepts a Token or a TokenDocument", () => {
  assert.deepEqual(targetRecord(token("A", "Guerreiro", 30)), { uuid: "Scene.s.Token.A", name: "Guerreiro", displayName: 30 });
  assert.deepEqual(targetRecord({ uuid: "T.1", name: "X" }), { uuid: "T.1", name: "X", displayName: 0 });
  assert.equal(targetRecord({ document: { name: "sem uuid" } }), null);
  assert.equal(targetRecord(null), null);
});

test("canSeeTokenName: GM, owner, or a public display mode", () => {
  assert.equal(canSeeTokenName({ isGM: true, isOwner: false, displayName: 0 }), true);
  assert.equal(canSeeTokenName({ isGM: false, isOwner: true, displayName: 0 }), true);
  for (const mode of [0, 10, 20, 40]) assert.equal(canSeeTokenName({ isGM: false, isOwner: false, displayName: mode }), false);
  for (const mode of [30, 50, "50"]) assert.equal(canSeeTokenName({ isGM: false, isOwner: false, displayName: mode }), true);
});

test("Defense adjustments: per target, accumulated without repeating an id, returned as a copy", () => {
  const item = {};
  addDefenseAdjustments(item, new Map([["A", [{ id: "cover", delta: 5 }]], ["B", [{ id: "x", delta: -2 }]]]));
  addDefenseAdjustments(item, new Map([["A", [{ id: "cover", delta: 10 }, { id: "flank", delta: "2" }]]]));
  assert.deepEqual(defenseAdjustmentsFor(item, "A"), [{ id: "cover", delta: 5 }, { id: "flank", delta: 2 }]);
  assert.deepEqual(defenseAdjustmentsFor(item, "B"), [{ id: "x", delta: -2 }]);
  assert.deepEqual(defenseAdjustmentsFor(item, "C"), []);
  assert.deepEqual(defenseAdjustmentsFor({}, "A"), []);
  defenseAdjustmentsFor(item, "A")[0].delta = 99;
  assert.equal(defenseAdjustmentsFor(item, "A")[0].delta, 5);
});
