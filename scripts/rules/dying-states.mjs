/**
 * Optional rule "Estados de PV zero" (#51).
 *
 * Book rule (core rulebook, p. 236): at 0 HP or less a creature falls unconscious and bleeds; any healing of 1 HP
 * or more stabilizes it, and losing more HP makes it bleed again; recovering to 1 HP or more wakes it up; at -10
 * or minus half its maximum HP (whichever is lower) it dies. Nonlethal damage counts for falling unconscious, but
 * not for bleeding or dying. The system never applies these conditions.
 *
 * One designated client per actor (the active GM, otherwise the active owner chosen by the core) applies or removes
 * the system conditions "inconsciente", "sangrando" and "morto". Effects created here carry a flag, and only those
 * are removed automatically, plus child conditions the system created after their parent was already deleted.
 *
 * The lethal HP contract (snapshots, rebase between nonlethal modes) comes from nonlethal-damage.mjs (#55), and the
 * death threshold from the death-threshold patch (#29).
 */
import { MODULE_ID } from "../utils.mjs";
import { deathThreshold } from "../patches/death-threshold.mjs";
import { hpSnapshotOf, rebaseSnapshot, touchesLethalHp } from "./nonlethal-damage.mjs";

export const DYING_STATES_SETTING = "dyingStatesRule";
export const DYING_STATES_MODES = ["off", "characters", "all"];
export const DYING_FLAG = "dyingState";
export const UNCONSCIOUS = "inconsciente";
export const BLEEDING = "sangrando";
export const DEAD = "morto";
export const RULE_STATUSES = [UNCONSCIOUS, BLEEDING, DEAD];
const TRACKED_TYPES = {
  characters: new Set(["character"]),
  all: new Set(["character", "npc", "simple"])
};
const LOG = `${MODULE_ID} | dying-states:`;

/**
 * Whether the rule covers an actor type in a mode.
 * @param {string} type
 * @param {string} mode
 * @returns {boolean}
 */
export function isTracked(type, mode) {
  return TRACKED_TYPES[mode]?.has(type) ?? false;
}

function currentMode() {
  try {
    return game.settings.get(MODULE_ID, DYING_STATES_SETTING);
  } catch {
    return "off";
  }
}

/** Whether the rule, in its current mode, covers this actor. False when the setting is not registered. */
export function coversActor(actor) {
  return isTracked(actor?.type, currentMode());
}

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

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const enqueue = createKeyedQueue();
const tracker = createPvTracker();
const warnedMissing = new Set();

/** Same answer on every client: the active GM if any, otherwise the active owner the core designates. */
export function isDesignatedExecutor(actor) {
  const user = game.users.getDesignatedUser((u) => u.active && actor.testUserPermission(u, "OWNER"));
  return !!user && user.id === game.user?.id;
}

function isActive(actor) {
  return actor?.documentName === "Actor" && coversActor(actor) && isDesignatedExecutor(actor);
}

function onPreUpdateActor(actor, changes, options, userId) {
  try {
    if (userId !== game.user?.id || !touchesLethalHp(changes) || !coversActor(actor)) return;
    const store = (options[MODULE_ID] ??= {});
    (store.dyingStates ??= {})[actor.uuid] = hpSnapshotOf(actor);
  } catch (err) {
    console.warn(`${LOG} could not capture the HP of ${actor?.name}`, err);
  }
}

function onUpdateActor(actor, changed, options) {
  try {
    if (!touchesLethalHp(changed)) return;
    // Read synchronously: the document already holds this update, and hooks fire in server order.
    const after = hpSnapshotOf(actor);
    const observed = tracker.observe(actor.uuid, after, options?.[MODULE_ID]?.dyingStates?.[actor.uuid]);
    // Compare under one mode: a snapshot taken before the nonlethal rule was toggled is recomputed under the new one.
    const before = rebaseSnapshot(observed, after.nonlethalOn);
    if (!isActive(actor)) return;
    enqueue(actor.uuid, () => syncDyingStates(actor, before, after));
  } catch (err) {
    console.error(`${LOG} could not track the HP of ${actor?.name}`, err);
  }
}

