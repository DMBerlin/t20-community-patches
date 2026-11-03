/**
 * Declarative settings of the features (#85). The kernel never reads Foundry globals: registration goes through the
 * platform's register function.
 */

/** Keys of a SettingSpec that only the module reads. */
const OWN_KEYS = new Set(["key", "center", "centerId"]);

/**
 * Registers one SettingSpec, hidden from the core settings window (the Center shows it).
 * @param {(key: string, config: object) => void} platformRegister  e.g. (key, c) => game.settings.register(MODULE_ID, key, c)
 * @param {import("./feature.mjs").SettingSpec} spec
 */
export function registerFeatureSetting(platformRegister, spec) {
  const config = {};
  // for…in reads getters (a `type` built on demand) only now, during "init".
  for (const name in spec) {
    if (!OWN_KEYS.has(name)) config[name] = spec[name];
  }
  config.config = false;
  platformRegister(spec.key, config);
}

/**
 * Entries of the Center's "Optional rules" tab: every setting with `center !== false`, grouped by `centerId ?? id`.
 * Entries follow their first appearance in `features`; the group is the one of the feature that has the entry's id,
 * or else of the feature that declared the first key. The Center groups the entries by group.
 * @param {import("./feature.mjs").Feature[]} features
 * @returns {{id: string, group: string, keys: string[]}[]}
 */
export function centerSettings(features) {
  const groupOf = new Map(features.map((f) => [f.id, f.group]));
  /** @type {Map<string, {id: string, group: string, keys: string[]}>} */
  const entries = new Map();
  for (const feature of features) {
    for (const spec of feature.settings ?? []) {
      if (spec.center === false) continue;
      const id = spec.centerId ?? feature.id;
      if (!entries.has(id)) entries.set(id, { id, group: groupOf.get(id) ?? feature.group, keys: [] });
      entries.get(id).keys.push(spec.key);
    }
  }
  return [...entries.values()];
}
