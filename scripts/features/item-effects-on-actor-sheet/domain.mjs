import { stripComments } from "../../lib/source.mjs";

/**
 * Groups the categorized effects by id, in render order (category key order, then insertion order).
 * @param {Record<string, {effects: object[]}>} categories
 * @returns {Map<string, object[]>}
 */
export function buildRowQueue(categories) {
  const queue = new Map();
  for (const category of Object.values(categories ?? {})) {
    for (const effect of category?.effects ?? []) {
      if (!queue.has(effect.id)) queue.set(effect.id, []);
      queue.get(effect.id).push(effect);
    }
  }
  return queue;
}

/**
 * Whether the effect is held by an item of the actor (not by the actor itself).
 * @param {{parent?: object}} effect
 * @param {object} actor
 * @returns {boolean}
 */
export function isItemHeldEffect(effect, actor) {
  return Boolean(effect?.parent) && effect.parent !== actor && effect.parent.documentName === "Item";
}

/**
 * Reads the sources of ActorSheetT20#getData (listing) and ActiveEffectT20.onManageActiveEffect (controls).
 * The patch fixes both, so a fix of the listing alone is not a fix. Comments are ignored, and unrecognized code
 * (for example another module's wrapper) gives "unknown". Only reading code, a fix is never high-confidence.
 * @param {string|undefined} getData
 * @param {string|undefined} manage
 * @returns {import("../../registry.mjs").Diagnosis}
 */
export function diagnoseItemEffectsSheet(getData, manage) {
  if (typeof getData !== "string") return { bug: "unknown", confidence: "low", evidence: "getData source unavailable" };
  const listing = stripComments(getData);
  if (/prepareActiveEffectCategories\(\s*this\.actor\.effects\s*\)/.test(listing)) {
    return { bug: "present", confidence: "high", evidence: "getData lists only actor.effects" };
  }
  if (!/allApplicableEffects\s*\(/.test(listing)) {
    return { bug: "unknown", confidence: "low", evidence: "getData source not recognized" };
  }
  const actions = typeof manage === "string" ? stripComments(manage) : "";
  if (/owner\.effects\.get\s*\(/.test(actions)) {
    return {
      bug: "present",
      confidence: "low",
      evidence: "getData uses allApplicableEffects, but effect controls still resolve through owner.effects"
    };
  }
  if (!/dataset\.action/.test(actions)) {
    return { bug: "unknown", confidence: "low", evidence: "onManageActiveEffect source not recognized" };
  }
  return {
    bug: "fixed",
    confidence: "low",
    evidence: "getData uses allApplicableEffects and effect controls no longer use owner.effects"
  };
}
