/**
 * Plain descriptions of the item's documents (effects, base values, bearer), read without any Foundry global: what
 * would come from the platform (getProperty, parseUuid, the usage-effect-max mode) comes in by parameter.
 */
import { isArmorPenaltyReducer } from "../../../lib/armor-penalty.mjs";
import { hasUsageLimit } from "../../../lib/usage-limits.mjs";
import { PDA_KEY } from "./classify.mjs";

/**
 * @typedef {{mode?: () => string, getProperty?: (obj: object, path: string) => unknown}} UsageLimits
 *   `mode`: the usage-effect-max mode, read only when needed ("off" when absent).
 */

function setHas(collection, value) {
  if (!collection) return false;
  if (typeof collection.has === "function") return collection.has(value);
  return Array.isArray(collection) && collection.includes(value);
}

/**
 * ActiveEffectT20#shouldApplyChange (T20:18120-18133): an aura that applies effects reaches its own bearer only when
 * its targets include "self".
 */
export function auraAppliesToBearer(system) {
  const aura = system?.aura;
  if (!aura?.isAura) return true;
  const applies = Object.values(aura.behaviors ?? {}).some((b) => b?.type === "applyActiveEffect");
  return !applies || setHas(system.targets, "self");
}

/**
 * The usage dialog charges, multiplies or limits this usage effect.
 * @param {object} effect
 * @param {UsageLimits} [usage]
 */
export function isUsageBound(effect, usage = {}) {
  const use = effect?.system?.abilityUse ?? {};
  const cost = use.custo;
  if ((cost !== null && cost !== undefined && Number(cost) !== 0) || !!use.aumenta) return true;
  return hasUsageLimit(effect, usage.mode?.() ?? "off", usage.getProperty);
}

/**
 * @param {object} effect  ActiveEffect owned by `item`
 * @param {object} item
 * @param {UsageLimits} [usage]
 * @returns {import("./classify.mjs").EffectInfo}
 */
export function describeEffect(effect, item, usage = {}) {
  const system = effect?.system ?? {};
  const use = system.abilityUse ?? {};
  let reducer = false;
  try {
    reducer = isArmorPenaltyReducer(effect);
  } catch {
    reducer = false;
  }
  return {
    id: effect?.id,
    name: effect?.name ?? "",
    disabled: !!effect?.disabled,
    transfer: effect?.transfer !== false,
    onuse: !!system.onuse,
    temporary: !!effect?.isTemporary,
    selfUse: setHas(use.types, "self") || setHas(use.names, item?.name),
    automatic: !!use.automatic,
    usageBound: isUsageBound(effect, usage),
    appliesToBearer: auraAppliesToBearer(system),
    hasStatus: system.status !== null && system.status !== undefined,
    identifier: system.identifier,
    reducer,
    changes: (system.changes ?? []).map((ch) => ({ key: ch?.key, type: ch?.type, value: ch?.value, phase: ch?.phase }))
  };
}

/** @param {UsageLimits} [usage] */
export function describeItemEffects(item, usage = {}) {
  return [...(item?.effects ?? [])].map((effect) => describeEffect(effect, item, usage));
}

export function baseOf(item) {
  const src = item?._source?.system ?? {};
  return {
    type: item?.type,
    tipo: src.tipo,
    armadura: src.armadura,
    criticoM: src.criticoM,
    criticoX: src.criticoX,
    labels: { toHit: item?.labels?.toHit, dano: item?.labels?.dano }
  };
}

/** Own usage effects the system would accept in this item's roll (includeEffect, T20:8068-8076). */
export function prepRollEffects(descriptors) {
  return descriptors
    .filter((d) => d.onuse && !d.temporary && d.selfUse)
    .map((d) => ({ id: d.id, own: true, automatic: d.automatic, usageBound: d.usageBound, changes: d.changes }));
}

/**
 * Actor effects touching defesa.pda whose origin points to the item (armor-penalty-reduction resolveItemId).
 * @param {object} item
 * @param {(uuid: string) => {id?: string}} [parseUuid]   foundry.utils.parseUuid; without it, nothing is counted.
 */
export function linkedPdaCount(item, parseUuid) {
  const actor = item?.parent;
  if (!actor || actor.documentName !== "Actor" || typeof parseUuid !== "function") return 0;
  let count = 0;
  for (const effect of actor.effects ?? []) {
    if (!effect?.origin || !(effect.system?.changes ?? []).some((ch) => ch?.key === PDA_KEY)) continue;
    try {
      if (parseUuid(effect.origin)?.id === item.id) count++;
    } catch {
      /* unparsable origin */
    }
  }
  return count;
}

/** Passive effects of the bearer other than the item's own: the actor's and the other items' transferred ones. */
export function bearerEffects(item) {
  const actor = item?.parent;
  if (!actor || actor.documentName !== "Actor") return [];
  const list = [];
  for (const effect of actor.effects ?? []) list.push({ disabled: !!effect?.disabled, changes: effect?.system?.changes ?? [] });
  for (const other of actor.items?.values?.() ?? actor.items ?? []) {
    if (other === item || other?.id === item.id) continue;
    for (const effect of other?.effects ?? []) {
      if (effect?.transfer === false || effect?.system?.onuse) continue;
      list.push({ disabled: !!effect?.disabled, changes: effect?.system?.changes ?? [] });
    }
  }
  return list;
}
