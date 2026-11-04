/**
 * In-memory platform for the tests (#86): the same ports as scripts/platform/foundry.mjs, without Foundry globals.
 * Every port can be replaced through `overrides`; `notes` and `logs` record what the code under test showed.
 */
import { unwrap } from "../../scripts/lib/source.mjs";
import { createWrapRegistry } from "../../scripts/kernel/wrap.mjs";
import { createFeatureContext, createServiceContext } from "../../scripts/kernel/context.mjs";
import { createServiceRegistry } from "../../scripts/kernel/services.mjs";
import { createFeatureDirectory } from "../../scripts/kernel/features.mjs";
import { SERVICES } from "../../scripts/services/index.mjs";

const getProperty = (object, key) => key.split(".").reduce((value, part) => value?.[part], object);

function setProperty(object, key, value) {
  const parts = key.split(".");
  const last = parts.pop();
  let target = object;
  for (const part of parts) target = target[part] ??= {};
  target[last] = value;
  return true;
}

function expandObject(flat) {
  const expanded = {};
  for (const [key, value] of Object.entries(flat ?? {})) setProperty(expanded, key, value);
  return expanded;
}

const slugify = (text) =>
  String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

let ids = 0;

/**
 * @param {object} [overrides]
 * @param {Record<string, unknown>} [overrides.settings]  Initial values of the module settings.
 * @param {boolean} [overrides.isGM]
 * @param {boolean} [overrides.isActiveGM]
 * @param {object} [overrides.system]                     {id, version, title}
 * @param {object} [overrides.classes]
 * @param {object} [overrides.t20]                         Value returned by platform.t20().
 * @param {object} [overrides.dice]
 * @param {object} [overrides.forms]
 * @param {object} [overrides.i18n]
 * @param {Function} [overrides.sourceOf]
 * @param {Record<string, string|(() => Function)>} [overrides.sources]  Each method label read by
 *   platform.sourceOfMethod: its source, or a getter of the live method (read under the module's wrappers, as in Foundry).
 * @param {() => Iterable<object>} [overrides.targets]   Value of platform.user.targets().
 */
export function createFakePlatform(overrides = {}) {
  const store = new Map(Object.entries(overrides.settings ?? {}));
  const registered = new Map();
  const notes = [];
  const logs = [];
  const hooks = [];
  let api;
  const user = { isGM: overrides.isGM ?? true, isActiveGM: overrides.isActiveGM ?? overrides.isGM ?? true };
  const notifier = (level) => (message, options) => notes.push({ level, message, options });
  const logger = (level) => (...args) => logs.push({ level, args });
  const sourceOf =
    overrides.sourceOf ??
    ((fn) => {
      const inner = unwrap(fn);
      return typeof inner === "function" ? inner.toString() : null;
    });

  return {
    notes,
    logs,
    registered,
    hookCalls: hooks,
    user: {
      isGM: () => user.isGM,
      isActiveGM: () => user.isActiveGM,
      id: () => "user",
      targets: overrides.targets ?? (() => [])
    },
    system: overrides.system ?? { id: "tormenta20", version: "1.6.6", title: "Tormenta20" },
    classes: overrides.classes ?? {},
    t20: () => overrides.t20,
    t20Config: () => overrides.t20Config,
    statusEffects: () => overrides.statusEffects,
    settings: {
      register: (key, spec) => {
        registered.set(key, spec);
        if (!store.has(key) && "default" in spec) store.set(key, spec.default);
      },
      registerMenu: (key, spec) => registered.set(`menu:${key}`, spec),
      get: (key) => {
        if (!store.has(key)) throw new Error(`setting ${key} not registered`);
        return store.get(key);
      },
      set: async (key, value) => {
        store.set(key, value);
        return value;
      }
    },
    i18n: overrides.i18n ?? {
      localize: (key) => key,
      format: (key, data) => `${key} ${JSON.stringify(data ?? {})}`,
      has: () => true
    },
    notify: { info: notifier("info"), warn: notifier("warn"), error: notifier("error") },
    hooks: {
      on: (name, fn) => hooks.push({ name, fn, once: false }),
      once: (name, fn) => hooks.push({ name, fn, once: true }),
      off: () => {}
    },
    documents: overrides.documents ?? {},
    utils: {
      getProperty,
      setProperty,
      hasProperty: (object, key) => getProperty(object, key) !== undefined,
      deepClone: (value) => structuredClone(value),
      randomID: () => `fake${String(++ids).padStart(12, "0")}`,
      escapeHTML: (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
      expandObject,
      slugify
    },
    dice: overrides.dice ?? {},
    forms: overrides.forms ?? { data: () => ({}) },
    log: { info: logger("info"), warn: logger("warn"), error: logger("error") },
    sourceOf,
    sourceOfMethod: (label) => {
      const entry = overrides.sources?.[label];
      return typeof entry === "function" ? sourceOf(entry()) : (entry ?? null);
    },
    module: { setApi: (value) => (api = value), api: () => api, systemCompatibility: () => undefined },
    /** Runs the handlers registered for a hook, as Hooks.callAll. */
    callHook: (name, ...args) => {
      for (const hook of hooks.filter((h) => h.name === name)) hook.fn(...args);
    }
  };
}

/**
 * Context of a feature on a fake platform, with its own wrapper registry.
 * @param {object} [kernel]  `services` (registry) and `features` (directory), as createTestKernel builds them.
 * @returns {import("../../scripts/kernel/feature.mjs").FeatureContext}
 */
export function createFakeContext(feature, platform = createFakePlatform(), wraps = createWrapRegistry(), kernel = {}) {
  return createFeatureContext(platform, feature, { wraps, ...kernel });
}

/**
 * Context for a source probe: `sources` maps each method label to its source or to a getter of the live method.
 * @param {Record<string, string|(() => Function)>} sources
 * @returns {import("../../scripts/kernel/feature.mjs").FeatureContext}
 */
export function createProbeContext(feature, sources) {
  return createFakeContext(feature, createFakePlatform({ sources }));
}

/**
 * A kernel for tests: one service registry and one feature directory over `platform`, as main.mjs wires them.
 * `install(feature)` installs the declared services, then the feature (one context per feature id); `service(id)`
 * gives a service API, installing it if needed.
 * @param {object} options
 * @param {object} options.platform  A fake platform, or createPlatform() over a fake Foundry.
 * @param {{wrap: Function}} [options.wraps]
 * @param {object[]} [options.features]  Features `ctx.features` knows about.
 * @param {object[]} [options.status]    Status entries read by ctx.features.isActive.
 * @param {object[]} [options.services]
 */
export function createTestKernel({ platform, wraps = createWrapRegistry(), features = [], status = [], services = SERVICES }) {
  const registry = createServiceRegistry(services, (service) => createServiceContext(platform, service, { wraps }));
  const directory = createFeatureDirectory({ features, status: () => status, getSetting: (key) => platform.settings.get(key) });
  const contexts = new Map();
  const contextFor = (feature) => {
    if (!contexts.has(feature.id)) {
      contexts.set(feature.id, createFeatureContext(platform, feature, { wraps, services: registry, features: directory }));
    }
    return contexts.get(feature.id);
  };
  return {
    services: registry,
    status,
    contextFor,
    service: (id) => registry.ensure(id),
    install(feature) {
      for (const id of feature.services ?? []) registry.ensure(id);
      const ctx = contextFor(feature);
      feature.install(ctx);
      return ctx;
    }
  };
}
