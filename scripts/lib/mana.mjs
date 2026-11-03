/** Mana limit formulas and automatic applications (mana-limit, #46), shared with usage-effect-max, arcane-armor-casting and trained-only-skills. */

/**
 * Evaluates a dice-free formula with the actor's roll data. Never uses eval: the formula goes through Roll.
 * @param {string} formula
 * @param {object} rollData
 * @param {typeof foundry.dice.Roll} Roll
 * @returns {number|null}  null when the formula is invalid, references missing data, has dice or is not finite.
 */
export function evaluateManaLimit(formula, rollData, Roll) {
  try {
    // Roll replaces missing data with 0, which would turn a typo into a limit of 0: resolve it first.
    const resolved = Roll.replaceFormulaData(String(formula), rollData);
    if (resolved.includes("@")) return null;
    const roll = new Roll(resolved);
    if (!roll.isDeterministic) return null;
    roll.evaluateSync({ strict: true });
    const total = Number(roll.total);
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

/**
 * The `aprs` the system builds when the item is used without the dialog: only "Aplicar Sempre" effects.
 * @param {UseEffect[]} effects
 */
export function automaticApplied(effects = []) {
  const applied = {};
  for (const effect of effects) {
    if (effect.automatic) applied[effect.id] = { aplica: 1, custo: effect.custo || 0 };
  }
  return applied;
}
