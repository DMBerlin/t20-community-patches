/** Pure logic of the dying states rule (#51): what to create and remove so the conditions match the HP. */
import { MODULE_ID } from "../../lib/module.mjs";
import { deathThreshold } from "../../lib/death-threshold.mjs";

export const DYING_STATES_MODES = ["off", "characters", "all"];
export const DYING_FLAG = "dyingState";
export const UNCONSCIOUS = "inconsciente";
export const BLEEDING = "sangrando";
export const DEAD = "morto";
export const RULE_STATUSES = [UNCONSCIOUS, BLEEDING, DEAD];

/**
 * Remembers the last confirmed snapshot of each actor, in the order the updates arrive from the server.
 * The previous snapshot of a transition is the last confirmed one; the snapshot captured before sending is only a
 * fallback for the first update seen in this session.
 */
export function createPvTracker() {
  const last = new Map();
  return {
    /**
     * @param {string} key
     * @param {object} after          Confirmed snapshot of this update.
     * @param {object} [fallback]     Snapshot captured by the client that sent the update.
     * @returns {object|undefined}    Previous confirmed snapshot.
     */
    observe(key, after, fallback) {
      const before = last.has(key) ? last.get(key) : fallback;
      if (Number.isFinite(after?.value)) last.set(key, after);
      return Number.isFinite(before?.value) ? before : undefined;
    }
  };
}

/**
 * What to create and remove so the rule's conditions match the HP. Idempotent: with equal snapshots it only
 * reconciles (duplicates, rule conditions left at 1 HP or more, rule Sangrando on a dead creature).
 * Inconsciente follows the current HP (`before`/`after`); Sangrando and Morto follow the lethal HP
 * (`lethalBefore`/`lethalAfter`, which default to the current HP).
 * @param {object} state
 * @param {number} [state.before]
 * @param {number} state.after
 * @param {number} state.max
 * @param {Set<string>} state.statuses            Every status on the actor's effects (active or not).
 * @param {Record<string, string[]>} state.owned  Ids of this rule's effects per status, in collection order.
 * @param {number} [state.lethalBefore]
 * @param {number} [state.lethalAfter]
 * @returns {{create: string[], remove: string[]}}
 */
export function planDyingStates({ before, after, max, statuses, owned, lethalBefore = before, lethalAfter = after }) {
  const plan = { create: [], remove: [] };
  const a = Number(after);
  const la = Number(lethalAfter);
  if (!Number.isFinite(a) || !Number.isFinite(la)) return plan;
  const b = Number(before);
  const lb = Number(lethalBefore);
  const known = Number.isFinite(b) && Number.isFinite(lb);
  const mine = (id) => owned?.[id] ?? [];
  const kept = (id) => mine(id).slice(0, 1);
  const has = (id) => statuses?.has?.(id) === true;
  for (const id of RULE_STATUSES) plan.remove.push(...mine(id).slice(1));
  const limit = deathThreshold(max);

  if (limit !== null && la <= limit) {
    // Crossing the threshold, or losing more lethal HP after Morto was removed by hand, applies Morto.
    if (!has(DEAD) && known && (lb > limit || la < lb)) plan.create.push(DEAD);
    plan.remove.push(...kept(BLEEDING));
    return plan;
  }
  // Dead creatures above the threshold are left to the GM (resurrection, corrections).
  if (has(DEAD)) return plan;
  if (a >= 1) plan.remove.push(...kept(UNCONSCIOUS));
  if (la >= 1) plan.remove.push(...kept(BLEEDING));
  if (!known) return plan;
  if (a <= 0 && b >= 1 && !has(UNCONSCIOUS)) plan.create.push(UNCONSCIOUS);
  if (la <= 0) {
    if (lb > 0 || la < lb) {
      if (!has(BLEEDING)) plan.create.push(BLEEDING);
    } else if (a > b) {
      // Any healing of 1 HP or more stabilizes, even when it only paid back nonlethal damage.
      plan.remove.push(...kept(BLEEDING));
    }
  }
  return plan;
}

/**
 * Effect data for a condition created by this rule. Does not mutate the source.
 * @param {object} source            `toObject()` of the system's status effect.
 * @param {string} statusId
 * @param {number} alwaysShowIcon    CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS
 * @returns {object}
 */
export function buildStatusEffectData(source, statusId, alwaysShowIcon) {
  const data = structuredClone(source ?? {});
  data.flags ??= {};
  data.flags[MODULE_ID] = { ...(data.flags[MODULE_ID] ?? {}), [DYING_FLAG]: statusId };
  if (statusId === DEAD) {
    data.flags.core = { ...(data.flags.core ?? {}), overlay: true };
    data.duration = { ...(data.duration ?? {}), expiry: null };
    data.showIcon = alwaysShowIcon;
  }
  return data;
}

/**
 * Every status that descends from the given ones through `system.status.childEffect`.
 * @param {Record<string, {_source?: object}>} statusEffects   CONFIG.statusEffects
 * @param {string[]} roots
 * @returns {Set<string>}
 */
export function childStatusesOf(statusEffects, roots) {
  const found = new Set();
  const pending = [...roots];
  while (pending.length) {
    const id = pending.pop();
    for (const child of statusEffects?.[id]?._source?.system?.status?.childEffect ?? []) {
      if (found.has(child) || roots.includes(child)) continue;
      found.add(child);
      pending.push(child);
    }
  }
  return found;
}

/**
 * Whether a newly created effect is a child condition whose parent no longer exists on the same actor.
 * The system creates child conditions with `origin` = parent uuid, without await.
 * @param {{statuses: Iterable<string>, origin?: string, actorUuid: string, effectIds: {has(id: string): boolean},
 *   childStatuses: Set<string>}} input
 * @returns {boolean}
 */
export function isOrphanChild({ statuses, origin, actorUuid, effectIds, childStatuses }) {
  if (typeof origin !== "string") return false;
  const prefix = `${actorUuid}.ActiveEffect.`;
  if (!origin.startsWith(prefix)) return false;
  const parentId = origin.slice(prefix.length);
  if (!parentId || parentId.includes(".") || effectIds.has(parentId)) return false;
  return [...(statuses ?? [])].some((s) => childStatuses.has(s));
}

/**
 * Child conditions left on the actor after their parent was deleted (the system only removes the children the
 * deleting client already had).
 * @param {{deletedId: string, actorUuid: string, effects: Iterable<{id: string, origin?: string,
 *   statuses?: Iterable<string>}>, childStatuses: Set<string>}} input
 * @returns {string[]}
 */
export function orphansOf({ deletedId, actorUuid, effects, childStatuses }) {
  const origin = `${actorUuid}.ActiveEffect.${deletedId}`;
  const ids = [];
  for (const e of effects ?? []) {
    if (e.origin === origin && [...(e.statuses ?? [])].some((s) => childStatuses.has(s))) ids.push(e.id);
  }
  return ids;
}

/**
 * Runs async tasks in order per key. A failed task does not stop the next one.
 * @returns {(key: string, task: () => Promise<unknown>) => Promise<unknown>}
 */
export function createKeyedQueue() {
  const tails = new Map();
  return function enqueue(key, task) {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(() => task());
    const tail = run.catch(() => {});
    tails.set(key, tail);
    tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}
