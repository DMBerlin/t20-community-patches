/** Per-install state and Foundry reads of "Manobras de combate" (#48). */
import { MODULE_ID } from "../../../lib/module.mjs";
import { CONCEALMENT_SETTING } from "../../../lib/concealment.mjs";
import { COMBAT_MANEUVERS_SETTING, maneuverConcealment, selectVisibleResults } from "../domain/index.mjs";
import { t } from "../ui/cards.mjs";

/** @typedef {import("../../../kernel/feature.mjs").FeatureContext} FeatureContext */

/**
 * State of one install: the use-targets service, the resistance locks, the open details and the declarations.
 * @param {FeatureContext} ctx
 */
export function createRuntime(ctx) {
  return {
    ctx,
    uses: ctx.services["use-targets"],
    /** Maneuver cards (B ids) with a resistance in progress on this client (Resistir and Dar passagem share it). */
    locks: new Set(),
    /** Maneuver and result cards whose details are open on this client (kept across re-renders). */
    expanded: new Set(),
    /** Maneuvers declared in the use dialog, by the per-use clone of ItemT20#roll (rollAttack → rollDamage → displayCard). */
    declarations: new WeakMap()
  };
}

export function isEnabled(rt) {
  try {
    return rt.ctx.setting(COMBAT_MANEUVERS_SETTING) === "on";
  } catch {
    return false;
  }
}

/** Whether the concealment rule is on (its checks show on the maneuver card). */
function concealmentEnabled(rt) {
  try {
    return rt.ctx.features.setting("concealment-miss-chance", CONCEALMENT_SETTING) === "on";
  } catch {
    return false;
  }
}

/** The miss chance only counts while the concealment rule is on (its checks are recorded only then). */
export function concealmentOf(rt, roll, targetUuid) {
  if (!concealmentEnabled(rt)) return null;
  return maneuverConcealment(roll, targetUuid);
}

export function fromUuid(rt, uuid) {
  try {
    return uuid ? rt.ctx.platform.documents.fromUuidSync(uuid) : null;
  } catch {
    return null;
  }
}

export function allMessages(rt) {
  const messages = rt.ctx.platform.documents.messages();
  return messages?.contents ?? [...(messages ?? [])];
}

/** The single selection of results used by every render and both checks of a resistance. */
export function visibleResults(rt, bId) {
  return selectVisibleResults(allMessages(rt), bId);
}

/** Shows a warning; returns null so a check can `return warn(...)`. */
export function warn(rt, key) {
  rt.ctx.platform.notify.warn(t(rt.ctx, `Warn.${key}`));
  return null;
}

export function canResist(rt, actor) {
  const { user, users } = rt.ctx.platform;
  return Boolean(user.isGM() || actor?.testUserPermission?.(users.current(), "OWNER"));
}

export const flagsOf = (message) => message?.flags?.[MODULE_ID];
