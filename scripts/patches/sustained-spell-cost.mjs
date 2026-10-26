/**
 * Sustained spell cost (tormenta20 1.6.5).
 *
 * Bug: applyOnUseEffects gives every sustained effect of a chat card its own origin
 * (`<actor>.ActiveEffect.<randomID>`), and the active GM creates one "Sustentando" marker per origin. A spell with
 * several effects (Oração: bonus on allies, penalty on enemies) becomes several markers: the turn prompt charges
 * 1 MP per marker, and unchecking one deletes that half of the spell.
 *
 * Fix: before the card is created, every sustained effect of the same caster gets the origin of the first one, so a
 * cast has a single marker, named after the spell. The system's own cost and deletion logic then work per cast.
 */
import { MODULE_ID, markWrapper, stripComments, unwrap } from "../utils.mjs";

export const SUSTAIN_EXPIRY = "sustainEnd";
export const SUSTAIN_STATUS = "sustentando";
export const SUSTAIN_LABEL_FLAG = "sustainLabel";

/**
 * Splits a sustained origin (`<caster uuid>.ActiveEffect.<marker id>`, T20:6634-6636).
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
  const groups = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const effect of Array.isArray(entry) ? entry : []) {
      if (effect?.duration?.expiry !== SUSTAIN_EXPIRY) continue;
      const parsed = parseSustainOrigin(effect.origin);
      if (!parsed) continue;
      let group = groups.get(parsed.casterUuid);
      if (!group) groups.set(parsed.casterUuid, (group = []));
      group.push(effect);
    }
  }
  let changed = 0;
  for (const group of groups.values()) {
    if (new Set(group.map((effect) => effect.origin)).size < 2) continue;
    const origin = group[0].origin;
    for (const effect of group) {
      if (effect.origin !== origin) {
        effect.origin = origin;
        changed++;
      }
      if (typeof label === "string" && label.trim()) {
        const flags = effect.flags && typeof effect.flags === "object" ? effect.flags : {};
        effect.flags = { ...flags, [MODULE_ID]: { ...flags[MODULE_ID], [SUSTAIN_LABEL_FLAG]: label.trim() } };
      }
    }
  }
  return changed;
}

/**
 * New name for a "Sustentando" marker: the system appends ` (<applied effect name>)` (T20:17903); this swaps that
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
 * checks `fromUuidSync(origin)` before awaiting the marker creation (T20:17898-17907), so two overlapping
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
 * last part of the origin and its parent is the caster (T20:17899-17906), so `<parent uuid>.ActiveEffect.<id>` is
 * that origin.
 * @param {{statuses?: Set<string>, parent?: {uuid?: string}, id?: string, name?: string, updateSource: Function}} effect
 * @param {{_id?: string, name?: string}} data
 * @param {Map<string, {appliedName: string, label: string}>} labels
 * @returns {boolean} Whether the marker was renamed.
 */
export function relabelPendingMarker(effect, data, labels) {
  if (!effect?.statuses?.has?.(SUSTAIN_STATUS)) return false;
  const id = data?._id ?? effect.id;
  const parentUuid = effect.parent?.uuid;
  if (!id || !parentUuid) return false;
  const pending = labels.get(`${parentUuid}.ActiveEffect.${id}`);
  if (!pending) return false;
  const name = relabelSustainMarker(data?.name ?? effect.name, pending.appliedName, pending.label);
  if (!name) return false;
  effect.updateSource({ name });
  return true;
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const queues = new Map();
const labels = new Map();

function apply() {
  const ItemClass = CONFIG.Item?.documentClass;
  const displayCard = ItemClass?.prototype?.displayCard;
  const EffectClass = CONFIG.ActiveEffect?.documentClass;
  const preCreate = EffectClass?.prototype?._preCreate;
  if (typeof displayCard !== "function") throw new Error("ItemT20#displayCard not found");
  if (typeof preCreate !== "function") throw new Error("ActiveEffect#_preCreate not found");

  ItemClass.prototype.displayCard = markWrapper(function (config, ...rest) {
    try {
      unifySustainedOrigins(config?.options?.effects, this?.name);
    } catch (err) {
      console.error(`${MODULE_ID} | sustained-spell-cost: failed to group the sustained effects`, err);
    }
    return displayCard.call(this, config, ...rest);
  }, displayCard);

  EffectClass.prototype._preCreate = markWrapper(wrapSustainedPreCreate(preCreate, { queues, labels }), preCreate);

  Hooks.on("preCreateActiveEffect", (effect, data) => {
    try {
      relabelPendingMarker(effect, data, labels);
    } catch (err) {
      console.error(`${MODULE_ID} | sustained-spell-cost: failed to rename the Sustentando marker`, err);
    }
  });
}

function isNeeded() {
  const handler = unwrap(CONFIG.ChatMessage?.documentClass?._onSustainEffect);
  if (typeof handler !== "function") {
    return { bug: "unknown", confidence: "low", evidence: "ChatMessage._onSustainEffect not found" };
  }
  if (sustainCostIsPerMarker(Function.prototype.toString.call(handler))) {
    return {
      bug: "present",
      confidence: "low",
      evidence: "_onSustainEffect charges 1 MP per Sustentando marker; per-effect origins (applyOnUseEffects) are module-local"
    };
  }
  return { bug: "unknown", confidence: "low", evidence: "_onSustainEffect not recognized" };
}

export default {
  id: "sustained-spell-cost",
  group: "usage-effects",
  issue: 61,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  guarded: true,
  isNeeded,
  apply
};
