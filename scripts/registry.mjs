import { compareVersions } from "./utils.mjs";

/**
 * @typedef {"applied"|"applied-unverified"|"applied-guarded"|"suspected-fixed"|"forced"|"disabled"|"fixed"|"unverified"|"incompatible"|"error"} PatchState
 * @typedef {"auto"|"off"|"force"} PatchMode
 */

/**
 * @typedef {object} Diagnosis
 * @property {"present"|"fixed"|"unknown"} bug
 * @property {"high"|"low"} confidence  "high" only when the evidence covers everything the patch fixes.
 * @property {string} [evidence]         Short text for the badge tooltip and the log.
 */

/** States in which the patch's apply() must be called. */
export const APPLY_STATES = new Set(["applied", "applied-unverified", "applied-guarded", "suspected-fixed", "forced"]);

/**
 * Whether a patch's apply() ran, according to the status list built on init.
 * @param {{id: string, state: PatchState}[]|undefined} status
 * @param {string} id
 * @returns {boolean}
 */
export function isPatchApplied(status, id) {
  const entry = Array.isArray(status) ? status.find((s) => s?.id === id) : undefined;
  return !!entry && APPLY_STATES.has(entry.state);
}

const BUGS = new Set(["present", "fixed", "unknown"]);

/**
 * Converts what a probe returned into a Diagnosis. Legacy booleans: true → present/high, false → fixed/low
 * (a hint, never enough to skip the patch alone), undefined → unknown/low.
 * @param {Diagnosis|boolean|undefined} result
 * @returns {Diagnosis}
 */
export function normalizeDiagnosis(result) {
  if (result === true) return { bug: "present", confidence: "high" };
  if (result === false) return { bug: "fixed", confidence: "low" };
  if (result && typeof result === "object" && BUGS.has(result.bug)) {
    const diagnosis = { bug: result.bug, confidence: result.confidence === "high" ? "high" : "low" };
    if (result.evidence) diagnosis.evidence = String(result.evidence);
    return diagnosis;
  }
  return { bug: "unknown", confidence: "low" };
}

/**
 * Runs a probe without letting it throw. An exception becomes unknown/low with its message as evidence.
 * @param {(() => Diagnosis|boolean|undefined)|undefined} probe
 * @returns {Diagnosis}
 */
export function runProbe(probe) {
  if (typeof probe !== "function") return normalizeDiagnosis(undefined);
  try {
    return normalizeDiagnosis(probe());
  } catch (err) {
    return { bug: "unknown", confidence: "low", evidence: err?.message ?? String(err) };
  }
}

/**
 * Decide what to do with a patch. Pure: the runtime probe is passed in as a function.
 * The probe runs in every mode except when the system is incompatible, so a disabled patch still learns that the
 * system fixed the bug. In "auto", only a high-confidence fix skips the patch.
 * @param {object} args
 * @param {{guarded?: boolean, system: {id: string, affected?: {minimum?: string, maximum?: string}}}} args.patch
 * @param {PatchMode} args.mode
 * @param {string} args.systemId
 * @param {string} args.systemVersion
 * @param {() => Diagnosis|boolean|undefined} [args.probe]
 * @returns {{state: PatchState, diagnosis?: Diagnosis, reason?: string}}
 */
export function resolvePatchState({ patch, mode, systemId, systemVersion, probe }) {
  const { id, affected = {} } = patch.system;
  const version = `${systemId} ${systemVersion}`;
  const incompatible =
    systemId !== id || (!!affected.minimum && compareVersions(systemVersion, affected.minimum) < 0);
  if (incompatible) {
    if (mode === "off") return { state: "disabled" };
    return { state: "incompatible", reason: systemId !== id ? systemId : version };
  }

  const diagnosis = runProbe(probe);
  if (mode === "off") return { state: "disabled", diagnosis, reason: version };
  if (mode === "force") return { state: "forced", diagnosis, reason: version };

  const fixedHigh = diagnosis.bug === "fixed" && diagnosis.confidence === "high";
  if (fixedHigh) return { state: "fixed", diagnosis, reason: version };

  const aboveRange = !!affected.maximum && compareVersions(systemVersion, affected.maximum) > 0;
  if (!aboveRange) {
    return { state: diagnosis.bug === "fixed" ? "suspected-fixed" : "applied", diagnosis, reason: version };
  }
  if (diagnosis.bug === "present") return { state: "applied-unverified", diagnosis, reason: version };
  if (patch.guarded) return { state: "applied-guarded", diagnosis, reason: version };
  return { state: "unverified", diagnosis, reason: version };
}

