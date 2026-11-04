/**
 * State of one installation: what "effective" mode folded into each prepared item, and the roll clones that keep the
 * base critical. Created by install(ctx) (or by a test) with the readers it needs; nothing lives at module level.
 */
import {
  ARMOR_TIPOS,
  DEFAULT_MODE,
  applyCritEffects,
  baseOf,
  bearerEffects,
  canFoldDefense,
  canFoldPenalty,
  classifyItemEffects,
  computeEffectiveStats,
  consumedArmorIds,
  describeItemEffects,
  linkedPdaCount,
  planCritFold,
  prepRollEffects,
  statChanged
} from "../domain/index.mjs";

/**
 * @typedef {object} EngineDeps
 * @property {() => string} [mode]       Current mode of the rule.
 * @property {() => {penaltyFix?: boolean, threatFix?: boolean}} [patches]  Patches the fold follows.
 * @property {import("../domain/describe.mjs").UsageLimits} [usage]
 * @property {() => Function|undefined} [parseUuid]   foundry.utils.parseUuid
 * @property {() => boolean} [equipmentSlots]         Setting tormenta20.equipmentSlots (may throw).
 * @property {{error: Function}} [log]
 */

/** @param {EngineDeps} [deps] */
export function createEngine({
  mode = () => DEFAULT_MODE,
  patches = () => ({}),
  usage = {},
  parseUuid = () => undefined,
  equipmentSlots = () => false,
  log = { error: () => {} }
} = {}) {
  /** Effective-mode state of each prepared item: what was folded. @type {WeakMap<object, {value?: boolean, penalty?: boolean, crit?: boolean}>} */
  const folded = new WeakMap();
  /** Roll clones that keep the base critical (their chain stays on the roll). */
  const keepsBase = new WeakSet();

  const describe = (item) => describeItemEffects(item, usage);

  /** Whether prepareDefense reads this armor (always true outside an actor: nothing else reads it there). */
  function isConsumedArmor(item) {
    const actor = item?.parent;
    if (!actor || actor.documentName !== "Actor") return true;
    let slots = false;
    try {
      slots = !!equipmentSlots();
    } catch {
      slots = false;
    }
    return consumedArmorIds(actor.itemTypes?.equipamento, slots).has(item.id);
  }

  /**
   * Effective stats of an item, with the "applied on the roll" note when the critical chain was not folded in
   * "effective" mode.
   */
  function statsFor(item, currentMode = mode(), state = patches()) {
    const stats = computeEffectiveStats(baseOf(item), classifyItemEffects(describe(item)), state);
    if (currentMode === "effective" && item?.type === "arma" && folded.get(item)?.crit !== true) {
      for (const key of ["criticoM", "criticoX"]) {
        if (statChanged(stats[key])) stats[key].parts.push({ label: "AppliedOnRoll", kind: "note", i18n: true });
      }
    }
    return stats;
  }

  function foldArmor(system, item, src, state) {
    const descriptors = describe(item);
    const stats = computeEffectiveStats(baseOf(item), classifyItemEffects(descriptors), state);
    // armor-penalty-reduction reads the penalty of every owned armor; only the one prepareDefense uses is folded.
    const external = bearerEffects(item);
    const foldPenalty = isConsumedArmor(item) && canFoldPenalty(descriptors, linkedPdaCount(item, parseUuid()), external);
    const foldValue = canFoldDefense(descriptors, external);
    system.armadura.value = foldValue ? stats["armadura.value"].final : Number(src.armadura?.value) || 0;
    system.armadura.penalidade = foldPenalty ? stats["armadura.penalidade"].final : Number(src.armadura?.penalidade) || 0;
    folded.set(item, { value: foldValue, penalty: foldPenalty });
  }

  function foldWeapon(system, item, src, state) {
    const descriptors = describe(item);
    const plan = item.isEmbedded ? planCritFold(prepRollEffects(descriptors)) : { fold: false };
    if (plan.fold) {
      const crit = applyCritEffects(src.criticoM, src.criticoX, classifyItemEffects(descriptors).automatic, !!state.threatFix);
      system.criticoM = crit.criticoM;
      system.criticoX = crit.criticoX;
    } else {
      system.criticoM = src.criticoM;
      system.criticoX = src.criticoX;
    }
    folded.set(item, { crit: plan.fold });
  }

  /**
   * Mode "effective": writes the final values into the item's derived data. Always computed from `_source`, so it
   * is idempotent. Called after the type data model's prepareDerivedData.
   * @param {object} system   The item's TypeDataModel instance
   */
  function foldItemSystem(system, currentMode = mode(), state = patches()) {
    const item = system?.parent;
    if (!item || currentMode !== "effective") return;
    if (keepsBase.has(item)) return;
    const src = item._source?.system;
    if (!src) return;
    if (item.type === "equipamento" && ARMOR_TIPOS.has(src.tipo) && system.armadura) {
      foldArmor(system, item, src, state);
      return;
    }
    if (item.type === "arma") foldWeapon(system, item, src, state);
  }

  return Object.freeze({
    mode,
    patches,
    usage,
    log,
    describe,
    keepsBase,
    /** What "effective" mode folded into the item in its last preparation. */
    foldedState: (item) => folded.get(item),
    isConsumedArmor,
    statsFor,
    foldItemSystem
  });
}
