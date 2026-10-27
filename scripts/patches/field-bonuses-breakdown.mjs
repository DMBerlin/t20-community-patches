/**
 * Sheet breakdowns that disagree with the prepared value (tormenta20 1.6.5).
 *
 * The `fieldBonuses` Handlebars helper (T20:4254-4463) rebuilds the total of PV, PM, perícias and Defesa from its own
 * list. That list diverges from the prepared value:
 * - manual: the manual PV/PM bonuses per level are summed once ("Configuração Manual") and the manual total is missing;
 * - zeroLevel: a per-even-level bonus at level 1 has multiplier 0, which is falsy, so it is added once;
 * - formula: a value without "@" goes through Number() ("2+1" is NaN) and "1+1" per level becomes "1+1 * 5";
 * - types: modifiedFields entries carry `type` but the helper reads `mode`, so override and multiply show as additions;
 * - wildcard: `system.pericias.*.bonus` keeps its literal key in modifiedFields and never reaches a skill;
 * - heavyArmor: with heavy armor the Defesa drops the attribute; prepareDefense adds clamp(attr, 0, maxAtr);
 * - defenseSources: the Defesa shows "Outros" as one aggregated number and the conditions as one line, so the player
 *   cannot tell which effect changes it nor why a condition did nothing.
 *
 * Fix: during the call the actor's modifiedFields is shadowed by a normalized copy (array fields simulated as the core
 * applies them, wildcards expanded, values evaluated, manual elements listed); afterwards the system's "Configuração
 * Manual" line is removed, the heavy armor attribute line is added and the Defesa "Outros" line is split by source.
 * Each part is installed only when its bug is recognized in the helper's source, so a partial fix upstream is never
 * doubled.
 */
import { isPatchApplied } from "../registry.mjs";
import { MODULE_ID, addTooltipLine, markWrapper, stripComments, unwrap } from "../utils.mjs";
import { resolveDataRefs } from "./armor-penalty-reduction.mjs";
import { fieldTerms } from "./field-bonuses-tooltip.mjs";
import { PRONE, collectProneCandidates, isProneDefenseChange, planProneChange } from "./prone-defense.mjs";

const LOG = "t20-community-patches | field-bonuses-breakdown:";
export const PARTS = ["manual", "zeroLevel", "formula", "types", "wildcard", "heavyArmor", "defenseSources"];
const INPUT_PARTS = ["manual", "zeroLevel", "formula", "types", "wildcard"];
export const MANUAL_KEYS = {
  nivel: "T20CP.FieldBonuses.ManualPerLevel",
  nivelPar: "T20CP.FieldBonuses.ManualEven",
  nivelImpar: "T20CP.FieldBonuses.ManualOdd",
  total: "T20CP.FieldBonuses.ManualTotal"
};
export const HEAVY_ARMOR_KEY = "T20CP.FieldBonuses.HeavyArmorLimit";
export const MANUAL_OTHER_KEY = "T20CP.FieldBonuses.ManualOther";
export const NOT_STACKING_KEY = "T20CP.FieldBonuses.NotStacking";
export const MINIMUM_PV_KEY = "T20CP.FieldBonuses.MinimumPV";
export const ROUNDING_KEY = "T20CP.FieldBonuses.Rounding";
export const OUTROS_KEY = "system.attributes.defesa.outros";
export const CONDI_KEY = "system.attributes.defesa.condi";
/** Default priorities of Foundry 14 change types (common/constants.mjs). */
export const DEFAULT_PRIORITY = { custom: 0, multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50 };
/** Wildcard keys ActorT20._prepareProxyChange expands (T20:18195-18203); other wildcards are not applied at all. */
export const PROXY_KEYS = [
  "system.atributos.*.value",
  "system.atributos.*.bonus",
  "system.pericias.*.bonus",
  "system.pericias.*.condi",
  "system.attributes.movement.*.value",
  "system.attributes.movement.*.base",
  "system.attributes.movement.*.bonus"
];
const PHASES = ["initial", "final"];
const HELPER_TYPES = new Set(["pv", "pm", "pericias", "defesa"]);
const NUMERIC_TYPES = new Set(["add", "subtract", "multiply", "override", "upgrade", "downgrade"]);
const ARRAY_KEY =
  /^system\.(?:attributes\.(?:pv|pm)\.bonus\.(?:nivel|nivelPar|nivelImpar|total)|attributes\.defesa\.bonus|pericias\.[^.*]+\.bonus|modificadores\.pericias\.(?:geral|ataque|resistencia|semataque|atr\.[^.*]+))$/;
