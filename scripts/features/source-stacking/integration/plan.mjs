/**
 * Builds the suppression plan of one actor from its documents: the source of each effect, the amount of each change
 * as the target field reads it, and the equipped accessories. Reads the platform only through `platform`.
 */
import { MODULE_ID } from "../../../lib/module.mjs";
import {
  ARMOR_TIPOS,
  CATEGORIES,
  DEFENSE_KEY,
  PENALTY_KEY,
  SOURCE_FLAG,
  changeAmount,
  isArmorExempt,
  itemCategory,
  planSuppression,
  sourceCategory
} from "../domain.mjs";

const FLAG_PATH = `flags.${MODULE_ID}.${SOURCE_FLAG}`;

function setFlag(effect, category) {
  for (const target of [effect, effect._source]) {
    if (!target) continue;
    if (category) {
      target.flags ??= {};
      target.flags[MODULE_ID] ??= {};
      target.flags[MODULE_ID][SOURCE_FLAG] = category;
    } else if (target.flags?.[MODULE_ID] && SOURCE_FLAG in target.flags[MODULE_ID]) {
      delete target.flags[MODULE_ID][SOURCE_FLAG];
    }
  }
}

/** Stamps the rolled clone's own effects with the source; the system copies `ef.flags` into the card effect. */
export function stampClone(item) {
  if (!item?.effects || !item.isEmbedded || item.actor?.items?.get(item.id) === item) return;
  const category = itemCategory(item.type);
  for (const effect of item.effects) setFlag(effect, category);
}

/** The owned item a legacy actor effect points to (`Actor.<a>.Item.<i>` or `Scene.<s>.Token.<t>.Item.<i>`). */
export function originItem(actor, origin) {
  if (typeof origin !== "string") return null;
  const parts = origin.split(".");
  if (parts.length === 4 && parts[0] === "Actor" && parts[1] === actor.id && parts[2] === "Item") return actor.items?.get(parts[3]) ?? null;
  if (parts.length === 6 && parts[0] === "Scene" && parts[2] === "Token" && parts[3] === actor.token?.id && parts[4] === "Item") {
    return actor.items?.get(parts[5]) ?? null;
  }
  return null;
}

const time = (doc) => Number(doc?._stats?.createdTime) || 0;

export function itemSource(item, category, effect) {
  return {
    category,
    source: `Item.${item.id}`,
    order: [time(item), item.id],
    name: item.name,
    itemType: item.type,
    tipo: item.system?.tipo,
    effects: effect ? [effect.uuid] : [],
    items: [item.id]
  };
}

/** Source of an applicable effect on this actor, or null when it does not take part. */
export function effectSource(platform, actor, effect) {
  const parent = effect?.parent;
  if (parent?.documentName === "Item") {
    if (parent.parent !== actor) return null;
    const category = sourceCategory({ parent: "Item", itemType: parent.type, transfer: !!effect.transfer });
    return category ? itemSource(parent, category, effect) : null;
  }
  if (parent !== actor) return null;
  const flag = platform.utils.getProperty(effect, FLAG_PATH);
  if (CATEGORIES.has(flag)) {
    return { category: flag, source: `ActiveEffect.${effect.id}`, order: [time(effect), effect.id], name: effect.name, effects: [effect.uuid], items: [] };
  }
  const item = originItem(actor, effect.origin);
  const category = item ? sourceCategory({ parent: "Actor", originItemType: item.type }) : null;
  return category ? itemSource(item, category, effect) : null;
}

