import { MODULE_ID } from "../../lib/module.mjs";
import { stripComments } from "../../lib/source.mjs";

export const SUSTAIN_EXPIRY = "sustainEnd";
export const SUSTAIN_STATUS = "sustentando";
export const SUSTAIN_LABEL_FLAG = "sustainLabel";

/**
 * Splits a sustained origin (`<caster uuid>.ActiveEffect.<marker id>`, T20:5459-5461).
 * @param {unknown} origin
 * @returns {{casterUuid: string, markerId: string}|null}
 */
export function parseSustainOrigin(origin) {
  if (typeof origin !== "string") return null;
  const [casterUuid, markerId, ...rest] = origin.split(".ActiveEffect.");
  if (!casterUuid || !markerId || rest.length) return null;
  return { casterUuid, markerId };
}

/**
 * Gives every sustained effect of one chat card the origin of the first sustained effect of the same caster, so the
 * system creates a single "Sustentando" marker per cast. Only groups with two or more distinct origins change; they
 * are also stamped with the item name. Mutates the card effect data in place.
 * @param {unknown} entries  `options.effects`: one `[effect, ...children]` array per card button.
 * @param {string} [label]   Name of the used item.
 * @returns {number}         How many effects had their origin changed.
 */
export function unifySustainedOrigins(entries, label) {
  let changed = 0;
  for (const group of groupByCaster(entries).values()) {
    if (new Set(group.map((effect) => effect.origin)).size < 2) continue;
    const origin = group[0].origin;
    for (const effect of group) {
      if (effect.origin !== origin) {
        effect.origin = origin;
        changed++;
      }
      stampLabel(effect, label);
    }
  }
  return changed;
}

/** Sustained effects with a marker origin, grouped by caster uuid, in card order. */
function groupByCaster(entries) {
  const groups = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const effect of Array.isArray(entry) ? entry : []) {
      if (effect?.duration?.expiry !== SUSTAIN_EXPIRY) continue;
      const parsed = parseSustainOrigin(effect.origin);
      if (!parsed) continue;
      if (!groups.has(parsed.casterUuid)) groups.set(parsed.casterUuid, []);
      groups.get(parsed.casterUuid).push(effect);
    }
  }
  return groups;
}

function stampLabel(effect, label) {
  if (typeof label !== "string" || !label.trim()) return;
  const flags = effect.flags && typeof effect.flags === "object" ? effect.flags : {};
  effect.flags = { ...flags, [MODULE_ID]: { ...flags[MODULE_ID], [SUSTAIN_LABEL_FLAG]: label.trim() } };
}

/**
 * New name for a "Sustentando" marker: the system appends ` (<applied effect name>)` (T20:16744); this swaps that
 * suffix for the spell name.
 * @param {unknown} name         Marker name built by the system.
 * @param {unknown} appliedName  Name of the applied effect that created the marker.
 * @param {unknown} label        Name of the spell.
 * @returns {string|null}        null when nothing should change.
 */
export function relabelSustainMarker(name, appliedName, label) {
  if (typeof name !== "string" || typeof appliedName !== "string" || typeof label !== "string") return null;
  if (!appliedName || !label || appliedName === label) return null;
  const suffix = ` (${appliedName})`;
  if (!name.endsWith(suffix)) return null;
  return `${name.slice(0, -suffix.length)} (${label})`;
}

/**
 * Whether the source of ChatMessageT20._onSustainEffect charges 1 MP per selected "Sustentando" marker.
 * @param {unknown} source
 * @returns {boolean}
 */
export function sustainCostIsPerMarker(source) {
  if (typeof source !== "string") return false;
  const code = stripComments(source).replace(/\s+/g, "");
  return code.includes(`"${SUSTAIN_STATUS}"`) && code.includes("spendMana(toUpdate.length");
}

/**
 * Runs `task` after every task queued before with the same key has settled. A failed task does not block the next.
 * @template T
 * @param {Map<string, Promise<void>>} queues
 * @param {string} key
 * @param {() => Promise<T>|T} task
 * @returns {Promise<T>}
 */
export function queueByKey(queues, key, task) {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(() => task());
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  queues.set(key, tail);
  tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

/**
 * Wraps ActiveEffect#_preCreate. Sustained effects with a marker origin run one at a time per origin: the system
 * checks `fromUuidSync(origin)` before awaiting the marker creation (T20:16739-16748), so two overlapping
 * applications of one cast would both try to create the same marker id. While a call runs, `labels` maps its origin
 * to the applied effect name and the spell name, for the nested marker creation (see relabelPendingMarker).
 * @param {Function} preCreate  The original _preCreate.
 * @param {{queues: Map<string, Promise<void>>, labels: Map<string, {appliedName: string, label: string}>}} state
 * @returns {Function}
 */
export function wrapSustainedPreCreate(preCreate, { queues, labels }) {
  return function (data, ...rest) {
    const origin = data?.duration?.expiry === SUSTAIN_EXPIRY && parseSustainOrigin(data?.origin) ? data.origin : null;
    if (!origin) return preCreate.call(this, data, ...rest);
    return queueByKey(queues, origin, async () => {
      const label = data.flags?.[MODULE_ID]?.[SUSTAIN_LABEL_FLAG];
      const entry = typeof label === "string" && label ? { appliedName: data.name, label } : null;
      if (entry) labels.set(origin, entry);
      try {
        return await preCreate.call(this, data, ...rest);
      } finally {
        if (entry && labels.get(origin) === entry) labels.delete(origin);
      }
    });
  };
}

/**
 * preCreateActiveEffect: renames a "Sustentando" marker created inside a wrapped _preCreate. The marker id is the
 * last part of the origin and its parent is the caster (T20:16740-16747), so `<parent uuid>.ActiveEffect.<id>` is
 * that origin.
 * @param {{statuses?: Set<string>, parent?: {uuid?: string}, id?: string, name?: string, updateSource: Function}} effect
 * @param {{_id?: string, name?: string}} data
 * @param {Map<string, {appliedName: string, label: string}>} labels
 * @returns {boolean} Whether the marker was renamed.
 */
export function relabelPendingMarker(effect, data, labels) {
  const pending = pendingLabel(effect, data, labels);
  if (!pending) return false;
  const name = relabelSustainMarker(data?.name ?? effect.name, pending.appliedName, pending.label);
  if (!name) return false;
  effect.updateSource({ name });
  return true;
}

/** The pending label of a "Sustentando" marker being created, if any. */
function pendingLabel(effect, data, labels) {
  if (!effect?.statuses?.has?.(SUSTAIN_STATUS)) return undefined;
  const id = data?._id ?? effect.id;
  const parentUuid = effect.parent?.uuid;
  if (!id || !parentUuid) return undefined;
  return labels.get(`${parentUuid}.ActiveEffect.${id}`);
}