const TOTAL = /(<label>Total:<\/label><span>)([+-]?\d+(?:\.\d+)?)(<\/span>)/;
const EPSILON = 1e-9;
const signed = (n) => (n >= 0 ? `+${n}` : String(n));
const tidy = (n) => Math.round(n * 1e9) / 1e9;
const escapeHTML = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const phaseIndex = (phase) => (PHASES.includes(phase ?? "initial") ? PHASES.indexOf(phase ?? "initial") : PHASES.length);

/**
 * Whether the helper reads this modifiedFields key as an ArrayField(StringField) of the actor.
 * @param {string} key
 */
export function isArrayKey(key) {
  return typeof key === "string" && ARRAY_KEY.test(key);
}

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
  } catch (err) {
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
 * @param {{min?: number}} [options]  The field's minimum length (1 for the PV/PM bonus lists, T20:19252).
 * @returns {{label: string, value: unknown, hidden?: boolean}[]}
 */
export function simulateArray(seed = [], entries = [], { min = 0 } = {}) {
  const sorted = [...entries].sort((a, b) => phaseIndex(a.phase) - phaseIndex(b.phase) || a.priority - b.priority || a.seq - b.seq);
  let result = seed.map(({ label, value, hidden }) => (hidden ? { label, value, hidden } : { label, value }));
  for (const entry of sorted) {
    const item = { label: entry.label, value: entry.value };
    switch (entry.type) {
      case "override":
        result = [item];
        break;
      case "subtract": {
        const index = result.findIndex((r) => String(r.value) === String(entry.value));
        if (index >= 0 && result.length - 1 >= min) result.splice(index, 1);
        break;
      }
      case "multiply":
      case "upgrade":
      case "downgrade":
        break;
      default:
        result.push(item);
    }
  }
  return result;
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
 */
export function normalizeModifiedFields(
  modFields,
  { parts = {}, changes = [], keysOf = () => [], evaluate, resolve, seeds = {}, level = 0 } = {}
) {
  let entries = annotateEntries(modFields, changes);
  if (parts.wildcard) entries = expandWildcards(entries, keysOf);
  const groups = new Map();
  for (const key of Object.keys(seeds)) groups.set(key, []);
  for (const entry of entries) {
    if (!isArrayKey(entry.key)) continue;
    if (!groups.has(entry.key)) groups.set(entry.key, []);
    groups.get(entry.key).push(entry);
  }
  const value = (v) => (parts.formula ? evaluateValue(v, evaluate) : v);
  const result = { ...modFields };
  for (const [key, list] of groups) {
    const seed = (seeds[key] ?? []).map(({ label, value, hidden }) => (hidden ? { label, value, hidden } : { label, value }));
    const min = key in seeds && /^system\.attributes\.(?:pv|pm)\.bonus\.\w+$/.test(key) ? 1 : 0;
    // The core's subtract compares the strings with the data references resolved, not what a formula evaluates to.
    const cast = (v) => {
      if (typeof v !== "string" || typeof resolve !== "function") return v;
      try {
        return resolve(v);
      } catch (err) {
        return v;
      }
    };
    let fields = parts.types
      ? simulateArray(seed, list.map((e) => ({ ...e, value: cast(e.value) })), { min })
      : [...seed, ...[...list].sort((a, b) => a.seq - b.seq).map(({ label, value, type }) => ({ label, value, type }))];
    fields = fields.filter((f) => !f.hidden).map((f) => ({ ...f, value: value(f.value) }));
    if (parts.zeroLevel && level > 0 && levelMultiplier(key, level) === 0) fields = [];
    result[key] = fields;
  }
  return result;
}

/**
 * The value of the helper's "Configuração Manual" line (T20:4283), from the prepared lists.
 * @param {Record<string, unknown[]>} [bonus]  Prepared system.attributes[pv|pm].bonus.
 */
export function manualOverrideValue(bonus) {
  return Number(bonus?.nivel?.[0]) + Number(bonus?.nivelImpar?.[0]) + Number(bonus?.nivelPar?.[0]);
}

/**
 * Removes the last line `label: value` written by the helper before the total and corrects the total.
 * Returns the HTML unchanged when the line or the total is not found.
 * @param {string} html
 * @param {string} label  As the helper writes it (not escaped).
 * @param {number} value
 */
export function removeTooltipLine(html, label, value) {
  if (!value || !Number.isFinite(value) || typeof html !== "string") return html;
  const hr = html.lastIndexOf("<hr>");
  if (hr < 0 || !TOTAL.test(html.slice(hr))) return html;
  const line = `<li class="flexrow"><label>${label}:</label><span>${signed(value)}</span></li>`;
  const at = html.lastIndexOf(line, hr);
  if (at < 0) return html;
  const tail = html.slice(hr).replace(TOTAL, (_, open, total, close) => `${open}${signed(Number(total) - value)}${close}`);
  return html.slice(0, at) + html.slice(at + line.length, hr) + tail;
}

/**
 * The PV the helper leaves out when the Constituição it reads (value − bonus) is 0: preparePVPM (T20:20001) still
 * raises each level to at least 1 PV, but the helper only counts that inside its Constituição branch (T20:4313).
 * @param {{classes: {inicial?: boolean, porNivel: number, niveis: number}[], nivel?: number, nivelPar?: number,
 *   nivelImpar?: number}} data  Classes in item order; sums of the prepared per-level bonuses.
 */
export function pvMinimumCompensation({ classes = [], nivel = 0, nivelPar = 0, nivelImpar = 0 } = {}) {
  let levelSum = 0;
  let compensation = 0;
  for (const c of classes) {
    for (let i = 1; i < Number(c.niveis) + 1; i++) {
      levelSum++;
      let sum = c.inicial && i === 1 ? 4 * Number(c.porNivel) : Number(c.porNivel);
      sum += nivel + (levelSum % 2 === 0 ? nivelPar : nivelImpar);
      if (sum < 1) compensation += 1 - sum;
    }
  }
  return Number.isFinite(compensation) ? compensation : 0;
}

/**
 * Adds a line `label: value` before the total and corrects the total; accepts fractional values.
 * Returns the HTML unchanged when the value is 0 or the total is not found.
 * @param {string} html
 * @param {string} label  Escaped here.
 * @param {number} value
 */
export function appendTooltipLine(html, label, value) {
  if (!value || !Number.isFinite(value) || typeof html !== "string") return html;
  const hr = html.lastIndexOf("<hr>");
  if (hr < 0 || !TOTAL.test(html.slice(hr))) return html;
  const line = `<li class="flexrow"><label>${escapeHTML(label)}:</label><span>${signed(tidy(value))}</span></li>\n\t\t\t`;
  const tail = html.slice(hr).replace(TOTAL, (_, open, total, close) => `${open}${signed(tidy(Number(total) + value))}${close}`);
  return html.slice(0, hr) + line + tail;
}

/**
 * What preparePVPM's Math.floor takes from a fractional breakdown total (0 when the total is whole or not found).
 * @param {string} html
 */
export function roundingDelta(html) {
  if (typeof html !== "string") return 0;
  const hr = html.lastIndexOf("<hr>");
  const total = Number(TOTAL.exec(hr < 0 ? "" : html.slice(hr))?.[2]);
  if (!Number.isFinite(total)) return 0;
  const delta = tidy(Math.floor(tidy(total)) - total);
  return Math.abs(delta) > EPSILON ? delta : 0;
}

/**
 * What prepareDefense (T20:19892-19906) adds for the Defesa attribute minus what the helper (T20:4396-4404) shows.
 * @param {{attribute?: string, rollValue?: number, abilityValue?: number, armorType?: string, maxAtr?: number,
 *   helperHeavy?: boolean}} data  armorType/maxAtr: the first equipped light or heavy armor; helperHeavy: the helper
 *   found an equipped heavy armor with a Defesa value.
 */
export function defenseAbilityDelta({ attribute, rollValue, abilityValue, armorType, maxAtr, helperHeavy } = {}) {
  if (!attribute) return 0;
  const roll = Number(rollValue) || 0;
  const prepared = armorType !== "pesada" ? roll : Math.min(Math.max(Number(abilityValue) || 0, 0), Number(maxAtr) || 0);
  const shown = helperHeavy ? 0 : roll;
  return prepared - shown;
}

/**
 * A change value a NumberField accepts without data or a formula, or null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function plainNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Marginal contribution of each change to a numeric field, in core order (phase → priority → order), with the
 * semantics of NumberField (add, subtract, multiply, override; upgrade → max, downgrade → min).
 * Within a run of upgrades or downgrades, the change that wins (the first with the extreme value, as the core keeps
 * the current value on ties) gets the whole contribution of the run; the losers get 0.
 * @param {number} base  Value of the field before the changes.
 * @param {{label: string, type: string, value: unknown, priority?: number, phase?: string}[]} changes
 * @returns {{lines: {label: string, type: string, value: number, delta: number}[], result: number}|null}
 *   Lines in application order; null for a custom type, an unknown type or a value that is not a plain number.
 */
export function simulateNumericChanges(base, changes = []) {
  let current = Number(base);
  if (!Number.isFinite(current)) return null;
  const indexed = changes.map((change, seq) => ({ change, seq }));
  indexed.sort(
    (a, b) =>
      phaseIndex(a.change.phase) - phaseIndex(b.change.phase) ||
      (a.change.priority ?? DEFAULT_PRIORITY[a.change.type] ?? 0) - (b.change.priority ?? DEFAULT_PRIORITY[b.change.type] ?? 0) ||
      a.seq - b.seq
  );
  const lines = [];
  for (const { change } of indexed) {
    if (!NUMERIC_TYPES.has(change.type)) return null;
    const value = plainNumber(change.value);
    if (value === null) return null;
    const before = current;
    switch (change.type) {
      case "add":
        current += value;
        break;
      case "subtract":
        current -= value;
        break;
      case "multiply":
        current *= value;
        break;
      case "override":
        current = value;
        break;
      case "upgrade":
        if (value > current) current = value;
        break;
      case "downgrade":
        if (value < current) current = value;
        break;
    }
    lines.push({ label: change.label, type: change.type, value, delta: current - before, start: before, end: current });
  }
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j < lines.length && lines[j].type === lines[i].type) j++;
    if (lines[i].type === "upgrade" || lines[i].type === "downgrade") {
      const start = lines[i].start;
      const end = lines[j - 1].end;
      const winner = end === start ? -1 : lines.slice(i, j).findIndex((l) => l.value === end);
      for (let k = i; k < j; k++) lines[k].delta = k - i === winner ? end - start : 0;
    }
    i = j;
  }
  return { lines: lines.map(({ label, type, value, delta }) => ({ label, type, value, delta })), result: current };
}

