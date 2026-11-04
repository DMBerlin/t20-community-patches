import { computePenaltyAdjustments } from "../../lib/armor-penalty.mjs";

export const PDA_KEY = "system.attributes.defesa.pda";

/**
 * Interprets how the actor's armor penalty field cleans a positive value (a reduction). A negative result is the
 * mechanism of the bug. Anything else only shows that the field changed, not that reductions now work (item
 * link, cap at 0, stored values), so it is never a high-confidence fix.
 * @param {unknown} cleaned  Result of `field.clean(1)` on `attributes.defesa.pda`.
 * @returns {import("../../registry.mjs").Diagnosis}
 */
export function diagnosePenaltyField(cleaned) {
  if (typeof cleaned !== "number" || !Number.isFinite(cleaned)) {
    return { bug: "unknown", confidence: "low", evidence: `defesa.pda cleans 1 to ${cleaned}` };
  }
  const value = cleaned;
  if (value < 0) return { bug: "present", confidence: "high", evidence: "defesa.pda turns reductions into penalties" };
  return { bug: "fixed", confidence: "low", evidence: `defesa.pda keeps positive values (1 → ${value})` };
}

export function addTo(store, actor, key, amount) {
  const map = store.get(actor) ?? new Map();
  map.set(key, (map.get(key) ?? 0) + amount);
  store.set(actor, map);
}

/** @param {boolean} slots  Value of the system's "equipmentSlots" setting. */
export function equippedDefenseItems(actor, slots) {
  return (actor.itemTypes?.equipamento ?? []).filter((i) => (slots ? i.system.equipado2?.slot : i.system.equipado));
}

/**
 * Temporarily applies the reductions to the item data and cancels covered item increases on the actor.
 * Returns a function that restores the item data.
 * @param {{slots: boolean, increases: Map<string, number>|undefined}} state
 */
export function reduceItemPenalties(actor, system, reductions, { slots, increases = new Map() }) {
  const items = equippedDefenseItems(actor, slots).filter((i) => i.system.armadura);
  const fallback =
    items.find((i) => ["leve", "pesada"].includes(i.system.tipo)) ?? items.find((i) => i.system.tipo === "escudo");
  const penalties = new Map(items.map((i) => [i.id, i.system.armadura.penalidade]));
  const { items: reduced, actorDelta } = computePenaltyAdjustments(penalties, reductions, increases, fallback?.id ?? null);

  const defesa = system.attributes?.defesa;
  if (actorDelta && defesa) defesa.pda = Math.min(0, (Number(defesa.pda) || 0) + actorDelta);

  const restore = [];
  for (const [id, penalty] of reduced) {
    const armadura = actor.items.get(id).system.armadura;
    restore.push([armadura, armadura.penalidade]);
    armadura.penalidade = penalty;
  }
  return () => {
    for (const [armadura, original] of restore) armadura.penalidade = original;
  };
}
