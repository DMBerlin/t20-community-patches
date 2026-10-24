/**
 * Shared target handling for chat-card rules (attack-vs-defense, save-button-card).
 *
 * The targets of an item use are frozen when ItemT20#roll starts, before any attack or damage roll. ItemT20#roll
 * clones the item synchronously before its first await (T20:8545) and runs rollAttack, rollDamage and displayCard
 * on that clone, so the clone is bound to the frozen selection until the use ends.
 */
import { markWrapper } from "../../utils.mjs";

/** CONST.TOKEN_DISPLAY_MODES.HOVER and ALWAYS: the only modes the canvas shows to users who do not own the token. */
export const PUBLIC_NAME_MODES = new Set([30, 50]);

/** @typedef {{uuid: string, name: string, displayName: number}} TargetRecord */
/** @typedef {{tokens: readonly Token[], records: readonly TargetRecord[], purpose?: string|null}} TargetUse */

/** Purposes a caller can attach to the next item use (see withUsePurpose). */
export const USE_PURPOSES = Object.freeze({ MANEUVER_RESISTANCE: "maneuver-resistance" });

const EMPTY = Object.freeze([]);
const consumers = new Set();
/** @type {WeakMap<object, TargetUse>} */
const contexts = new WeakMap();
/** Open ItemT20#roll calls whose synchronous part is running, innermost last. */
const frames = [];
/** Prototypes already wrapped; every rule calls installUseTargets, the wrappers go on once. */
const installedOn = new WeakSet();
/** Purpose for the next ItemT20#roll that starts while withUsePurpose runs; consumed by that roll. */
let pendingPurpose = null;

/**
 * Runs fn with a purpose for the item use it starts. Only works if fn calls item.roll synchronously, that roll is
 * the first one fn starts, and no foreign wrapper of ItemT20#roll awaits before calling the next one.
 */
export function withUsePurpose(purpose, fn) {
  const previous = pendingPurpose;
  pendingPurpose = purpose;
  try {
    return fn();
  } finally {
    pendingPurpose = previous;
  }
}

/** @returns {string|null} The purpose of the use the item clone belongs to. */
export function usePurposeOf(item) {
  return contexts.get(item)?.purpose ?? null;
}

/** Whether the item is the clone of an ItemT20#roll in progress (one per use). */
export function inItemUse(item) {
  return contexts.has(item);
}

/** @param {() => boolean} isOn */
export function registerTargetConsumer(isOn) {
  consumers.add(isOn);
}

function anyConsumerOn() {
  return [...consumers].some((isOn) => {
    try {
      return Boolean(isOn());
    } catch {
      return false;
    }
  });
}

/**
 * What a card stores about a target. Accepts a Token or a TokenDocument.
 * @returns {TargetRecord | null}
 */
export function targetRecord(token) {
  const doc = token?.document ?? token;
  if (!doc?.uuid) return null;
  return { uuid: doc.uuid, name: String(doc.name ?? ""), displayName: Number(doc.displayName ?? 0) };
}

/** A snapshot of the user's current targets; records are read now, never later. @returns {TargetUse} */
function snapshot() {
  const tokens = [];
  const records = [];
  for (const token of game.user?.targets ?? []) {
    const record = targetRecord(token);
    if (!record) continue;
    tokens.push(token);
    records.push(Object.freeze(record));
  }
  return { tokens: Object.freeze(tokens), records: Object.freeze(records) };
}

/** Wraps ItemT20#roll and ItemT20#clone once; later calls do nothing. */
export function installUseTargets() {
  const proto = CONFIG.Item?.documentClass?.prototype;
  if (!proto) throw new Error("CONFIG.Item.documentClass not found");
  if (installedOn.has(proto)) return;
  const roll = proto.roll;
  const clone = proto.clone;
  if (typeof roll !== "function" || typeof clone !== "function") throw new Error("ItemT20#roll or #clone not found");

  proto.clone = markWrapper(function (...args) {
    const top = frames.at(-1);
    // Reserve before running the original: nested rolls or clones inside it cannot take this frame.
    const frame = top && !top.claimed && top.source === this ? top : null;
    if (frame) frame.claimed = true;
    const copy = clone.apply(this, args);
    if (frame && copy) {
      frame.clone = copy;
      contexts.set(copy, frame.use);
    }
    return copy;
  }, clone);

  proto.roll = markWrapper(async function (...args) {
    // Consumed here, so nested rolls started by this one do not inherit it.
    const purpose = pendingPurpose;
    pendingPurpose = null;
    if (purpose === null && !anyConsumerOn()) return roll.apply(this, args);
    // The defender's test of a maneuver has no targets of its own.
    const base = purpose === USE_PURPOSES.MANEUVER_RESISTANCE ? { tokens: EMPTY, records: EMPTY } : snapshot();
    const frame = { source: this, use: Object.freeze({ ...base, purpose }), claimed: false, clone: null };
    frames.push(frame);
    try {
      let pending;
      try {
        pending = roll.apply(this, args);
      } finally {
        // Remove only this frame; an outer roll's frame stays on the stack.
        const index = frames.lastIndexOf(frame);
        if (index !== -1) frames.splice(index, 1);
      }
      return await pending;
    } finally {
      if (frame.clone) contexts.delete(frame.clone);
    }
  }, roll);

  installedOn.add(proto);
}

/**
 * Tokens of the current item use (for live data such as the actor or its Defense).
 * Inside a use: the same frozen array on every call. Outside: a fresh copy each call.
 * @returns {readonly Token[]}
 */
export function useTargets(item) {
  return (contexts.get(item) ?? snapshot()).tokens;
}

/**
 * Records frozen at the start of the current item use (what cards persist). Same identity rules as useTargets.
 * @returns {readonly TargetRecord[]}
 */
export function useTargetRecords(item) {
  return (contexts.get(item) ?? snapshot()).records;
}

/** @typedef {{id: string, delta: number}} DefenseAdjustment  Stable id (e.g. "cover") and the delta added to Defense. */

const defenseAdjustments = new WeakMap();

/**
 * Records Defense adjustments of this use, per target TokenDocument UUID. Called before the original rollAttack.
 * Repeated calls accumulate; the same id on the same target is kept once (the first one wins).
 * @param {object} item  The per-use clone created by ItemT20#roll (T20:8545).
 * @param {Map<string, DefenseAdjustment[]>} byTarget
 */
export function addDefenseAdjustments(item, byTarget) {
  if (!item) return;
  const store = defenseAdjustments.get(item) ?? new Map();
  for (const [uuid, list] of byTarget) {
    const current = store.get(uuid) ?? [];
    for (const adj of list) if (!current.some((a) => a.id === adj.id)) current.push({ id: adj.id, delta: Number(adj.delta) || 0 });
    store.set(uuid, current);
  }
  defenseAdjustments.set(item, store);
}

/**
 * Defense adjustments of this use for one target. Read after the original rollAttack.
 * @returns {DefenseAdjustment[]}  A copy; empty when there are none.
 */
export function defenseAdjustmentsFor(item, tokenUuid) {
  return (defenseAdjustments.get(item)?.get(tokenUuid) ?? []).map((a) => ({ ...a }));
}

/**
 * Chat policy for a target's name: GM, owner of the token, or a mode that shows the name to everyone.
 * The name shown is always the recorded one; isOwner and displayName are read live (recorded if the token is gone).
 * @param {{isGM: boolean, isOwner: boolean, displayName: unknown}} params
 */
export function canSeeTokenName({ isGM, isOwner, displayName }) {
  return Boolean(isGM || isOwner || PUBLIC_NAME_MODES.has(Number(displayName)));
}