/**
 * Applies a diagnosis found after "ready" (lateProbe). The patch is already installed or not, so the new state
 * never switches between applied and not applied; only the diagnosis and the wording can change.
 * @param {object} args
 * @param {object} args.patch
 * @param {PatchMode} args.mode
 * @param {PatchState} args.state       State resolved during "init".
 * @param {string} args.systemId
 * @param {string} args.systemVersion
 * @param {Diagnosis|boolean} late
 * @returns {{state: PatchState, diagnosis: Diagnosis}}
 */
export function applyLateDiagnosis({ patch, mode, state, systemId, systemVersion }, late) {
  const next = resolvePatchState({ patch, mode, systemId, systemVersion, probe: () => late });
  if (APPLY_STATES.has(next.state) !== APPLY_STATES.has(state)) return { state, diagnosis: next.diagnosis };
  return { state: next.state, diagnosis: next.diagnosis };
}

/**
 * @typedef {object} StatusRecord   What each GM saw on the previous load (`lastStatus[id]`).
 * @property {string} state         Display state (see displayState).
 * @property {"present"|"fixed"|"unknown"} [bug]
 * @property {"high"|"low"} [confidence]
 * @property {string} [systemVersion]
 */

/** Display states that are worth a notification when they appear. */
const ATTENTION = new Set([
  "fixed",
  "disabled-fixed",
  "suspected-fixed",
  "unverified",
  "applied-unverified",
  "applied-guarded",
  "incompatible"
]);
const FIXED_STATES = new Set(["fixed", "disabled-fixed"]);

/**
 * Reads a `lastStatus` entry. Earlier versions stored only the state string.
 * @param {unknown} value
 * @returns {StatusRecord|undefined}
 */
export function readStatusRecord(value) {
  if (typeof value === "string") return { state: value };
  if (value && typeof value === "object" && typeof value.state === "string") return /** @type {StatusRecord} */ (value);
  return undefined;
}

/**
 * Builds the `lastStatus` entry for a patch on this load.
 * @param {{state: PatchState, diagnosis?: Diagnosis}} entry
 * @param {string} systemVersion
 * @returns {StatusRecord}
 */
export function statusRecord({ state, diagnosis }, systemVersion) {
  const record = { state: displayState(state, diagnosis), systemVersion };
  if (diagnosis) Object.assign(record, { bug: diagnosis.bug, confidence: diagnosis.confidence });
  return record;
}

/**
 * Which notification, if any, the GM gets for a patch, given what they saw on the previous load.
 * - errors always;
 * - "regression" when a patch seen as fixed is applied again because the bug was detected;
 * - states that need attention, when they change or reappear on another system version.
 * A system fix (fixed, disabled-fixed) is informative; everything else is a warning.
 * @param {StatusRecord} current
 * @param {unknown} previous  Raw `lastStatus[id]`.
 * @returns {{key: string, level: "info"|"warn"|"error"}|null}
 */
