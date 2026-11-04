/**
 * "effective" mode fold plans: what can be written into the item's derived data without applying anything twice.
 */
import { DEFENSE_KEY, FOLDABLE_KEYS, PDA_KEY, armorAmount, isInitial } from "./classify.mjs";

/**
 * Fold plan of the critical chain in "effective" mode. All or nothing: the chain (criticoM and criticoX) is folded
 * only if every effect touching it is the item's own, in "Aplicar Sempre", has only FOLDABLE_KEYS and no override, and
 * is not bound to the usage dialog (PM cost, "aumenta" or a usage-effect-max limit), since folding removes it from the
 * list that charges and validates it.
 * @param {Array<{id: string, own: boolean, automatic: boolean, usageBound?: boolean,
 *   changes: import("./classify.mjs").Change[]}>} rollEffects
 * @returns {{fold: boolean, effectIds: Set<string>}}
 */
export function planCritFold(rollEffects) {
  const ids = new Set();
  for (const effect of rollEffects ?? []) {
    const changes = effect?.changes ?? [];
    if (!changes.some((ch) => FOLDABLE_KEYS.has(ch?.key))) continue;
    const ok =
      effect.own &&
      effect.automatic &&
      !effect.usageBound &&
      changes.every((ch) => FOLDABLE_KEYS.has(ch?.key) && ch?.type !== "override");
    if (!ok) return { fold: false, effectIds: new Set() };
    ids.add(effect.id);
  }
  return ids.size ? { fold: true, effectIds: ids } : { fold: false, effectIds: ids };
}

/**
 * Armor penalty, all or nothing: false when an own, transferred, enabled passive effect touching defesa.pda has a
 * status (the actor may suppress it) or a change other than a numeric initial "add" (it stays on the actor and needs the reductions'
 * excess, armor-penalty-reduction), or when actor effects touching defesa.pda point to the item by origin
 * (armor-penalty-reduction counts them for the item), or when any other enabled effect of the bearer changes
 * defesa.pda other than by "add" (a subtract, multiply or override depends on the folded amounts).
 * @param {import("./classify.mjs").EffectInfo[]} effects   Same input as classifyItemEffects.
 * @param {number} linkedPdaCount
 * @param {Array<{disabled?: boolean, changes?: import("./classify.mjs").Change[]}>} [external]   Bearer's other passive effects.
 */
export function canFoldPenalty(effects, linkedPdaCount, external = []) {
  if (linkedPdaCount) return false;
  const blocks = (ch) => ch?.key === PDA_KEY && ch.type !== "add";
  if ((external ?? []).some((e) => e && !e.disabled && (e.changes ?? []).some(blocks))) return false;
  return !(effects ?? []).some(
    (e) =>
      e &&
      !e.onuse &&
      e.transfer !== false &&
      !e.disabled &&
      (e.changes ?? []).some((ch) => ch?.key === PDA_KEY && (e.hasStatus || !Number.isFinite(armorAmount(ch))))
  );
}

/**
 * Armor Defense, all or nothing: false when an own, transferred, enabled passive effect changes defesa.bonus other
 * than by an "add" in the "initial" phase (a "subtract" could remove an entry that folding took out of the array), or
 * when any other enabled effect of the bearer (actor or other item) does so.
 * @param {import("./classify.mjs").EffectInfo[]} effects   Same input as classifyItemEffects.
 * @param {Array<{disabled?: boolean, changes?: import("./classify.mjs").Change[]}>} [external]   Bearer's other passive effects.
 */
export function canFoldDefense(effects, external = []) {
  const blocks = (ch) => ch?.key === DEFENSE_KEY && (ch.type !== "add" || !isInitial(ch));
  if ((external ?? []).some((e) => e && !e.disabled && (e.changes ?? []).some(blocks))) return false;
  return !(effects ?? []).some(
    (e) =>
      e &&
      !e.onuse &&
      e.transfer !== false &&
      !e.disabled &&
      (e.changes ?? []).some(blocks)
  );
}
