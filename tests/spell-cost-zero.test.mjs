import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  CANTRIP_COST,
  cantripLocks,
  isDisposableEffect,
  safeUsageCost,
  systemReadsAsCantrip,
  withSafeCost
} from "../scripts/patches/spell-cost-zero.mjs";
import dialogCostPatch from "../scripts/patches/ability-dialog-cost.mjs";

test("the system's cantrip test also matches -1 and a missing cost", () => {
  for (const custo of [CANTRIP_COST, -1, undefined]) assert.equal(systemReadsAsCantrip(custo), true, String(custo));
  for (const custo of ["-1", "0", "", 0, null, 2, -2]) assert.equal(systemReadsAsCantrip(custo), false, String(custo));
});

test("only a numeric cost misread as a cantrip is handed over as text", () => {
  assert.equal(safeUsageCost(-1), "-1");
  assert.equal(systemReadsAsCantrip(safeUsageCost(-1)), false);
  assert.equal(Number(safeUsageCost(-1)) * 1 || safeUsageCost(-1), -1, "the system still adds -1 PM");
  for (const custo of [-2, 0, null, undefined, 2, CANTRIP_COST, "-1", NaN]) assert.equal(safeUsageCost(custo), custo);
});

/* Fake documents. */

function collection(docs) {
  const map = new Map(docs.map((doc) => [doc.id, doc]));
  return { get: (id) => map.get(id), [Symbol.iterator]: () => map.values() };
}

function fakeEffect(id, custo) {
  const effect = {
    id,
    parent: null,
    system: { abilityUse: { custo } },
    clone(data, { keepId } = {}) {
      assert.equal(keepId, true);
      const copy = fakeEffect(this.id, this.system.abilityUse.custo);
      copy.parent = this.parent;
      return copy;
    }
  };
  return effect;
}

function fakeParent(id, effects) {
  const parent = { id, effects: collection(effects) };
  for (const effect of effects) effect.parent = parent;
  return parent;
}

function fakeWorld() {
  const stored = fakeEffect("foco", -1);
  const storedItem = fakeParent("poder", [stored]);
  const spellStored = fakeParent("spell", [fakeEffect("own", -1)]);
  const actorEffect = fakeEffect("actor-ef", -1);
  const actor = { id: "actor", items: collection([storedItem, spellStored]) };
  actor.effects = collection([actorEffect]);
  actorEffect.parent = actor;
  const ownEffect = fakeEffect("own", -1);
  const spellClone = fakeParent("spell", [ownEffect]);
  return { stored, storedItem, actorEffect, actor, ownEffect, spellClone };
}

test("only effects of the rolled clone and loose copies are disposable", () => {
  const { stored, actorEffect, actor, ownEffect } = fakeWorld();
  assert.equal(isDisposableEffect(ownEffect, actor), true, "effect of the rolled item's clone");
  const looseCopy = stored.clone({}, { keepId: true });
  assert.equal(isDisposableEffect(looseCopy, actor), true, "copy outside its parent's collection (#23)");
  assert.equal(isDisposableEffect(stored, actor), false, "effect of a stored item");
  assert.equal(isDisposableEffect(actorEffect, actor), false, "effect of the actor");
  assert.equal(isDisposableEffect({ id: "x" }, actor), false);
  assert.equal(isDisposableEffect(ownEffect, null), false);
});

test("stored effects are cloned before the fix and never changed", () => {
  const { stored, actor, ownEffect } = fakeWorld();
  const fixed = withSafeCost(stored, actor);
  assert.notEqual(fixed, stored);
  assert.equal(fixed.id, stored.id);
  assert.equal(fixed.system.abilityUse.custo, "-1");
  assert.equal(stored.system.abilityUse.custo, -1);

  assert.equal(withSafeCost(ownEffect, actor), ownEffect, "disposable copy changed in place");
  assert.equal(ownEffect.system.abilityUse.custo, "-1");

  const reducer = fakeEffect("r2", -2);
  fakeParent("poder2", [reducer]);
  assert.equal(withSafeCost(reducer, actor), reducer);
  assert.equal(reducer.system.abilityUse.custo, -2);
});

test("a checked Truque locks the spell's enhancements, other Truques and paid rows from other sources", () => {
  const row = (id, extra) => ({ id, own: false, cantrip: false, cost: 0, active: false, ...extra });
  assert.equal(cantripLocks([row("t", { own: true, cantrip: true, cost: NaN })]).cantrip, null);
  const rows = [
    row("dice", { own: true, cost: 1, active: true }),
    row("t1", { own: true, cantrip: true, cost: NaN, active: true }),
    row("t2", { own: true, cantrip: true, cost: NaN, active: true }),
    row("ampliada", { cost: 2, active: true }),
    row("foco", { cost: -1, active: true }),
    row("bonus", { cost: 0 }),
    row("empty", { cost: Number("") })
  ];
  const { cantrip, locked } = cantripLocks(rows);
  assert.equal(cantrip, "t1");
  assert.deepEqual([...locked].sort(), ["ampliada", "dice", "t2"]);
  assert.deepEqual(cantripLocks().locked.size, 0);
});

