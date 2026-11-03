/** Armor penalty reducers (armor-penalty-reduction, non-proficiency-penalties, item-effective-stats). */

export const UNASSIGNED = "";

export const REDUCERS = {
  identifiers: new Set(["adjusted", "undermeasure", "mithril"]),
  // Effect ids in the system compendium `tormenta20.efeitos` and the world copy `world.item-upgrades`.
  sourceIds: new Set(["w3JoRmXaQASrkEjH", "HvXw5DvWL1irkLkB", "K9RtA8a5aPdqyRUR"]),
  // Legacy effects without identifier (e.g. magic items from `tormenta20.equipamentos-magicos`).
  names: new Set(["ajustada", "ajustado", "sob medida", "mitral", "adjusted", "under measure", "mithril"])
};

/**
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
export function isArmorPenaltyReducer(effect) {
  if (!effect) return false;
  if (REDUCERS.identifiers.has(effect.system?.identifier)) return true;
  if (REDUCERS.identifiers.has(effect.flags?.tormenta20?.upgrade)) return true;
  const sourceId = String(effect._stats?.compendiumSource ?? "").split(".").pop();
  if (REDUCERS.sourceIds.has(sourceId)) return true;
  return REDUCERS.names.has(String(effect.name ?? "").trim().toLowerCase());
}

/**
 * The system data stores these reductions with inconsistent signs (-1 and 1), so the magnitude is used.
 * @param {number|string} value
 * @param {(formula: string) => number} [evaluate]  Evaluates non-numeric formulas.
 * @returns {number}
 */
export function parseReduction(value, evaluate) {
  let amount = Number(value);
  if (!Number.isFinite(amount) && evaluate) {
    try {
      amount = Number(evaluate(String(value)));
    } catch {
      amount = NaN;
    }
  }
  return Number.isFinite(amount) ? Math.abs(amount) : 0;
}

/**
 * Computes the corrected penalties. Each reduction lowers the penalty of the item that carries it, down to 0.
 * The item's combined penalty is its base penalty plus the increases from its own upgrades (e.g. Reforçada),
 * which the system applies to the actor's `defesa.pda`. A reduction larger than the base penalty therefore
 * also cancels those increases, through `actorDelta`. Increases without an item (e.g. Sobrecarregado) are never
 * cancelled.
 * @param {Map<string, number>} penalties   Base penalty (<= 0) by equipped item id.
 * @param {Map<string, number>} reductions  Reduction magnitude by item id (UNASSIGNED for effects without item).
 * @param {Map<string, number>} increases   Penalty increase magnitude applied to the actor, by item id.
 * @param {string|null} fallbackId          Item receiving unassigned reductions (equipped armor or shield).
 * @returns {{items: Map<string, number>, actorDelta: number}}
 *          New base penalty by item id (only changed items) and the amount to add to the actor's `defesa.pda`.
 */
export function computePenaltyAdjustments(penalties, reductions, increases = new Map(), fallbackId = null) {
  const byItem = new Map();
  for (const [id, amount] of reductions) {
    const target = id === UNASSIGNED ? fallbackId : id;
    if (!target || !penalties.has(target)) continue;
    byItem.set(target, (byItem.get(target) ?? 0) + amount);
  }
  const items = new Map();
  let actorDelta = 0;
  for (const [id, amount] of byItem) {
    const penalty = Number(penalties.get(id)) || 0;
    items.set(id, Math.min(0, penalty + amount));
    const leftover = Math.max(0, amount + penalty);
    actorDelta += Math.min(leftover, increases.get(id) ?? 0);
  }
  return { items, actorDelta };
}