/** Evaluates a formula without dice like core's NumberField (Roll parser), never as JavaScript. */
export function evaluate(platform, formula, data) {
  const Roll = platform.dice.Roll;
  const resolved = Roll.defaultImplementation.replaceFormulaData(formula, data ?? {}, { recursive: true });
  if (resolved.replace(/@\w+\[[^#\]]+]/g, "").includes("@")) return NaN;
  const roll = Roll.create(resolved);
  if (!roll.isDeterministic) return NaN;
  return Number(roll.evaluateSync().total);
}

export function equippedAccessories(platform, actor) {
  let slots = false;
  try {
    slots = platform.settingsOf("tormenta20").get("equipmentSlots");
  } catch {
    /* setting not registered */
  }
  return (actor.itemTypes?.equipamento ?? []).filter(
    (i) => (slots ? i.system?.equipado2?.slot : i.system?.equipado) && !ARMOR_TIPOS.has(i.system?.tipo) && i.system?.armadura
  );
}

/** Concrete path of a change key: short movement keys and proxy keys (`system.path.*.key`), as the system expands them. */
function concretePath(platform, actor, key, type) {
  let path = key;
  // Same as ActiveEffectT20.applyChange: short movement keys target "bonus" on "add" and "base" otherwise.
  if (path.startsWith("system.attributes.movement") && /(walk|fly|burrow|climb|swim)$/.test(path)) {
    path += type === "add" ? ".bonus" : ".base";
  }
  if (path.search(/\.\*\./) <= 0) return path;
  const [base, rest = ""] = path.split(".*");
  // Same filter as the system: movement also holds keys that are not movement types (hover, flags).
  const keep = base === "system.attributes.movement" ? (k) => platform.t20Config()?.movementTypes?.[k] : () => true;
  const first = Object.keys(platform.utils.getProperty(actor, base) ?? {}).find(keep);
  return first === undefined ? undefined : `${base}.${first}${rest}`;
}

/**
 * Kind of the field a change key targets, as the core resolves it in ActiveEffect.applyChange. Proxy keys
 * (`system.path.*.key`, expanded by ActiveEffectT20._prepareProxyChange) take the kind of their first concrete key.
 */
export function fieldKind(platform, actor, key, type) {
  const fields = platform.core.fields;
  if (!fields) return undefined;
  let field;
  try {
    const path = concretePath(platform, actor, key, type);
    if (path === undefined) return undefined;
    field = path.startsWith("system.") ? actor.system?.getFieldForProperty?.(path.slice(7)) : actor.getFieldForProperty?.(path);
  } catch {
    return undefined;
  }
  if (field instanceof fields.NumberField) return "number";
  if (field instanceof fields.ArrayField) return "array";
  return undefined;
}

/** Entries of the changes of one applicable effect. */
function effectEntries({ platform, exclusions }, { effect, info, phase, rollData, kindOf }) {
  const entries = [];
  const replacementData = effect.getReplacementData(rollData);
  const cache = new Map();
  const resolve = (formula) => {
    if (!cache.has(formula)) cache.set(formula, evaluate(platform, formula, replacementData));
    return cache.get(formula);
  };
  for (const change of effect.system?.changes ?? []) {
    if (!change?.key || (change.type !== "add" && change.type !== "subtract")) continue;
    if (exclusions?.isExcluded(effect, change)) continue;
    if (isArmorExempt({ itemType: info.itemType, tipo: info.tipo, key: change.key })) continue;
    if (!effect.shouldApplyChange(change, { phase, replacementData })) continue;
    entries.push({ ...info, ref: change, key: change.key, amount: changeAmount(change, resolve, kindOf(change.key, change.type)) });
  }
  return entries;
}

/** Entries of the Defense and armor penalty of the equipped accessories. */
function accessoryEntries(platform, actor) {
  const entries = [];
  for (const item of equippedAccessories(platform, actor)) {
    const info = itemSource(item, "item");
    const value = Number(item.system.armadura.value) || 0;
    const penalty = Number(item.system.armadura.penalidade) || 0;
    if (value) entries.push({ ...info, ref: { item, field: "value" }, key: DEFENSE_KEY, amount: value });
    if (penalty) entries.push({ ...info, ref: { item, field: "penalty" }, key: PENALTY_KEY, amount: -Math.abs(penalty) });
  }
  return entries;
}

/**
 * @param {{platform: object, exclusions: {isExcluded: Function}|null}} env
 * @param {object} actor
 * @param {string} phase
 */
export function buildPlan(env, actor, phase) {
  const rollData = actor.getRollData();
  const entries = [];
  const kinds = new Map();
  const kindOf = (key, type) => {
    const id = `${type}\u0000${key}`;
    if (!kinds.has(id)) kinds.set(id, fieldKind(env.platform, actor, key, type));
    return kinds.get(id);
  };
  for (const effect of actor.allApplicableEffects()) {
    if (!effect.active) continue;
    const info = effectSource(env.platform, actor, effect);
    if (!info) continue;
    entries.push(...effectEntries(env, { effect, info, phase, rollData, kindOf }));
  }
  if (phase === "initial") entries.push(...accessoryEntries(env.platform, actor));
  return planSuppression(entries);
}

export function targetActor(effect) {
  const parent = effect?.parent;
  return parent?.documentName === "Item" ? parent.parent : parent;
}
