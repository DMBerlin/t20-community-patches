/**
 * Foundry side of the sustained spell limit (#37): the warning before the roll, the check when an effect is applied
 * and the snapshots kept honest by the document hooks. The state (warning dedup, snapshots) lives in `state`, created
 * by the install.
 */
import { MODULE_ID } from "../../../lib/module.mjs";
import {
  CAST_FLAG,
  MANA_FLOW_NAME,
  MANA_FLOW_SOURCE,
  SUSTAIN_EXPIRY,
  SUSTAIN_STATUS,
  SUSTAINED_SPELL_MODES,
  SUSTAINED_SPELL_SETTING,
  activeSustainedCasts,
  castFromMessage,
  castHistory,
  castsAfter,
  collectStampedEffects,
  createScanCache,
  effectSources,
  exceedsLimit,
  isSupersededCast,
  isSustainedSpell,
  parseSustainOrigin,
  readCast,
  shouldWarn,
  sustainedSpellCapacity
} from "../domain/index.mjs";
import { heldText, list, sustainedReference, t } from "../ui.mjs";
import { getMode, hasPower } from "./common.mjs";

const CAST_PATH = `flags.${MODULE_ID}.${CAST_FLAG}`;

/**
 * @typedef {object} SustainedState
 * @property {import("../../../kernel/feature.mjs").FeatureContext} ctx
 * @property {Map<string, number>} recentWarnings  `${kind}:${castId}:${text}` → time of the last identical warning.
 * @property {ReturnType<typeof createScanCache>} scans  Snapshots of the applications.
 */

/** @returns {SustainedState} */
export function createSustainedState(ctx) {
  return { ctx, recentWarnings: new Map(), scans: createScanCache() };
}

const capacityOf = (ctx, actor) =>
  sustainedSpellCapacity({ manaFlow: hasPower(ctx, actor, { source: MANA_FLOW_SOURCE, name: MANA_FLOW_NAME }) });

function scanStampedEffects(ctx, casterUuid) {
  const { documents } = ctx.platform;
  return collectStampedEffects(effectSources({ actors: documents.actors() ?? [], scenes: documents.scenes() ?? [] }), casterUuid);
}

function activeOf(ctx, actor, effects = scanStampedEffects(ctx, actor.uuid)) {
  return activeSustainedCasts({
    casterUuid: actor.uuid,
    effects,
    markers: [...(actor.effects ?? [])].filter((e) => e.statuses?.has?.(SUSTAIN_STATUS)).map((e) => ({ id: e.id, name: e.name })),
    spellNames: [...(actor.items ?? [])].filter(isSustainedSpell).map((i) => i.name)
  });
}

function historyOf(ctx, casterUuid) {
  return castHistory([...(ctx.platform.documents.messages() ?? [])].map(castFromMessage).filter(Boolean), casterUuid);
}

/** The snapshot of one application; effects are only read when needed. */
function applicationScan(state, casterUuid, castId) {
  return state.scans.get(castId, () => ({ history: historyOf(state.ctx, casterUuid), effects: null }), Date.now());
}

function warnOnce(state, { kind, castId }, message) {
  if (shouldWarn(state.recentWarnings, `${kind}:${castId}:${message}`, { now: Date.now() })) state.ctx.platform.notify.warn(message);
}

const stampOf = (effect) => (effect?.duration?.expiry === SUSTAIN_EXPIRY ? readCast(effect.flags?.[MODULE_ID]?.[CAST_FLAG]) : null);

const INVALIDATING_HOOKS = [
  "createChatMessage",
  "updateChatMessage",
  "deleteChatMessage",
  "createActor",
  "deleteActor",
  "createToken",
  "deleteToken",
  "createScene",
  "deleteScene",
  "updateActiveEffect"
];

/** Keeps the application snapshots honest: any change to casts or stamped effects seen by this client. */
export function registerInvalidation(state) {
  const { hooks } = state.ctx;
  const invalidate = () => state.scans.invalidate();
  for (const hook of INVALIDATING_HOOKS) hooks.on(hook, invalidate);
  hooks.on("updateToken", (token, changes) => {
    if (changes && ("delta" in changes || "actorLink" in changes)) invalidate();
  });
  hooks.on("createActiveEffect", (effect) => {
    const cast = stampOf(effect);
    if (cast) state.scans.noteCreated(cast.castId, { origin: effect.origin, cast });
  });
  // An update may have just removed the stamp or the sustainEnd expiry (the hook sees the updated document), so any
  // update invalidates; a deleted effect still carries its stamp.
  hooks.on("deleteActiveEffect", (effect) => {
    if (stampOf(effect)) invalidate();
  });
}

/** Before ItemT20#roll: warns when a new sustained spell exceeds what the caster keeps. */
export function sustainedBeforeRoll(ctx, item, actor) {
  if (getMode(ctx, SUSTAINED_SPELL_SETTING, SUSTAINED_SPELL_MODES) !== "warn" || !isSustainedSpell(item)) return;
  const capacity = capacityOf(ctx, actor);
  const active = activeOf(ctx, actor);
  if (!exceedsLimit(active, capacity)) return;
  const held = heldText(ctx, active.casts, active.uncertain);
  ctx.platform.notify.warn(
    t(ctx, "Sustained.Warning", { actor: actor.name, item: item.name, held, capacity, reference: sustainedReference(ctx) })
  );
}

/** preCreateActiveEffect, on the client that applies the effect. Only warns; never refuses. */
export function onPreCreateEffect(state, effect, data) {
  const { ctx } = state;
  if (getMode(ctx, SUSTAINED_SPELL_SETTING, SUSTAINED_SPELL_MODES) !== "warn") return;
  const source = data ?? effect;
  if (source?.duration?.expiry !== SUSTAIN_EXPIRY) return;
  const cast = readCast(ctx.platform.utils.getProperty(source, CAST_PATH));
  const origin = parseSustainOrigin(source.origin);
  if (!cast || origin?.casterUuid !== cast.casterUuid) return;
  const caster = ctx.platform.documents.fromUuidSync(cast.casterUuid);
  if (!caster?.effects) return;
  const capacity = capacityOf(ctx, caster);
  const reference = sustainedReference(ctx);

  const scan = applicationScan(state, cast.casterUuid, cast.castId);
  const history = scan.history;
  if (isSupersededCast(cast.castId, history, capacity)) {
    const current = list(ctx, castsAfter(cast.castId, history).map((c) => c.spell));
    warnOnce(state, { kind: "stale", castId: cast.castId }, t(ctx, "Sustained.Stale", {
      spell: cast.spell, actor: caster.name, current, capacity, reference
    }));
    return;
  }
  scan.effects ??= scanStampedEffects(ctx, cast.casterUuid);
  scan.effects.push({ origin: source.origin, cast });
  const active = activeOf(ctx, caster, scan.effects);
  const others = exceedsLimit(active, capacity, cast.castId);
  if (others) {
    warnOnce(state, { kind: "limit", castId: cast.castId }, t(ctx, "Sustained.Apply", {
      spell: cast.spell, actor: caster.name, held: heldText(ctx, others, active.uncertain), capacity, reference
    }));
  }
}
