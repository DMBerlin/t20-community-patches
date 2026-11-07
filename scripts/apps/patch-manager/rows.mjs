/**
 * Pure row building of the Center (#89): the patch and rule rows, their groups, the filter buttons, the search text and
 * what a submitted form changes. Everything Foundry-specific (translations, DataFields, setting entries) comes by
 * parameter.
 */
import { displayState } from "../../kernel/diagnosis.mjs";
import { controlsFromMode, modeFromControls } from "../../kernel/modes.mjs";
import { STATE_CATEGORIES, countCategories, reportIssueUrl, stateCategory } from "../../kernel/center.mjs";
import { patchBucket, ruleBucket } from "./view.mjs";

export const ICONS = Object.freeze({
  active: "fa-solid fa-circle-check",
  unneeded: "fa-solid fa-circle-check",
  attention: "fa-solid fa-triangle-exclamation",
  error: "fa-solid fa-circle-xmark",
  off: "fa-regular fa-circle"
});

/** Input names. Patch ids and setting keys never contain ":". */
export const PATCH_INPUT = "patch:";
export const ALWAYS_INPUT = "always:";
export const SETTING_INPUT = "setting:";

/**
 * @typedef {object} Text  What the rows read from the translations (platform.i18n and platform.utils.escapeHTML).
 * @property {(key: string) => string} localize
 * @property {(key: string, data?: object) => string} format
 * @property {(value: unknown) => string} escapeHTML
 * @property {string} lang  game.i18n.lang
 */

/**
 * @param {string} text
 * @param {string} [lang]
 */
export function normalizeSearch(text, lang) {
  return (text ?? "").toLocaleLowerCase(lang);
}

/** Lowercased text the search looks in: the localized name and the id. */
export function searchText(name, id, lang) {
  return normalizeSearch(`${name} ${id}`, lang);
}

/**
 * One line with the diagnosis behind the state.
 * @param {import("../../kernel/diagnosis.mjs").Diagnosis|undefined} diagnosis
 * @param {Text} text
 */
export function describeDiagnosis(diagnosis, text) {
  if (!diagnosis) return "";
  return text.format("T20CP.Diagnosis.Line", {
    bug: text.localize(`T20CP.Diagnosis.Bug.${diagnosis.bug}`),
    confidence: text.localize(`T20CP.Diagnosis.Confidence.${diagnosis.confidence}`),
    evidence: diagnosis.evidence ? ` (${text.escapeHTML(diagnosis.evidence)})` : ""
  });
}

/**
 * Row of the patches tab.
 * @param {{patch: {id: string, group: string, issue?: number}, entry?: object, mode: string, bugs?: string,
 *   versions: object}} data  entry: the patch's api.status entry.
 * @param {Text} text
 */
export function patchRow({ patch, entry, mode, bugs, versions }, text) {
  const { state = "disabled", diagnosis, reason, changed } = entry ?? {};
  const shown = displayState(state, diagnosis);
  const category = stateCategory(shown);
  const name = text.localize(`T20CP.Patches.${patch.id}.Name`);
  const link =
    category === "attention"
      ? { url: reportIssueUrl({ bugs, patch, name, state: shown, mode, diagnosis, versions }), label: "T20CP.Manager.Report" }
      : { url: patch.issue && bugs ? `${bugs}/${patch.issue}` : null, label: "T20CP.Manager.Details" };
  return {
    id: patch.id,
    group: patch.group,
    name,
    search: searchText(name, patch.id, text.lang),
    bucket: patchBucket(category),
    hint: text.localize(`T20CP.Patches.${patch.id}.Hint`),
    mode,
    ...controlsFromMode(mode),
    category,
    icon: ICONS[shown === "error" ? "error" : category],
    iconClass: shown === "error" ? "error" : category,
    changed: !!changed,
    stateLabel: text.localize(`T20CP.States.${shown}.Label`),
    stateHint: [text.format(`T20CP.States.${shown}.Hint`, { reason: text.escapeHTML(reason ?? "") }), describeDiagnosis(diagnosis, text)]
      .filter(Boolean)
      .join(" "),
    link: link.url ? link : null
  };
}

/**
 * Category counts of the patch rows and the header line ("3 active · 1 needs attention").
 * @param {{id: string}[]} rows
 * @param {Map<string, {state: string, diagnosis?: object}>} status
 * @param {Text} text
 */
export function patchSummary(rows, status, text) {
  const counts = countCategories(rows.map((r) => (status.has(r.id) ? displayState(status.get(r.id).state, status.get(r.id).diagnosis) : "disabled")));
  const plural = new Intl.PluralRules(text.lang);
  const summary = STATE_CATEGORIES.filter((c) => counts[c])
    .map((c) => text.format(`T20CP.Manager.Count.${c}.${plural.select(counts[c]) === "one" ? "one" : "other"}`, { count: counts[c] }))
    .join(" · ");
  return { counts, summary };
}

