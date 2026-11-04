/**
 * Foundry integration of the same-ability-stacking rule: the stamp on rolled clones, the check before
 * ActiveEffect#_preCreate, the reconciliation on createActiveEffect and the cleanup of orphan "Sustentando" markers.
 * Reads the platform only through `ctx`; the state lives in the install.
 */
import { MODULE_ID } from "../../lib/module.mjs";
import { allActors } from "../../lib/actors.mjs";
import {
  SAME_ABILITY_FLAG,
  SAME_ABILITY_MODES,
  SAME_ABILITY_SETTING,
  abilityIdentity,
  compareMagnitude,
  decideStacking,
  findSameAbility,
  planReconcile,
  sustainMarker
} from "./domain.mjs";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

const FLAG_PATH = `flags.${MODULE_ID}.${SAME_ABILITY_FLAG}`;

/** State of one installation: nothing is shared between installs. */
function createState() {
  return {
    /** Batches seen by _preCreate (the options object is shared by every entry of one operation). */
    batches: new WeakMap(),
    /**
     * Sustained origins this client is still creating (between _preCreate and createActiveEffect). The card applies
     * to the selected tokens one after the other, and only the active GM creates markers, so the marker of an origin
     * with a pending creation here is never treated as orphan. A creation that never completes keeps its marker.
     */
    pendingOrigins: new Map(),
    /** Sustained origins whose marker this client is deleting: a creation with that origin waits, so the system recreates it. */
    deletingMarkers: new Map()
  };
}

function getPolicy(ctx) {
  try {
    const mode = ctx.setting(SAME_ABILITY_SETTING);
    return SAME_ABILITY_MODES.includes(mode) ? mode : "off";
  } catch {
    return "off";
  }
}

function identityOf(platform, effect) {
  const value = platform.utils.getProperty(effect ?? {}, FLAG_PATH);
  return typeof value === "string" ? value : "";
}

/** Writes or removes the flag on the instance and on its source; only used on clones, never on live documents. */
function setFlag(effect, identity) {
  for (const target of [effect, effect._source]) {
    if (!target) continue;
    if (identity) {
      target.flags ??= {};
      target.flags[MODULE_ID] ??= {};
      target.flags[MODULE_ID][SAME_ABILITY_FLAG] = identity;
    } else if (target.flags?.[MODULE_ID] && SAME_ABILITY_FLAG in target.flags[MODULE_ID]) {
      delete target.flags[MODULE_ID][SAME_ABILITY_FLAG];
    }
  }
}

/**
 * Stamps the rolled clone's own effects (including the ones linked-usage-effects injects): the system copies
 * `ef.flags` into the chat card effect, and from there into the applied effect. Effects of other item types lose
 * a stamp they may carry (for instance, an effect brewed into a potion), so only "poder" uses take part.
 */
function stampClone(platform, item) {
  if (!item?.effects || !item.isEmbedded || item.actor?.items?.get(item.id) === item) return;
  const isPower = item.type === "poder";
  const source = isPower ? (item._stats?.compendiumSource ?? platform.utils.getProperty(item, "flags.core.sourceId")) : null;
  const slugify = (s) => (typeof s.slugify === "function" ? s.slugify() : s.toLowerCase());
  for (const effect of item.effects) {
    const identity = isPower ? abilityIdentity({ compendiumSource: source, itemName: item.name, effectName: effect.name, slugify }) : "";
    setFlag(effect, identity);
  }
}

function changesOf(effect) {
  const changes = effect?.system?.changes ?? effect?._source?.system?.changes;
  return Array.isArray(changes) ? changes : [];
}

/** Notification text; every message cites the official rule ("Acumulando Efeitos"). */
function ruleMessage(platform, key, effect, actor) {
  const reference = platform.i18n.localize("T20CP.SameAbility.Reference");
  return platform.i18n.format(`T20CP.SameAbility.${key}`, { effect: effect?.name, actor: actor?.name, reference });
}

/** Whether `identity` was already seen in this creation batch; records it otherwise. */
function seenInBatch(state, options, identity) {
  if (!options || typeof options !== "object") return false;
  let batch = state.batches.get(options);
  if (!batch) state.batches.set(options, (batch = new Set()));
  if (batch.has(identity)) return true;
  batch.add(identity);
  return false;
}

/** For "highest": the comparison of the new effect against the greatest active previous one (null = none active). */
function compareWithPrevious(effect, data, previous) {
  const newChanges = Array.isArray(data?.system?.changes) ? data.system.changes : changesOf(effect);
  let comparison = null;
  for (const old of previous) {
    if (old.disabled) continue;
    const result = compareMagnitude(newChanges, changesOf(old));
    comparison = comparison === null ? result : Math.min(comparison, result);
  }
  return comparison;
}

/**
 * Runs before ActiveEffect#_preCreate, so a refused effect never reaches the system's side effects (such as the
 * "Sustentando" marker the active GM creates for a sustained effect). Returns false to refuse.
 */
function checkCreation(ctx, state, { effect, data, options }) {
  const { platform } = ctx;
  const policy = getPolicy(ctx);
  if (policy === "off") return undefined;
  const identity = platform.utils.getProperty(data ?? {}, FLAG_PATH);
  const actor = effect?.parent;
  if (typeof identity !== "string" || !identity || actor?.documentName !== "Actor") return undefined;
  if (seenInBatch(state, options, identity)) {
    ctx.log.warn(`"${effect.name}" twice in one creation; only the first is kept`);
    return false;
  }
  const previous = findSameAbility([...(actor.effects ?? [])], identity, (e) => identityOf(platform, e));
  const comparison = policy === "highest" ? compareWithPrevious(effect, data, previous) : null;
  if (decideStacking(policy, { previous: previous.length > 0, comparison }) === "refuse") {
    platform.notify.warn(ruleMessage(platform, "Refused", effect, actor));
    return false;
  }
  return undefined;
}

