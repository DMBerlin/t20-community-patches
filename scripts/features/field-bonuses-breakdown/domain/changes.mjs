import { isArrayKey } from "../../../lib/applied-breakdown.mjs";
import { DEFAULT_PRIORITY, MANUAL_KEYS, PROXY_KEYS, phaseIndex } from "./shared.mjs";

/**
 * How many times the helper (and preparePVPM) counts an element of a PV/PM per-level list; 1 for other keys.
 * @param {string} key
 * @param {number} level  Total character level.
 */
export function levelMultiplier(key, level) {
  const field = /^system\.attributes\.(?:pv|pm)\.bonus\.(nivel|nivelPar|nivelImpar)$/.exec(key)?.[1];
  if (field === "nivel") return level;
  if (field === "nivelPar") return Math.floor(level / 2);
  if (field === "nivelImpar") return Math.ceil(level / 2);
  return 1;
}

/**
 * A change value as a number, like simplifyRollFormula does in preparation; the original value when it cannot be
 * evaluated (dice, missing data).
 * @param {unknown} value
 * @param {(formula: string) => number} [evaluate]  Roll-based evaluator; never eval.
 */
export function evaluateValue(value, evaluate) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value.trim()) return value;
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  if (typeof evaluate !== "function") return value;
  try {
    const total = Number(evaluate(value));
    return Number.isFinite(total) ? total : value;
  } catch {
    return value;
  }
}

/**
 * Flattens modifiedFields and attaches each entry's priority, phase and order from the applied changes it came from.
 * @param {Record<string, {label: string, value: unknown, type?: string}[]>} modFields
 * @param {{key: string, label: string, value: unknown, type?: string, priority?: number, phase?: string}[]} changes
 *   Changes of the actor's applied effects (modifiesActor), in appliedEffects order.
 */
export function annotateEntries(modFields, changes = []) {
  const used = new Set();
  const out = [];
  for (const [key, list] of Object.entries(modFields ?? {})) {
    for (const entry of Array.isArray(list) ? list : []) {
      const index = changes.findIndex(
        (ch, i) => !used.has(i) && ch.key === key && ch.label === entry.label && ch.type === entry.type && ch.value === entry.value
      );
      if (index >= 0) used.add(index);
      const change = index >= 0 ? changes[index] : {};
      out.push({
        key,
        label: entry.label,
        value: entry.value,
        type: entry.type,
        priority: Number.isFinite(change.priority) ? change.priority : (DEFAULT_PRIORITY[entry.type] ?? 0),
        phase: change.phase ?? "initial",
        seq: index >= 0 ? index : changes.length + out.length
      });
    }
  }
  return out;
}

/**
 * Repeats each entry under a proxy wildcard key for every key the system expands it to.
 * @param {object[]} entries  Output of annotateEntries.
 * @param {(path: string) => string[]} keysOf  Keys of the object at a path ("system.pericias" → ["acro", …]).
 */
export function expandWildcards(entries, keysOf) {
  return entries.flatMap((entry) => {
    if (!PROXY_KEYS.includes(entry.key)) return [entry];
    const [path, field = ""] = entry.key.split(".*");
    return (keysOf(path) ?? []).map((key) => ({ ...entry, key: `${path}.${key}${field}` }));
  });
}

/**
 * The elements an ArrayField ends with, as core applies the changes (common/data/fields.mjs, ArrayField): phase, then
 * priority, then order; add appends, override replaces the list, subtract removes the first equal element, multiply,
 * upgrade and downgrade do nothing. Custom and unknown types are kept as additions, as the system shows them.
 * A subtract that would leave fewer than `min` elements fails validation in the core and is ignored.
 * @param {{label: string, value: unknown, hidden?: boolean}[]} seed  Elements already in the list (manual source values).
 * @param {object[]} entries  Annotated entries of one key.
 * @param {{min?: number}} [options]  The field's minimum length (1 for the PV/PM bonus lists, T20:18094).
 *   options.ordered: the entries are already in application order (recorded changes); only their order counts.
 * @returns {{label: string, value: unknown, hidden?: boolean}[]}
 */
export function simulateArray(seed = [], entries = [], { min = 0, ordered = false } = {}) {
  const sorted = [...entries].sort((a, b) =>
    ordered ? a.seq - b.seq : phaseIndex(a.phase) - phaseIndex(b.phase) || a.priority - b.priority || a.seq - b.seq
  );
  let result = seed.map(copyElement);
  for (const entry of sorted) result = applyArrayChange(result, entry, min);
  return result;
}

const copyElement = ({ label, value, hidden }) => (hidden ? { label, value, hidden } : { label, value });

