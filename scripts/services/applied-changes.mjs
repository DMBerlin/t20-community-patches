/**
 * What the actor's preparation really applied (service, #91), for the breakdowns of field-bonuses-breakdown.
 *
 * ActorT20#modifiedFields lists every change of every applied effect; it does not know which changes a feature cut
 * (item-effective-stats, source-stacking, prone-defense) nor what was added outside effects (non-proficiency).
 * This service records, per actor and preparation cycle:
 * - the changes ActiveEffect.applyChangeField applied to the fields the breakdowns use;
 * - the contributions the features report as cut (reportSuppressed) or as added outside effects (contribute).
 *
 * The cycle opens when Actor#applyActiveEffects("initial") starts and is published when the "final" phase returns;
 * every report is made inside the core's own work (shouldApplyChange, applyChange, prepareDerivedData), after the
 * opening, whatever the order of the wrappers. A phase that throws discards the cycle and the previous one stays;
 * a phase run inside another one joins its cycle, which is settled when the outermost final call returns (the core's
 * own one, rejected as repeated, when final already ran nested in initial).
 */
import { isTrackedKey } from "../lib/applied-breakdown.mjs";

const EMPTY = Object.freeze([]);

/** @typedef {{key: string, label: string, type: string, value: unknown, priority?: number, phase?: string}} AppliedChange */
/** @typedef {{key: string, label: string, value: unknown, reason: string, item?: {id: string, accessory?: boolean}}} SuppressedEntry */
/** @typedef {{path: string, label: string, value: number, owner: string}} Contribution */

/**
 * The change value with its data references resolved by the field, against the data the core used when applying it
 * (DataField#_castChangeDelta): the tooltip must not resolve them again against the prepared actor. No arithmetic, so
 * array subtract still compares the same strings. The raw value when there is nothing to resolve or it fails.
 */
function appliedValue(targetDoc, change, options) {
  const raw = change.value;
  const data = options?.replacementData;
  if (typeof raw !== "string" || !raw.includes("@") || typeof data !== "object" || !data) return raw;
  try {
    const field = options.field ?? targetDoc.getFieldForProperty?.(change.key);
    const element = field?.element ?? field;
    return element?._replaceDataRefs ? element._replaceDataRefs(raw, data) : raw;
  } catch {
    return raw;
  }
}

const newCycle = () => ({
  phase: null,
  depth: 0,
  failed: false,
  finalDone: false,
  changes: [],
  suppressed: [],
  contributions: new Map(),
  origins: new WeakSet()
});

/**
 * Wraps Actor#applyActiveEffects and ActiveEffect.applyChangeField. Without either method the API is inert: changes()
 * answers null and reports are ignored.
 * @param {{actorProto?: object, EffectClass?: Function, wrap: Function, warn?: Function}} options
 */
