/**
 * Target handling of chat-card rules (service, #87): attack-vs-defense, save-button-card, situational-modifiers,
 * concealment-miss-chance, combat-maneuvers and nonlethal-attack.
 *
 * The targets of an item use are frozen when ItemT20#roll starts, before any attack or damage roll. ItemT20#roll
 * clones the item synchronously before its first await (T20:8545) and runs rollAttack, rollDamage and displayCard
 * on that clone, so the clone is bound to the frozen selection until the use ends.
 */
import { USE_PURPOSES, targetRecord } from "../lib/targets.mjs";

/** @typedef {import("../lib/targets.mjs").TargetRecord} TargetRecord */
/** @typedef {{tokens: readonly Token[], records: readonly TargetRecord[], purpose?: string|null}} TargetUse */
/** @typedef {{id: string, delta: number}} DefenseAdjustment  Stable id (e.g. "cover") and the delta added to Defense. */

const EMPTY = Object.freeze([]);

/**
 * Wraps ItemT20#roll and ItemT20#clone of `proto`. Throws when either is missing.
 * @param {object} proto                       Prototype of the system's item class.
 * @param {() => Iterable<object>} userTargets  The tokens the user targets now.
 * @param {(target: object, method: string, wrapper: Function) => Function} wrap  Wraps with the service as owner.
 */
export function createUseTargets(proto, userTargets, wrap) {
  if (!proto) throw new Error("CONFIG.Item.documentClass not found");
  if (typeof proto.roll !== "function" || typeof proto.clone !== "function") throw new Error("ItemT20#roll or #clone not found");

  const consumers = new Set();
  /** @type {WeakMap<object, TargetUse>} */
  const contexts = new WeakMap();
  /** Open ItemT20#roll calls whose synchronous part is running, innermost last. */
  const frames = [];
  /** Purpose for the next ItemT20#roll that starts while withUsePurpose runs; consumed by that roll. */
  let pendingPurpose = null;
  /** @type {WeakMap<object, Map<string, DefenseAdjustment[]>>} */
  const defenseAdjustments = new WeakMap();

  const anyConsumerOn = () =>
    [...consumers].some((isOn) => {
      try {
        return Boolean(isOn());
      } catch {
        return false;
      }
    });

  /** A snapshot of the user's current targets; records are read now, never later. @returns {TargetUse} */
  function snapshot() {
    const tokens = [];
    const records = [];
    for (const token of userTargets() ?? []) {
      const record = targetRecord(token);
      if (!record) continue;
      tokens.push(token);
      records.push(Object.freeze(record));
    }
    return { tokens: Object.freeze(tokens), records: Object.freeze(records) };
  }

  wrap(proto, "clone", function (clone, ...args) {
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
  });

  wrap(proto, "roll", async function (roll, ...args) {
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
  });

  return {
    /**
     * Runs fn with a purpose for the item use it starts. Only works if fn calls item.roll synchronously, that roll
     * is the first one fn starts, and no foreign wrapper of ItemT20#roll awaits before calling the next one.
     */
    withUsePurpose(purpose, fn) {
      const previous = pendingPurpose;
      pendingPurpose = purpose;
      try {
        return fn();
      } finally {
        pendingPurpose = previous;
      }
    },

    /** @returns {string|null} The purpose of the use the item clone belongs to. */
    usePurposeOf: (item) => contexts.get(item)?.purpose ?? null,

    /** Whether the item is the clone of an ItemT20#roll in progress (one per use). */
    inItemUse: (item) => contexts.has(item),

    /** The uses are only tracked while some consumer is on. @param {() => boolean} isOn */
    registerTargetConsumer(isOn) {
      consumers.add(isOn);
    },

    /**
     * Tokens of the current item use (for live data such as the actor or its Defense).
     * Inside a use: the same frozen array on every call. Outside: a fresh copy each call.
     * @returns {readonly Token[]}
     */
    useTargets: (item) => (contexts.get(item) ?? snapshot()).tokens,

    /**
     * Records frozen at the start of the current item use (what cards persist). Same identity rules as useTargets.
     * @returns {readonly TargetRecord[]}
     */
    useTargetRecords: (item) => (contexts.get(item) ?? snapshot()).records,

    /**
     * Records Defense adjustments of this use, per target TokenDocument UUID. Called before the original rollAttack.
     * Repeated calls accumulate; the same id on the same target is kept once (the first one wins).
     * @param {object} item  The per-use clone created by ItemT20#roll (T20:8545).
     * @param {Map<string, DefenseAdjustment[]>} byTarget
     */
    addDefenseAdjustments(item, byTarget) {
      if (!item) return;
      const store = defenseAdjustments.get(item) ?? new Map();
      for (const [uuid, list] of byTarget) {
        const current = store.get(uuid) ?? [];
        for (const adj of list) if (!current.some((a) => a.id === adj.id)) current.push({ id: adj.id, delta: Number(adj.delta) || 0 });
        store.set(uuid, current);
      }
      defenseAdjustments.set(item, store);
    },

    /**
     * Defense adjustments of this use for one target. Read after the original rollAttack.
     * @returns {DefenseAdjustment[]}  A copy; empty when there are none.
     */
    defenseAdjustmentsFor: (item, tokenUuid) => (defenseAdjustments.get(item)?.get(tokenUuid) ?? []).map((a) => ({ ...a }))
  };
}

/** @type {import("../kernel/services.mjs").Service} */
export default {
  id: "use-targets",
  install: (ctx) => createUseTargets(ctx.platform.classes.item?.prototype, () => ctx.platform.user.targets(), ctx.wrap)
};
