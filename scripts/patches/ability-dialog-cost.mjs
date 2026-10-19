/**
 * Ability use dialog total cost (tormenta20 1.6.5).
 *
 * Bug: AbilityUseDialog.create pre-adds the cost of every usage effect with disabled=false to the initial cost
 * (usage effects are pre-checked by abilityUse.automatic, not by disabled) and stores that sum in
 * data-initial-cost, so checked costs are counted twice and automatic effects are missing until the first click.
 * _onInputChange also overwrites the accumulated `hasCost` flag with `initialCost > 0`, showing 0 for rolls
 * without base cost. Display only: the cost actually spent comes from the submitted form.
 *
 * Fix: data-initial-cost holds only the base activation cost, and the total is computed from the checked boxes.
 */
import { MODULE_ID, markWrapper, unwrap } from "../utils.mjs";

/**
 * Base PM cost of the activation (what the system adds when `ativacao.custo > 0`).
 * @param {object} system  Item system data (or pseudo item data for skills/attributes)
 * @returns {number}
 */
export function baseActivationCost(system) {
  const cost = Number(system?.ativacao?.custo);
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

/**
 * Total cost displayed in the dialog. Only positive costs (or a positive base cost) make the roll "paid", so a
 * lone reducer on a roll without base cost shows 0; paid rolls keep the system's minimum of 1 PM.
 * @param {object} params
 * @param {{cost: number|string, quantity?: number|string}[]} [params.costs]  Checked boxes / applied quantities
 * @param {number|string} [params.initialCost=0]                            Base activation cost
 * @param {number|string} [params.adjustment=0]                             "ajustecusto" field
 * @returns {number}
 */
export function computeDialogCost({ costs = [], initialCost = 0, adjustment = 0 } = {}) {
  let total = 0;
  let hasCost = false;
  for (const { cost, quantity = 1 } of costs) {
    const value = Number(cost);
    const times = Number(quantity);
    // "Truque" (NaN), 0 and empty are ignored, as in the system.
    if (!Number.isFinite(value) || !Number.isFinite(times) || !value || !times) continue;
    total += value * times;
    if (value > 0) hasCost = true;
  }
  const base = Number(initialCost);
  if (Number.isFinite(base) && base > 0) {
    total += base;
    hasCost = true;
  }
  const extra = Number(adjustment);
  if (Number.isFinite(extra)) total += extra;
  return hasCost ? Math.max(total, 1) : 0;
}

/**
 * Inspects the system's dialog code: true when either bug is still there, undefined when neither pattern is
 * found (the code changed, so a partial or different fix cannot be told apart from a complete one).
 * @param {string} onInputChange  Source of AbilityUseDialog#_onInputChange
 * @param {string} create         Source of AbilityUseDialog.create
 * @returns {true|undefined}
 */
export function dialogCostIsBroken(onInputChange, create) {
  if (typeof onInputChange === "string" && /hasCost\s*=\s*Number\(\s*initialCost\s*\)\s*>\s*0/.test(onInputChange)) {
    return true;
  }
  if (typeof create === "string" && /if\s*\(\s*ef\.disabled\s*\)\s*continue/.test(create)) return true;
  return undefined;
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const TOTAL_SELECTOR = ".total-cost .cost";

function toElement(html) {
  if (html instanceof HTMLElement) return html;
  return html?.[0] instanceof HTMLElement ? html[0] : null;
}

/** Mirrors the system's reading of the enhancement rows (checkbox or quantity input + hidden cost). */
function readCosts(root) {
  const costs = [];
  for (const input of root.querySelectorAll(".aprimoramentos-list li input:not([type=hidden])")) {
    const hidden = input.closest("div")?.querySelector("input[type=hidden]");
    if (!hidden) continue;
    if (input.type === "checkbox") {
      if (input.checked) costs.push({ cost: hidden.value });
    } else if (Number(input.value)) {
      costs.push({ cost: hidden.value, quantity: input.value });
    }
  }
  return costs;
}

function getDialogClass() {
  return globalThis.tormenta20?.applications?.AbilityUseDialog;
}

function isNeeded() {
  const Dialog = getDialogClass();
  const onInputChange = unwrap(Dialog?.prototype?._onInputChange);
  const create = unwrap(Dialog?.create);
  if (typeof onInputChange !== "function" || typeof create !== "function") return undefined;
  const source = (fn) => Function.prototype.toString.call(fn);
  return dialogCostIsBroken(source(onInputChange), source(create));
}

function apply() {
  const AbilityUseDialog = getDialogClass();
  if (typeof AbilityUseDialog?.prototype?._onInputChange !== "function") {
    throw new Error("Tormenta20 AbilityUseDialog not found");
  }

  const original = AbilityUseDialog.prototype._onInputChange;
  AbilityUseDialog.prototype._onInputChange = markWrapper(function (html, ...args) {
    const root = toElement(html);
    const inputCost = root?.querySelector(TOTAL_SELECTOR);
    if (!inputCost) return original.call(this, html, ...args);
    inputCost.value = computeDialogCost({
      costs: readCosts(root),
      initialCost: inputCost.dataset.initialCost,
      adjustment: root.querySelector("input[name=ajustecusto]")?.value
    });
  }, original);

  Hooks.on("renderAbilityUseDialog", (app, html) => {
    try {
      if (!(app instanceof AbilityUseDialog)) return;
      const root = toElement(html);
      const inputCost = root?.querySelector(TOTAL_SELECTOR);
      if (!inputCost) return;
      inputCost.dataset.initialCost = String(baseActivationCost(app.item?.system));
      app._onInputChange(html);
    } catch (err) {
      console.error(`${MODULE_ID} | ability-dialog-cost: failed to compute the initial cost`, err);
    }
  });
}

export default {
  id: "ability-dialog-cost",
  group: "usage-effects",
  issue: 7,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  apply
};
