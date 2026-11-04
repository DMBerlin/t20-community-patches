/**
 * Item chat cards and the actor side of the fold: which armor prepareDefense reads and which changes it skips.
 */
import { ARMOR_TIPOS, DEFENSE_KEY, PDA_KEY, armorAmount } from "./classify.mjs";

/**
 * Whether the actor must skip a change already folded into the item (mode "effective").
 * `consumed`: the item is the armor or shield that prepareDefense reads (consumedArmorIds); the folded values of
 * any other one never reach the actor, so its changes must keep applying.
 * @param {{mode: string, key?: string, change?: import("./classify.mjs").Change, targetIsActor: boolean,
 *   ownedByTarget: boolean, consumed?: boolean, itemType?: string, tipo?: string, hasStatus: boolean, onuse?: boolean,
 *   folded?: {value?: boolean, penalty?: boolean}}} p
 */
export function shouldSkipFoldedChange({ mode, change, targetIsActor, ownedByTarget, consumed, itemType, tipo, hasStatus, onuse, folded }) {
  if (mode !== "effective" || !targetIsActor || !ownedByTarget || !consumed || !folded) return false;
  if (change?.key !== PDA_KEY && change?.key !== DEFENSE_KEY) return false;
  if (itemType !== "equipamento" || !ARMOR_TIPOS.has(tipo) || hasStatus || onuse) return false;
  if (!Number.isFinite(armorAmount(change))) return false;
  return change.key === PDA_KEY ? folded.penalty === true : folded.value === true;
}

/**
 * Ids of the armor and shield read by AttributesFields.prepareDefense (T20:19876-19897): the first equipped
 * "leve"/"pesada" and the first equipped "escudo", in itemTypes order.
 * @param {Array<{id: string, system: object}>} equipment   actor.itemTypes.equipamento
 * @param {boolean} equipmentSlots   Setting tormenta20.equipmentSlots
 */
export function consumedArmorIds(equipment, equipmentSlots) {
  const equipped = (equipment ?? []).filter((i) => (equipmentSlots ? i?.system?.equipado2?.slot : i?.system?.equipado));
  const armor = equipped.find((i) => ["leve", "pesada"].includes(i.system.tipo));
  const shield = equipped.find((i) => i.system.tipo === "escudo");
  return new Set([armor?.id, shield?.id].filter(Boolean));
}

/** Item and actor ids of an item chat card (templates/chat/chat-card.hbs:1), without parsing HTML. */
export function parseItemCard(content) {
  const tag = String(content ?? "").match(/<div\b[^>]*\bclass="[^"]*\bitem-card\b[^"]*"[^>]*>/);
  if (!tag) return null;
  const itemId = tag[0].match(/\bdata-item-id="([^"]*)"/)?.[1];
  if (!itemId) return null;
  return { itemId, actorId: tag[0].match(/\bdata-actor-id="([^"]*)"/)?.[1] };
}
