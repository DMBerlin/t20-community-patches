import { test } from "node:test";
import assert from "node:assert/strict";
import patch, { collectsIgnoringSuppression, isSuppressedUsageEffect } from "../scripts/patches/suppressed-usage-effects.mjs";

const item = (id, suppressed = false) => ({ documentName: "Item", id, areEffectsSuppressed: suppressed });
const usage = (parent, extra = {}) => ({ documentName: "ActiveEffect", system: { onuse: true }, parent, ...extra });

test("only usage effects of suppressed items other than the rolled one are suppressed", () => {
  assert.equal(isSuppressedUsageEffect({ system: { onuse: false }, parent: item("a", true) }, null), false);
  assert.equal(isSuppressedUsageEffect(usage({ documentName: "Actor", areEffectsSuppressed: true }), null), false);
  assert.equal(isSuppressedUsageEffect(usage(item("a", true)), "a"), false);
  assert.equal(isSuppressedUsageEffect(usage(item("a", true)), "b"), true);
  assert.equal(isSuppressedUsageEffect(usage(item("a", true)), null), true);
  assert.equal(isSuppressedUsageEffect(usage(item("a"), { isSuppressed: true }), null), true);
  assert.equal(isSuppressedUsageEffect(usage(item("a")), null), false);
});

test("detects collection code that ignores suppression", () => {
  const buggy = "for (const effect of item.effects) { if (!effect.system.onuse) return; list.push(effect); }";
  assert.equal(collectsIgnoringSuppression(buggy), true);
  assert.equal(collectsIgnoringSuppression(buggy.replace("return;", "return; if (item.areEffectsSuppressed) return;")), false);
});

/* Integration with fake system classes. */

function setup() {
  const equipped = item("worn");
  const stored = item("bag", true);
  const effects = {
    own: usage(item("rolled", true)),
    worn: usage(equipped),
    bag: usage(stored),
    actor: usage({ documentName: "Actor" })
  };
  const traversal = [
    ["items", equipped],
    ["items.effects", effects.worn],
    ["items", stored],
    ["items.effects", effects.bag],
    ["effects", effects.actor]
  ];
  class Actor {
    *traverseEmbeddedDocuments() {
      yield* traversal;
    }
    collect() {
      return [...this.traverseEmbeddedDocuments()].map(([, d]) => d).filter((d) => d.documentName === "ActiveEffect");
    }
    async rollPericia(_key, options = {}) {
      const list = this.collect(); // filters system.onuse
      const nested = options.nested ? this.rollAtributo("for") : null;
      const after = this.collect();
      await null;
      return { list, after, nested: await nested, late: this.collect() };
    }
    async rollAtributo() {
      return { list: this.collect() }; // filters system.onuse
    }
  }
  class Item {
    id = "rolled";
    _allApplicableOnUseEffects() {
      return Object.values(effects); // filters system.onuse
    }
  }
  globalThis.CONFIG = { Actor: { documentClass: Actor }, Item: { documentClass: Item } };
  assert.equal(patch.isNeeded(), true);
  patch.apply();
  return { Actor, Item, effects };
}

test("item rolls keep the rolled item's and the actor's effects and drop stored items' effects", () => {
  const { Item, effects } = setup();
  assert.deepEqual(new Item()._allApplicableOnUseEffects(), [effects.own, effects.worn, effects.actor]);
});

test("skill and attribute rolls drop stored items' effects only inside the collection window", async () => {
  const { Actor, effects } = setup();
  const actor = new Actor();
  const filtered = [effects.worn, effects.actor];
  assert.equal(actor.collect().length, 3);
  const result = await actor.rollPericia("furt", { nested: true });
  assert.deepEqual(result.list, filtered);
  assert.deepEqual(result.after, filtered, "a nested sync roll must not close the outer window");
  assert.deepEqual(result.nested.list, filtered);
  assert.equal(result.late.length, 3, "after the first await the traversal is untouched");
  assert.deepEqual((await actor.rollAtributo("for")).list, filtered);
  assert.equal(actor.collect().length, 3);
});

test("the probe sees the system code after the patch is applied", () => {
  setup();
  assert.equal(patch.isNeeded(), true);
});
