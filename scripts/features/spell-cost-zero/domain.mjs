export const CANTRIP_COST = "Truque";

/**
 * The system's cantrip test (applyOnUseEffects): `!Number(applied[ef.id]?.custo + 1)`.
 * @param {unknown} custo  Cost of an applied usage effect, as the system receives it.
 * @returns {boolean}
 */
export function systemReadsAsCantrip(custo) {
  return !Number(custo + 1);
}

/**
 * Cost to hand the system. A number its test misreads as a cantrip (-1) goes as text, as the dialog form sends it:
 * `"-1" + 1` is "-11", and `Number("-1") * aplica` still adds -1 PM. Every other value is returned untouched.
 * @param {unknown} custo  abilityUse.custo of the effect.
 * @returns {unknown}
 */
export function safeUsageCost(custo) {
  return typeof custo === "number" && Number.isFinite(custo) && systemReadsAsCantrip(custo) ? String(custo) : custo;
}

/**
 * Whether the effect is a disposable copy that may be changed in place: an effect of the rolled item's clone, or a
 * copy that is not in its parent's collection (appended-usage-changes). Stored effects, and anything uncertain,
 * return false and are cloned before any change.
 * @param {{id: string, parent?: {id: string, effects?: {get?: Function}}}} effect
 * @param {{items?: {get?: Function}}} actor  Actor of the rolled item.
 * @returns {boolean}
 */
export function isDisposableEffect(effect, actor) {
  const parent = effect?.parent;
  if (!parent || !actor || typeof parent.effects?.get !== "function") return false;
  if (parent.effects.get(effect.id) !== effect) return true;
  return parent !== actor && actor.items?.get?.(parent.id) !== parent;
}

/**
 * The effect with a safe cost: the same object when nothing changes, the effect itself when it is a disposable copy,
 * or a clone (same id) when it is a stored document, which is never changed.
 * @param {object} effect
 * @param {object} actor
 * @returns {object}
 */
export function withSafeCost(effect, actor) {
  const custo = effect?.system?.abilityUse?.custo;
  const safe = safeUsageCost(custo);
  if (safe === custo) return effect;
  const target = isDisposableEffect(effect, actor) ? effect : effect.clone({}, { keepId: true });
  target.system.abilityUse.custo = safe;
  return target;
}

/**
 * @typedef {object} DialogRow
 * @property {string} id        Usage effect id.
 * @property {boolean} own      The effect belongs to the rolled spell (one of its enhancements).
 * @property {boolean} cantrip  Its hidden cost is "Truque".
 * @property {number} cost      Number(hidden cost): NaN for "Truque", 0 for empty.
 * @property {boolean} active   Checked, or applied at least once.
 */

/**
 * Rows locked by a checked Truque. The first active Truque wins. It locks the spell's other enhancements, any other
 * Truque and any paid row from another source (enhancement powers such as Magia Ampliada, +2 PM). Bonuses and
 * reductions from other sources (no cost, 0 or negative, such as Foco em Magia) stay free.
 * @param {DialogRow[]} rows
 * @returns {{cantrip: string|null, locked: Set<string>}}
 */
export function cantripLocks(rows = []) {
  const cantrip = rows.find((row) => row.cantrip && row.active)?.id ?? null;
  const locked = new Set();
  if (cantrip === null) return { cantrip, locked };
  for (const row of rows) {
    if (row.id === cantrip) continue;
    if (row.own || row.cantrip || Number(row.cost) > 0) locked.add(row.id);
  }
  return { cantrip, locked };
}
