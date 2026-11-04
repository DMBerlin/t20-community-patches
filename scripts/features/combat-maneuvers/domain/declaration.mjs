/** Pure declaration and visibility rules of "Manobras de combate" (#48). */
import { canSeeTokenName } from "../../../lib/targets.mjs";
import { FORM_KIND, FORM_VERSATILE, MANEUVERS } from "./maneuver.mjs";

/**
 * The recorded name of a target if the user may see it, else null. Ownership and display mode are read from the
 * live TokenDocument; a deleted token is not owned and keeps the recorded display mode.
 * @param {{name?: string, displayName?: number} | null} record
 * @param {{isGM: boolean, token?: {isOwner?: boolean, displayName?: number} | null}} viewer
 */
export function targetNameFor(record, { isGM, token = null }) {
  if (!record?.name) return null;
  const visible = canSeeTokenName({
    isGM,
    isOwner: Boolean(token?.isOwner),
    displayName: token ? token.displayName : record.displayName
  });
  return visible ? String(record.name) : null;
}

/**
 * Normalizes the choices of a maneuver dialog.
 * @param {{kind?: unknown, versatile?: unknown, other?: unknown}} raw
 * @param {{versatileAllowed?: boolean}} [options]
 * @returns {{kind: string|null, versatile: boolean, other: number}}
 */
export function parseManeuverChoice(raw, { versatileAllowed = true } = {}) {
  const kind = MANEUVERS.includes(raw?.kind) ? raw.kind : null;
  const other = Number(raw?.other);
  return { kind, versatile: versatileAllowed && !!raw?.versatile, other: Number.isFinite(other) ? Math.trunc(other) : 0 };
}

/**
 * The maneuver declared in the use dialog, or null (none chosen, or the shortcut without dialog).
 * @param {object} options  The use options (FormDataExtended object of the dialog).
 * @returns {{kind: string, versatile: boolean} | null}
 */
export function parseDeclaration(options, { versatileAllowed = true } = {}) {
  const kind = MANEUVERS.includes(options?.[FORM_KIND]) ? options[FORM_KIND] : null;
  return kind ? { kind, versatile: versatileAllowed && !!options?.[FORM_VERSATILE] } : null;
}

/**
 * Why a list of frozen targets cannot take a maneuver: "NoTarget", "ManyTargets", "SelfTarget" or null (valid).
 * @param {object[]} records
 * @param {(record: object) => boolean} [isSelf]
 */
export function targetProblem(records, isSelf = () => false) {
  if (!records?.length) return "NoTarget";
  if (records.length > 1) return "ManyTargets";
  return isSelf(records[0]) ? "SelfTarget" : null;
}

/**
 * Data a result message (C) copies from the visibility of the maneuver card (B): a whispered B keeps its readers;
 * otherwise the resister's message mode applies (null = apply the mode).
 * @returns {{whisper: string[], blind: boolean} | null}
 */
export function inheritedVisibility(card) {
  const whisper = Array.isArray(card?.whisper) ? card.whisper : [];
  return whisper.length ? { whisper: [...whisper], blind: !!card.blind } : null;
}

/** The attacker's token uuid: the actor's token, else the speaker's scene and token. */
export function attackerTokenUuid(speaker, actor) {
  if (actor?.token?.uuid) return actor.token.uuid;
  const { scene, token } = speaker ?? {};
  return scene && token ? `Scene.${scene}.Token.${token}` : null;
}
