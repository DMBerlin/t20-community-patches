/**
 * Base PM cost of the activation (what the system adds when `ativacao.custo > 0`).
 * @param {object} system  Item system data (or pseudo item data for skills/attributes)
 * @returns {number}
 */
export function baseActivationCost(system) {
  const cost = Number(system?.ativacao?.custo);
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

/** Sum of the checked costs, and whether any of them is positive. */
function sumCosts(costs) {
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
  return { total, hasCost };
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
  let { total, hasCost } = sumCosts(costs);
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

export const SOURCES = ["AbilityUseDialog#_onInputChange", "AbilityUseDialog.create"];
