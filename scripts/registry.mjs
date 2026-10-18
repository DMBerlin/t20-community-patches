import { compareVersions } from "./utils.mjs";

/**
 * @typedef {"applied"|"applied-unverified"|"disabled"|"fixed"|"unverified"|"incompatible"|"error"} PatchState
 */

/** States in which the patch's apply() must be called. */
export const APPLY_STATES = new Set(["applied", "applied-unverified"]);

/**
 * Decide what to do with a patch. Pure: the runtime probe is passed in as a function and only called when needed.
 * - Inside the affected range the bug is assumed, unless the probe proves it is gone.
 * - Above the range (newer, unverified system release) the patch is only applied when the probe confirms the bug.
 * @param {object} args
 * @param {{system: {id: string, affected?: {minimum?: string, maximum?: string}}}} args.patch
 * @param {boolean} args.enabled
 * @param {string} args.systemId
 * @param {string} args.systemVersion
 * @param {() => boolean|undefined} [args.probe]  Returns true when the bug is present, false when fixed.
 * @returns {{state: PatchState, reason?: string}}
 */
export function resolvePatchState({ patch, enabled, systemId, systemVersion, probe }) {
  if (!enabled) return { state: "disabled" };
  const { id, affected = {} } = patch.system;
  if (systemId !== id) return { state: "incompatible", reason: systemId };
  if (affected.minimum && compareVersions(systemVersion, affected.minimum) < 0) {
    return { state: "incompatible", reason: `${systemId} ${systemVersion}` };
  }

  let needed;
  let probeError;
  try {
    needed = probe ? probe() : undefined;
  } catch (err) {
    probeError = err?.message ?? String(err);
  }

  const aboveRange = !!affected.maximum && compareVersions(systemVersion, affected.maximum) > 0;
  if (needed === false) return { state: "fixed", reason: `${systemId} ${systemVersion}` };
  if (!aboveRange) return { state: "applied" };
  if (needed === true) return { state: "applied-unverified", reason: `${systemId} ${systemVersion}` };
  return { state: "unverified", reason: probeError ?? `${systemId} ${systemVersion}` };
}

/**
 * Whether the GM should be told about a state, given the state recorded on the previous load.
 * Errors are always reported; other states only when they changed into something that needs attention.
 * @param {PatchState} state
 * @param {PatchState|undefined} previous
 */
export function shouldNotify(state, previous) {
  if (state === "error") return true;
  if (state === previous) return false;
  return ["fixed", "unverified", "applied-unverified", "incompatible"].includes(state);
}
