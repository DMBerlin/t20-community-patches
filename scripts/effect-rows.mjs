/**
 * Helpers shared by patches that act on the effect rows of `templates/partials/active-effects.hbs`.
 */

/**
 * Parses an effect uuid relative to its owner document.
 * @param {string} uuid        e.g. "Actor.A.Item.I.ActiveEffect.E"
 * @param {string} ownerUuid   e.g. "Actor.A"
 * @returns {{itemId?: string, effectId: string}|null}
 */
export function parseOwnedEffectUuid(uuid, ownerUuid) {
  if (!uuid || !ownerUuid || !uuid.startsWith(`${ownerUuid}.`)) return null;
  const parts = uuid.slice(ownerUuid.length + 1).split(".");
  if (parts.length === 2 && parts[0] === "ActiveEffect") return { effectId: parts[1] };
  if (parts.length === 4 && parts[0] === "Item" && parts[2] === "ActiveEffect") {
    return { itemId: parts[1], effectId: parts[3] };
  }
  return null;
}

/**
 * Resolves the ActiveEffect of an effect row: `data-effect-uuid` (set by item-effects-on-actor-sheet) first,
 * then `owner.effects.get(data-effect-id)` (system behaviour).
 * @param {HTMLElement} li
 * @param {foundry.abstract.Document} owner  Actor or Item that owns the sheet (or the effect parent)
 * @returns {ActiveEffect|null}
 */
export function resolveEffectFromRow(li, owner) {
  const uuid = li?.dataset?.effectUuid;
  if (uuid) {
    const parsed = parseOwnedEffectUuid(uuid, owner?.uuid);
    if (parsed) {
      const parent = parsed.itemId ? owner.items?.get(parsed.itemId) : owner;
      return parent?.effects?.get(parsed.effectId) ?? null;
    }
    try {
      // strict:false – fromUuidSync throws for embedded documents of compendium actors otherwise.
      return globalThis.foundry?.utils?.fromUuidSync(uuid, { strict: false }) ?? null;
    } catch {
      return null;
    }
  }
  const id = li?.dataset?.effectId;
  return id ? (owner?.effects?.get(id) ?? null) : null;
}
