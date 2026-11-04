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
import { createPublished } from "../../scripts/kernel/publish.mjs";
import { createSettingListeners } from "../../scripts/kernel/settings.mjs";

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

/** The CONST values the features read. */
const FAKE_CONST = Object.freeze({
  ACTIVE_EFFECT_SHOW_ICON: Object.freeze({ NEVER: 0, CONDITIONAL: 1, ALWAYS: 2 }),
  TOKEN_DISPOSITIONS: Object.freeze({ SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 })
});

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
 * @param {Record<string, object>} [overrides.config]     CONFIG by document name, read by platform.config.document().
 * @param {object} [overrides.core]                       Value of platform.core (core classes, fields, operators).
 * @param {Record<string, unknown>} [overrides.namespaceSettings]  "<namespace>.<key>" → value, for platform.settingsOf().
 * @param {Record<string, Function>} [overrides.helpers]  Handlebars helpers.
 * @param {object} [overrides.tokenHud]
 * @param {string} [overrides.userId]
 * @param {object} [overrides.currentUser]                Value of platform.users.current() (default: {id, isGM}).
 * @param {object} [overrides.users]                      Replaces any method of platform.users.
 * @param {object} [overrides.chat]                       Replaces any method of platform.chat.
 * @param {object} [overrides.ui]                         Replaces any method of platform.ui.
 * @param {object} [overrides.apps]                       Value of platform.apps (application base classes).
 * @param {object} [overrides.canvas]                     Replaces any method of platform.canvas.
 * @param {object} [overrides.constants]                  Value of platform.constants().
 * @param {object} [overrides.module]                     Replaces any method of platform.module.
 * @param {string} [overrides.lang]                       Value of platform.i18n.lang() (default "pt-BR").
 */
