import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  isolateUsageEffect,
  normalizeAppendedChanges,
  shouldNormalizeAppendedChange
} from "../scripts/patches/appended-usage-changes.mjs";

const plus = { key: "+system.modificadores.dano.geral" };

test("normalizes only +system.* changes without aumenta on item rolls", () => {
  assert.equal(shouldNormalizeAppendedChange(plus, { aumenta: false, itemType: "poder" }), true);
  assert.equal(shouldNormalizeAppendedChange(plus, { aumenta: true, itemType: "poder" }), false);
  assert.equal(shouldNormalizeAppendedChange(plus, { itemType: "pericia" }), false);
  assert.equal(shouldNormalizeAppendedChange(plus, { itemType: "atributo" }), false);
  for (const key of ["+cd", "+pericia", "system.x", "+system.", "+system.a b", undefined]) {
    assert.equal(shouldNormalizeAppendedChange({ key }, { itemType: "poder" }), false, String(key));
  }
});

test("normalizeAppendedChanges changes only the eligible entries", () => {
  const changes = [{ key: "+system.a.b" }, { key: "+cd" }, { key: "system.c" }, { key: "+system.d" }];
  assert.equal(normalizeAppendedChanges(changes, { itemType: "arma" }), 2);
  assert.deepEqual(changes.map((c) => c.key), ["system.a.b", "+cd", "system.c", "system.d"]);
  assert.equal(normalizeAppendedChanges(undefined, {}), 0);
});

/* Integration: a reduced copy of the system's applyOnUseEffects ("+" branch, addToChange and final reduce). */

class FakeEffect {
  constructor(data, { parent } = {}) {
    this.id = data.id;
    this.parent = parent;
    this.system = structuredClone(data.system);
    this._source = structuredClone(data);
  }
  clone(_data, { keepId } = {}) {
    const data = structuredClone(this._source);
    if (!keepId) delete data.id;
    return new FakeEffect(data, { parent: this.parent });
  }
}

function systemApplyOnUse(mainEffect, usageEffects, applied) {
  const effectList = [mainEffect];
  for (const ef of usageEffects.filter((e) => applied[e.id])) {
    const qty = applied[ef.id];
    for (const ch of ef.system.changes) {
      ch.value = ch.value.toString();
      if (ch.key.startsWith("+")) {
        ch.key = ch.key.replace("+", "");
        effectList.forEach((e) => e.system.changes.push(ch));
      }
      const addToChange = (t) => {
        if (ch.key.startsWith("@")) {
          t.system.changes.forEach((c) => {
            if (c.key == ch.key) c.value = Number(c.value) + (Number(ch.value * qty) || ch.value);
          });
        } else if (ch.key.startsWith("+")) ; else {
          const include = ef.system.abilityUse?.aumenta ? t.system.changes.some((i) => i.key == ch.key) : true;
          if (include) t.system.changes.push({ key: ch.key, value: Number(ch.value * qty) || ch.value, type: ch.type });
        }
      };
      effectList.forEach(addToChange);
    }
  }
  const changes = mainEffect.system.changes;
  const vars = Object.fromEntries(changes.filter((c) => c.key.startsWith("@")).map((c) => [c.key.slice(1), c.value]));
  return changes.reduce((acc, ch) => {
    if (ch.key.startsWith("@")) return acc;
    ch.value = String(ch.value).replace(/@(\w+)/g, (_, k) => vars[k]);
    const prev = acc.find((c) => c.key === ch.key);
    if (prev) prev.value = Number(prev.value) + Number(ch.value);
    else acc.push({ key: ch.key, value: Number(ch.value) });
    return acc;
  }, []);
}

function setup() {
  const actor = { documentName: "Actor" };
  const marcial = new FakeEffect(
    {
      id: "marcial",
      system: {
        abilityUse: { aumenta: false },
        changes: [{ key: "+system.modificadores.dano.geral", value: "@modificador", type: "add" }]
      }
    },
    { parent: { documentName: "Item", id: "marcialItem", parent: actor } }
  );
  const aumento = new FakeEffect(
    { id: "aumento", system: { abilityUse: { aumenta: true }, changes: [{ key: "@modificador", value: 1, type: "add" }] } },
    { parent: { documentName: "Item", id: "inspiracao", parent: actor } }
  );
  const mainEffect = () =>
    new FakeEffect({
      id: "main",
      system: {
        changes: [
          { key: "@modificador", value: 1, type: "add" },
          { key: "system.modificadores.pericias.geral", value: "@modificador", type: "add" }
        ]
      }
    });
  class Item {
    type = "poder";
    _allApplicableOnUseEffects() {
      return [marcial, aumento];
    }
  }
  return { marcial, mainEffect, Item };
}

const roll = (Item, mainEffect, applied) => {
  const item = new Item();
  return systemApplyOnUse(mainEffect(), item._allApplicableOnUseEffects(), applied);
};

const result = (pericias, dano) => [
  { key: "system.modificadores.pericias.geral", value: pericias },
  { key: "system.modificadores.dano.geral", value: dano }
];

test("reduced system flow reproduces the doubled and leaked bonus", () => {
  const { marcial, mainEffect, Item } = setup();
  assert.deepEqual(roll(Item, mainEffect, { marcial: 1, aumento: 2 }), result(3, 6));
  assert.equal(marcial.system.changes[0].key, "system.modificadores.dano.geral");
  assert.deepEqual(roll(Item, mainEffect, { marcial: 1 }), result(1, 3));
});

test("with the patch the bonus is added once and the live effect is untouched", () => {
  const { marcial, mainEffect, Item } = setup();
  globalThis.CONFIG = { Item: { documentClass: Item } };
  try {
    patch.apply();
    assert.deepEqual(roll(Item, mainEffect, { marcial: 1, aumento: 2 }), result(3, 3));
    assert.deepEqual(roll(Item, mainEffect, { marcial: 1 }), result(1, 1));
    assert.deepEqual(marcial.system.changes, [
      { key: "+system.modificadores.dano.geral", value: "@modificador", type: "add" }
    ]);
    const [copy] = new Item()._allApplicableOnUseEffects();
    assert.equal(copy.id, marcial.id);
    assert.equal(copy.parent, marcial.parent);
  } finally {
    delete globalThis.CONFIG;
  }
});

test("an effect that cannot be cloned is returned as is", () => {
  const plain = { id: "x" };
  assert.equal(isolateUsageEffect(plain, "poder"), plain);
  const broken = { id: "y", clone: () => { throw new Error("boom"); } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(isolateUsageEffect(broken, "poder"), broken);
  } finally {
    console.warn = warn;
  }
});
