/**
 * Lethal HP contract of the nonlethal damage rule (#55), shared with dying-states (#51) and nonlethal-attack (#74).
 * Pure: the rule's mode comes in through parameters, read by each feature through ctx.features.
 */
import { MODULE_ID } from "./module.mjs";

/** Field of the use dialog where nonlethal-attack records the choice (read by combat-maneuvers). */
export const NONLETHAL_FIELD = "t20cpNonlethal";

export const NONLETHAL_SETTING = "nonlethalDamageRule";

export const NONLETHAL_FLAG = "nonlethal";

/** roll.options[MODULE_ID][ROLL_DATA_KEY] = {v, nonlethal}: the choice made when attacking (#74). */
export const ROLL_DATA_KEY = "nonlethal";

export const FLAG_PATH = `flags.${MODULE_ID}.${NONLETHAL_FLAG}`;

export const HP_PATH = "system.attributes.pv.value";

export const MAX_PATH = "system.attributes.pv.max";

/** Whether a mode reader says "on". False when the reader throws (setting not registered yet). */
export function readsOn(read) {
  try {
    return read() === "on";
  } catch {
    return false;
  }
}

/**
 * Nonlethal HP that still counts: an integer between 0 and the HP actually missing (max − value).
 * Non-finite inputs count as no nonlethal damage.
 */
export function effectiveNonlethal(nonlethal, value, max) {
  const n = Math.trunc(Number(nonlethal));
  const v = Number(value);
  const m = Number(max);
  if (!Number.isFinite(n) || !Number.isFinite(v) || !Number.isFinite(m)) return 0;
  return Math.min(Math.max(n, 0), Math.max(0, m - v));
}

/** Lethal HP under the rule: current HP plus the nonlethal HP that still counts. */
export function lethalHp(value, nonlethal, max) {
  return Number(value) + effectiveNonlethal(nonlethal, value, max);
}

/** Stored flag, as an integer >= 0. */
export function nonlethalOf(actor) {
  return Math.max(0, Math.trunc(Number(actor?.getFlag?.(MODULE_ID, NONLETHAL_FLAG))) || 0);
}

/**
 * Immutable HP snapshot used by the conditions rule. Keeps the raw flag and the mode, so a snapshot taken under
 * one mode can be recomputed under the other.
 */
export function lethalSnapshot({ value, nonlethal, max, nonlethalOn }) {
  const raw = Math.max(0, Math.trunc(Number(nonlethal)) || 0);
  const n = nonlethalOn ? effectiveNonlethal(raw, value, max) : 0;
  return Object.freeze({ value, rawNonlethal: raw, nonlethal: n, lethal: value + n, max, nonlethalOn: !!nonlethalOn });
}

/** The same confirmed data, seen under another mode. Returns the snapshot itself when the mode matches. */
export function rebaseSnapshot(snapshot, nonlethalOn) {
  if (!snapshot || snapshot.nonlethalOn === !!nonlethalOn) return snapshot;
  return lethalSnapshot({ value: snapshot.value, nonlethal: snapshot.rawNonlethal, max: snapshot.max, nonlethalOn });
}

/**
 * Confirmed snapshot of an actor under the given mode.
 * @param {object} actor
 * @param {boolean} nonlethalOn  Whether the nonlethal damage rule is on.
 */
export function hpSnapshotOf(actor, nonlethalOn) {
  const pv = actor.system?.attributes?.pv ?? {};
  return lethalSnapshot({ value: Number(pv.value), nonlethal: nonlethalOf(actor), max: Number(pv.max), nonlethalOn });
}

/** Whether an update changed anything the snapshot depends on (nested or dotted keys). */
export function touchesLethalHp(changed) {
  return [HP_PATH, MAX_PATH, FLAG_PATH].some((path) => readChange(changed, path).found);
}

/* -------------------------------------------- */
/*  Changes (nested or dotted keys)             */
/* -------------------------------------------- */

/**
 * Reads a path from update changes that may mix nested objects and dotted keys.
 * @returns {{found: boolean, value?: unknown}}
 */
export function readChange(obj, path) {
  const parts = Array.isArray(path) ? path : path.split(".");
  if (!obj || typeof obj !== "object") return { found: false };
  for (let i = parts.length; i >= 1; i--) {
    const key = parts.slice(0, i).join(".");
    if (!Object.hasOwn(obj, key)) continue;
    if (i === parts.length) return { found: true, value: obj[key] };
    const inner = readChange(obj[key], parts.slice(i));
    if (inner.found) return inner;
  }
  return { found: false };
}
