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
 * Computes the corrected penalties. Each reduction lowers the penalty of the item that carries it, down to 0.
 * The item's combined penalty is its base penalty plus the increases from its own upgrades (e.g. Reforçada),
 * which the system applies to the actor's `defesa.pda`. A reduction larger than the base penalty therefore
 * also cancels those increases, through `actorDelta`. Increases without an item (e.g. Sobrecarregado) are never
 * cancelled.
 * @param {Map<string, number>} penalties   Base penalty (<= 0) by equipped item id.
 * @param {Map<string, number>} reductions  Reduction magnitude by item id (UNASSIGNED for effects without item).
 * @param {Map<string, number>} increases   Penalty increase magnitude applied to the actor, by item id.
 * @param {string|null} fallbackId          Item receiving unassigned reductions (equipped armor or shield).
 * @returns {{items: Map<string, number>, actorDelta: number}}
 *          New base penalty by item id (only changed items) and the amount to add to the actor's `defesa.pda`.
 */
export function computePenaltyAdjustments(penalties, reductions, increases = new Map(), fallbackId = null) {
  const byItem = new Map();
  for (const [id, amount] of reductions) {
    const target = id === UNASSIGNED ? fallbackId : id;
    if (!target || !penalties.has(target)) continue;
    byItem.set(target, (byItem.get(target) ?? 0) + amount);
  }
  const items = new Map();
  let actorDelta = 0;
  for (const [id, amount] of byItem) {
    const penalty = Number(penalties.get(id)) || 0;
    items.set(id, Math.min(0, penalty + amount));
    const leftover = Math.max(0, amount + penalty);
    actorDelta += Math.min(leftover, increases.get(id) ?? 0);
  }
  return { items, actorDelta };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

/** @type {WeakMap<Actor, Map<string, number>>} */
const reductionsByActor = new WeakMap();
/** @type {WeakMap<Actor, Map<string, number>>} */
const increasesByActor = new WeakMap();
/** Phase being applied by Actor#applyActiveEffects ("initial", "final", ...). */
let currentPhase = null;
let warnedPhase = false;
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
  const amount = parseReduction(change.value, (formula) => evaluateFormula(actor, formula, options));
  if (!amount) return;
  addTo(reductionsByActor, actor, resolveItemId(actor, change.effect), amount);
}

/** Records an item's own penalty increase. The system still applies it; it is only tracked. */
function recordIncrease(actor, change, options) {
  const itemId = resolveItemId(actor, change.effect);
  if (itemId === UNASSIGNED) return;
  const amount = parseReduction(change.value, (formula) => evaluateFormula(actor, formula, options));
  if (amount) addTo(increasesByActor, actor, itemId, amount);
}

/** Evaluates like core's NumberField (Roll parser), never as raw JavaScript. */
function evaluateFormula(actor, formula, options) {
  const data = options?.replacementData ?? actor.getRollData();
  return foundry.dice.Roll.create(resolveDataRefs(formula, data)).evaluateSync().total;
}

/** Mirrors core DataField#_replaceDataRefs: recursive, throws on unresolved references. */
export function resolveDataRefs(raw, data, RollClass = foundry.dice.Roll.defaultImplementation) {
  const resolved = RollClass.replaceFormulaData(raw, data, { recursive: true });
  if (resolved.replace(/@\w+\[[^#\]]+]/g, "").includes("@")) {
    throw new Error(`Unable to replace all data references in ${JSON.stringify(raw)}`);
  }
  return resolved;
}

function addTo(store, actor, key, amount) {
  const map = store.get(actor) ?? new Map();
  map.set(key, (map.get(key) ?? 0) + amount);
  store.set(actor, map);
}

function equippedDefenseItems(actor) {
  const slots = game.settings.get("tormenta20", "equipmentSlots");
  return (actor.itemTypes?.equipamento ?? []).filter((i) => (slots ? i.system.equipado2?.slot : i.system.equipado));
}

/**
 * Temporarily applies the reductions to the item data and cancels covered item increases on the actor.
 * Returns a function that restores the item data.
 */
function reduceItemPenalties(actor, system, reductions) {
  const items = equippedDefenseItems(actor).filter((i) => i.system.armadura);
  const fallback =
    items.find((i) => ["leve", "pesada"].includes(i.system.tipo)) ?? items.find((i) => i.system.tipo === "escudo");
  const penalties = new Map(items.map((i) => [i.id, i.system.armadura.penalidade]));
  const increases = increasesByActor.get(actor) ?? new Map();
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

function apply() {
  const EffectClass = CONFIG.ActiveEffect.documentClass;
  const ActorClass = CONFIG.Actor.documentClass;

  const applyChange = EffectClass.applyChange;
  EffectClass.applyChange = function (targetDoc, change, options) {
    if (change?.key === PDA_KEY && change.type === "add" && targetDoc instanceof foundry.documents.Actor) {
      const reducer = isArmorPenaltyReducer(change.effect);
      // Reductions are applied while derived data is prepared, so only initial-phase changes can be corrected.
      // Later phases keep the system's behavior.
      if (reducer && currentPhase === "initial") return recordReduction(targetDoc, change, options);
      if (reducer && !warnedPhase) {
        warnedPhase = true;
        console.warn(`t20-community-patches | armor-penalty-reduction: "${change.effect?.name}" uses phase "${currentPhase}"; only "initial" is corrected.`);
      }
      if (!reducer && currentPhase === "initial") recordIncrease(targetDoc, change, options);
    }
    return applyChange.call(this, targetDoc, change, options);
  };

  const applyActiveEffects = ActorClass.prototype.applyActiveEffects;
  ActorClass.prototype.applyActiveEffects = function (phase, ...args) {
    if (phase === "initial") {
      reductionsByActor.delete(this);
      increasesByActor.delete(this);
    }
    const previous = currentPhase;
    currentPhase = phase;
    try {
      return applyActiveEffects.call(this, phase, ...args);
    } finally {
      currentPhase = previous;
    }
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
      const restore = reduceItemPenalties(actor, this, reductions);
      try {
        return prepareDerivedData.apply(this, args);
      } finally {
        restore();
        preparing.delete(actor);
      }
    };
  }
}

/**
 * The bug exists while the actor's armor penalty field turns every value (including reductions) negative.
 * @returns {boolean|undefined}
 */
function isNeeded() {
  const field = CONFIG.Actor.dataModels?.character?.schema?.getField?.("attributes.defesa.pda");
  if (!field) return undefined;
  return field.clean(1) < 0;
}

export default {
  id: "armor-penalty-reduction",
  group: "items",
  issue: 19,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  apply
};
