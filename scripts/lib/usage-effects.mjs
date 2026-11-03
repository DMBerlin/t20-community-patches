/** Usage effects of items, skills and attributes, shared by several features. */

/**
 * Suppressed usage effects (tormenta20 1.6.5).
 *
 * Bug: usage effects (system.onuse) held by unequipped weapons/equipment are still offered in the usage
 * dialog and auto-applied ("Aplicar Sempre") on item, skill and attribute rolls, although the same effects are
 * shown as suppressed and give no passive bonus.
 *
 * Fix: usage effects held by another item whose effects are suppressed (ItemT20#areEffectsSuppressed or
 * ActiveEffect#isSuppressed) are removed from the applicable lists. The rolled item's own effects and the
 * actor's own effects are kept.
 */

/**
 * @param {object} effect                 ActiveEffect
 * @param {string|null} rolledItemId      Id of the rolled item (null for skill/attribute rolls)
 * @returns {boolean}
 */
export function isSuppressedUsageEffect(effect, rolledItemId) {
  if (!effect?.system?.onuse) return false;
  const parent = effect.parent;
  if (parent?.documentName !== "Item") return false;
  if (rolledItemId && parent.id === rolledItemId) return false;
  return Boolean(effect.isSuppressed || parent.areEffectsSuppressed);
}

/**
 * Usage effects of a skill or attribute roll, filtered as ActorT20#rollPericia/rollAtributo do.
 * @param {Iterable<[string, object]>} entries  actor.traverseEmbeddedDocuments().
 * @param {{type: "skill"|"ability", name?: string}} params
 */
export function pseudoItemEffects(entries, { type, name }) {
  const effects = [];
  for (const [path, doc] of entries) {
    if (doc?.documentName !== "ActiveEffect") continue;
    if (doc.isTemporary && path !== "effects") continue;
    if (!doc.system?.onuse) continue;
    const { types, names } = doc.system.abilityUse ?? {};
    if (!types?.has?.(type)) continue;
    if (names?.size && !names.has(name)) continue;
    effects.push(doc);
  }
  return effects;
}

/**
 * Whether ItemT20#roll will skip the dialog and apply only the "Aplicar Sempre" effects, as the system decides.
 * @param {{usageDefault: boolean, shiftKey: boolean, hasEffectsOrRolls: boolean}} params
 */
export function skipsDialog({ usageDefault, shiftKey, hasEffectsOrRolls }) {
  return !(hasEffectsOrRolls && (usageDefault ? !shiftKey : shiftKey));
}