/** The list after one change of an ArrayField (see simulateArray); may modify `result`. */
function applyArrayChange(result, entry, min) {
  const item = { label: entry.label, value: entry.value };
  switch (entry.type) {
    case "override":
      return [item];
    case "subtract": {
      const index = result.findIndex((r) => String(r.value) === String(entry.value));
      if (index >= 0 && result.length - 1 >= min) result.splice(index, 1);
      return result;
    }
    case "multiply":
    case "upgrade":
    case "downgrade":
      return result;
    default:
      result.push(item);
      return result;
  }
}

/**
 * The manual PV/PM elements of the source, as labelled entries per modifiedFields key. Blank and zero elements are
 * kept, marked hidden: they still count for the list's minimum length and for subtract, but are not shown.
 * @param {"pv"|"pm"} type
 * @param {Record<string, unknown[]>} [bonus]  _source.system.attributes[type].bonus.
 * @param {(key: string) => string} localize
 */
export function manualEntries(type, bonus, localize = (k) => k) {
  const seeds = {};
  for (const [field, labelKey] of Object.entries(MANUAL_KEYS)) {
    const list = Array.isArray(bonus?.[field]) ? bonus[field] : [];
    if (!list.length) continue;
    seeds[`system.attributes.${type}.bonus.${field}`] = list.map((value) => {
      const hidden = String(value ?? "").trim() === "" || Number(value) === 0;
      return hidden ? { label: localize(labelKey), value, hidden } : { label: localize(labelKey), value };
    });
  }
  return seeds;
}

/**
 * modifiedFields as the helper should read it. Only array keys are rewritten; the others are kept as they are.
 * @param {Record<string, object[]>} modFields
 * @param {{parts?: Record<string, boolean>, changes?: object[], keysOf?: Function, evaluate?: Function,
 *   resolve?: (value: string) => string, seeds?: Record<string, object[]>, level?: number}} [options]
 *   resolve: replaces the data references of a change value, as StringField#_castChangeDelta does (no arithmetic).
 *   ordered: `changes` are the recorded changes, in the order the core applied them.
 */
export function normalizeModifiedFields(modFields, options) {
  const o = normalizeOptions(options);
  let entries = annotateEntries(modFields, o.changes);
  if (o.parts.wildcard) entries = expandWildcards(entries, o.keysOf);
  const result = { ...modFields };
  for (const [key, list] of groupArrayEntries(entries, o.seeds)) result[key] = arrayFields(key, list, o);
  return result;
}

const normalizeOptions = ({
  parts = {},
  changes = [],
  keysOf = () => [],
  evaluate,
  resolve,
  seeds = {},
  level = 0,
  ordered = false
} = {}) => ({ parts, changes, keysOf, evaluate, resolve, seeds, level, ordered });

/** The entries of array keys, by key; every seeded key has a group, even without entries. */
function groupArrayEntries(entries, seeds) {
  const groups = new Map();
  for (const key of Object.keys(seeds)) groups.set(key, []);
  for (const entry of entries) {
    if (!isArrayKey(entry.key)) continue;
    if (!groups.has(entry.key)) groups.set(entry.key, []);
    groups.get(entry.key).push(entry);
  }
  return groups;
}

/** The core's subtract compares the strings with the data references resolved, not what a formula evaluates to. */
const castWith = (resolve) => (v) => {
  if (typeof v !== "string" || typeof resolve !== "function") return v;
  try {
    return resolve(v);
  } catch {
    return v;
  }
};

/** The elements of one array key as the helper should list them. */
function arrayFields(key, list, { parts, seeds, resolve, evaluate, level, ordered }) {
  const seed = (seeds[key] ?? []).map(copyElement);
  const min = key in seeds && /^system\.attributes\.(?:pv|pm)\.bonus\.\w+$/.test(key) ? 1 : 0;
  const cast = castWith(resolve);
  const value = (v) => (parts.formula ? evaluateValue(v, evaluate) : v);
  const fields = parts.types
    ? simulateArray(seed, list.map((e) => ({ ...e, value: cast(e.value) })), { min, ordered })
    : [...seed, ...[...list].sort((a, b) => a.seq - b.seq).map(({ label, value, type }) => ({ label, value, type }))];
  if (parts.zeroLevel && level > 0 && levelMultiplier(key, level) === 0) return [];
  return fields.filter((f) => !f.hidden).map((f) => ({ ...f, value: value(f.value) }));
}

/**
 * The value of the helper's "Configuração Manual" line (`manualOverride`, T20:3110), from the prepared lists.
 * @param {Record<string, unknown[]>} [bonus]  Prepared system.attributes[pv|pm].bonus.
 */
export function manualOverrideValue(bonus) {
  return Number(bonus?.nivel?.[0]) + Number(bonus?.nivelImpar?.[0]) + Number(bonus?.nivelPar?.[0]);
}