export function pickNotification(current, previous) {
  if (current.state === "error") return { key: "error", level: "error" };
  const last = readStatusRecord(previous);
  if (last && FIXED_STATES.has(last.state) && current.bug === "present" && APPLY_STATES.has(current.state)) {
    return { key: "regression", level: "warn" };
  }
  if (!ATTENTION.has(current.state)) return null;
  const sameVersion = !last?.systemVersion || last.systemVersion === current.systemVersion;
  if (last?.state === current.state && sameVersion) return null;
  // A late probe may have confirmed the bug on an earlier load; going back to "guarded" is not news.
  if (current.state === "applied-guarded" && last?.state === "applied-unverified" && sameVersion) return null;
  return { key: current.state, level: FIXED_STATES.has(current.state) ? "info" : "warn" };
}

/**
 * Notification for a late diagnosis. It is compared with the previous load, so a regression is still reported and
 * a result already known is not repeated, and with this load's initial record, so nothing is shown twice.
 * @param {StatusRecord} late
 * @param {StatusRecord} initial   Record notified on "ready" in this load.
 * @param {unknown} previous       Record saved by the previous load.
 * @returns {{key: string, level: "info"|"warn"|"error"}|null}
 */
export function pickLateNotification(late, initial, previous) {
  const next = pickNotification(late, previous);
  if (!next || next.key === pickNotification(initial, previous)?.key) return null;
  if (next.key === "regression") return next;
  return pickNotification(late, initial) ? next : null;
}

/** Preference values, in the order shown in the patch manager. */
export const MODES = ["auto", "off", "force"];

/**
 * Reads a stored preference. Booleans from earlier versions: true → "auto", false → "off". Without a value, the
 * 0.1.0 setting decides (false → "off"), and otherwise "auto".
 * @param {unknown} value        `patches[id]`
 * @param {unknown} [legacy]     The 0.1.0 Boolean setting of the patch.
 * @returns {PatchMode}
 */
export function normalizeMode(value, legacy) {
  if (MODES.includes(value)) return /** @type {PatchMode} */ (value);
  if (value === true) return "auto";
  if (value === false) return "off";
  return legacy === false ? "off" : "auto";
}

/**
 * Rewrites booleans and 0.1.0 settings as modes, keeping the effective behavior.
 * @param {Record<string, unknown>} current  `patches` setting.
 * @param {string[]} ids
 * @param {(id: string) => unknown} legacy   Reads the 0.1.0 setting of a patch.
 * @returns {{next: Record<string, unknown>, migrated: string[]}|null}  null when nothing changes.
 */
export function planModeMigration(current, ids, legacy) {
  const next = { ...(current ?? {}) };
  const migrated = [];
  for (const id of ids) {
    if (MODES.includes(next[id])) continue;
    const mode = normalizeMode(next[id], next[id] === undefined ? legacy(id) : undefined);
    if (next[id] === undefined && mode === "auto") continue;
    next[id] = mode;
    migrated.push(id);
  }
  return migrated.length ? { next, migrated } : null;
}

/**
 * State shown in the badge. A patch turned off on a system that fixed the bug says so, so the GM knows the
 * preference can stay off.
 * @param {PatchState} state
 * @param {Diagnosis} [diagnosis]
 * @returns {PatchState|"disabled-fixed"}
 */
export function displayState(state, diagnosis) {
  if (state === "disabled" && diagnosis?.bug === "fixed" && diagnosis.confidence === "high") return "disabled-fixed";
  return state;
}

/**
 * @typedef {"active"|"unneeded"|"attention"|"off"} StateCategory
 */

const CATEGORIES = {
  active: ["applied", "forced", "applied-unverified", "applied-guarded", "suspected-fixed"],
  unneeded: ["fixed", "disabled-fixed"],
  attention: ["unverified", "error"],
  off: ["disabled", "incompatible"]
};
const CATEGORY_OF = new Map(Object.entries(CATEGORIES).flatMap(([category, states]) => states.map((s) => [s, category])));

/** Category order, as shown in the Center header. */
export const STATE_CATEGORIES = ["active", "unneeded", "attention", "off"];

/**
 * Groups the display states in the four categories the GM sees. An unknown state needs attention.
 * @param {string} state  Display state (see displayState).
 * @returns {StateCategory}
 */