function deleteOrphans(actor, ids) {
  if (!ids.length) return;
  enqueue(actor.uuid, async () => {
    const live = ids.filter((id) => actor.effects.has(id));
    if (!live.length) return;
    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", live);
    } catch (err) {
      console.debug(`${LOG} orphans already removed`, err);
    }
  });
}

// Server order makes the two checks complete: a child is either created after its parent's deletion (caught on
// creation) or before it (caught on the deletion).
function onCreateActiveEffect(effect) {
  try {
    const actor = effect.parent;
    if (!isActive(actor)) return;
    const childStatuses = childStatusesOf(CONFIG.statusEffects, RULE_STATUSES);
    const orphan = isOrphanChild({
      statuses: effect.statuses, origin: effect.origin, actorUuid: actor.uuid, effectIds: actor.effects, childStatuses
    });
    if (orphan) return deleteOrphans(actor, [effect.id]);
    if (effect.getFlag?.(MODULE_ID, DYING_FLAG)) {
      const now = hpSnapshotOf(actor);
      enqueue(actor.uuid, () => syncDyingStates(actor, now, now));
    }
  } catch (err) {
    console.error(`${LOG} could not check a new effect`, err);
  }
}

function onDeleteActiveEffect(effect) {
  try {
    const actor = effect.parent;
    if (!isActive(actor)) return;
    const childStatuses = childStatusesOf(CONFIG.statusEffects, RULE_STATUSES);
    deleteOrphans(actor, orphansOf({ deletedId: effect.id, actorUuid: actor.uuid, effects: actor.effects, childStatuses }));
  } catch (err) {
    console.error(`${LOG} could not check a deleted effect`, err);
  }
}

async function syncDyingStates(actor, before, after) {
  try {
    const statuses = new Set(actor.statuses ?? []);
    const owned = {};
    for (const effect of actor.effects) {
      for (const id of effect.statuses ?? []) statuses.add(id);
      const mine = effect.getFlag(MODULE_ID, DYING_FLAG);
      if (mine) (owned[mine] ??= []).push(effect.id);
    }
    const plan = planDyingStates({
      before: before?.value, after: after.value, max: after.max, statuses, owned,
      lethalBefore: before?.lethal, lethalAfter: after.lethal
    });

    const remove = plan.remove.filter((id) => actor.effects.has(id));
    if (remove.length) await actor.deleteEmbeddedDocuments("ActiveEffect", remove);

    const create = [];
    for (const statusId of plan.create) {
      if (!CONFIG.statusEffects?.[statusId]) {
        if (!warnedMissing.has(statusId)) {
          warnedMissing.add(statusId);
          console.warn(`${LOG} condition "${statusId}" is not in CONFIG.statusEffects on this client; skipped.`);
        }
        continue;
      }
      const effect = await CONFIG.ActiveEffect.documentClass.fromStatusEffect(statusId);
      create.push(buildStatusEffectData(effect.toObject(), statusId, CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS));
    }
    if (create.length) await actor.createEmbeddedDocuments("ActiveEffect", create);
  } catch (err) {
    console.error(`${LOG} could not update the conditions of ${actor?.name}`, err);
  }
}

/** Registers the world setting. Runs on "init" for every system, so the setting always exists. */
export function registerDyingStatesSetting() {
  game.settings.register(MODULE_ID, DYING_STATES_SETTING, {
    name: "T20CP.DyingStates.Setting.Name",
    hint: "T20CP.DyingStates.Setting.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: Object.fromEntries(DYING_STATES_MODES.map((m) => [m, `T20CP.DyingStates.Setting.${m}`])),
    default: "off"
  });
}

/** Installs the hooks. They stay installed and read the setting on every change. */
export function installDyingStatesRule() {
  Hooks.on("preUpdateActor", onPreUpdateActor);
  Hooks.on("updateActor", onUpdateActor);
  Hooks.on("createActiveEffect", onCreateActiveEffect);
  Hooks.on("deleteActiveEffect", onDeleteActiveEffect);
}