export function createFakePlatform(overrides = {}) {
  const store = new Map(Object.entries(overrides.settings ?? {}));
  const registered = new Map();
  const notes = [];
  const logs = [];
  const hooks = [];
  let api;
  const configWrites = {};
  let statusEffects = overrides.statusEffects;
  const foreign = new Map(Object.entries(overrides.namespaceSettings ?? {}));
  const foreignEntries = new Map();
  const user = { isGM: overrides.isGM ?? true, isActiveGM: overrides.isActiveGM ?? overrides.isGM ?? true };
  const chatMessages = [];
  const lang = overrides.lang ?? "pt-BR";
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
      id: () => overrides.userId ?? "user",
      targets: overrides.targets ?? (() => [])
    },
    system: overrides.system ?? { id: "tormenta20", version: "1.6.6", title: "Tormenta20" },
    classes: overrides.classes ?? {},
    t20: () => overrides.t20,
    t20Config: () => overrides.t20Config,
    statusEffects: () => statusEffects,
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
    i18n: {
      localize: (key) => key,
      format: (key, data) => `${key} ${JSON.stringify(data ?? {})}`,
      has: () => true,
      lang: () => lang,
      listFormat: (items) => new Intl.ListFormat(lang).format(items),
      ...overrides.i18n
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
      slugify,
      getRoute: (path) => path,
      debounce: (fn) => fn,
      parseUuid: (uuid) => ({ id: String(uuid ?? "").split(".").at(-1) || undefined }),
      enrichHTML: async (html) => html
    },
    dice: overrides.dice ?? {},
    forms: overrides.forms ?? { data: () => ({}) },
    log: { info: logger("info"), warn: logger("warn"), error: logger("error") },
    sourceOf,
    sourceOfMethod: (label) => {
      const entry = overrides.sources?.[label];
      return typeof entry === "function" ? sourceOf(entry()) : (entry ?? null);
    },
    module: {
      setApi: (value) => (api = value),
      api: () => api,
      systemCompatibility: () => undefined,
      version: () => "0.0.0-test",
      coreVersion: () => "14.369",
      bugs: () => "https://example.test/issues",
      ...overrides.module
    },
    config: {
      document: (name) => overrides.config?.[name],
      setControlIcon: (name, value) => (configWrites[`controlIcons.${name}`] = value),
      setSpecialStatus: (name, id) => (configWrites[`specialStatusEffects.${name}`] = id),
      setStatusEffects: (entries) => {
        configWrites.statusEffects = entries;
        statusEffects = entries;
      }
    },
    /** What platform.config wrote ("controlIcons.<name>", "specialStatusEffects.<name>", "statusEffects"). */
    configWrites,
    core: overrides.core ?? {},
    settingsOf: (namespace) => ({
      get: (key) => foreign.get(`${namespace}.${key}`),
      set: async (key, value) => {
        foreign.set(`${namespace}.${key}`, value);
        return value;
      },
      entry: (key) => foreignEntries.get(`${namespace}.${key}`),
      registerMenu: (key, spec) => registered.set(`menu:${namespace}.${key}`, spec)
    }),
    /** Registered SettingConfig of other namespaces, read by settingsOf(ns).entry(key). */
    foreignEntries,
    canvas: {
      tokenHud: () => overrides.tokenHud,
      controlledTokens: () => [],
      scene: () => undefined,
      activeCombat: () => undefined,
      ...overrides.canvas
    },
    handlebars: { helpers: () => overrides.helpers },
    constants: () => overrides.constants ?? FAKE_CONST,
    users: {
      current: () => overrides.currentUser ?? { id: overrides.userId ?? "user", isGM: user.isGM },
      activeGM: () => undefined,
      players: () => [],
      designated: () => null,
      whisperRecipients: () => [],
      ...overrides.users
    },
    /** Messages created through platform.chat.create: {data, options}. */
    chatMessages,
    chat: {
      create: async (data, options) => {
        chatMessages.push({ data, options });
        return { id: `msg${chatMessages.length}`, ...data };
      },
      speaker: (options) => ({ actor: options?.actor?.id, alias: options?.actor?.name }),
      applyMode: (data, mode) => Object.assign(data, mode ? { messageMode: mode } : {}),
      updateMessage: () => {},
      ...overrides.chat
    },
    ui: { renderControls: () => {}, application: () => undefined, reloadConfirm: async () => {}, ...overrides.ui },
    apps: overrides.apps ?? {},
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
  return createFeatureContext(platform, feature, {
    wraps,
    publish: createPublished([]).add,
    settingListeners: createSettingListeners((err) => {
      throw err;
    }),
    ...kernel
  });
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
  const published = createPublished([]);
  const settingListeners = createSettingListeners((err) => {
    throw err;
  });
  const registry = createServiceRegistry(services, (service) => createServiceContext(platform, service, { wraps }));
  const directory = createFeatureDirectory({ features, status: () => status, getSetting: (key) => platform.settings.get(key) });
  const contexts = new Map();
  const contextFor = (feature) => {
    if (!contexts.has(feature.id)) {
      contexts.set(
        feature.id,
        createFeatureContext(platform, feature, {
          wraps,
          services: registry,
          features: directory,
          publish: published.add,
          settingListeners
        })
      );
    }
    return contexts.get(feature.id);
  };
  return {
    services: registry,
    status,
    contextFor,
    service: (id) => registry.ensure(id),
    /** Changes a module setting as Foundry would: stores it, then runs the spec's onChange and the listeners. */
    async changeSetting(key, value) {
      await platform.settings.set(key, value);
      const spec = features.flatMap((f) => f.settings ?? []).find((s) => s.key === key);
      spec?.onChange?.(value);
      settingListeners.emit(key, value);
    },
    /** What the installed features published (api.<name>). */
    published: () => published.entries(),
    install(feature) {
      for (const id of feature.services ?? []) registry.ensure(id);
      const ctx = contextFor(feature);
      feature.install(ctx);
      return ctx;
    }
  };
}
