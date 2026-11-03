/** Conditions of CONFIG.statusEffects, read through parameters. */

/**
 * Source data of the conditions the system builds on "ready" from world.statuses (1.6.6+:
 * `CONFIG.statusEffects[id]._source`), keyed by status id. Null until every id in `ids` has its source: the system
 * fills CONFIG.statusEffects one condition at a time, so a partial map is not read.
 * @param {string[]} ids
 * @param {unknown} statusEffects  CONFIG.statusEffects (an object in Tormenta20, an array in core).
 * @returns {Record<string, object>|null}
 */
export function statusEffectSources(ids, statusEffects) {
  if (!statusEffects || typeof statusEffects !== "object") return null;
  const sources = {};
  for (const status of Array.isArray(statusEffects) ? statusEffects : Object.values(statusEffects)) {
    if (typeof status?.id === "string" && status._source && typeof status._source === "object") {
      sources[status.id] = status._source;
    }
  }
  return ids.every((id) => Object.hasOwn(sources, id)) ? sources : null;
}
