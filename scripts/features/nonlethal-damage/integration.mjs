/** Foundry integration of the nonlethal damage rule, only through ctx. */
import { allActors } from "../../lib/actors.mjs";
import { FLAG_PATH, HP_PATH, MAX_PATH, NONLETHAL_SETTING, nonlethalOf, readsOn } from "../../lib/nonlethal.mjs";
import { MODULE_ID } from "../../lib/module.mjs";
import {
  ACTOR_TYPES,
  createPreparedFloors,
  deleteChange,
  hpForNonlethalEdit,
  nonlethalForUpdate,
  readChange,
  recognizesDamageMethod,
  writeChange
} from "./domain/index.mjs";
import { onRenderActorSheet, onRenderChatMessage, syncChatToggles } from "./ui.mjs";

/**
 * State of one installation, shared by the hooks, the wrappers and the UI.
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 */
export function createState(ctx) {
  const { i18n } = ctx.platform;
  return {
    platform: ctx.platform,
    log: ctx.log,
    /** Whether the optional rule is on. Safe before the setting is registered (returns false). */
    enabled: () => readsOn(() => ctx.setting(NONLETHAL_SETTING)),
    t: (key, data) => (data ? i18n.format(`T20CP.NonlethalDamage.${key}`, data) : i18n.localize(`T20CP.NonlethalDamage.${key}`)),
    /** The damage methods were recognized on install; without them the chat toggle is not added. */
    toggleReady: false,
    listened: new WeakSet(),
    floors: createPreparedFloors()
  };
}

/**
 * preUpdateActor handler. Runs on the client that updates, after the system's _preUpdate, for world actors and the
 * synthetic actors of unlinked tokens (their update is turned into an ActorDelta update after this hook).
 */
export function onPreUpdateActor(state, actor, changes, options) {
  try {
    if (!ACTOR_TYPES.includes(actor?.type)) return;
    const pv = actor.system?.attributes?.pv;
    if (!pv) return;
    let hp = readChange(changes, HP_PATH);
    const flag = readChange(changes, FLAG_PATH);
    if (!hp.found && !flag.found) return;
    const before = actor._source?.system?.attributes?.pv?.value ?? pv.value;
    const stored = nonlethalOf(actor);
    const enabled = state.enabled();
    const damaged = hpForNonlethalEdit({ before, stored, max: pv.max, hp, flag, enabled });
    if (damaged !== undefined) {
      deleteChange(changes, HP_PATH);
      writeChange(changes, HP_PATH, damaged);
      hp = { found: true, value: damaged };
    }
    const maxChange = readChange(changes, MAX_PATH);
    const next = nonlethalForUpdate({
      before,
      stored,
      max: pv.max,
      maxAfter: maxChange.found ? maxChange.value : undefined,
      hp,
      flag,
      isNonlethal: options?.[MODULE_ID]?.nonlethal === true,
      enabled
    });
    if (next === null) return;
    deleteChange(changes, FLAG_PATH);
    writeChange(changes, FLAG_PATH, next);
  } catch (err) {
    state.log.error(`failed to resolve the nonlethal HP of ${actor?.name}`, err);
  }
}

function refreshActors(ctx) {
  for (const actor of allActors(ctx.platform.documents)) {
    try {
      actor.reset();
      if (actor.sheet?.rendered) actor.sheet.render(false);
    } catch (err) {
      ctx.log.error(`failed to refresh ${actor?.name}`, err);
    }
  }
}

/** Data model prototypes that own prepareDerivedData, once each. */
function preparedPrototypes(ctx) {
  const dataModels = ctx.platform.config.document("Actor")?.dataModels;
  const prototypes = new Set();
  for (const type of ACTOR_TYPES) {
    const proto = dataModels?.[type]?.prototype;
    if (proto && Object.hasOwn(proto, "prepareDerivedData")) prototypes.add(proto);
  }
  return prototypes;
}

function wrapPreparation(ctx, state) {
  let warned = false;
  for (const proto of preparedPrototypes(ctx)) {
    if (typeof proto.prepareDerivedData !== "function") continue;
    ctx.wrap(proto, "prepareDerivedData", function (original, ...args) {
      try {
        state.floors.restorePreparedMin(this);
      } catch {
        // Never block the system's preparation.
      }
      const result = original.apply(this, args);
      try {
        if (state.enabled()) state.floors.widenPreparedMin(this);
      } catch (err) {
        if (!warned) {
          warned = true;
          ctx.log.warn("could not widen the minimum HP", err);
        }
      }
      return result;
    });
  }
}

/**
 * Installs the rule. Runs after the patches and the other rules, so the prepareDerivedData wrappers sit outside
 * death-threshold's (#29) and widen the floor it sets.
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 * @returns {ReturnType<typeof createState>}
 */
export function install(ctx) {
  const state = createState(ctx);
  const actorProto = ctx.platform.classes.actor?.prototype;
  const sources = ["applyDamageV2", "applyDamage"].map((name) => {
    const fn = actorProto?.[name];
    return typeof fn === "function" ? ctx.platform.sourceOf(fn) : undefined;
  });
  state.toggleReady = sources.every(recognizesDamageMethod);
  if (!state.toggleReady) ctx.log.warn("ActorT20 damage methods not recognized; the chat toggle is disabled");

  wrapPreparation(ctx, state);

  ctx.hooks.on("preUpdateActor", (actor, changes, options) => onPreUpdateActor(state, actor, changes, options));
  ctx.hooks.on("renderChatMessageHTML", (message, html) => onRenderChatMessage(state, message, html));
  ctx.hooks.on("renderActorSheetT20", (sheet, html) => onRenderActorSheet(state, sheet, html));
  ctx.onSettingChange(NONLETHAL_SETTING, (value) => {
    syncChatToggles(value === "on");
    refreshActors(ctx);
  });
  return state;
}
