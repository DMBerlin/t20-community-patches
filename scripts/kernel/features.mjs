/**
 * Declared runtime dependencies between features (#87): `ctx.features` reads another feature's state or setting only
 * when its id is in `interactsWith`. Pure: the features, the status and the settings come in through parameters.
 */
import { APPLY_STATES } from "./diagnosis.mjs";

/**
 * Whether a status entry is active: an applied patch, or an installed rule.
 * @param {{kind: string, state: string}|undefined} entry
 */
export function isEntryActive(entry) {
  if (!entry) return false;
  if (entry.kind === "patch") return APPLY_STATES.has(entry.state);
  return entry.state === "installed";
}

/**
 * Dependency graph, for the Center and for debugging (`api.graph()`).
 * @param {import("./feature.mjs").Feature[]} features
 */
export function featureGraph(features) {
  return features.map((feature) => ({
    id: feature.id,
    kind: feature.kind,
    services: [...(feature.services ?? [])],
    interactsWith: [...(feature.interactsWith ?? [])]
  }));
}

/**
 * @param {object} deps
 * @param {import("./feature.mjs").Feature[]} deps.features
 * @param {() => {id: string, kind: string, state: string}[]} deps.status  Read on every call (filled after the boot).
 * @param {(key: string) => unknown} deps.getSetting                        A setting of this module.
 */
export function createFeatureDirectory({ features, status, getSetting }) {
  const byId = new Map(features.map((feature) => [feature.id, feature]));

  /** @param {import("./feature.mjs").Feature} feature */
  function forFeature(feature) {
    const declared = new Set(feature.interactsWith ?? []);
    const check = (id) => {
      if (!declared.has(id)) throw new Error(`${feature.id}: feature "${id}" is not declared in interactsWith`);
    };
    return Object.freeze({
      /** Patch applied or rule installed. Read at run time, never while the features are being installed. */
      isActive(id) {
        check(id);
        return isEntryActive(status().find((entry) => entry.id === id));
      },
      /** A setting declared by another feature. */
      setting(id, key) {
        check(id);
        const owner = byId.get(id);
        if (!(owner?.settings ?? []).some((spec) => spec.key === key)) {
          throw new Error(`${feature.id}: setting "${key}" is not declared by "${id}"`);
        }
        return getSetting(key);
      },
      list: () => featureGraph(features)
    });
  }

  return Object.freeze({ forFeature, graph: () => featureGraph(features) });
}
