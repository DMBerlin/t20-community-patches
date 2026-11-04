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
import { wraps } from "../kernel/wrap.mjs";
import { UNASSIGNED, isArmorPenaltyReducer, parseReduction, computePenaltyAdjustments } from "../lib/armor-penalty.mjs";
import { resolveDataRefs } from "../lib/data-refs.mjs";

const PDA_KEY = "system.attributes.defesa.pda";
/**
 * Interprets how the actor's armor penalty field cleans a positive value (a reduction). A negative result is the
 * mechanism of the bug. Anything else only shows that the field changed, not that reductions now work (item
 * link, cap at 0, stored values), so it is never a high-confidence fix.
 * @param {unknown} cleaned  Result of `field.clean(1)` on `attributes.defesa.pda`.
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnosePenaltyField(cleaned) {
  if (typeof cleaned !== "number" || !Number.isFinite(cleaned)) {
    return { bug: "unknown", confidence: "low", evidence: `defesa.pda cleans 1 to ${cleaned}` };
  }
  const value = cleaned;
  if (value < 0) return { bug: "present", confidence: "high", evidence: "defesa.pda turns reductions into penalties" };
  return { bug: "fixed", confidence: "low", evidence: `defesa.pda keeps positive values (1 → ${value})` };
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
  return foundry.dice.Roll.create(resolveDataRefs(formula, data, foundry.dice.Roll.defaultImplementation)).evaluateSync().total;
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

  wraps.wrap(EffectClass, "applyChange", "armor-penalty-reduction", function (applyChange, targetDoc, change, options) {
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
  });

  wraps.wrap(ActorClass.prototype, "applyActiveEffects", "armor-penalty-reduction", function (applyActiveEffects, phase, ...args) {
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
  });

  // prepareDefense runs inside each actor type's TypeDataModel#prepareDerivedData.
  const prototypes = new Set(
    Object.values(CONFIG.Actor.dataModels ?? {})
      .map((cls) => cls?.prototype)
      .filter((proto) => proto && Object.hasOwn(proto, "prepareDerivedData"))
  );
  for (const proto of prototypes) {
    wraps.wrap(proto, "prepareDerivedData", "armor-penalty-reduction", function (prepareDerivedData, ...args) {
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
    });
  }
}

function isNeeded() {
  const field = CONFIG.Actor.dataModels?.character?.schema?.getField?.("attributes.defesa.pda");
  if (!field) return undefined;
  return diagnosePenaltyField(field.clean(1));
}

export default {
  id: "armor-penalty-reduction",
  group: "items",
  issue: 19,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  probeKind: "behavior",
  sources: ["PenaltyField#_cast", "CreatureData.schemaDefense", "AttributesFields.prepareDefense"],
  isNeeded,
  apply
};