/* Minimal DOM: just the selectors and events the dialog code uses. */

class FakeElement {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.type = attrs.type ?? "";
    this.name = attrs.name ?? "";
    this.value = attrs.value ?? "";
    this.checked = !!attrs.checked;
    this.disabled = false;
    this.classes = new Set(attrs.class ? attrs.class.split(" ") : []);
    this.dataset = { ...(attrs.dataset ?? {}) };
    this.style = {};
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.classList = {
      add: (c) => this.classes.add(c),
      remove: (c) => this.classes.delete(c),
      contains: (c) => this.classes.has(c)
    };
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
    return this;
  }
  *descendants() {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }
  matchesCompound(compound) {
    const tag = compound.match(/^[a-z]+/i)?.[0];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    const outside = compound.replace(/\[[^\]]*\]/g, "");
    for (const [, cls] of outside.matchAll(/\.([\w-]+)/g)) if (!this.classes.has(cls)) return false;
    const rest = compound.replace(/:not\(([^)]*)\)/g, (_, inner) => {
      if (this.matchesCompound(inner)) throw new Error("not");
      return "";
    });
    for (const m of rest.matchAll(/\[([\w-]+)(=("?)([^\]"]*)\3)?\]/g)) {
      const [attr, value] = [m[1], m[4]];
      const actual = this[attr];
      if (value === undefined ? !actual : String(actual) !== value) return false;
    }
    return true;
  }
  matches(compound) {
    try {
      return this.matchesCompound(compound);
    } catch {
      return false;
    }
  }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+(?![^[]*\])/);
    let scope = [this];
    for (const part of parts) {
      const found = new Set();
      for (const node of scope) for (const el of node.descendants()) if (el.matches(part)) found.add(el);
      scope = [...found];
    }
    const order = [...this.descendants()];
    return scope.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  closest(selector) {
    for (let node = this; node; node = node.parent) if (node.matches(selector)) return node;
    return null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  dispatch(type, target) {
    for (let node = target; node; node = node.parent) for (const fn of node.listeners[type] ?? []) fn({ target, type });
  }
}

/**
 * Builds the dialog as the 1.6.5 template does (templates/apps/ability-use.hbs): rows with a checkbox or a quantity
 * input with +/- buttons, and a hidden cost input only when the cost is "Truque", null or truthy.
 */
function buildDialog({ rows, initialCost }) {
  const root = new FakeElement("div");
  const form = new FakeElement("form");
  const list = new FakeElement("ul", { class: "aprimoramentos-list" });
  const els = {};
  for (const { id, cost, checked = false, quantity } of rows) {
    const li = new FakeElement("li", { class: "item" });
    const div = new FakeElement("div", { class: "item-cost" });
    let input;
    if (quantity === undefined) {
      input = new FakeElement("input", { type: "checkbox", name: `aprs.${id}.aplica`, value: "1", checked });
      div.append(input);
    } else {
      input = new FakeElement("input", { type: "number", name: `aprs.${id}.aplica`, value: String(quantity), class: "numInp" });
      const minus = new FakeElement("button", { class: "numCtrl", value: "-" });
      const plus = new FakeElement("button", { class: "numCtrl", value: "+" });
      div.append(minus, input, plus);
      els[`${id}+`] = plus;
    }
    if (cost === CANTRIP_COST || cost === null || cost) {
      const value = cost === null ? "0" : String(cost);
      div.append(new FakeElement("input", { type: "hidden", name: `aprs.${id}.custo`, value }));
    }
    li.append(div);
    list.append(li);
    els[id] = input;
  }
  const total = new FakeElement("input", { class: "cost", value: String(initialCost), dataset: { initialCost: String(initialCost) } });
  const totalGroup = new FakeElement("div", { class: "total-cost" }).append(total);
  form.append(list, totalGroup);
  root.append(form);
  /** Enabled named fields, as FormDataExtended reads them (disabled fields are skipped). */
  const formData = () => {
    const data = {};
    for (const el of form.querySelectorAll("input[name]")) {
      if (el.disabled) continue;
      if (el.type === "checkbox") data[el.name] = el.checked;
      else data[el.name] = el.value;
    }
    return data;
  };
  return { root, form, total, els, formData };
}

