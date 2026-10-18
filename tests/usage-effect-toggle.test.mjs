import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toggleFlipsDisabled,
  toggleIconClasses,
  usesAutomaticToggle
} from "../scripts/patches/usage-effect-toggle.mjs";
import { markWrapper, unwrap } from "../scripts/utils.mjs";

const item = { documentName: "Item" };
const actor = { documentName: "Actor" };

test("usage rows toggle Always Apply, except temporary usage effects held by items", () => {
  assert.equal(usesAutomaticToggle(null), false);
  assert.equal(usesAutomaticToggle({ system: { onuse: false }, parent: item }), false);
  assert.equal(usesAutomaticToggle({ system: { onuse: true }, isTemporary: false, parent: item }), true);
  assert.equal(usesAutomaticToggle({ system: { onuse: true }, isTemporary: true, parent: actor }), true);
  assert.equal(usesAutomaticToggle({ system: { onuse: true }, isTemporary: true, parent: item }), false);
});

test("icon follows the Always Apply state", () => {
  assert.deepEqual(toggleIconClasses(true), { add: "fa-square-check", remove: "fa-square" });
  assert.deepEqual(toggleIconClasses(false), { add: "fa-square", remove: "fa-square-check" });
});

test("detects the official toggle that flips disabled", () => {
  const buggy = `static async onManageActiveEffect(event, owner) {
    switch (a.dataset.action) {
      case "delete":
        return effect.delete();
      case "toggle":
        return effect.update({ disabled: !effect.disabled });
    }
  }`;
  assert.equal(toggleFlipsDisabled(buggy), true);
  const fixed = buggy.replace(
    "return effect.update({ disabled: !effect.disabled });",
    'if (effect.isUsage) return effect.update({ "system.abilityUse.automatic": !effect.system.abilityUse.automatic });'
  );
  assert.equal(toggleFlipsDisabled(fixed), false);
  assert.equal(toggleFlipsDisabled("async (event, owner) { return manage.call(this, event, owner); }"), undefined);
  assert.equal(toggleFlipsDisabled(undefined), undefined);
});

test("unwrap reaches the system function below wrappers of other patches", () => {
  const original = () => "system";
  const inner = markWrapper(() => "item-effects", original);
  const outer = markWrapper(() => "usage-toggle", inner);
  assert.equal(unwrap(outer), original);
  assert.equal(unwrap(original), original);
});

/* Composition with item-effects-on-actor-sheet (#2) on a mocked Foundry, both patch orders. */

class FakeElement {}
class ClassList {
  constructor(names) { this.names = new Set(names); }
  add(n) { this.names.add(n); }
  remove(n) { this.names.delete(n); }
  contains(n) { return this.names.has(n); }
}

function setupFoundry() {
  const hooks = {};
  class ActorSheet {}
  class ActorSheetT20 extends ActorSheet {
    async getData() { return { effects: {} }; }
    _onDragStart() {}
  }
  class ActorSheetT20Character extends ActorSheetT20 {}
  const Legacy = {
    async onManageActiveEffect(event, owner) {
      const effect = owner.effects.get(event.currentTarget.closest("li").dataset.effectId);
      return effect.update({ disabled: !effect.disabled });
    },
    async prepareActiveEffectCategories(list) {
      return { onuse: { effects: list } };
    }
  };
  Object.assign(globalThis, {
    Hooks: { on: (name, fn) => (hooks[name] ??= []).push(fn) },
    game: { i18n: { localize: (key) => key } },
    HTMLElement: FakeElement,
    foundry: { appv1: { sheets: { ActorSheet } }, utils: { fromUuidSync: () => null } },
    tormenta20: { entities: { ActiveEffectT20: Legacy }, applications: { ActorSheetT20Character } }
  });
  return { hooks, Legacy, ActorSheetT20Character };
}

function makeEffect(id, parent, automatic) {
  return {
    id,
    parent,
    disabled: true,
    isTemporary: false,
    system: { onuse: true, abilityUse: { automatic } },
    get uuid() { return `${parent.uuid}.ActiveEffect.${id}`; },
    async update(changes) {
      if ("system.abilityUse.automatic" in changes) this.system.abilityUse.automatic = changes["system.abilityUse.automatic"];
      if ("disabled" in changes) this.disabled = changes.disabled;
      return this;
    }
  };
}

function makeRow(id) {
  const icon = { classList: new ClassList(["fa-regular", "fa-square"]) };
  const anchor = { dataset: { action: "toggle" }, querySelector: () => icon };
  const li = { dataset: { effectId: id }, classList: new ClassList(["effect"]), querySelector: () => anchor };
  anchor.closest = () => li;
  return { li, anchor, icon };
}

for (const order of [["item-effects", "usage-toggle"], ["usage-toggle", "item-effects"]]) {
  test(`icons follow each row's own effect with repeated ids (${order.join(" → ")})`, async () => {
    const { hooks, Legacy, ActorSheetT20Character } = setupFoundry();
    const patches = {
      "item-effects": (await import("../scripts/patches/item-effects-on-actor-sheet.mjs")).default,
      "usage-toggle": (await import("../scripts/patches/usage-effect-toggle.mjs")).default
    };
    for (const id of order) patches[id].apply();

    // Same effect id "E" on the actor and on two items created from the same source.
    const actor = { documentName: "Actor", uuid: "Actor.A" };
    const sword = { documentName: "Item", uuid: "Actor.A.Item.S" };
    const staff = { documentName: "Item", uuid: "Actor.A.Item.T" };
    const own = makeEffect("E", actor, false);
    const onSword = makeEffect("E", sword, true);
    const onStaff = makeEffect("E", staff, false);
    actor.effects = new Map([["E", own]]);
    sword.effects = new Map([["E", onSword]]);
    staff.effects = new Map([["E", onStaff]]);
    actor.items = new Map([["S", sword], ["T", staff]]);
    actor.allApplicableEffects = function* () { yield own; yield onSword; yield onStaff; };

    const rows = [makeRow("E"), makeRow("E"), makeRow("E")];
    const root = Object.assign(new FakeElement(), { querySelectorAll: () => rows.map((r) => r.li) });
    const app = Object.assign(new ActorSheetT20Character(), { actor });
    await app.getData();
    for (const fn of hooks.renderActorSheetT20) fn(app, root);
    await Promise.resolve();

    const checked = rows.map((r) => r.icon.classList.contains("fa-square-check"));
    assert.deepEqual(checked, [false, true, false]);

    await Legacy.onManageActiveEffect({ currentTarget: rows[2].anchor, preventDefault() {} }, actor);
    assert.equal(onStaff.system.abilityUse.automatic, true);
    assert.equal(onStaff.disabled, true);
    assert.equal(own.system.abilityUse.automatic, false);
  });
}
