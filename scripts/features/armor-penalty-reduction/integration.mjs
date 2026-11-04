import { UNASSIGNED, isArmorPenaltyReducer, parseReduction } from "../../lib/armor-penalty.mjs";
import { resolveDataRefs } from "../../lib/data-refs.mjs";
import { PDA_KEY, addTo, diagnosePenaltyField, reduceItemPenalties } from "./domain.mjs";

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const { platform } = ctx;
  const EffectClass = platform.classes.activeEffect;
  const ActorClass = platform.classes.actor;

  /** @type {WeakMap<Actor, Map<string, number>>} */
  const reductionsByActor = new WeakMap();
  /** @type {WeakMap<Actor, Map<string, number>>} */
  const increasesByActor = new WeakMap();
  /** Phase being applied by Actor#applyActiveEffects ("initial", "final", ...). */
  let currentPhase = null;
  let warnedPhase = false;
  const preparing = new WeakSet();

  function resolveItemId(actor, effect) {
    const Item = platform.core.Item;
    if (effect.parent instanceof Item && effect.parent.parent === actor) return effect.parent.id;
    if (effect.origin) {
      try {
        const origin = platform.documents.fromUuidSync(effect.origin, { strict: false });
        if (origin instanceof Item && origin.parent === actor) return origin.id;
      } catch {
        /* origin not resolvable synchronously */
      }
    }
    return UNASSIGNED;
  }

  /** Evaluates like core's NumberField (Roll parser), never as raw JavaScript. */
  function evaluateFormula(actor, formula, options) {
    const data = options?.replacementData ?? actor.getRollData();
    const Roll = platform.dice.Roll;
    return Roll.create(resolveDataRefs(formula, data, Roll.defaultImplementation)).evaluateSync().total;
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

  ctx.wrap(EffectClass, "applyChange", function (applyChange, targetDoc, change, options) {
    if (change?.key === PDA_KEY && change.type === "add" && targetDoc instanceof platform.core.Actor) {
      const reducer = isArmorPenaltyReducer(change.effect);
      // Reductions are applied while derived data is prepared, so only initial-phase changes can be corrected.
      // Later phases keep the system's behavior.
      if (reducer && currentPhase === "initial") return recordReduction(targetDoc, change, options);
      if (reducer && !warnedPhase) {
        warnedPhase = true;
        ctx.log.warn(`"${change.effect?.name}" uses phase "${currentPhase}"; only "initial" is corrected.`);
      }
      if (!reducer && currentPhase === "initial") recordIncrease(targetDoc, change, options);
    }
    return applyChange.call(this, targetDoc, change, options);
  });

  ctx.wrap(ActorClass.prototype, "applyActiveEffects", function (applyActiveEffects, phase, ...args) {
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
    Object.values(platform.config.document("Actor")?.dataModels ?? {})
      .map((cls) => cls?.prototype)
      .filter((proto) => proto && Object.hasOwn(proto, "prepareDerivedData"))
  );
  for (const proto of prototypes) {
    ctx.wrap(proto, "prepareDerivedData", function (prepareDerivedData, ...args) {
      const actor = this.parent;
      const reductions = actor && reductionsByActor.get(actor);
      if (!reductions?.size || preparing.has(actor)) return prepareDerivedData.apply(this, args);
      preparing.add(actor);
      const slots = platform.settingsOf("tormenta20").get("equipmentSlots");
      const restore = reduceItemPenalties(actor, this, reductions, { slots, increases: increasesByActor.get(actor) });
      try {
        return prepareDerivedData.apply(this, args);
      } finally {
        restore();
        preparing.delete(actor);
      }
    });
  }
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const field = ctx.platform.config.document("Actor")?.dataModels?.character?.schema?.getField?.("attributes.defesa.pda");
  if (!field) return undefined;
  return diagnosePenaltyField(field.clean(1));
}
