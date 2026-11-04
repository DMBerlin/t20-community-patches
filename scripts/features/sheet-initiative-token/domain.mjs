import { stripComments } from "../../lib/source.mjs";

export const INITIATIVE_KEY = "inic";

/**
 * @typedef {object} CombatantInfo
 * @property {string} id
 * @property {string|null} [actorId]
 * @property {string|null} [tokenId]
 * @property {string|null} [sceneId]
 * @property {boolean} [linked]           The combatant represents the world actor (linked token or no token).
 * @property {number|null} [initiative]
 * @property {boolean} [isOwner]
 */

/**
 * Combatants that a roll of the Initiative skill sets, following core Actor#rollInitiative: a token's actor sets the
 * combatants of that token; any other actor sets its combatants without token or with a linked token. When the actor
 * has none of those and exactly one combatant of it is in the combat (an unlinked token), that one is used, as the
 * system did. Only combatants without initiative that the user owns are returned.
 * @param {object} args
 * @param {{id: string, isToken?: boolean, tokenId?: string|null, sceneId?: string|null}} args.actor
 * @param {CombatantInfo[]} args.combatants
 * @returns {string[]} Combatant ids.
 */
export function initiativeTargets({ actor, combatants }) {
  const list = Array.isArray(combatants) ? combatants : [];
  let matches;
  if (actor?.isToken) {
    matches = list.filter(
      (c) => !!c.tokenId && c.tokenId === actor.tokenId && (!c.sceneId || !actor.sceneId || c.sceneId === actor.sceneId)
    );
  } else {
    const own = list.filter((c) => !!c.actorId && c.actorId === actor?.id);
    matches = own.filter((c) => !c.tokenId || c.linked);
    if (!matches.length && own.length === 1) matches = own;
  }
  return matches.filter((c) => c.initiative === null && c.isOwner !== false).map((c) => c.id);
}

/**
 * The roll total of the chat message the system created for the skill roll.
 * @param {{rolls?: {total?: number}[], flags?: {tormenta20?: {rollTotal?: number}}}|undefined} message
 * @returns {number|null}
 */
export function rollTotal(message) {
  const total = message?.rolls?.[0]?.total ?? message?.flags?.tormenta20?.rollTotal;
  return Number.isFinite(total) ? total : null;
}

/**
 * Whether a Combat#setInitiative call is the one toInitiative makes: on the active combat, for a combatant without
 * initiative whose actor has an Initiative roll in flight.
 * @param {object} args
 * @param {Iterable<string>} args.pending   Actor ids with an Initiative roll in flight.
 * @param {string|null|undefined} args.actorId  Id of the combatant's actor.
 * @param {number|null|undefined} args.initiative
 * @param {boolean} args.active             The combat is game.combats.active.
 * @returns {boolean}
 */
export function suppressesSetInitiative({ pending, actorId, initiative, active }) {
  return !!active && initiative === null && !!actorId && [...(pending ?? [])].includes(actorId);
}

/**
 * Whether a call stack comes from the system's toInitiative closure (V8 "at toInitiative (" or Firefox/Safari
 * "toInitiative@"). Without a readable stack it answers true, so the system's wrong write stays suppressed.
 * @param {unknown} stack
 * @returns {boolean}
 */
export function fromToInitiative(stack) {
  if (typeof stack !== "string" || !stack) return true;
  return /(?:^|[\s.])toInitiative(?: \(|@)/m.test(stack);
}

/**
 * Reads the source of the system's rollPericia. Source reading never proves a fix, so it never returns fixed/high.
 * @param {string|undefined} source
 * @returns {import("../../registry.mjs").Diagnosis}
 */
export function diagnoseSource(source) {
  if (typeof source !== "string") return { bug: "unknown", confidence: "low", evidence: "rollPericia not found" };
  const code = stripComments(source);
  if (!/\bsetInitiative\s*\(/.test(code)) {
    return { bug: "unknown", confidence: "low", evidence: "setInitiative call not found in rollPericia" };
  }
  const found = [
    /\.actor\.id\s*===\s*actor\.id\b/.test(code) && "combatant matched by actor id",
    /\.label\s*===\s*["']Iniciativa["']/.test(code) && 'skill matched by the label "Iniciativa"'
  ].filter(Boolean);
  if (found.length === 2) return { bug: "present", confidence: "high", evidence: found.join(", ") };
  if (found.length) return { bug: "present", confidence: "low", evidence: found.join(", ") };
  return { bug: "fixed", confidence: "low", evidence: "combatant and skill matching not recognized" };
}

export const ROLL_PERICIA = "ActorT20#rollPericia";