export function stateCategory(state) {
  return /** @type {StateCategory} */ (CATEGORY_OF.get(state) ?? "attention");
}

/**
 * Counts the display states by category.
 * @param {string[]} states
 * @returns {Record<StateCategory, number>}
 */
export function countCategories(states) {
  const counts = Object.fromEntries(STATE_CATEGORIES.map((c) => [c, 0]));
  for (const state of states) counts[stateCategory(state)]++;
  return /** @type {Record<StateCategory, number>} */ (counts);
}

/**
 * Mode saved for the switch and the "Apply always" box. A switch turned off ignores the box.
 * @param {{enabled: boolean, always?: boolean}} controls
 * @returns {PatchMode}
 */
export function modeFromControls({ enabled, always }) {
  if (!enabled) return "off";
  return always ? "force" : "auto";
}

/**
 * Inverse of modeFromControls.
 * @param {PatchMode} mode
 * @returns {{enabled: boolean, always: boolean}}
 */
export function controlsFromMode(mode) {
  return { enabled: mode !== "off", always: mode === "force" };
}

/**
 * Whether saving needs a world reload: any patch mode change (apply() only runs on init) or a changed setting
 * registered with `requiresReload`.
 * @param {string[]} changedPatches                    Ids whose mode changed.
 * @param {{requiresReload?: boolean}[]} changedSettings
 * @returns {boolean}
 */
export function needsReload(changedPatches, changedSettings) {
  return changedPatches.length > 0 || changedSettings.some((s) => !!s?.requiresReload);
}

/** Summary sections, in display order, and the notification keys of pickNotification each one gathers. */
export const NOTIFICATION_SECTIONS = [
  ["error", ["error"]],
  ["regression", ["regression"]],
  ["fixed", ["fixed", "disabled-fixed"]],
  ["suspected-fixed", ["suspected-fixed"]],
  ["unverified", ["unverified"]],
  ["unverified-applied", ["applied-unverified", "applied-guarded"]],
  ["incompatible", ["incompatible"]]
];
const SECTION_OF = new Map(NOTIFICATION_SECTIONS.flatMap(([section, keys]) => keys.map((k) => [k, section])));
const LEVELS = ["info", "warn", "error"];
const PERMANENT_KEYS = new Set(["error", "regression"]);

/**
 * @typedef {object} NotificationSummary
 * @property {"info"|"warn"|"error"} level   The most severe level among the entries.
 * @property {boolean} permanent              Only errors and regressions stay until dismissed.
 * @property {{section: string, names: string[], more: number}[]} sections
 * @property {string[]} ids                   Patches cited in the summary.
 */

/**
 * Joins the notifications picked for several patches into one summary.
 * @param {{id: string, name: string, key: string, level: "info"|"warn"|"error"}[]} entries
 * @param {number} [maxNames=3]  Names listed per section; the rest is counted.
 * @returns {NotificationSummary|null}  null when there is nothing to notify.
 */
export function summarizeNotifications(entries, maxNames = 3) {
  const valid = (entries ?? []).filter((e) => e && SECTION_OF.has(e.key));
  if (!valid.length) return null;
  const sections = [];
  for (const [section] of NOTIFICATION_SECTIONS) {
    const names = valid.filter((e) => SECTION_OF.get(e.key) === section).map((e) => e.name);
    if (names.length) sections.push({ section, names: names.slice(0, maxNames), more: Math.max(0, names.length - maxNames) });
  }
  const level = LEVELS[Math.max(...valid.map((e) => Math.max(0, LEVELS.indexOf(e.level))))];
  return {
    level: /** @type {"info"|"warn"|"error"} */ (level),
    permanent: valid.some((e) => PERMANENT_KEYS.has(e.key)),
    sections,
    ids: valid.map((e) => e.id)
  };
}

/**
 * Text of a summary. `t(key, data)` is the localization function (game.i18n.format).
 * @param {NotificationSummary} summary
 * @param {string} system  For example "Tormenta20 1.6.5".
 * @param {(key: string, data?: object) => string} t
 * @returns {string}
 */