function trackPending(state, data, delta) {
  const origin = data?.duration?.expiry === "sustainEnd" ? data.origin : null;
  if (typeof origin !== "string" || !origin) return;
  const count = (state.pendingOrigins.get(origin) ?? 0) + delta;
  if (count > 0) state.pendingOrigins.set(origin, count);
  else state.pendingOrigins.delete(origin);
}

/** createActiveEffect: the creating user reconciles the effects of the ability on the actor. */
function onCreate(ctx, state, effect, userId) {
  const { platform } = ctx;
  if (userId !== platform.user.id()) return;
  trackPending(state, effect, -1);
  const policy = getPolicy(ctx);
  if (policy === "off") return;
  const identity = identityOf(platform, effect);
  const actor = effect?.parent;
  if (!identity || actor?.documentName !== "Actor") return;
  const entries = findSameAbility([...(actor.effects ?? [])], identity, (e) => identityOf(platform, e)).map((e) => ({
    id: e.id,
    createdTime: e._stats?.createdTime,
    disabled: !!e.disabled,
    changes: changesOf(e)
  }));
  const { remove, selfRemoved } = planReconcile(policy, effect.id, entries);
  const ids = remove.filter((id) => actor.effects?.has(id));
  if (!ids.length) return;
  if (selfRemoved && policy === "highest") platform.notify.warn(ruleMessage(platform, "Refused", effect, actor));
  else platform.notify.info(ruleMessage(platform, "Replaced", effect, actor));
  actor
    .deleteEmbeddedDocuments("ActiveEffect", ids)
    .then(() => (selfRemoved ? removeOrphanMarker(ctx, state, effect) : undefined))
    .catch((err) => {
      ctx.log.warn("failed to delete the replaced effects", err);
    });
}

/** Whether an effect other than `effect`, on any actor (world or unlinked token), still points to its origin. */
function originInUse(platform, effect) {
  for (const other of allActors(platform.documents)) {
    for (const e of other.effects ?? []) if (e.id !== effect.id && e.origin === effect.origin) return true;
  }
  return false;
}

/**
 * A sustained effect removed by the reconciliation may leave the "Sustentando" marker the active GM created for it
 * in ActiveEffectT20#_preCreate. Only the active GM creates markers, so only it removes one, and only when no other
 * effect still points to the same origin (one card can apply the same origin to several targets).
 */
async function removeOrphanMarker(ctx, state, effect) {
  const { platform } = ctx;
  if (!platform.user.isActiveGM() || effect?.duration?.expiry !== "sustainEnd") return;
  const marker = sustainMarker(effect.origin);
  if (!marker || state.pendingOrigins.has(effect.origin)) return;
  if (originInUse(platform, effect)) return;
  const caster = platform.documents.fromUuidSync(marker.casterUuid);
  const doc = caster?.effects?.get(marker.markerId);
  if (!doc) return;
  const deletion = Promise.resolve()
    .then(() => doc.delete())
    .finally(() => {
      if (state.deletingMarkers.get(effect.origin) === deletion) state.deletingMarkers.delete(effect.origin);
    });
  state.deletingMarkers.set(effect.origin, deletion);
  await deletion;
}

/**
 * Installs the rule. Must run after the patches, so the stamp sees the effects linked-usage-effects injects.
 * The stamp is always applied (it is inert), so effects applied while the rule is off are recognized later.
 * @param {FeatureContext} ctx
 */
export function install(ctx) {
  const { platform } = ctx;
  const proto = platform.classes.item?.prototype;
  if (typeof proto?._allApplicableOnUseEffects !== "function") throw new Error("Tormenta20 usage effect API not found");
  const state = createState();
  ctx.wrap(proto, "_allApplicableOnUseEffects", function (original, ...args) {
    const effects = original.apply(this, args);
    try {
      stampClone(platform, this);
    } catch (err) {
      ctx.log.error("failed to stamp the ability effects", err);
    }
    return effects;
  });
  const effectProto = platform.classes.activeEffect?.prototype;
  if (typeof effectProto?._preCreate !== "function") throw new Error("ActiveEffect#_preCreate not found");
  ctx.wrap(effectProto, "_preCreate", function (preCreate, ...args) {
    let allowed;
    try {
      allowed = checkCreation(ctx, state, { effect: this, data: args[0], options: args[1] });
    } catch (err) {
      ctx.log.error("failed to check the effect", err);
    }
    if (allowed === false) return Promise.resolve(false);
    trackPending(state, args[0], 1);
    const deletion = args[0]?.duration?.expiry === "sustainEnd" ? state.deletingMarkers.get(args[0].origin) : undefined;
    if (!deletion) return preCreate.apply(this, args);
    return deletion.catch(() => {}).then(() => preCreate.apply(this, args));
  });
  ctx.hooks.on("createActiveEffect", (effect, options, userId) => {
    try {
      onCreate(ctx, state, effect, userId);
    } catch (err) {
      ctx.log.error("failed to replace the previous effect", err);
    }
  });
}
