/**
 * Central lifecycle of the features (#85): the only place that installs patches and rules, and the only error
 * boundary between them. Pure: everything comes in through parameters, so it runs in Node tests.
 */
import { APPLY_STATES, resolvePatchState } from "./diagnosis.mjs";

/**
 * @typedef {object} StatusEntry
 * @property {string} id
 * @property {"patch"|"rule"} kind
 * @property {string} group
 * @property {import("./diagnosis.mjs").PatchMode} [mode]   Patches only.
 * @property {import("./diagnosis.mjs").PatchState|"installed"} state  Rules: "installed", "incompatible" or "error".
 * @property {import("./diagnosis.mjs").Diagnosis} [diagnosis]
 * @property {string} [reason]
 * @property {boolean} [changed]  Marks the patches cited in a notification on this load.
 */

/** @param {import("./diagnosis.mjs").Diagnosis|undefined} diagnosis */
export function describeDiagnosis(diagnosis) {
  if (!diagnosis) return "";
  return `; bug ${diagnosis.bug}/${diagnosis.confidence}${diagnosis.evidence ? `: ${diagnosis.evidence}` : ""}`;
}

/** Registers every setting of a feature. */
function registerAll(feature, registerSetting) {
  for (const spec of feature.settings ?? []) registerSetting(spec);
}

/**
 * Installs the services the feature declares, right before its own install(): the first feature that declares a
 * service decides where its wrappers sit in each chain (#87).
 */
function ensureServices(feature, services) {
  for (const id of feature.services ?? []) {
    if (!services) throw new Error(`${feature.id}: no service registry for "${id}"`);
    services.ensure(id);
  }
}

/** Mode and state of a patch, or an "error" entry when reading the mode or probing throws. */
function resolvePatch(feature, deps) {
  const { modeOf, system, contextFor, log } = deps;
  let mode;
  try {
    mode = modeOf(feature);
    const ctx = contextFor(feature);
    const resolved = resolvePatchState({
      patch: feature,
      mode,
      systemId: system.id,
      systemVersion: system.version,
      probe: typeof feature.isNeeded === "function" ? () => feature.isNeeded(ctx) : undefined
    });
    return { mode, ctx, ...resolved };
  } catch (err) {
    log.error(`Failed to resolve patch: ${feature.id}`, err);
    return { mode, state: "error", reason: err?.message ?? String(err), failed: true };
  }
}

function bootPatch(feature, deps) {
  const { registerSetting, log } = deps;
  const { mode, ctx, diagnosis, failed, ...resolved } = resolvePatch(feature, deps);
  let { state, reason } = resolved;
  const entry = () => ({ id: feature.id, kind: "patch", group: feature.group, mode, state, diagnosis, reason });
  if (failed) return entry();
  if (!APPLY_STATES.has(state)) {
    log.info(`Patch not applied: ${feature.id} (${state}${reason ? `: ${reason}` : ""}${describeDiagnosis(diagnosis)})`);
    return entry();
  }
  try {
    // Only an applied patch registers its settings (segmented-scene-setting's limit).
    registerAll(feature, registerSetting);
    ensureServices(feature, deps.services);
    feature.install(ctx);
    log.info(`Patch applied: ${feature.id} (${state}${describeDiagnosis(diagnosis)})`);
  } catch (err) {
    state = "error";
    reason = err?.message ?? String(err);
    log.error(`Failed to apply patch: ${feature.id}`, err);
  }
  return entry();
}

function bootRule(feature, deps, failed) {
  const { system, contextFor, log } = deps;
  const entry = { id: feature.id, kind: "rule", group: feature.group };
  if (failed.has(feature.id)) return { ...entry, state: "error", reason: failed.get(feature.id) };
  if (feature.system?.id && feature.system.id !== system.id) {
    log.info(`Rule not installed: ${feature.id} (incompatible: needs ${feature.system.id})`);
    return { ...entry, state: "incompatible", reason: system.id };
  }
  try {
    ensureServices(feature, deps.services);
    feature.install(contextFor(feature));
    return { ...entry, state: "installed" };
  } catch (err) {
    log.error(`Failed to install rule: ${feature.id}`, err);
    return { ...entry, state: "error", reason: err?.message ?? String(err) };
  }
}

/**
 * Installs the features in order. A feature that throws becomes state "error" and never stops the others.
 * Rule settings are all registered first, whatever the system (as before #85): rules read them on every use, and a
 * rule may read another's setting. Patches register theirs only when applied, right before install().
 * @param {object} deps
 * @param {import("./feature.mjs").Feature[]} deps.features
 * @param {(feature: import("./feature.mjs").Feature) => import("./diagnosis.mjs").PatchMode} deps.modeOf
 * @param {{id: string, version: string}} deps.system
 * @param {(feature: import("./feature.mjs").Feature) => import("./feature.mjs").FeatureContext} deps.contextFor
 * @param {(spec: import("./feature.mjs").SettingSpec) => void} deps.registerSetting
 * @param {{ensure: (id: string) => object}} [deps.services]  Installs the declared services on demand.
 * @param {{info: Function, error: Function}} deps.log
 * @returns {StatusEntry[]}
 */
export function bootFeatures(deps) {
  const { features, registerSetting, log } = deps;
  /** Rules whose settings failed to register: installing them would read a missing setting. */
  const failed = new Map();
  for (const feature of features) {
    if (feature.kind !== "rule") continue;
    try {
      registerAll(feature, registerSetting);
    } catch (err) {
      failed.set(feature.id, err?.message ?? String(err));
      log.error(`Failed to register the settings of rule: ${feature.id}`, err);
    }
  }
  return features.map((feature) =>
    feature.kind === "patch" ? bootPatch(feature, deps) : bootRule(feature, deps, failed)
  );
}