export function summaryMessage(summary, system, t) {
  const separator = t("T20CP.Notifications.Separator");
  const sections = summary.sections.map(({ section, names, more }) => {
    const list = names.join(", ");
    const shown = more ? t("T20CP.Notifications.More", { names: list, count: more }) : list;
    return t(`T20CP.Notifications.Sections.${section}`, { names: shown });
  });
  return t("T20CP.Notifications.Summary", { system, sections: sections.join(separator) });
}

/**
 * Gathers late diagnoses (lateProbe) into one summary, emitted when every pending probe settles or after `delay`,
 * whichever comes first. A result settled after that is emitted on its own.
 * @param {object} args
 * @param {number} args.pending                                   Probes that will settle.
 * @param {(entries: object[]) => void} args.emit                 Receives a non-empty batch of notification entries.
 * @param {(fn: () => void, ms: number) => unknown} args.setTimer
 * @param {(handle: unknown) => void} [args.clearTimer]
 * @param {number} [args.delay=10000]
 * @returns {{settle: (entry?: object|null) => void}}
 */
export function createLateSummary({ pending, emit, setTimer, clearTimer = () => {}, delay = 10000 }) {
  let open = pending > 0;
  let remaining = pending;
  const batch = [];
  let timer = null;
  const flush = () => {
    if (!open) return;
    open = false;
    if (timer !== null) clearTimer(timer);
    if (batch.length) emit(batch.splice(0));
  };
  if (open) timer = setTimer(flush, delay);
  return {
    settle(entry) {
      if (entry) {
        if (open) batch.push(entry);
        else emit([entry]);
      }
      remaining--;
      if (remaining <= 0) flush();
    }
  };
}

/**
 * URL of a new prefilled issue for a patch that needs attention. Only closed fields go in the URL: evidence and
 * reason may hold arbitrary exception messages, so they never do.
 * @param {object} args
 * @param {string} [args.bugs]           The module's `bugs` URL.
 * @param {{id: string, issue?: number}} args.patch
 * @param {string} args.name             Localized patch name.
 * @param {string} args.state            Display state.
 * @param {PatchMode} args.mode
 * @param {Diagnosis} [args.diagnosis]
 * @param {{system?: string, foundry?: string, module?: string}} [args.versions]
 * @returns {string|null}
 */
export function reportIssueUrl({ bugs, patch, name, state, mode, diagnosis, versions = {} }) {
  if (!bugs || !patch?.id) return null;
  const base = String(bugs).replace(/\/+$/, "");
  const title = `[${patch.id}] ${state}`;
  const lines = [
    `**Correção:** ${name} (\`${patch.id}\`)`,
    patch.issue ? `**Issue original:** #${patch.issue}` : null,
    `**Tormenta20:** ${versions.system ?? "?"} · **Foundry:** ${versions.foundry ?? "?"} · **Módulo:** ${versions.module ?? "?"}`,
    `**Modo:** ${mode} · **Estado:** ${state}`,
    diagnosis && BUGS.has(diagnosis.bug)
      ? `**Diagnóstico:** ${diagnosis.bug}/${diagnosis.confidence === "high" ? "high" : "low"}`
      : null,
    "",
    "**O que aconteceu:**",
    ""
  ].filter((l) => l !== null);
  return `${base}/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

/**
 * Where Tab moves the focus inside a focus-trapped container: the next or previous element, wrapping around at the
 * ends, and back inside when the focus escaped.
 * @param {number} count       Focusable elements in the container.
 * @param {number} index       Index of the focused element, or -1 when the focus is outside.
 * @param {boolean} backwards  Shift+Tab.
 * @returns {number|null}      Null when there is nothing to focus.
 */
export function nextFocusIndex(count, index, backwards) {
  if (count < 1) return null;
  if (index < 0) return backwards ? count - 1 : 0;
  return (index + (backwards ? count - 1 : 1)) % count;
}
