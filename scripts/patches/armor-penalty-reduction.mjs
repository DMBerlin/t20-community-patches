/**
 * Armor penalty reduction upgrades (Ajustada, Sob Medida, Mitral).
 *
 * Bug (tormenta20 1.6.5): these upgrades add to `system.attributes.defesa.pda`, a PenaltyField that always
 * casts values to negative numbers. Every change therefore INCREASES the penalty: a Full Plate (-5) with
 * Ajustada shows -6 instead of -4.
 *
 * Fix: changes from these upgrades are intercepted and, while the actor's derived data is prepared, the
 * penalty of the item that carries the upgrade is temporarily reduced (never above 0). The stored item data
 * and the item sheet stay untouched; only the actor's armor penalty (skills and rolls) is corrected.
 * Penalty increases (Reforçada, Sobrecarregado, custom effects) keep the system's behavior.
 */

const PDA_KEY = "system.attributes.defesa.pda";
const UNASSIGNED = "";

export const REDUCERS = {
  identifiers: new Set(["adjusted", "undermeasure", "mithril"]),
  // Effect ids in the system compendium `tormenta20.efeitos` and the world copy `world.item-upgrades`.
  sourceIds: new Set(["w3JoRmXaQASrkEjH", "HvXw5DvWL1irkLkB", "K9RtA8a5aPdqyRUR"]),
  // Legacy effects without identifier (e.g. magic items from `tormenta20.equipamentos-magicos`).
  names: new Set(["ajustada", "ajustado", "sob medida", "mitral", "adjusted", "under measure", "mithril"])
};

/**
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
export function isArmorPenaltyReducer(effect) {
  if (!effect) return false;
  if (REDUCERS.identifiers.has(effect.system?.identifier)) return true;
  if (REDUCERS.identifiers.has(effect.flags?.tormenta20?.upgrade)) return true;
  const sourceId = String(effect._stats?.compendiumSource ?? "").split(".").pop();
  if (REDUCERS.sourceIds.has(sourceId)) return true;
  return REDUCERS.names.has(String(effect.name ?? "").trim().toLowerCase());
}

/**
 * The system data stores these reductions with inconsistent signs (-1 and 1), so the magnitude is used.
 * @param {number|string} value
 * @param {(formula: string) => number} [evaluate]  Evaluates non-numeric formulas.
 * @returns {number}
 */
export function parseReduction(value, evaluate) {
  let amount = Number(value);
  if (!Number.isFinite(amount) && evaluate) {
    try {
      amount = Number(evaluate(String(value)));
    } catch {
      amount = NaN;
    }
  }
  return Number.isFinite(amount) ? Math.abs(amount) : 0;
}

/**
 * @param {Map<string, number>} penalties   Current penalty by item id.
 * @param {Map<string, number>} reductions  Reduction by item id (UNASSIGNED for effects without item).
 * @param {string|null} fallbackId          Item receiving unassigned reductions (equipped armor or shield).
 * @returns {Map<string, number>}           New penalty by item id, only for changed items.
 */
export function computeReducedPenalties(penalties, reductions, fallbackId) {
  const byItem = new Map();
  for (const [id, amount] of reductions) {
    const target = id === UNASSIGNED ? fallbackId : id;
    if (!target || !penalties.has(target)) continue;
    byItem.set(target, (byItem.get(target) ?? 0) + amount);
  }
  const result = new Map();
  for (const [id, amount] of byItem) {
    const penalty = Number(penalties.get(id)) || 0;
    result.set(id, Math.min(0, penalty + amount));
  }
  return result;
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

/** @type {WeakMap<Actor, Map<string, number>>} */
const reductionsByActor = new WeakMap();
const preparing = new WeakSet();

function resolveItemId(actor, effect) {
  const Item = foundry.documents.Item;
  if (effect.parent instanceof Item && effect.parent.parent === actor) return effect.parent.id;
  if (effect.origin) {
    try {
      const origin = foundry.utils.fromUuidSync(effect.origin, { strict: false });
      if (origin instanceof Item && origin.parent === actor) return origin.id;
    } catch {
      /* origin not resolvable synchronously */
    }
  }
  return UNASSIGNED;
}

function recordReduction(actor, change, options) {
  const amount = parseReduction(change.value, (formula) =>
    Roll.safeEval(Roll.replaceFormulaData(formula, options?.replacementData ?? actor.getRollData()))
  );
  if (!amount) return;
  const reductions = reductionsByActor.get(actor) ?? new Map();
  const itemId = resolveItemId(actor, change.effect);
  reductions.set(itemId, (reductions.get(itemId) ?? 0) + amount);
  reductionsByActor.set(actor, reductions);
}

function equippedDefenseItems(actor) {
  const slots = game.settings.get("tormenta20", "equipmentSlots");
  return (actor.itemTypes?.equipamento ?? []).filter((i) => (slots ? i.system.equipado2?.slot : i.system.equipado));
}

/** Temporarily applies the reductions to the item data. Returns a function that restores it. */
function reduceItemPenalties(actor, reductions) {
  const items = equippedDefenseItems(actor).filter((i) => i.system.armadura);
  const fallback =
    items.find((i) => ["leve", "pesada"].includes(i.system.tipo)) ?? items.find((i) => i.system.tipo === "escudo");
  const penalties = new Map(items.map((i) => [i.id, i.system.armadura.penalidade]));
  const reduced = computeReducedPenalties(penalties, reductions, fallback?.id ?? null);

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

function apply() {
  const EffectClass = CONFIG.ActiveEffect.documentClass;
  const ActorClass = CONFIG.Actor.documentClass;

  const applyChange = EffectClass.applyChange;
  EffectClass.applyChange = function (targetDoc, change, options) {
    if (
      change?.key === PDA_KEY &&
      change.type === "add" &&
      targetDoc instanceof foundry.documents.Actor &&
      isArmorPenaltyReducer(change.effect)
    ) {
      return recordReduction(targetDoc, change, options);
    }
    return applyChange.call(this, targetDoc, change, options);
  };

  const applyActiveEffects = ActorClass.prototype.applyActiveEffects;
  ActorClass.prototype.applyActiveEffects = function (phase, ...args) {
    if (phase === "initial") reductionsByActor.delete(this);
    return applyActiveEffects.call(this, phase, ...args);
  };

  // prepareDefense runs inside each actor type's TypeDataModel#prepareDerivedData.
  const prototypes = new Set(
    Object.values(CONFIG.Actor.dataModels ?? {})
      .map((cls) => cls?.prototype)
      .filter((proto) => proto && Object.hasOwn(proto, "prepareDerivedData"))
  );
  for (const proto of prototypes) {
    const prepareDerivedData = proto.prepareDerivedData;
    proto.prepareDerivedData = function (...args) {
      const actor = this.parent;
      const reductions = actor && reductionsByActor.get(actor);
      if (!reductions?.size || preparing.has(actor)) return prepareDerivedData.apply(this, args);
      preparing.add(actor);
      const restore = reduceItemPenalties(actor, reductions);
      try {
        return prepareDerivedData.apply(this, args);
      } finally {
        restore();
        preparing.delete(actor);
      }
    };
  }
}

export default {
  id: "armor-penalty-reduction",
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  apply
};