/**
 * Whether a saved mode differs from the one used at load time, so it only takes effect after a reload.
 * @param {{id: string, mode: string}[]} rows
 * @param {Map<string, {mode: string}>} status
 */
export function pendingReload(rows, status) {
  return rows.some((r) => status.has(r.id) && status.get(r.id).mode !== r.mode);
}

/**
 * Row of the "Optional rules" tab, or null when none of its settings is registered on this load.
 * @param {{id: string, group: string, keys: string[]}} center  Entry of centerSettings (scripts/kernel/settings.mjs).
 * @param {{key: string, value: unknown, label: string}[]} entries  The registered settings of the entry, in order.
 * @param {Text} text
 * @param {(keys: string[]) => unknown[]|undefined} [neutralOf]  Neutral values of some keys (ruleBucket).
 */
export function ruleRow({ id, group, keys }, entries, text, neutralOf = () => undefined) {
  if (!entries.length) return null;
  const shown = entries.map((e) => e.key);
  const view = { id, group, keys: shown.join(" "), bucket: ruleBucket(entries.map((e) => e.value), neutralOf(shown)) };
  if (keys.length === 1) return { ...view, single: true, ...entries[0], search: searchText(entries[0].label, id, text.lang) };
  const label = text.localize(`T20CP.Manager.Rules.${id}`);
  return { ...view, single: false, label, entries, search: searchText(label, id, text.lang) };
}

/**
 * Rows grouped in GROUPS order (unknown groups last), skipping empty groups.
 * @template {{group: string}} T
 * @param {T[]} rows
 * @param {string[]} groups  GROUPS
 * @param {(key: string) => string} localize
 * @returns {{id: string, label: string, rows: T[]}[]}
 */
export function groupRows(rows, groups, localize) {
  const ids = [...groups, ...new Set(rows.map((r) => r.group).filter((g) => !groups.includes(g)))];
  return ids
    .map((id) => ({ id, label: localize(`T20CP.Groups.${id}`), rows: rows.filter((r) => r.group === id) }))
    .filter((g) => g.rows.length);
}

/**
 * @param {string[]} filters
 * @param {(key: string) => string} localize
 * @param {Record<string, boolean>} [disabled]
 */
export function filterButtons(filters, localize, disabled = {}) {
  return filters.map((id) => ({ id, label: localize(`T20CP.Manager.Filter.${id}`), disabled: !!disabled[id] }));
}

/**
 * The DataField behind a setting, as in the core SettingsConfig: the setting's own field, or one built from its type
 * and choices.
 * @param {object} setting  Entry of game.settings.settings.
 * @param {object} fields   foundry.data.fields (platform.core.fields).
 */
export function settingField(setting, fields) {
  if (setting.type instanceof fields.DataField) return setting.type;
  if (setting.type === Boolean) return new fields.BooleanField({ initial: setting.default ?? false });
  if (setting.type === Number) {
    const { min, max, step } = setting.range ?? {};
    return new fields.NumberField({ required: true, choices: setting.choices, initial: setting.default, min, max, step });
  }
  return new fields.StringField({ required: true, choices: setting.choices, initial: setting.default });
}

/**
 * What the submitted form changes, compared with what was rendered.
 * @param {Record<string, unknown>} submitted  FormDataExtended#object
 * @param {{patches: {id: string}[], snapshot: Record<string, string>, ruleSnapshot: Record<string, unknown>,
 *   entry: (key: string) => object|undefined, fields: object}} rendered  entry: the registered setting of a key.
 */
export function collectChanges(submitted, { patches: features, snapshot, ruleSnapshot, entry, fields }) {
  const patches = [];
  for (const patch of features) {
    const key = `${PATCH_INPUT}${patch.id}`;
    if (!(key in submitted)) continue;
    const mode = modeFromControls({ enabled: !!submitted[key], always: !!submitted[`${ALWAYS_INPUT}${patch.id}`] });
    if (mode !== snapshot[patch.id]) patches.push({ id: patch.id, mode });
  }
  const settings = [];
  for (const [key, before] of Object.entries(ruleSnapshot)) {
    const name = `${SETTING_INPUT}${key}`;
    const setting = name in submitted ? entry(key) : null;
    if (!setting) continue;
    const field = settingField(setting, fields);
    const value = field.clean(submitted[name]);
    if (value === before) continue;
    settings.push({ key, value, field, label: setting.name, requiresReload: !!setting.requiresReload });
  }
  return { patches, settings };
}