/**
 * The Defesa lines that replace the helper's "Outros" line and the aggregated condition line, or null when a
 * simulation is impossible or does not match the prepared values (the tooltip then stays as it is).
 * @param {{sourceOutros: number, outrosChanges: object[], preparedOutros: number, condiBase?: number,
 *   condiChanges: object[], preparedCondi: number, skipped?: {label: string, value: number}[], manualLabel?: string}} data
 *   skipped: Caído penalties prone-defense drops (duplicates that do not stack), listed as not stacking.
 *   condiBase: persisted defesa.condi (0 for NPCs), listed as condiLabel when not 0.
 * @returns {{outros: {label: string, value: number, muted: boolean}[], condi: {label: string, value: number,
 *   muted: boolean}[]}|null}
 */
export function defenseSourceLines({
  sourceOutros,
  outrosChanges = [],
  preparedOutros,
  condiBase = 0,
  condiChanges = [],
  preparedCondi,
  skipped = [],
  manualLabel = "Outros (manual)",
  condiLabel = "Condição"
} = {}) {
  const outros = simulateNumericChanges(Number(sourceOutros) || 0, outrosChanges);
  const condi = simulateNumericChanges(Number(condiBase) || 0, condiChanges);
  if (!outros || !condi) return null;
  if (Math.abs(outros.result - (Number(preparedOutros) || 0)) > EPSILON) return null;
  if (Math.abs(condi.result - (Number(preparedCondi) || 0)) > EPSILON) return null;
  const toLine = (l) => {
    const muted = (l.type === "upgrade" || l.type === "downgrade") && l.delta === 0;
    return { label: l.label, value: muted ? l.value : l.delta, muted };
  };
  const manual = Number(sourceOutros) || 0;
  return {
    outros: [
      ...(manual ? [{ label: manualLabel, value: manual, muted: false }] : []),
      ...outros.lines.map(toLine),
      ...skipped.map((s) => ({ label: s.label, value: s.value, muted: true }))
    ],
    condi: [...(Number(condiBase) ? [{ label: condiLabel, value: Number(condiBase), muted: false }] : []), ...condi.lines.map(toLine)]
  };
}

