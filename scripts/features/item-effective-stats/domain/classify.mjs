/**
 * Constants, modes and classification of an item's own effects and changes.
 */
import { isArmorPenaltyReducer } from "../../../lib/armor-penalty.mjs";

export const ITEM_EFFECTIVE_STATS_SETTING = "itemEffectiveStats";
export const MODES = ["ends", "display", "effective"];
export const DEFAULT_MODE = "display";
/** The only usage effect keys folded into the item. */
export const FOLDABLE_KEYS = new Set(["criticoM", "criticoX"]);
export const PDA_KEY = "system.attributes.defesa.pda";
export const DEFENSE_KEY = "system.attributes.defesa.bonus";
export const ARMOR_TIPOS = new Set(["leve", "pesada", "escudo"]);
export const FLAG = "effectiveStats";
export const STEP_KEYS = new Set(["passo", "passos"]);
export const I18N = "T20CP.ItemEffectiveStats";

/**
 * @typedef {{key: string, type?: string, value?: unknown}} Change
 * @typedef {{id?: string, name?: string, disabled?: boolean, transfer?: boolean, onuse?: boolean, temporary?: boolean,
 *   selfUse?: boolean, automatic?: boolean, hasStatus?: boolean, identifier?: string, reducer?: boolean,
 *   changes?: Change[]}} EffectInfo
 * @typedef {{label: string, delta?: string, kind: "applied"|"optional"|"not-applied"|"note", i18n?: boolean,
 *   suffix?: string, target?: string}} Part
 * @typedef {{stat: string, base: number|string, final: number|string, parts: Part[], warning?: string}} Stat
 */

/** @param {unknown} value */
export function normalizeMode(value) {
  return MODES.includes(value) ? value : DEFAULT_MODE;
}

/**
 * Classifies the item's own effects.
 * - Passive (`onuse` false): only `disabled === false` counts. `transfer: false` goes to `notApplied` (the system
 *   never gives it to the actor); a non-null `system.status` goes to `bearer` (the actor may suppress it).
 * - Usage (`onuse` true): eligible as in includeEffect (T20:8068-8076): not temporary and `selfUse`. `disabled` is
 *   ignored, as the system does. "Aplicar Sempre" goes to `automatic`, the rest to `optional`.
 * @param {EffectInfo[]} effects
 * @returns {{passive: EffectInfo[], automatic: EffectInfo[], optional: EffectInfo[], notApplied: EffectInfo[],
 *   bearer: EffectInfo[]}}
 */
export function classifyItemEffects(effects) {
  const result = { passive: [], automatic: [], optional: [], notApplied: [], bearer: [] };
  for (const effect of effects ?? []) {
    if (!effect) continue;
    if (effect.onuse) {
      if (effect.temporary || !effect.selfUse) continue;
      (effect.automatic ? result.automatic : result.optional).push(effect);
      continue;
    }
    if (effect.disabled) continue;
    if (effect.transfer === false || effect.appliesToBearer === false) result.notApplied.push(effect);
    else if (effect.hasStatus) result.bearer.push(effect);
    else result.passive.push(effect);
  }
  return result;
}

/** @param {unknown} value */
export function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value.trim()) return NaN;
  return Number(value.trim());
}

/**
 * Signed amount of a numeric "add"/"subtract" change, or NaN (formulas, other types).
 * Only these are folded into the item; anything else stays on the system's own path.
 * @param {Change} change
 */
export function foldableAmount(change) {
  if (change?.type !== "add" && change?.type !== "subtract") return NaN;
  const amount = toNumber(change.value);
  if (!Number.isFinite(amount)) return NaN;
  return change.type === "subtract" ? -amount : amount;
}

/** Whether the change is applied in the core's "initial" phase, before prepareDefense (the default phase). */
export function isInitial(change) {
  return (change?.phase ?? "initial") === "initial";
}

/**
 * Amount of an "add" change in the "initial" phase, or NaN. Only these are folded into an armor: defesa.bonus is an
 * ArrayField ("subtract" removes an entry), PenaltyField casts any value to a penalty, armor-penalty-reduction only
 * intercepts initial "add" changes, and later phases run after prepareDefense.
 * @param {Change} change
 */
export function armorAmount(change) {
  return change?.type === "add" && isInitial(change) ? foldableAmount(change) : NaN;
}

/** @param {number} n */
export function signed(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return String(n);
  return value < 0 ? `${value}` : `+${value}`;
}

export function signedText(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return /^[+-]/.test(text) ? text : `+${text}`;
}

export function isReducer(effect) {
  if (typeof effect.reducer === "boolean") return effect.reducer;
  return isArmorPenaltyReducer({ name: effect.name, system: { identifier: effect.identifier } });
}

export function isPolished(effect) {
  return effect.identifier === "polished" || /^polid[ao]$|^polished$/i.test(String(effect.name ?? "").trim());
}
