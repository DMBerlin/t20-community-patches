import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  baseActivationCost,
  computeDialogCost,
  dialogCostIsBroken
} from "../scripts/patches/ability-dialog-cost.mjs";
import { unwrap } from "../scripts/utils.mjs";

test("base activation cost is the positive numeric ativacao.custo", () => {
  assert.equal(baseActivationCost({ ativacao: { custo: 3 } }), 3);
  assert.equal(baseActivationCost({ ativacao: { custo: "2" } }), 2);
  for (const custo of [0, null, "abc", undefined, -1]) assert.equal(baseActivationCost({ ativacao: { custo } }), 0);
  assert.equal(baseActivationCost(undefined), 0);
});

test("total is the base cost plus the checked costs, counted once", () => {
  assert.equal(computeDialogCost({ costs: [], initialCost: 1 }), 1);
  assert.equal(computeDialogCost({ costs: [{ cost: "2" }], initialCost: "1" }), 3);
  assert.equal(computeDialogCost({ costs: [{ cost: 2, quantity: "2" }], initialCost: 1 }), 5);
  assert.equal(computeDialogCost({ costs: [{ cost: 1 }], initialCost: 2, adjustment: "+2" }), 5);
});

test("paid effects count on rolls without base cost", () => {
  assert.equal(computeDialogCost({ costs: [{ cost: "1" }], initialCost: "0" }), 1);
  assert.equal(computeDialogCost({ costs: [], initialCost: 0 }), 0);
  assert.equal(computeDialogCost(), 0);
});

test("cantrips, empty and zero costs are ignored; reducers keep the 1 PM minimum only when paid", () => {
  assert.equal(computeDialogCost({ costs: [{ cost: "Truque" }, { cost: "" }, { cost: "0" }], initialCost: 0 }), 0);
  assert.equal(computeDialogCost({ costs: [{ cost: -1 }], initialCost: 1 }), 1);
  assert.equal(computeDialogCost({ costs: [{ cost: -1 }], initialCost: 0 }), 0);
  assert.equal(computeDialogCost({ costs: [], initialCost: 3, adjustment: "abc" }), 3);
});

const BUGGY_INPUT = `_onInputChange(html) {
    const { initialCost } = inputCost.dataset;
    totalCost += Number(initialCost);
    hasCost = Number(initialCost) > 0;
  }`;
const BUGGY_CREATE = `static async create(item) {
    for (const ef of aprimoramentos) {
      await this.prepareDescription(ef);
      if (ef.disabled) continue;
    }
  }`;

test("probe reports the bug while either flaw is in the system code", () => {
  assert.equal(dialogCostIsBroken(BUGGY_INPUT, BUGGY_CREATE), true);
  assert.equal(dialogCostIsBroken("hasCost ||= Number(initialCost) > 0;", BUGGY_CREATE), true);
  assert.equal(dialogCostIsBroken(BUGGY_INPUT, "if (!ef.system.abilityUse.automatic) continue;"), true);
  assert.equal(dialogCostIsBroken("hasCost ||= Number(initialCost) > 0;", "if (!ef.system.abilityUse.automatic) continue;"), undefined);
  assert.equal(dialogCostIsBroken(undefined, undefined), undefined);
});

/* Integration on a minimal fake DOM, with the system's dialog code. */

class FakeElement {
  constructor({ type = "text", value = "", checked = false, dataset = {} } = {}) {
    Object.assign(this, { type, value, checked, dataset });
    this.children = {};
    this.wrapper = null;
  }
  closest() {
    return this.wrapper;
  }
  querySelector(selector) {
    return this.children[selector] ?? null;
  }
}

function buildDialog({ rows = [], initialCost, adjustment }) {
  const root = new FakeElement();
  const total = new FakeElement({ value: String(initialCost), dataset: { initialCost: String(initialCost) } });
  const inputs = rows.map(({ cost, checked, quantity }) => {
    const input = quantity === undefined ? new FakeElement({ type: "checkbox", checked }) : new FakeElement({ type: "number", value: String(quantity) });
    input.wrapper = new FakeElement();
    input.wrapper.children["input[type=hidden]"] = new FakeElement({ type: "hidden", value: String(cost) });
    return input;
  });
  root.children[".total-cost .cost"] = total;
  if (adjustment !== undefined) root.children["input[name=ajustecusto]"] = new FakeElement({ value: adjustment });
  root.querySelectorAll = (selector) => (selector.startsWith(".aprimoramentos-list") ? inputs : []);
  return { root, total, inputs };
}

function installSystem() {
  const hooks = {};
  globalThis.HTMLElement = FakeElement;
  globalThis.Hooks = { on: (name, fn) => (hooks[name] ??= []).push(fn) };
  class AbilityUseDialog {
    constructor(item) {
      this.item = item;
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
    static async create() {
      for (const ef of []) {
        if (ef.disabled) continue;
      }
    }
  }
  globalThis.tormenta20 = { applications: { AbilityUseDialog } };
  const render = (app, html) => (hooks.renderAbilityUseDialog ?? []).forEach((fn) => fn(app, html));
  return { AbilityUseDialog, render };
}

test("integration: initial total uses only base cost plus pre-checked rows, clicks do not double count", (t) => {
  t.after(() => {
    delete globalThis.tormenta20;
    delete globalThis.Hooks;
    delete globalThis.HTMLElement;
  });
  const { AbilityUseDialog, render } = installSystem();
  assert.equal(patch.isNeeded(), true);

  // Case A before the patch: the system pre-added a disabled=false +2 enhancement (initialCost 3); checking it shows 5.
  const before = buildDialog({ rows: [{ cost: 2, checked: true }], initialCost: 3 });
  new AbilityUseDialog({ system: { ativacao: { custo: 1 } } })._onInputChange([before.root]);
  assert.equal(before.total.value, 5);

  patch.apply();
  assert.equal(patch.isNeeded(), true, "probe inspects the system code below the wrapper");
  assert.equal(typeof unwrap(AbilityUseDialog.prototype._onInputChange), "function");

  // Case A: render resets the initial cost to the activation cost.
  const a = buildDialog({ rows: [{ cost: 2, checked: false }], initialCost: 3 });
  const spell = new AbilityUseDialog({ system: { ativacao: { custo: 1 } } });
  render(spell, [a.root]);
  assert.equal(a.total.dataset.initialCost, "1");
  assert.equal(a.total.value, 1);
  a.inputs[0].checked = true;
  spell._onInputChange([a.root]);
  assert.equal(a.total.value, 3);
  a.inputs[0].checked = false;
  spell._onInputChange([a.root]);
  assert.equal(a.total.value, 1);

  // Case B: an "Always Apply" row comes pre-checked and is in the initial total.
  const b = buildDialog({ rows: [{ cost: 2, checked: true }], initialCost: 1 });
  render(spell, [b.root]);
  assert.equal(b.total.value, 3);

  // Case C: skill roll without base cost and a checked paid effect; quantity rows multiply.
  const c = buildDialog({ rows: [{ cost: 1, checked: true }, { cost: 1, quantity: 2 }], initialCost: 0, adjustment: "" });
  render(new AbilityUseDialog({ system: { ativacao: { custo: 0 } } }), [c.root]);
  assert.equal(c.total.value, 3);

  // Without the total field the system method is called (other dialogs or modules).
  const other = new FakeElement();
  other.querySelectorAll = () => [];
  assert.throws(() => spell._onInputChange([other]), TypeError);
});
