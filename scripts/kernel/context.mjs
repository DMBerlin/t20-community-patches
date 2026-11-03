/**
 * Context injected into each feature (#86): the only way a feature reaches the platform, the wrapper registry and its
 * own settings. Pure: the platform and the registry come in through parameters.
 */

/**
 * @typedef {object} FeatureLog
 * @property {(...args: unknown[]) => void} info
 * @property {(...args: unknown[]) => void} warn
 * @property {(...args: unknown[]) => void} error
 */

/**
 * Prefixes every message with the feature id: "t20-community-patches | <id>: …" once the platform adds its own.
 * @param {FeatureLog} log
 * @param {string} id
 * @returns {FeatureLog}
 */
function prefixed(log, id) {
  return Object.freeze({
    info: (...args) => log.info(`${id}:`, ...args),
    warn: (...args) => log.warn(`${id}:`, ...args),
    error: (...args) => log.error(`${id}:`, ...args)
  });
}

/**
 * @param {import("../platform/foundry.mjs").Platform} platform
 * @param {import("./feature.mjs").Feature} feature
 * @param {{wraps: {wrap: Function}}} kernel
 * @returns {import("./feature.mjs").FeatureContext}
 */
export function createFeatureContext(platform, feature, kernel) {
  const declared = new Set((feature.settings ?? []).map((spec) => spec.key));
  return Object.freeze({
    id: feature.id,
    platform,
    log: prefixed(platform.log, feature.id),
    hooks: platform.hooks,
    wrap: (target, method, wrapper, options) => kernel.wraps.wrap(target, method, feature.id, wrapper, options),
    setting: (key) => {
      // Reading another feature's setting is a dependency that must be declared (#87).
      if (!declared.has(key)) throw new Error(`${feature.id}: setting "${key}" is not declared by this feature`);
      return platform.settings.get(key);
    }
  });
}
