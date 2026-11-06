import { stripComments } from "../../lib/source.mjs";

export const KEY = "isSuppressedByUpgrade";
export const DUPLICATE_KEY = "isSuppressedByDuplicated";

/** Book chain, JdA v1.3 p. 394: "Se ficar fatigado novamente, em vez disso fica exausto", and so on. */
export const UPGRADE_CHAIN = Object.freeze({
  abalado: "apavorado",
  debilitado: "inconsciente",
  exausto: "inconsciente",
  fatigado: "exausto",
  fraco: "debilitado",
  frustrado: "esmorecido"
});

/** Getter of tormenta20 1.6.5–1.6.6 (T20:16649), without comments and whitespace. */
export const KNOWN_GETTER =
  "getisSuppressedByUpgrade(){constactor=this.parent.actor;consthasUpgrade=!!this.status.upgrade;" +
  "returnhasUpgrade&&actor.statuses.has(this.status.upgrade);}";

/**
 * The status that suppresses a condition: the stored link wins; an empty one falls back to the book's chain.
 * @param {{upgrade?: string}|null|undefined} status  `system.status` of the effect.
 * @param {string|undefined} statusId                   The effect's first status.
 * @returns {string} "" when the condition has no upgrade.
 */
export function upgradeOf(status, statusId) {
  if (!status) return "";
  if (status.upgrade) return status.upgrade;
  return (statusId && Object.hasOwn(UPGRADE_CHAIN, statusId) && UPGRADE_CHAIN[statusId]) || "";
}

/**
 * Whether another active effect carries the status, regardless of the order the actor applies its effects.
 * @param {Iterable<{statuses?: Set<string>, active?: boolean}>} effects  Actor#allApplicableEffects().
 * @param {string} statusId
 * @param {object} self  The suppressed effect, ignored.
 */
export function hasActiveStatus(effects, statusId, self) {
  for (const effect of effects) {
    if (effect === self || !effect?.statuses?.has?.(statusId)) continue;
    if (effect.active) return true;
  }
  return false;
}

/**
 * The system's duplicate rule (a newer effect with the same status suppresses the older one), except that a newer
 * effect whose origin condition is inactive does not count: it is a child of a suppressed condition.
 * @param {Iterable<object>} effects  `actor.effects`.
 * @param {object} self               The effect being evaluated.
 * @param {string|undefined} statusId Its first status.
 * @param {(effect: object) => boolean} inherited  Whether an effect is suppressed by inheritance.
 */
export function hasNewerDuplicate(effects, self, statusId, inherited) {
  const createdTime = self?._stats?.createdTime;
  for (const effect of effects) {
    if (effect?.id === self?.id || !effect?.statuses?.has?.(statusId)) continue;
    if (!(effect._stats?.createdTime > createdTime)) continue;
    if (!inherited(effect)) return true;
  }
  return false;
}

export function normalizeSource(source) {
  return typeof source === "string" ? stripComments(source).replace(/\s+/g, "") : "";
}

export function diagnose(source) {
  if (normalizeSource(source) !== KNOWN_GETTER) {
    return { bug: "unknown", confidence: "low", evidence: "isSuppressedByUpgrade implementation not recognized" };
  }
  // low: the source shows the order defect, not the empty pack data nor the duplicate case (AGENTS.md, Diagnosis).
  return {
    bug: "present",
    confidence: "low",
    evidence: "isSuppressedByUpgrade reads actor.statuses, which is filled while the effects are applied"
  };
}

export function findDescriptor(proto, key) {
  for (let p = proto; p; p = Object.getPrototypeOf(p)) {
    const descriptor = Object.getOwnPropertyDescriptor(p, key);
    if (descriptor) return descriptor;
  }
  return undefined;
}
