/** Patch states and diagnoses (#89, split from scripts/registry.mjs): pure, the probe comes in as a function. */

import { compareVersions } from "../lib/version.mjs";

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

/** States in which the patch's install() must be called. */
export const APPLY_STATES = new Set(["applied", "applied-unverified", "applied-guarded", "suspected-fixed", "forced"]);

/**
 * Whether a patch's install() ran, according to the status list built on init.
 * @param {{id: string, state: PatchState}[]|undefined} status
 * @param {string} id
 * @returns {boolean}
 */
export function isPatchApplied(status, id) {
  const entry = Array.isArray(status) ? status.find((s) => s?.id === id) : undefined;
  return !!entry && APPLY_STATES.has(entry.state);
}

export const BUGS = new Set(["present", "fixed", "unknown"]);

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