function installSystem() {
  const hooks = {};
  globalThis.HTMLElement = FakeElement;
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  globalThis.game = { i18n: { localize: (key) => key } };
  globalThis.Hooks = { on: (name, fn) => (hooks[name] ??= []).push(fn) };
  class ItemT20 {
    _allApplicableOnUseEffects() {
      return this._effects;
    }
  }
  globalThis.CONFIG = { Item: { documentClass: ItemT20 } };
  class AbilityUseDialog {
    constructor(item, element) {
      this.item = item;
      this.element = element;
    }
    // Copy of the system's 1.6.5 method (T20:6694).
    _onInputChange(html) {
      html = html[0];
      const effects = html.querySelectorAll(".aprimoramentos-list li input:not([type=hidden])");
      let totalCost = 0;
      let hasCost = false;
      for (const input of effects) {
        const cost = input.closest("div").querySelector("input[type=hidden]");
        if (!cost) continue;
        if (input.type == "checkbox") {
          if (!input.checked) continue;
          if (Number(cost.value)) {
            totalCost += Number(cost.value);
            hasCost = true;
          }
        } else {
          if (input.value == 0) continue;
          if (Number(cost.value)) {
            totalCost += Number(cost.value) * input.value;
            hasCost = true;
          }
        }
      }
      const inputCost = html.querySelector(".total-cost .cost");
      const { initialCost } = inputCost.dataset;
      totalCost += Number(initialCost);
      hasCost = Number(initialCost) > 0;
      inputCost.value = hasCost ? Math.max(totalCost, 1) : 0;
    }
    static async create() {}
  }
  globalThis.tormenta20 = { applications: { AbilityUseDialog } };
  const render = (app, html) => (hooks.renderAbilityUseDialog ?? []).forEach((fn) => fn(app, html));
  return { ItemT20, AbilityUseDialog, render };
}

function cleanup() {
  for (const key of ["tormenta20", "Hooks", "HTMLElement", "document", "game", "CONFIG"]) delete globalThis[key];
}

/** Spell (base 1 PM) with two Truques A and B and a paid power (+2 PM), all checked when the dialog opens. */
function openTwoCantrips({ AbilityUseDialog, render }, initialCost) {
  const spell = { id: "spell", type: "magia", system: { ativacao: { custo: 1 } } };
  const ef = (id, parentId) => ({ id, parent: { id: parentId } });
  spell.applicableOnUseEffects = [ef("A", "spell"), ef("B", "spell"), ef("P", "ampliada")];
  const dialog = buildDialog({
    rows: [
      { id: "A", cost: CANTRIP_COST, checked: true },
      { id: "B", cost: CANTRIP_COST, checked: true },
      { id: "P", cost: 2, checked: true }
    ],
    initialCost
  });
  const html = [dialog.root];
  const app = new AbilityUseDialog(spell, html);
  render(app, html);
  /** Simulates a click on a checkbox: the system's click handler, then the change event. */
  const toggle = (id) => {
    const input = dialog.els[id];
    assert.equal(input.disabled, false, `${id} is clickable`);
    input.checked = !input.checked;
    app._onInputChange(html);
    dialog.form.dispatch("change", input);
  };
  return { ...dialog, app, html, toggle };
}

function assertState(d, { A, B, P }, total) {
  for (const [id, [checked, disabled]] of Object.entries({ A, B, P })) {
    assert.equal(d.els[id].checked, checked, `${id} checked`);
    assert.equal(d.els[id].disabled, disabled, `${id} disabled`);
  }
  assert.equal(Number(d.total.value), total, "total");
}

for (const withDialogCost of [true, false]) {
  test(`integration: Truque locks and restores enhancements ${withDialogCost ? "with" : "without"} ability-dialog-cost`, (t) => {
    t.after(cleanup);
    const system = installSystem();
    if (withDialogCost) dialogCostPatch.apply();
    patch.apply();
    // Without #7, the system pre-adds the +2 of the paid row to data-initial-cost (T20:6748-6755).
    const d = openTwoCantrips(system, withDialogCost ? 1 : 3);

    assertState(d, { A: [true, false], B: [false, true], P: [false, true] }, 0);
    assert.equal(d.root.querySelector("li").dataset.tooltip, undefined, "the active Truque has no lock hint");
    assert.equal(d.els.P.closest("li").dataset.tooltip, "T20CP.SpellCost.Locked");

    d.toggle("A");
    assertState(d, { A: [false, true], B: [true, false], P: [false, true] }, 0);
    assert.equal("aprs.P.aplica" in d.formData(), false, "locked rows are not submitted");

    d.toggle("B");
    assertState(d, { A: [false, false], B: [false, false], P: [true, false] }, withDialogCost ? 3 : 5);

    d.toggle("A");
    assertState(d, { A: [true, false], B: [false, true], P: [false, true] }, 0);
  });
}