/**
 * Replaces the helper's Defesa "Outros" line with the lines by source and adds the condition lines before the total,
 * marked with data-t20cp="condi" so field-bonuses-tooltip does not add its aggregated line. Muted lines do not count.
 * Returns the HTML unchanged when the "Outros" line (if any) or the total is not found.
 * @param {string} html
 * @param {{preparedOutros: number, outros: object[], condi: object[], notStacking?: string}} data
 */
export function applyDefenseSources(html, { preparedOutros, outros = [], condi = [], notStacking = "doesn't stack" }) {
  if (typeof html !== "string") return html;
  const hr = html.lastIndexOf("<hr>");
  if (hr < 0 || !TOTAL.test(html.slice(hr))) return html;
  const render = (line, attr = "") => {
    const cls = line.muted ? "flexrow t20cp-muted" : "flexrow";
    const value = line.muted ? `(${signed(line.value)}) ${escapeHTML(notStacking)}` : signed(line.value);
    return `<li class="${cls}"${attr}><label>${escapeHTML(line.label)}:</label><span>${value}</span></li>`;
  };
  const sum = (lines) => lines.reduce((s, l) => s + (l.muted ? 0 : l.value), 0);
  const prepared = Number(preparedOutros) || 0;
  let head = html.slice(0, hr);
  const outrosHTML = outros.map((l) => render(l)).join("");
  if (prepared) {
    const line = `<li class="flexrow"><label>Outros:</label><span>${signed(prepared)}</span></li>`;
    const at = head.lastIndexOf(line);
    if (at < 0) return html;
    head = head.slice(0, at) + outrosHTML + head.slice(at + line.length);
  } else if (outrosHTML) {
    head += `${outrosHTML}\n\t\t\t`;
  }
  const condiHTML = condi.map((l) => render(l, ' data-t20cp="condi"')).join("");
  if (condiHTML) head += `${condiHTML}\n\t\t\t`;
  const delta = sum(outros) - prepared + sum(condi);
  const tail = html.slice(hr).replace(TOTAL, (_, open, total, close) => `${open}${signed(Number(total) + delta)}${close}`);
  return head + tail;
}

