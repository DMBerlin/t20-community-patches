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