test("integration: cost 0 rows get an empty hidden cost and quantity rows are locked by a Truque", (t) => {
  t.after(cleanup);
  const { AbilityUseDialog, render } = installSystem();
  patch.apply();

  const spell = { id: "luz", type: "magia", system: { ativacao: { custo: 1 } } };
  spell.applicableOnUseEffects = ["T", "zero", "dice", "foco"].map((id) => ({ id, parent: { id: id === "foco" ? "poder" : "luz" } }));
  const d = buildDialog({
    rows: [
      { id: "T", cost: CANTRIP_COST },
      { id: "zero", cost: 0, checked: true },
      { id: "dice", cost: 1, quantity: 0 },
      { id: "foco", cost: "-1", checked: true }
    ],
    initialCost: 1
  });
  const html = [d.root];
  const app = new AbilityUseDialog(spell, html);
  render(app, html);

  assert.equal(d.formData()["aprs.zero.custo"], "", "the system now reads '' (not a cantrip) instead of undefined");
  assert.equal(d.els.zero.closest("div").querySelector("input[type=hidden]").value, "");
  assert.equal(Number(d.total.value), 1);

  d.els.dice.value = "2";
  app._onInputChange(html);
  d.form.dispatch("click", d.els["dice+"]);
  assert.equal(Number(d.total.value), 2);

  d.els.T.checked = true;
  app._onInputChange(html);
  d.form.dispatch("change", d.els.T);
  assert.equal(d.els.dice.value, 0);
  assert.equal(d.els.dice.disabled, true);
  assert.equal(d.els["dice+"].disabled, true, "the +/- buttons are locked too");
  assert.equal(d.els.zero.disabled, true, "the spell's own 0-cost enhancement is locked");
  assert.equal(d.els.foco.disabled, false, "reducers from other sources stay free");
  assert.equal(Number(d.total.value), 0);

  d.els.T.checked = false;
  app._onInputChange(html);
  d.form.dispatch("change", d.els.T);
  assert.equal(d.els.dice.value, "2");
  assert.equal(d.els.zero.checked, true);
  assert.equal(Number(d.total.value), 2);

  // A non-spell dialog is not touched.
  const skill = buildDialog({ rows: [{ id: "x", cost: 0, checked: true }], initialCost: 0 });
  render(new AbilityUseDialog({ id: "p", type: "pericia", applicableOnUseEffects: [] }, [skill.root]), [skill.root]);
  assert.equal(skill.formData()["aprs.x.custo"], undefined);
});

test("integration: a lone pre-checked Truque shows a total of 0 when the dialog opens", (t) => {
  t.after(cleanup);
  const { AbilityUseDialog, render } = installSystem();
  patch.apply();
  const spell = { id: "s", type: "magia", applicableOnUseEffects: [{ id: "T", parent: { id: "s" } }] };
  const d = buildDialog({ rows: [{ id: "T", cost: CANTRIP_COST, checked: true }], initialCost: 1 });
  render(new AbilityUseDialog(spell, [d.root]), [d.root]);
  assert.equal(Number(d.total.value), 0);
});

test("integration: spells hand -1 to the system as text without touching stored effects", (t) => {
  t.after(cleanup);
  const { ItemT20 } = installSystem();
  patch.apply();
  const { stored, actor, ownEffect, spellClone } = fakeWorld();
  const spell = Object.assign(new ItemT20(), { id: spellClone.id, type: "magia", actor, _effects: [ownEffect, stored] });
  const [own, foco] = spell._allApplicableOnUseEffects();
  assert.equal(own, ownEffect);
  assert.equal(own.system.abilityUse.custo, "-1");
  assert.equal(foco.system.abilityUse.custo, "-1");
  assert.equal(stored.system.abilityUse.custo, -1);

  const weapon = Object.assign(new ItemT20(), { type: "arma", actor, _effects: [stored] });
  assert.equal(weapon._allApplicableOnUseEffects()[0], stored);
  assert.equal(stored.system.abilityUse.custo, -1);

  const broken = { id: "b", system: { abilityUse: { custo: -1 } }, clone: () => { throw new Error("boom"); } };
  const warn = t.mock.method(console, "warn", () => {});
  const result = Object.assign(new ItemT20(), { type: "magia", actor, _effects: [broken] })._allApplicableOnUseEffects();
  assert.equal(result[0], broken, "a failed clone keeps the system's behavior");
  assert.equal(warn.mock.callCount(), 1);
});
