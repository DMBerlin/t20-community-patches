/**
 * Pure part of the target handling of chat-card rules (#87); the per-use state is the use-targets service
 * (scripts/services/use-targets.mjs).
 */

/** CONST.TOKEN_DISPLAY_MODES.HOVER and ALWAYS: the only modes the canvas shows to users who do not own the token. */
export const PUBLIC_NAME_MODES = new Set([30, 50]);

/** @typedef {{uuid: string, name: string, displayName: number}} TargetRecord */

/** Purposes a caller can attach to the next item use (see the withUsePurpose of the use-targets service). */
export const USE_PURPOSES = Object.freeze({ MANEUVER_RESISTANCE: "maneuver-resistance" });

/**
 * What a card stores about a target. Accepts a Token or a TokenDocument.
 * @returns {TargetRecord | null}
 */
export function targetRecord(token) {
  const doc = token?.document ?? token;
  if (!doc?.uuid) return null;
  return { uuid: doc.uuid, name: String(doc.name ?? ""), displayName: Number(doc.displayName ?? 0) };
}

/**
 * Chat policy for a target's name: GM, owner of the token, or a mode that shows the name to everyone.
 * The name shown is always the recorded one; isOwner and displayName are read live (recorded if the token is gone).
 * @param {{isGM: boolean, isOwner: boolean, displayName: unknown}} params
 */
export function canSeeTokenName({ isGM, isOwner, displayName }) {
  return Boolean(isGM || isOwner || PUBLIC_NAME_MODES.has(Number(displayName)));
}