/**
 * The bugs recognized in the helper's source (comments ignored).
 * @param {string|undefined} source
 * @returns {Record<string, boolean>}
 */
export function helperParts(source) {
  const parts = Object.fromEntries(PARTS.map((p) => [p, false]));
  if (typeof source !== "string" || !source) return parts;
  const code = stripComments(source);
  const defense = /case\s*["']defesa["']\s*:([\s\S]*?)case\s*["']rd["']/.exec(code)?.[1] ?? "";
  parts.manual = /Number\(\s*nivel\[0\]\s*\)\s*\+\s*Number\(\s*nivelImpar\[0\]\s*\)\s*\+\s*Number\(\s*nivelPar\[0\]\s*\)/.test(code);
  parts.zeroLevel = /\|\|\s*item\.multiplier\s*\)/.test(code) && /multiplier:\s*Math\.floor\(\s*level\s*\/\s*2\s*\)/.test(code);
  parts.formula =
    /value\.includes\(\s*["']@["']\s*\)/.test(code) &&
    /\$\{value\}\s*\*\s*\$\{item\.multiplier/.test(code) &&
    /Number\(\s*value\s*\)/.test(code);
  parts.types = /switch\s*\(\s*item\.mode\s*\)/.test(code) && !/item\.type\b/.test(code);
  parts.wildcard = /modFields\[\s*path\s*\]/.test(code) && !code.includes(".*");
  parts.heavyArmor = /defesa\.atributo\s*&&\s*!armaduraPesada/.test(defense) && !/maxAtr/.test(defense);
  parts.defenseSources =
    /defesa\.outros\s*\?\s*\{\s*label:\s*["']Outros["']\s*,\s*value:\s*defesa\.outros\s*\}/.test(defense) && !/\bcondi\b/.test(defense);
  return parts;
}

/**
 * Reads the helper's source. Source reading never proves a fix.
 * @param {string|undefined} source
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseHelperSource(source) {
  if (typeof source !== "string" || !source) return { bug: "unknown", confidence: "low", evidence: "fieldBonuses source unavailable" };
  const parts = helperParts(source);
  const found = PARTS.filter((p) => parts[p]);
  const missing = PARTS.filter((p) => !parts[p]);
  if (!missing.length) return { bug: "present", confidence: "high", evidence: `recognized: ${found.join(", ")}` };
  if (found.length) return { bug: "present", confidence: "low", evidence: `recognized: ${found.join(", ")}; not recognized: ${missing.join(", ")}` };
  return { bug: "unknown", confidence: "low", evidence: "fieldBonuses not recognized" };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

let warned = false;

function warnOnce(message, err) {
  if (!warned) console.warn(`${LOG} ${message}`, err);
  warned = true;
}

function helperSource(fn) {
  const base = unwrap(fn);
  return typeof base === "function" ? Function.prototype.toString.call(base) : undefined;
}

/** The actor the helper reads (T20:4256), from the root it receives. */
function helperActor(root) {
  return game.actors?.get(root?.actor?._id) || foundry.utils.fromUuidSync(root?.uuid) || null;
}

function appliedChanges(actor) {
  const changes = [];
  for (const effect of actor.appliedEffects ?? []) {
    if (!effect?.modifiesActor) continue;
    for (const ch of effect.changes ?? []) {
      changes.push({ key: ch.key, label: effect.name, value: ch.value, type: ch.type, priority: ch.priority, phase: ch.phase });
    }
  }
  return changes;
}

function proxyKeys(actor, path) {
  const property = foundry.utils.getProperty(actor, path);
  if (!property || typeof property !== "object") return [];
  const keys = Object.keys(property);
  return path === "system.attributes.movement" ? keys.filter((k) => CONFIG.T20?.movementTypes?.[k]) : keys;
}

function heavyArmorLine(actor, rollData) {
  const attribute = actor.system?.attributes?.defesa?.atributo;
  if (!attribute) return null;
  const slots = game.settings.get("tormenta20", "equipmentSlots");
  const equipped = (actor.itemTypes?.equipamento ?? []).filter((i) => (slots ? i.system.equipado2?.slot : i.system.equipado));
  const armor = equipped.find((i) => ["leve", "pesada"].includes(i.system.tipo));
  const delta = defenseAbilityDelta({
    attribute,
    rollValue: rollData?.[attribute],
    abilityValue: actor.system.atributos?.[attribute]?.value,
    armorType: armor?.system.tipo,
    maxAtr: armor?.system.armadura?.maxAtr,
    helperHeavy: equipped.some((i) => i.system.armadura?.value && i.system.tipo === "pesada")
  });
  if (!delta) return null;
  const label = `${game.i18n.localize(CONFIG.T20.atributos[attribute] ?? attribute)} (${game.i18n.localize(HEAVY_ARMOR_KEY)})`;
  return { label, value: delta };
}

function moduleStatus() {
  return game.modules?.get(MODULE_ID)?.api?.status;
}

/**
 * The changes the core applies to defesa.outros and defesa.condi (Actor#applyActiveEffects: active applicable
 * effects whose shouldApplyChange accepts the change in its phase), with the Caído penalty as prone-defense applies
 * it when that patch is on.
 */
function defenseChanges(actor) {
  const outros = [];
  const condi = [];
  const skipped = [];
  const effects = [...(actor.allApplicableEffects?.() ?? [])].filter((e) => e?.active);
  const proneOn = isPatchApplied(moduleStatus(), "prone-defense");
  const candidates = proneOn ? collectProneCandidates(effects) : [];
  let counted = false;
  for (const effect of effects) {
    for (const change of effect.system?.changes ?? []) {
      if (change.key !== OUTROS_KEY && change.key !== CONDI_KEY) continue;
      const phase = change.phase ?? "initial";
      if (typeof effect.shouldApplyChange === "function" && !effect.shouldApplyChange(change, { phase })) continue;
      let type = change.type;
      if (proneOn && change.key === OUTROS_KEY && isProneDefenseChange(change) && effect.statuses?.has(PRONE)) {
        const plan = planProneChange({ effect, change, eligible: phase === "initial", alreadyCounted: counted }, candidates);
        if (plan === "skip") {
          skipped.push({ label: effect.name, value: Number(change.value) });
          continue;
        }
        if (plan === "add" || plan === "count") counted = true;
        if (plan === "add") type = "add";
      }
      const entry = { label: effect.name, type, value: change.value, priority: change.priority, phase };
      (change.key === OUTROS_KEY ? outros : condi).push(entry);
    }
  }
  return { outros, condi, skipped };
}

function defenseSourcesHTML(html, actor) {
  const defesa = actor.system?.attributes?.defesa;
  const source = actor._source?.system?.attributes?.defesa;
  if (!defesa || !source) return html;
  const includeCondi = isPatchApplied(moduleStatus(), "field-bonuses-tooltip");
  const changes = defenseChanges(actor);
  const lines = defenseSourceLines({
    sourceOutros: source.outros,
    outrosChanges: changes.outros,
    preparedOutros: defesa.outros,
    // NpcData#prepareBaseData resets condi before the effects (T20:20235).
    condiBase: actor.type === "npc" ? 0 : source.condi,
    condiChanges: changes.condi,
    preparedCondi: defesa.condi,
    skipped: changes.skipped,
    manualLabel: game.i18n.localize(MANUAL_OTHER_KEY),
    condiLabel: game.i18n.localize("T20CP.FieldBonuses.Condition")
  });
  if (!lines) return html;
  return applyDefenseSources(html, {
    preparedOutros: defesa.outros,
    outros: lines.outros,
    condi: includeCondi ? lines.condi : [],
    notStacking: game.i18n.localize(NOT_STACKING_KEY)
  });
}

/** The PV minimum and the rounding preparePVPM applies, which the helper leaves out. */
function resourceHTML(html, actor, type, rollData, context) {
  if (type === "pv") {
    const { substituirCon: con = "con" } = actor.flags?.tormenta20 ?? {};
    const ability = context?.system?.atributos?.[con];
    if (ability && !(ability.value - ability.bonus)) {
      const bonus = actor.system.attributes.pv.bonus;
      const sum = (list) =>
        (Array.isArray(list) ? list : []).reduce(
          (total, v) => total + Number(evaluateValue(v, (f) => foundry.dice.Roll.create(resolveDataRefs(f, rollData)).evaluateSync().total)),
          0
        );
      const compensation = pvMinimumCompensation({
        classes: (actor.items ?? [])
          .filter((i) => i.type === "classe")
          .map((c) => ({ inicial: c.system.inicial, porNivel: c.system.pvPorNivel, niveis: c.system.niveis })),
        nivel: sum(bonus.nivel),
        nivelPar: sum(bonus.nivelPar),
        nivelImpar: sum(bonus.nivelImpar)
      });
      const label = `${game.i18n.localize(CONFIG.T20.atributos[con] ?? con)} (${game.i18n.localize(MINIMUM_PV_KEY)})`;
      html = appendTooltipLine(html, label, compensation);
    }
  }
  return appendTooltipLine(html, game.i18n.localize(ROUNDING_KEY), roundingDelta(html));
}

function apply() {
  const original = globalThis.Handlebars?.helpers?.fieldBonuses;
  if (typeof original !== "function") throw new Error("Handlebars helper fieldBonuses not found");
  const parts = helperParts(helperSource(original));
  const inputs = INPUT_PARTS.some((p) => parts[p]);
  if (!inputs && !parts.heavyArmor && !parts.defenseSources) {
    console.warn(`${LOG} fieldBonuses not recognized; nothing to fix`);
    return;
  }
  Handlebars.registerHelper(
    "fieldBonuses",
    markWrapper(function (path, options) {
      const [type, key] = fieldTerms(path);
      if (!HELPER_TYPES.has(type) || (type === "defesa" && key === "pda")) return original.call(this, path, options);
      const resource = type === "pv" || type === "pm";
      let actor = null;
      let rollData = null;
      let shadowed = false;
      let seeded = false;
      try {
        actor = helperActor(options?.data?.root);
        if (actor && inputs && !Object.hasOwn(actor, "modifiedFields")) {
          rollData = actor.getRollData();
          const data = rollData;
          const seeds =
            parts.manual && resource ? manualEntries(type, actor._source?.system?.attributes?.[type]?.bonus, (k) => game.i18n.localize(k)) : {};
          const fields = normalizeModifiedFields(actor.modifiedFields ?? {}, {
            parts,
            changes: appliedChanges(actor),
            keysOf: (p) => proxyKeys(actor, p),
            evaluate: (formula) => foundry.dice.Roll.create(resolveDataRefs(formula, data)).evaluateSync().total,
            resolve: (value) => resolveDataRefs(value, data),
            seeds,
            level: Number(actor.system?.attributes?.nivel?.value) || 0
          });
          Object.defineProperty(actor, "modifiedFields", { value: fields, configurable: true, writable: true });
          shadowed = true;
          seeded = parts.manual && resource;
        }
      } catch (err) {
        warnOnce("could not normalize the effects of the breakdown", err);
      }
      let html;
      try {
        html = original.call(this, path, options);
      } finally {
        if (shadowed) delete actor.modifiedFields;
      }
      if (!actor || typeof html !== "string") return html;
      try {
        if (seeded) {
          const label = game.i18n.localize("T20.ManualOverride");
          html = removeTooltipLine(html, label, manualOverrideValue(actor.system.attributes[type].bonus));
        }
        if (parts.manual && resource && !actor.flags?.tormenta20?.lvlconfig?.manual) {
          html = resourceHTML(html, actor, type, rollData ?? actor.getRollData(), this);
        }
        if (parts.defenseSources && type === "defesa") html = defenseSourcesHTML(html, actor);
        if (parts.heavyArmor && type === "defesa") {
          const line = heavyArmorLine(actor, rollData ?? actor.getRollData());
          if (line) html = addTooltipLine(html, line.label, line.value);
        }
      } catch (err) {
        warnOnce("could not adjust the breakdown", err);
      }
      return html;
    }, original)
  );
}

function isNeeded() {
  return diagnoseHelperSource(helperSource(globalThis.Handlebars?.helpers?.fieldBonuses));
}

export default {
  id: "field-bonuses-breakdown",
  group: "sheet-effects",
  issue: 70,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  apply
};
