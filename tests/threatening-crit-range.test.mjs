import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  adjustThreatEffect,
  isThreatMultiply,
  rewriteThreatChanges,
  threatRangeIncrease
} from "../scripts/patches/threatening-crit-range.mjs";

const keen = () => ({ key: "criticoM", type: "multiply", value: 2, phase: "initial", priority: null });
const precise = () => ({ key: "criticoM", type: "add", value: -1, phase: "initial", priority: null });

test("threatRangeIncrease doubles the threat range from the base criticoM", () => {
  assert.equal(threatRangeIncrease(19, 2), -2);
  assert.equal(threatRangeIncrease(18, 2), -3);
  assert.equal(threatRangeIncrease(20, 2), -1);
  assert.equal(threatRangeIncrease(19, "2"), -2);
  assert.equal(threatRangeIncrease("19", 3), -4);
  for (const factor of [1, 0, 1.5, "x", -2, undefined]) assert.equal(threatRangeIncrease(19, factor), null, String(factor));
  for (const minimum of [0, 21, 18.5, "abc", undefined]) assert.equal(threatRangeIncrease(minimum, 2), null, String(minimum));
});

test("isThreatMultiply only matches criticoM multiply", () => {
  assert.equal(isThreatMultiply(keen()), true);
  assert.equal(isThreatMultiply(precise()), false);
  assert.equal(isThreatMultiply({ key: "criticoX", type: "multiply" }), false);
  assert.equal(isThreatMultiply({ key: "efeito.criticoM", type: "multiply" }), false);
  assert.equal(isThreatMultiply(undefined), false);
});

test("rewriteThreatChanges rewrites only the eligible change, without mutating the input", () => {
  const changes = [keen(), precise(), { key: "criticoX", type: "multiply", value: 2 }];
  const snapshot = structuredClone(changes);
  const { changes: result, count } = rewriteThreatChanges(changes, 19);
  assert.equal(count, 1);
  assert.deepEqual(result[0], { key: "criticoM", type: "add", value: -2, phase: "initial", priority: null });
  assert.deepEqual(result.slice(1), snapshot.slice(1));
  assert.notEqual(result[1], changes[1]);
  assert.deepEqual(changes, snapshot);
  assert.equal(rewriteThreatChanges([keen()], 25).count, 0);
  assert.deepEqual(rewriteThreatChanges(undefined, 19), { changes: [], count: 0 });
});

/* Reduced copy of the system's applyItemChanges (add/multiply branches) applied in effect order. */
function applyChanges(criticoM, effects) {
  let value = criticoM;
  for (const { changes, qty = 1 } of effects) {
    for (const ch of changes) {
      const v = ch.value.toString();
      if (ch.type === "multiply" && Number(v)) value = Number(value) * (Number(v) * qty);
      else if (ch.type === "add" && Number(v)) value = Number(value) + Number(v) * qty;
    }
  }
  return value;
}
const fixed = (criticoM, changes, qty) => ({ changes: rewriteThreatChanges(changes, criticoM).changes, qty });

test("the rewritten changes give the book's threat range", () => {
  assert.equal(applyChanges(19, [{ changes: [keen()] }]), 38, "bug without the patch");
  assert.equal(applyChanges(19, [fixed(19, [keen()])]), 17);
  assert.equal(applyChanges(18, [fixed(18, [keen()])]), 15);
  assert.equal(applyChanges(20, [fixed(20, [keen()])]), 19);
  assert.equal(applyChanges(19, [fixed(19, [keen()]), fixed(19, [precise()])]), 16);
  assert.equal(applyChanges(19, [fixed(19, [precise()]), fixed(19, [keen()])]), 16);
  assert.equal(applyChanges(19, [fixed(19, [keen()]), fixed(19, [keen()])]), 15);
  assert.equal(applyChanges(19, [fixed(19, [keen()], 2)]), 15);
});

/* Fake effect whose clone rebuilds from the source and merges the data, like Document#clone. */
class FakeEffect {
  constructor(data, { parent } = {}) {
    this._source = structuredClone(data);
    this.id = data._id;
    this.parent = parent;
    this.system = structuredClone(data.system);
    this.clones = [];
  }
  clone(data = {}, { keepId } = {}) {
    const source = structuredClone(this._source);
    if (data.system?.changes) source.system.changes = structuredClone(data.system.changes);
    if (!keepId) delete source._id;
    const copy = new FakeEffect(source, { parent: this.parent });
    this.clones.push(copy);
    return copy;
  }
}

const weapon = (criticoM = 19, id = "w1", type = "arma") => ({ id, type, system: { criticoM } });
const effectOf = (parent, changes, id = "e1") => new FakeEffect({ _id: id, system: { changes } }, { parent });

test("adjustThreatEffect returns a rewritten copy and keeps the live effect", () => {
  const item = weapon();
  const effect = effectOf(item, [keen()]);
  const copy = adjustThreatEffect(effect, item);
  assert.notEqual(copy, effect);
  assert.equal(copy.id, "e1");
  assert.equal(copy.parent, item);
  assert.deepEqual(copy.system.changes[0], { key: "criticoM", type: "add", value: -2, phase: "initial", priority: null });
  assert.deepEqual(copy._source.system.changes[0].type, "add", "the rewrite survives a later clone");
  assert.deepEqual(effect.system.changes, [keen()]);
  assert.deepEqual(effect._source.system.changes, [keen()]);
});

test("adjustThreatEffect keeps prepared changes from earlier wrappers", () => {
  const item = weapon();
  const effect = effectOf(item, [keen(), { key: "+system.x", type: "add", value: 1 }]);
  effect.system.changes[1].key = "system.x";
  const copy = adjustThreatEffect(effect, item);
  assert.equal(copy.system.changes[1].key, "system.x");
});

test("adjustThreatEffect returns the same effect when there is nothing to do or the clone fails", () => {
  const item = weapon();
  const plain = effectOf(item, [precise()]);
  assert.equal(adjustThreatEffect(plain, item), plain);
  const outOfRange = effectOf(weapon(25), [keen()]);
  assert.equal(adjustThreatEffect(outOfRange, weapon(25)), outOfRange);
  const broken = effectOf(item, [keen()]);
  broken.clone = () => {
    throw new Error("boom");
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(adjustThreatEffect(broken, item), broken);
  } finally {
    console.warn = warn;
  }
  const noChanges = { system: {} };
  assert.equal(adjustThreatEffect(noChanges, item), noChanges);
});

test("apply() rewrites only the rolled weapon's own effects", () => {
  let list = [];
  class Item {
    _allApplicableOnUseEffects() {
      return list;
    }
  }
  globalThis.CONFIG = { Item: { documentClass: Item } };
  try {
    patch.apply();
    const rolled = Object.assign(new Item(), weapon());
    const other = weapon(19, "p1", "poder");
    const own = effectOf(rolled, [keen()], "own");
    const foreign = effectOf(other, [keen()], "foreign");
    list = [own, foreign];
    const result = rolled._allApplicableOnUseEffects();
    assert.equal(result[0].system.changes[0].type, "add");
    assert.equal(result[0].id, "own");
    assert.equal(result[1], foreign);

    const power = Object.assign(new Item(), weapon(19, "p2", "poder"));
    const powerOwn = effectOf(power, [keen()]);
    list = [powerOwn];
    assert.equal(power._allApplicableOnUseEffects()[0], powerOwn);
  } finally {
    delete globalThis.CONFIG;
  }
});
