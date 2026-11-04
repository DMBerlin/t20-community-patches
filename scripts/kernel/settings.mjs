/**
 * Declarative settings of the features (#85). The kernel never reads Foundry globals: registration goes through the
 * platform's register function.
 */

/** Keys of a SettingSpec that only the module reads. */
const OWN_KEYS = new Set(["key", "center", "centerId", "typeOf"]);

/**
 * Listeners of setting changes added by installed features (`ctx.onSettingChange`, #89): the state a change touches
 * lives in the closure of install(), never at the top of a module.
 * @param {(err: unknown, key: string) => void} [onError]
 */
export function createSettingListeners(onError = (err, key) => console.error(`setting ${key}: listener failed`, err)) {
  /** @type {Map<string, Set<Function>>} */
  const byKey = new Map();
  return Object.freeze({
    /** @returns {() => void} Removes the listener. */
    on(key, fn) {
      if (typeof fn !== "function") throw new TypeError(`setting ${key}: listener is not a function`);
      if (!byKey.has(key)) byKey.set(key, new Set());
      byKey.get(key).add(fn);
      return () => byKey.get(key)?.delete(fn);
    },
    /** Calls every listener of `key`; one that throws never stops the others. */
    emit(key, value) {
      for (const fn of [...(byKey.get(key) ?? [])]) {
        try {
          fn(value);
        } catch (err) {
          onError(err, key);
        }
      }
    }
  });
}

/**
 * Registers one SettingSpec, hidden from the core settings window (the Center shows it).
 * @param {(key: string, config: object) => void} platformRegister  e.g. (key, c) => game.settings.register(MODULE_ID, key, c)
 * @param {import("./feature.mjs").SettingSpec} spec
 * @param {object} [kernel]
 * @param {object} [kernel.platform]  Passed to `spec.typeOf(platform)`, which builds the type during "init".
 * @param {ReturnType<typeof createSettingListeners>} [kernel.listeners]  Called after `spec.onChange`.
 */
export function registerFeatureSetting(platformRegister, spec, { platform, listeners } = {}) {
  const config = {};
  // for…in reads getters (a `type` built on demand) only now, during "init".
  for (const name in spec) {
    if (!OWN_KEYS.has(name)) config[name] = spec[name];
  }
  if (typeof spec.typeOf === "function") config.type = spec.typeOf(platform);
  if (listeners) {
    const own = spec.onChange;
    config.onChange = (value, ...rest) => {
      own?.(value, ...rest);
      listeners.emit(spec.key, value);
    };
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
