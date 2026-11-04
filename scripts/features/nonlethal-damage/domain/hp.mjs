/**
 * Nonlethal HP of an update and the per-call `this` of the system's damage methods. Pure: the lethal HP contract
 * (effectiveNonlethal, nonlethalOf) comes from lib/nonlethal.mjs.
 */
import { MODULE_ID } from "../../../lib/module.mjs";
import { stripComments } from "../../../lib/source.mjs";
import { HP_PATH, ROLL_DATA_KEY, effectiveNonlethal } from "../../../lib/nonlethal.mjs";

export const ACTOR_TYPES = Object.freeze(["character", "npc", "simple"]);

/** Floor of the lethal HP: the system's minimum lowered by the nonlethal HP. */
export function widenedMin(baseMin, nonlethal) {
  const min = Number(baseMin);
  if (!Number.isFinite(min)) return baseMin;
  return min - Math.max(0, Math.trunc(Number(nonlethal)) || 0);
}

/**
 * @param {object} p
 * @param {number} p.before         PV stored before the update.
 * @param {number} p.after          PV requested by the update.
 * @param {number} p.nonlethal      Flag stored before the update.
 * @param {number} p.max
 * @param {boolean} p.isNonlethal   The update applies nonlethal damage.
 * @param {number} [p.explicit]     Flag value in the changes, only when it is an explicit edit.
 * @returns {{value: number, nonlethal: number}}
 */
export function resolveHpUpdate({ before, after, nonlethal, max, isNonlethal, explicit }) {
  if (Number.isFinite(explicit)) return { value: after, nonlethal: Math.max(0, Math.trunc(explicit)) };
  const n0 = effectiveNonlethal(nonlethal, before, max);
  if (after > before) return { value: after, nonlethal: Math.max(0, n0 - (after - before)) };
  if (after < before && isNonlethal) return { value: after, nonlethal: n0 + (before - after) };
  return { value: after, nonlethal: n0 };
}

/**
 * Whether the flag value in an update is an edit, and not the unchanged field of a full sheet submission (appv1
 * sends every input). The sheet shows the effective value, so a value equal to the stored or the shown one is not
 * an edit. An empty field counts as 0.
 */
export function isExplicitNonlethalEdit(sent, stored, shown = stored) {
  if (sent === undefined) return false;
  const value = sent === null || sent === "" ? 0 : Math.trunc(Number(sent));
  if (!Number.isFinite(value)) return false;
  const raw = Math.max(0, Math.trunc(Number(stored)) || 0);
  return value !== raw && value !== shown;
}

/**
 * HP to write when an explicit edit raises the nonlethal HP above the value shown: the increase is applied as
 * nonlethal damage, so the field also works at full HP. Returns undefined to leave the HP as requested.
 * @param {object} p
 * @param {number} p.before          Stored HP.
 * @param {number} p.stored          Stored flag (integer >= 0).
 * @param {number} p.max             Prepared maximum before the update.
 * @param {{found: boolean, value?: unknown}} p.hp     pv.value in the changes.
 * @param {{found: boolean, value?: unknown}} p.flag   The flag in the changes.
 * @param {boolean} p.enabled        The rule is on.
 */
export function hpForNonlethalEdit({ before, stored, max, hp, flag, enabled }) {
  if (!enabled || !flag?.found) return undefined;
  const shown = effectiveNonlethal(stored, before, max);
  if (!isExplicitNonlethalEdit(flag.value, stored, shown)) return undefined;
  const raise = Math.trunc(Number(flag.value)) - shown;
  const base = hp?.found ? Number(hp.value) : Number(before);
  if (!(raise > 0) || !Number.isFinite(base)) return undefined;
  return base - raise;
}

