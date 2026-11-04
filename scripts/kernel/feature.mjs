/**
 * Unified contract of patches and optional rules (#85). The kernel never reads Foundry globals.
 *
 * @typedef {object} SettingSpec      Passed to game.settings.register, with MODULE_ID implied and `config: false`.
 * @property {string} key             Persisted key. NEVER rename an existing key.
 * @property {"world"|"client"|"user"} scope
 * @property {Function|object} type
 * @property {unknown} default
 * @property {string} [name]          i18n key.
 * @property {string} [hint]
 * @property {Record<string, string>} [choices]
 * @property {(value: unknown) => void} [onChange]  Static; state touched by a change goes in ctx.onSettingChange.
 * @property {(platform: object) => Function|object} [typeOf]  Builds `type` on registration (core fields, #89).
 * @property {boolean} [center]       Shown in the Center's "Optional rules" tab (default: true).
 * @property {string} [centerId]      Center entry the key belongs to (default: the feature id).
 *
 * @typedef {object} Feature
 * @property {string} id
 * @property {"patch"|"rule"} kind
 * @property {string} group                        One of GROUPS.
 * @property {number} [issue]
 * @property {{id: string, affected?: {minimum?: string, maximum?: string}}} [system]
 *                                                 Required for patches (with `affected`). On a rule, the system the
 *                                                 rule needs: another system id leaves it "incompatible".
 * @property {SettingSpec[]} [settings]           On patches, only registered when the patch is applied.
 * @property {string[]} [after]                   Ids that must come BEFORE in FEATURES (inner wrappers). "*" = all.
 * @property {string[]} [services]              Services used through ctx.services[id] (scripts/services/).
 * @property {string[]} [interactsWith]         Features whose state or settings this one reads at run time.
 * @property {string} [wrapOwner]              Owner of its wrappers in api.wraps() (default: the id). Only for the
 *                                                 rules whose wrappers kept a historical owner (#89).
 * @property {boolean} [guarded]
 * @property {"source"|"behavior"} [probeKind]   See Patch in scripts/features/patches.mjs (used by `make audit`).
 * @property {string[]} [sources]               Method labels the feature depends on (fingerprinted by `make audit`).
 * @property {(ctx: FeatureContext) => import("./diagnosis.mjs").Diagnosis|boolean|undefined} [isNeeded]
 * @property {(ctx: FeatureContext) => Promise<import("./diagnosis.mjs").Diagnosis|boolean|undefined>} [lateProbe]
 * @property {(ctx: FeatureContext) => void} install
 *
 * @typedef {object} FeatureContext            Built by createFeatureContext (scripts/kernel/context.mjs).
 * @property {string} id
 * @property {import("../platform/foundry.mjs").Platform} platform   The only way to reach Foundry.
 * @property {import("./context.mjs").FeatureLog} log                Prefixed with the module and the feature id.
 * @property {import("../platform/foundry.mjs").Platform["hooks"]} hooks
 * @property {(target: object, method: string, wrapper: Function, options?: object) => Function} wrap
 *           Owner = wrapOwner ?? id.
 * @property {(name: string, value: object) => void} publish  Publishes `api.<name>` (game.modules.get(…).api); a
 *           name already taken throws.
 * @property {(key: string) => unknown} setting  Value of a key declared in `settings`; any other key throws.
 * @property {(key: string, fn: (value: unknown) => void) => () => void} onSettingChange  Called after each change of
 *           a key declared in `settings` (any other key throws); returns a function that removes the listener.
 * @property {Record<string, unknown>} state    Mutable bag of this context, shared by isNeeded, install and lateProbe
 *           (for what install leaves for lateProbe); state used only by install stays in its closure.
 * @property {Record<string, object>} services   API of each declared service; any other id throws.
 * @property {{isActive: (id: string) => boolean, setting: (id: string, key: string) => unknown, list: () => object[]}}
 *           features                            Features declared in `interactsWith`; any other id throws.
 */

export const KINDS = ["patch", "rule"];

/** Every feature before this one, or "*": this one must be the last. */
export const AFTER_ALL = "*";

/** The first `after` problem of the feature at `index`, or null. */
function afterProblem(after, index, positions, last) {
  for (const id of after ?? []) {
    if (id === AFTER_ALL) {
      if (index !== last) return `after "*" but not the last feature`;
      continue;
    }
    if (!positions.has(id)) return `after unknown id "${id}"`;
    if (positions.get(id) >= index) return `after "${id}", which is not declared before it`;
  }
  return null;
}

/**
 * The first problem of one feature at `index`, or null.
 * @param {Feature} feature
 * @param {number} index
 * @param {Map<string, number>} positions  Index of every id in the list.
 * @param {{groups: string[], last: number, services?: Set<string>}} env
 */
function problemOf(feature, index, positions, { groups, last, services }) {
  if (!KINDS.includes(feature.kind)) return `invalid kind ${JSON.stringify(feature.kind)}`;
  if (!groups.includes(feature.group)) return `unknown group ${JSON.stringify(feature.group)}`;
  if (typeof feature.install !== "function") return "install missing";
  return (
    shapeProblem(feature) ??
    afterProblem(feature.after, index, positions, last) ??
    dependencyProblem(feature, positions, services)
  );
}

/** The first problem of the patch fields or of wrapOwner, or null. */
function shapeProblem(feature) {
  if (feature.kind === "patch" && !feature.system?.id) return "patch without system";
  if (feature.kind === "patch" && !feature.system.affected) return "patch without system.affected";
  const owner = feature.wrapOwner;
  if (owner !== undefined && (typeof owner !== "string" || !owner)) return "invalid wrapOwner";
  return null;
}

/** The first unknown id in `interactsWith` or `services`, or null. */
function dependencyProblem(feature, positions, services) {
  for (const id of feature.interactsWith ?? []) {
    if (id === feature.id) return `interactsWith itself`;
    if (!positions.has(id)) return `interactsWith unknown id "${id}"`;
  }
  if (!services) return null;
  for (const id of feature.services ?? []) {
    if (!services.has(id)) return `unknown service "${id}"`;
  }
  return null;
}

/**
 * Validates a list of features: unique ids, required fields, `after` satisfied by the declaration order (which is
 * the install order; `after` never reorders), and known ids in `interactsWith` and `services`. Throws on the first
 * problem.
 * @param {Feature[]} features
 * @param {string[]} groups
 * @param {string[]} [serviceIds]  When given, every id in `services` must be one of them.
 */
export function validateFeatures(features, groups, serviceIds) {
  const positions = new Map();
  features.forEach((feature, index) => {
    const id = feature?.id;
    if (typeof id !== "string" || !id) throw new Error(`Feature #${index}: id missing`);
    if (positions.has(id)) throw new Error(`Feature ${id}: duplicate id`);
    positions.set(id, index);
  });
  const env = { groups, last: features.length - 1, services: serviceIds ? new Set(serviceIds) : undefined };
  features.forEach((feature, index) => {
    const problem = problemOf(feature, index, positions, env);
    if (problem) throw new Error(`Feature ${feature.id}: ${problem}`);
  });
}

/**
 * A patch module (`{id, group, system, install, …}`, scripts/features/<id>/index.mjs) as a Feature.
 * @param {object} patch
 * @returns {Feature}
 */
export function patchFeature(patch) {
  return { ...patch, kind: "patch" };
}
