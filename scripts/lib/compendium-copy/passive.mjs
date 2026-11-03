/**
 * Changes the always-on effects of a compendium item leave on the actor, read from its source, and edits of its
 * effects array (see index.mjs).
 */
import { effectsOf } from "./signatures.mjs";

/** Default priority of each change type (core CONST.ACTIVE_EFFECT_CHANGE_TYPES). */
const TYPE_PRIORITY = { custom: 0, multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50 };

/** An effect that is always on (not disabled, transferred, not a usage effect). */
export const isPassiveEffect = (e) => e?.disabled !== true && e?.transfer !== false && e?.system?.onuse !== true;

const asList = (value) => (value instanceof Set ? [...value] : Array.isArray(value) ? value : []);

/**
 * Whether the actor applies an always-on effect's changes to itself (ActiveEffectT20#shouldApplyChange): an aura with
 * an applyActiveEffect behavior applies to its owner only when its targets include "self". true, false or null (not
 * determined: an aura whose behaviors this code cannot read). The cleaned source stores behaviors as JSON text
 * (JSONField), so a string is parsed first.
 */
export function appliesToSelf(effect) {
  if (!isPassiveEffect(effect)) return false;
  const aura = effect?.system?.aura;
  if (aura?.isAura !== true) return true;
  let behaviors = aura.behaviors;
  if (typeof behaviors === "string") {
    try {
      behaviors = JSON.parse(behaviors);
    } catch {
      return null;
    }
  }
  if (!behaviors || typeof behaviors !== "object") return null;
  const self = asList(effect.system.targets).includes("self");
  for (const behavior of Object.values(behaviors)) {
    if (!behavior || typeof behavior !== "object") return null;
    if (behavior.type === "applyActiveEffect" && !self) return false;
  }
  return true;
}

/** Key a change really writes: ActiveEffectT20.applyChange sends a movement type to ".bonus" (add) or ".base" (T20:18143). */
export function effectiveKey(c) {
  const key = String(c?.key ?? "");
  if (!key.startsWith("system.attributes.movement") || !/(walk|fly|burrow|climb|swim)$/.test(key)) return key;
  return `${key}.${c?.type === "add" ? "bonus" : "base"}`;
}

/** Whether `key` names a strict ancestor of `path`; "*" matches any segment, as in the system proxy keys. */
export function isAncestorKey(key, path) {
  const k = key.split(".");
  const p = path.split(".");
  return k.length < p.length && k.every((segment, i) => segment === "*" || segment === p[i]);
}

/** A change value this code can evaluate: a number, a boolean or plain text (no array, object, JSON text or @ reference). */
const isScalarValue = (v) =>
  typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && !/^\s*[[{]/.test(v) && !v.includes("@"));

/**
 * Changes of the item's always-on effects that match (`match`: list of keys or predicate) and that the actor applies
 * to itself, in the order it applies them (priority, then position; core Actor#applyActiveEffects). `paths` are the
 * fields being examined (by default the keys of `match`).
 * null when not determined:
 *  - a change in any phase other than "initial": the system derives values such as the walking speed between the
 *    phases (core Actor#prepareData; T20 prepareMovement);
 *  - a change to an ancestor of an examined field (for example an override of system.attributes.sentidos), which the
 *    core SchemaField applies to the whole object;
 *  - a value that is not scalar (an array or JSON text, which the core casts to several elements), an unknown type or
 *    an aura not evaluated.
 */
export function passiveChanges(src, match, paths = Array.isArray(match) ? match : []) {
  const test = typeof match === "function" ? match : (c) => match.includes(c?.key);
  const list = [];
  for (const effect of effectsOf(src)) {
    const applies = appliesToSelf(effect);
    if (applies === false) continue;
    for (const c of effect?.system?.changes ?? []) {
      if (/\.\?+\./.test(String(c?.key))) continue;
      const key = effectiveKey(c);
      const ancestor = paths.some((path) => isAncestorKey(key, path));
      if (!ancestor && !test(c)) continue;
      const priority = c?.priority ?? TYPE_PRIORITY[c?.type];
      if (applies === null || ancestor || (c?.phase ?? "initial") !== "initial") return null;
      if (typeof priority !== "number" || !isScalarValue(c?.value)) return null;
      list.push({ type: c.type, value: c.value, priority, position: list.length });
    }
  }
  return list.sort((a, b) => a.priority - b.priority || a.position - b.position);
}

/**
 * Number the item's always-on effects leave in a field whose base value is unknown. null when it is not determined:
 * no override, a later change of a type this code does not evaluate, or a non-numeric value.
 */
export function passiveNumber(src, match, paths) {
  const changes = passiveChanges(src, match, paths);
  if (!changes) return null;
  let value = null;
  for (const c of changes) {
    const n = Number(c.value);
    if (c.value === "" || typeof c.value === "boolean" || !Number.isFinite(n)) return null;
    if (c.type === "override") value = n;
    else if (c.type === "add") value = value === null ? null : value + n;
    else if (c.type === "subtract") value = value === null ? null : value - n;
    else return null;
  }
  return value;
}

/** Text the item's always-on effects leave in a field; null unless only overrides touch it. */
export function passiveText(src, match, paths) {
  const changes = passiveChanges(src, match, paths);
  if (!changes?.length || changes.some((c) => c.type !== "override")) return null;
  return String(changes.at(-1).value);
}

/**
 * Whether the item's always-on effects leave `member` in a SetField (such as sentidos.value): true, false or null
 * (not determined: nothing adds it, or a change of a type or value this code does not evaluate). Each value is a
 * single element, as the core SetField casts a scalar delta.
 */
export function passiveSetHas(src, match, member, paths) {
  const changes = passiveChanges(src, match, paths);
  if (!changes) return null;
  let has = null;
  for (const c of changes) {
    if (c.type !== "add" && c.type !== "subtract") return null;
    if (String(c.value) === member) has = c.type === "add";
  }
  return has;
}

/**
 * Full effects array with the effect `id` edited and `extra` appended. Every existing effect is passed back with its
 * _id, so updateSource diffs each one in place; elements without a matching _id are created.
 */
export function editEffects(src, id, mutate, extra = []) {
  return {
    effects: [
      ...effectsOf(src).map((effect) => {
        const copy = structuredClone(effect);
        if (id && effect?._id === id) mutate(copy);
        return copy;
      }),
      ...extra
    ]
  };
}