/**
 * Flag to write in an update, or null to leave the update alone.
 * @param {object} p
 * @param {number} p.before          Stored HP.
 * @param {number} p.stored          Stored flag (integer >= 0).
 * @param {number} p.max            Prepared maximum before the update.
 * @param {number} [p.maxAfter]      Maximum sent in the same update; limits an explicit edit.
 * @param {{found: boolean, value?: unknown}} p.hp     pv.value in the changes.
 * @param {{found: boolean, value?: unknown}} p.flag   The flag in the changes.
 * @param {boolean} p.isNonlethal    Intent carried by the update options.
 * @param {boolean} p.enabled        The rule is on (the intent only counts then).
 */
export function nonlethalForUpdate({ before, stored, max, maxAfter, hp, flag, isNonlethal, enabled }) {
  const shown = effectiveNonlethal(stored, before, max);
  const sent = flag?.found ? flag.value : undefined;
  const explicit = isExplicitNonlethalEdit(sent, stored, shown) ? (sent === null || sent === "" ? 0 : Number(sent)) : undefined;
  const after = Number(hp?.value);
  const hpChanged = hp?.found && Number.isFinite(after) && Number.isFinite(Number(before));
  let next;
  if (hpChanged) {
    next = resolveHpUpdate({ before: Number(before), after, nonlethal: stored, max, isNonlethal: !!(enabled && isNonlethal), explicit }).nonlethal;
  } else if (explicit !== undefined) {
    next = Math.max(0, Math.trunc(explicit));
  } else {
    next = stored;
  }
  // An explicit edit cannot exceed the HP actually missing, so the stored flag never holds HP that do not count.
  if (explicit !== undefined) {
    const limit = Number.isFinite(Number(maxAfter)) ? Number(maxAfter) : max;
    next = effectiveNonlethal(next, hpChanged ? after : before, limit);
  }
  if (!flag?.found && next === stored) return null;
  return next;
}

/** The damage roll the system's button applies (same rule as _onChatApplyDamage). */
export function pickDamageRoll(rolls, title) {
  return (rolls ?? []).find((r) => r?.options?.title === title && (!r.options.type || r.options.type === "damage"));
}

/** Whether the damage roll recorded a nonlethal choice when attacking (#74). */
export function recordedNonlethal(roll) {
  return roll?.options?.[MODULE_ID]?.[ROLL_DATA_KEY]?.nonlethal === true;
}

/**
 * Whether a damage method can be called with the per-call Proxy: it reads the HP through `this.system.attributes`,
 * clamps with pv.min, writes pv.value in a single `this.update(` and uses no private fields.
 */
export function recognizesDamageMethod(source) {
  if (typeof source !== "string") return false;
  const code = stripComments(source);
  const updates = code.match(/\bthis\.update\(/g)?.length ?? 0;
  return (
    updates === 1
    && code.includes(`"${HP_PATH}"`)
    && /this\.system\.attributes\b/.test(code)
    && /Math\.clamp\([^;]*\bpv\.min\b/.test(code)
    && !/this\.#/.test(code)
  );
}

function overridePvMin(system, min) {
  const pv = new Proxy(system.attributes.pv, {
    get: (t, k) => (k === "min" ? min : Reflect.get(t, k, t))
  });
  const attributes = new Proxy(system.attributes, {
    get: (t, k) => (k === "pv" ? pv : Reflect.get(t, k, t))
  });
  return new Proxy(system, { get: (t, k) => (k === "attributes" ? attributes : Reflect.get(t, k, t)) });
}

/**
 * `this` for one call of the system's damage methods: its update carries the nonlethal intent and pv.min reads
 * -Infinity. Nothing is shared between calls, and the actor itself is never changed.
 */
export function withNonlethalCall(actor) {
  return new Proxy(actor, {
    get(target, prop) {
      if (prop === "update") {
        return (data, options = {}) => target.update(data, {
          ...options,
          [MODULE_ID]: { ...options?.[MODULE_ID], nonlethal: true }
        });
      }
      if (prop === "system") return overridePvMin(target.system, -Infinity);
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set: (target, prop, value) => Reflect.set(target, prop, value, target)
  });
}
