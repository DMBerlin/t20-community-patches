/**
 * Context injected into each feature (#86): the only way a feature reaches the platform, the wrapper registry and its
 * own settings. Pure: the platform and the registry come in through parameters.
 */

import { servicesView } from "./services.mjs";

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
export function prefixed(log, id) {
  return Object.freeze({
    info: (...args) => log.info(`${id}:`, ...args),
    warn: (...args) => log.warn(`${id}:`, ...args),
    error: (...args) => log.error(`${id}:`, ...args)
  });
}

/**
 * @param {import("../platform/foundry.mjs").Platform} platform
 * @param {import("./feature.mjs").Feature} feature
 * @param {object} kernel
 * @param {{wrap: Function}} kernel.wraps
 * @param {ReturnType<import("./services.mjs").createServiceRegistry>} [kernel.services]
 * @param {ReturnType<import("./features.mjs").createFeatureDirectory>} [kernel.features]
 * @returns {import("./feature.mjs").FeatureContext}
 */
export function createFeatureContext(platform, feature, kernel) {
  const declared = new Set((feature.settings ?? []).map((spec) => spec.key));
  const features = kernel.features?.forFeature(feature) ?? noFeatures(feature);
  return Object.freeze({
    id: feature.id,
    platform,
    log: prefixed(platform.log, feature.id),
    hooks: platform.hooks,
    wrap: (target, method, wrapper, options) => kernel.wraps.wrap(target, method, feature.id, wrapper, options),
    setting: (key) => {
      // Another feature's setting goes through ctx.features.setting, declared in interactsWith (#87).
      if (!declared.has(key)) throw new Error(`${feature.id}: setting "${key}" is not declared by this feature`);
      return platform.settings.get(key);
    },
    services: servicesView(feature, kernel.services),
    features
  });
}

/** `ctx.features` without a directory: every read throws. */
function noFeatures(feature) {
  const fail = (id) => {
    throw new Error(`${feature.id}: no feature directory to read "${id}"`);
  };
  return Object.freeze({ isActive: fail, setting: fail, list: () => [] });
}

/**
 * Context of a service: same shape as a feature's, without settings; the service id owns its wrappers.
 * @param {import("../platform/foundry.mjs").Platform} platform
 * @param {{id: string}} service
 * @param {{wraps: {wrap: Function}}} kernel
 * @returns {import("./services.mjs").ServiceContext}
 */
export function createServiceContext(platform, service, kernel) {
  return Object.freeze({
    id: service.id,
    platform,
    log: prefixed(platform.log, service.id),
    hooks: platform.hooks,
    wrap: (target, method, wrapper, options) => kernel.wraps.wrap(target, method, service.id, wrapper, options)
  });
}