export function createAppliedChanges({ actorProto, EffectClass, wrap, warn = () => {} }) {
  /** @type {WeakMap<object, ReturnType<typeof newCycle>>} */
  const pending = new WeakMap();
  /** @type {WeakMap<object, {changes: readonly AppliedChange[], suppressed: readonly SuppressedEntry[], contributions: Contribution[]}>} */
  const published = new WeakMap();
  const open = (actor) => (actor && typeof actor === "object" ? pending.get(actor) : undefined);
  /** At the outermost call: a cycle with an error is discarded; one whose final phase completed is published. */
  const settle = (actor, cycle) => {
    if (pending.get(actor) !== cycle) return;
    if (cycle.failed) pending.delete(actor);
    if (cycle.failed || !cycle.finalDone) return;
    pending.delete(actor);
    published.set(actor, {
      changes: Object.freeze(cycle.changes),
      suppressed: Object.freeze(cycle.suppressed),
      contributions: [...cycle.contributions.values()]
    });
  };

  const api = Object.freeze({
    /** Changes applied in the last published cycle, in application order; null before any. */
    changes: (actor) => published.get(actor)?.changes ?? null,
    /** Contributions cut in the last published cycle. */
    suppressed: (actor) => published.get(actor)?.suppressed ?? EMPTY,
    /** Contributions to `path` added outside effects in the last published cycle. */
    contributions: (actor, path) => (published.get(actor)?.contributions ?? EMPTY).filter((c) => c.path === path),
    /**
     * Reports a contribution cut during the actor's preparation; ignored outside a cycle.
     * @param {object} actor
     * @param {SuppressedEntry} entry
     * @param {object} [origin]  The object cut (stored change, item); reported once per cycle.
     */
    reportSuppressed(actor, entry, origin) {
      const cycle = open(actor);
      if (!cycle || !entry) return;
      if (origin && typeof origin === "object") {
        if (cycle.origins.has(origin)) return;
        cycle.origins.add(origin);
      }
      cycle.suppressed.push(Object.freeze({ ...entry }));
    },
    /**
     * Reports what a feature adds to a field outside effects; one entry per owner and path (the last one wins).
     * @param {object} actor
     * @param {string} path
     * @param {{label: string, value: number, owner: string}} entry
     */
    contribute(actor, path, entry) {
      const cycle = open(actor);
      if (!cycle || !entry?.owner) return;
      cycle.contributions.set(`${entry.owner}\u0000${path}`, Object.freeze({ path, label: entry.label, value: entry.value, owner: entry.owner }));
    }
  });

  if (typeof actorProto?.applyActiveEffects !== "function" || typeof EffectClass?.applyChangeField !== "function") {
    warn("Actor#applyActiveEffects or ActiveEffect.applyChangeField not found; the breakdowns keep modifiedFields");
    return api;
  }

  wrap(actorProto, "applyActiveEffects", function (applyActiveEffects, phase, ...args) {
    // The core resolves a missing phase and rejects a phase already completed in this preparation (it applies
    // nothing then): such a call neither opens, changes nor publishes a cycle.
    const completed = this?._completedActiveEffectPhases;
    let resolved = phase;
    if (typeof resolved !== "string") resolved = completed?.has("initial") ? "final" : "initial";
    if (completed?.has(resolved)) {
      const result = applyActiveEffects.call(this, phase, ...args);
      // Core's own final call (Actor#prepareData) after a final already run nested: the preparation is now over.
      const waiting = pending.get(this);
      if (resolved === "final" && waiting && !waiting.depth) settle(this, waiting);
      return result;
    }
    // A nested call (another phase run during this one) joins the cycle; only the outermost call settles it.
    if (resolved === "initial" && !pending.get(this)?.depth) pending.set(this, newCycle());
    const cycle = pending.get(this);
    if (!cycle) return applyActiveEffects.call(this, phase, ...args);
    const previous = cycle.phase;
    cycle.phase = resolved;
    cycle.depth += 1;
    let ok = false;
    let result;
    try {
      result = applyActiveEffects.call(this, phase, ...args);
      ok = true;
    } finally {
      cycle.phase = previous;
      cycle.depth -= 1;
      if (!ok) cycle.failed = true;
      else if (resolved === "final") cycle.finalDone = true;
      // A final run nested in the initial phase waits for the next final call, after prepareDerivedData.
      if (!cycle.depth && (resolved === "final" || cycle.failed)) settle(this, cycle);
    }
    return result;
  });

  wrap(EffectClass, "applyChangeField", function (applyChangeField, ...args) {
    // Built before the change applies: the replacement data shares objects with the actor the change modifies.
    let record = null;
    let cycle = null;
    try {
      const [targetDoc, change, options] = args;
      cycle = open(targetDoc);
      if (cycle?.phase && options?.modifyTarget !== false && isTrackedKey(change?.key)) {
        record = Object.freeze({
          key: change.key,
          label: change.effect?.name,
          type: change.type,
          value: appliedValue(targetDoc, change, options),
          priority: change.priority,
          phase: change.phase ?? cycle.phase
        });
      }
    } catch (err) {
      warn("could not record a change", err);
    }
    const result = applyChangeField.apply(this, args);
    if (record) cycle.changes.push(record);
    return result;
  });

  return api;
}

/** @type {import("../kernel/services.mjs").Service} */
export default {
  id: "applied-changes",
  install: (ctx) =>
    createAppliedChanges({
      actorProto: ctx.platform.classes.actor?.prototype,
      EffectClass: ctx.platform.classes.activeEffect,
      wrap: ctx.wrap,
      warn: (...args) => ctx.log.warn(...args)
    })
};
