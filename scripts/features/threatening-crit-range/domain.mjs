import { isThreatMultiply, rewriteThreatChanges } from "../../lib/threat.mjs";

/**
 * Returns a copy of one of the weapon's own usage effects with its threat range multiplications rewritten, or the
 * effect itself when there is nothing to rewrite or it cannot be cloned.
 * The changes go as clone data (clone() rebuilds from the source), so the copy keeps what earlier wrappers did to
 * the prepared changes and later clones keep the rewrite.
 * @param {object} effect
 * @param {object} weapon   The rolled weapon (clone made by ItemT20#roll)
 */
export function adjustThreatEffect(effect, weapon) {
  const changes = effect?.system?.changes;
  if (!Array.isArray(changes) || !changes.some(isThreatMultiply) || typeof effect.clone !== "function") return effect;
  try {
    const rewritten = rewriteThreatChanges(changes, weapon?.system?.criticoM);
    if (!rewritten.count) return effect;
    return effect.clone({ system: { changes: rewritten.changes } }, { keepId: true });
  } catch (err) {
    console.warn("t20-community-patches | threatening-crit-range: could not adjust", effect?.uuid, err);
    return effect;
  }
}
