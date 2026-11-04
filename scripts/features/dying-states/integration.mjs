/**
 * Foundry integration of the dying states rule, only through ctx. One designated client per actor applies the
 * conditions; the queue, the HP tracker and the warnings belong to each installation.
 */
import { MODULE_ID } from "../../lib/module.mjs";
import { NONLETHAL_SETTING, hpSnapshotOf, readsOn, rebaseSnapshot, touchesLethalHp } from "../../lib/nonlethal.mjs";
import { DYING_STATES_SETTING, isTracked } from "../../lib/dying-states.mjs";
import {
  DYING_FLAG,
  RULE_STATUSES,
  buildStatusEffectData,
  childStatusesOf,
  createKeyedQueue,
  createPvTracker,
  isOrphanChild,
  orphansOf,
  planDyingStates
} from "./domain.mjs";

function currentMode(ctx) {
  try {
    return ctx.setting(DYING_STATES_SETTING);
  } catch {
    return "off";
  }
}

/** Whether the rule, in its current mode, covers this actor. False when the setting is not registered. */
export function coversActor(ctx, actor) {
  return isTracked(actor?.type, currentMode(ctx));
}

/** Same answer on every client: the active GM if any, otherwise the active owner the core designates. */
export function isDesignatedExecutor(ctx, actor) {
  const user = ctx.platform.users.designated((u) => u.active && actor.testUserPermission(u, "OWNER"));
  return !!user && user.id === ctx.platform.user.id();
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
function createState(ctx) {
  return {
    ctx,
    enqueue: createKeyedQueue(),
    tracker: createPvTracker(),
    warnedMissing: new Set(),
    /** Whether the nonlethal damage rule is on, read on every change. */
    nonlethalOn: () => readsOn(() => ctx.features.setting("nonlethal-damage", NONLETHAL_SETTING))
  };
}

function isActive(state, actor) {
  return actor?.documentName === "Actor" && coversActor(state.ctx, actor) && isDesignatedExecutor(state.ctx, actor);
}

function onPreUpdateActor(state, actor, changes, options, userId) {
  try {
    if (userId !== state.ctx.platform.user.id() || !touchesLethalHp(changes) || !coversActor(state.ctx, actor)) return;
    const store = (options[MODULE_ID] ??= {});
    (store.dyingStates ??= {})[actor.uuid] = hpSnapshotOf(actor, state.nonlethalOn());
  } catch (err) {
    state.ctx.log.warn(`could not capture the HP of ${actor?.name}`, err);
  }
}

function onUpdateActor(state, actor, changed, options) {
  try {
    if (!touchesLethalHp(changed)) return;
    // Read synchronously: the document already holds this update, and hooks fire in server order.
    const after = hpSnapshotOf(actor, state.nonlethalOn());
    const observed = state.tracker.observe(actor.uuid, after, options?.[MODULE_ID]?.dyingStates?.[actor.uuid]);
    // Compare under one mode: a snapshot taken before the nonlethal rule was toggled is recomputed under the new one.
    const before = rebaseSnapshot(observed, after.nonlethalOn);
    if (!isActive(state, actor)) return;
    state.enqueue(actor.uuid, () => syncDyingStates(state, actor, before, after));
  } catch (err) {
    state.ctx.log.error(`could not track the HP of ${actor?.name}`, err);
  }
}

function deleteOrphans(state, actor, ids) {
  if (!ids.length) return;
  state.enqueue(actor.uuid, async () => {
    const live = ids.filter((id) => actor.effects.has(id));
    if (!live.length) return;
    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", live);
    } catch (err) {
      state.ctx.log.info("orphans already removed", err);
    }
  });
}

// Server order makes the two checks complete: a child is either created after its parent's deletion (caught on
// creation) or before it (caught on the deletion).
function onCreateActiveEffect(state, effect) {
  try {
    const actor = effect.parent;
    if (!isActive(state, actor)) return;
    const childStatuses = childStatusesOf(state.ctx.platform.statusEffects(), RULE_STATUSES);
    const orphan = isOrphanChild({
      statuses: effect.statuses, origin: effect.origin, actorUuid: actor.uuid, effectIds: actor.effects, childStatuses
    });
    if (orphan) return deleteOrphans(state, actor, [effect.id]);
    if (effect.getFlag?.(MODULE_ID, DYING_FLAG)) {
      const now = hpSnapshotOf(actor, state.nonlethalOn());
      state.enqueue(actor.uuid, () => syncDyingStates(state, actor, now, now));
    }
  } catch (err) {
    state.ctx.log.error("could not check a new effect", err);
  }
}

function onDeleteActiveEffect(state, effect) {
  try {
    const actor = effect.parent;
    if (!isActive(state, actor)) return;
    const childStatuses = childStatusesOf(state.ctx.platform.statusEffects(), RULE_STATUSES);
    deleteOrphans(state, actor, orphansOf({ deletedId: effect.id, actorUuid: actor.uuid, effects: actor.effects, childStatuses }));
  } catch (err) {
    state.ctx.log.error("could not check a deleted effect", err);
  }
}

/** Effect data of each condition to create; a condition missing from CONFIG.statusEffects is skipped once warned. */
async function effectsToCreate(state, statusIds) {
  const { platform, log } = state.ctx;
  const create = [];
  for (const statusId of statusIds) {
    if (!platform.statusEffects()?.[statusId]) {
      if (!state.warnedMissing.has(statusId)) {
        state.warnedMissing.add(statusId);
        log.warn(`condition "${statusId}" is not in CONFIG.statusEffects on this client; skipped.`);
      }
      continue;
    }
    const effect = await platform.classes.activeEffect.fromStatusEffect(statusId);
    create.push(buildStatusEffectData(effect.toObject(), statusId, platform.constants().ACTIVE_EFFECT_SHOW_ICON.ALWAYS));
  }
  return create;
}

async function syncDyingStates(state, actor, before, after) {
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

    const create = await effectsToCreate(state, plan.create);
    if (create.length) await actor.createEmbeddedDocuments("ActiveEffect", create);
  } catch (err) {
    state.ctx.log.error(`could not update the conditions of ${actor?.name}`, err);
  }
}

/**
 * Installs the hooks. They stay installed and read the settings on every change.
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 */
export function install(ctx) {
  const state = createState(ctx);
  ctx.hooks.on("preUpdateActor", (actor, changes, options, userId) => onPreUpdateActor(state, actor, changes, options, userId));
  ctx.hooks.on("updateActor", (actor, changed, options) => onUpdateActor(state, actor, changed, options));
  ctx.hooks.on("createActiveEffect", (effect) => onCreateActiveEffect(state, effect));
  ctx.hooks.on("deleteActiveEffect", (effect) => onDeleteActiveEffect(state, effect));
}
