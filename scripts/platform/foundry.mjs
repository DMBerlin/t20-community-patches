/**
 * The only layer that reads Foundry globals (#86). Every port reads on demand (getters and arrow functions), because
 * CONFIG.*.documentClass, game.user, CONFIG.statusEffects and the translations change between "init" and "ready".
 * Methods of game.settings, game.i18n, Hooks and ui.notifications are always called on their owner, never detached.
 */
import { MODULE_ID } from "../lib/module.mjs";
import { unwrap } from "../lib/source.mjs";
import { findClassMember, parseMethodLabel } from "../lib/method-label.mjs";
import { createConfig, createCore, createDocuments, createHandlebars, settingsOf } from "./ports.mjs";
import { createApps, createChat, createModuleInfo, createScene, createUi, createUsers } from "./rule-ports.mjs";

/**
 * @typedef {object} SystemClasses   Document classes registered by the system (CONFIG.<Doc>.documentClass).
 * @property {Function|undefined} actor
 * @property {Function|undefined} item
 * @property {Function|undefined} activeEffect
 * @property {Function|undefined} combat
 * @property {Function|undefined} combatant
 * @property {Function|undefined} chatMessage
 * @property {Function|undefined} token
 * @property {Function|undefined} sheetEffect  ActiveEffect class whose static helpers the Tormenta20 sheets call.
 *
 * @typedef {object} Platform
 * @property {{id: string, version: string, title: string}} system
 * @property {SystemClasses} classes
 * @property {() => object|undefined} t20              globalThis.tormenta20 (applications, documents, dice…).
 * @property {() => object|undefined} t20Config        CONFIG.T20
 * @property {() => object|unknown[]|undefined} statusEffects  CONFIG.statusEffects
 * @property {{register(key: string, spec: object): void, registerMenu(key: string, spec: object): void,
 *   get(key: string): unknown, set(key: string, value: unknown): Promise<unknown>}} settings  Keys of this module.
 * @property {{localize(key: string): string, format(key: string, data?: object): string, has(key: string): boolean,
 *   lang(): string, listFormat(items: string[]): string}} i18n
 * @property {{info(msg: string, opts?: object), warn(msg: string, opts?: object), error(msg: string, opts?: object)}} notify
 * @property {{on(name: string, fn: Function): number, once(name: string, fn: Function): number,
 *   off(name: string, id: number|Function): void}} hooks
 * @property {{isGM(): boolean, isActiveGM(): boolean, id(): string|undefined, targets(): Iterable<object>}} user
 * @property {{fromUuid(uuid: string, options?: object): Promise<object|null>,
 *   fromUuidSync(uuid: string, options?: object): object|null,
 *   actors(): object, messages(): object, combats(): object, packs(): object, scenes(): object, items(): object}} documents
 * @property {{getProperty: Function, setProperty: Function, hasProperty: Function, deepClone: Function,
 *   randomID: Function, escapeHTML: Function, expandObject: Function, slugify(text: string): string,
 *   getRoute(path: string): string, debounce(fn: Function, ms: number): Function, parseUuid(uuid: string): object,
 *   enrichHTML(html: string, options?: object): Promise<string>}} utils
 * @property {{Roll: Function, ChatMessage: Function, DialogV2: object}} dice
 * @property {{data(form: HTMLFormElement): object}} forms  FormDataExtended#object of a form.
 * @property {{info(...a: unknown[]), warn(...a: unknown[]), error(...a: unknown[])}} log  Prefixed with the module id.
 * @property {(fn: Function) => string|null} sourceOf   Source of the innermost function under the module's wrappers.
 * @property {(label: string) => string|null} sourceOfMethod  "ItemT20#rollDamage" → source of the system's function
 *   (scripts/lib/method-label.mjs), under the module's wrappers; null when not found. The static audit (#90) answers
 *   the same labels from the bundle's text.
 * @property {{setApi(api: object): void, systemCompatibility(): {minimum?: string, verified?: string}|undefined}
 *   & import("./rule-ports.mjs").ModuleInfo} module
 * @property {import("./ports.mjs").ConfigPort} config
 * @property {import("./ports.mjs").CorePort} core
 * @property {(namespace: string) => import("./ports.mjs").NamespaceSettings} settingsOf  Another namespace's settings.
 * @property {import("./rule-ports.mjs").ScenePort} canvas
 * @property {{helpers(): Record<string, Function>|undefined}} handlebars
 * @property {() => object} constants  CONST
 * @property {import("./rule-ports.mjs").UsersPort} users
 * @property {import("./rule-ports.mjs").ChatPort} chat
 * @property {import("./rule-ports.mjs").UiPort} ui
 * @property {import("./rule-ports.mjs").AppsPort} apps
 */

/**
 * The ActiveEffect class whose static helpers (prepareActiveEffectCategories, onManageActiveEffect) the Tormenta20
 * sheets call: the legacy class exposed as `tormenta20.entities` up to 1.6.5, `tormenta20.documents` from 1.6.6.
 * Exported for the legacy patches until their migration (#88); features read `ctx.platform.classes.sheetEffect`.
 * @returns {Function|undefined}
 */
export function sheetEffectClass() {
  const t20 = globalThis.tormenta20;
  return t20?.entities?.ActiveEffectT20 ?? t20?.documents?.ActiveEffectT20;
}

const documentClass = (name) => globalThis.CONFIG?.[name]?.documentClass;

function createClasses() {
  return Object.freeze({
    get actor() {
      return documentClass("Actor");
    },
    get item() {
      return documentClass("Item");
    },
    get activeEffect() {
      return documentClass("ActiveEffect");
    },
    get combat() {
      return documentClass("Combat");
    },
    get combatant() {
      return documentClass("Combatant");
    },
    get chatMessage() {
      return documentClass("ChatMessage");
    },
    get token() {
      return documentClass("Token");
    },
    get sheetEffect() {
      return sheetEffectClass();
    }
  });
}

const LABEL_DOCUMENTS = ["Actor", "Item", "ActiveEffect", "ChatMessage", "Combat", "Combatant", "Token", "Region"];
const LABEL_NAMESPACES = ["entities", "documents", "applications"];

/**
 * Classes a method label is searched in. The system calls static helpers through its namespace
 * (`tormenta20.entities.ActiveEffectT20.onManageActiveEffect` up to 1.6.5, `tormenta20.documents` after) and instance
 * methods on the document classes, so each kind looks first where the system calls it: the bundle has two different
 * classes named ActiveEffectT20, and the order follows `sheetEffectClass()`.
 * @param {"instance"|"static"} kind
 * @returns {Function[]}
 */
function labelRoots(kind) {
  const { documents, dataModels, namespaces } = labelClasses();
  const configured = [...documents, ...dataModels];
  return kind === "static" ? [...namespaces, ...configured] : [...configured, ...namespaces];
}

function labelClasses() {
  const config = (name) => globalThis.CONFIG?.[name];
  const isClass = (value) => typeof value === "function";
  const t20 = globalThis.tormenta20;
  return {
    documents: LABEL_DOCUMENTS.map((name) => config(name)?.documentClass).filter(isClass),
    dataModels: LABEL_DOCUMENTS.flatMap((name) => Object.values(config(name)?.dataModels ?? {})).filter(isClass),
    namespaces: LABEL_NAMESPACES.flatMap((name) => Object.values(t20?.[name] ?? {})).filter(isClass)
  };
}

/** Namespaces of `globalThis.tormenta20` with the system's own classes (never CONFIG, which other modules change). */
const SYSTEM_NAMESPACES = [["entities"], ["documents"], ["applications"], ["models"], ["data", "models"], ["data", "fields"]];

/** Whether a class belongs to the system: one of its namespace classes, or an ancestor of one. */
function systemClassTest() {
  const t20 = globalThis.tormenta20;
  const system = new Set();
  for (const path of SYSTEM_NAMESPACES) {
    const namespace = path.reduce((holder, key) => holder?.[key], t20);
    for (const root of Object.values(namespace ?? {})) addLineage(system, root);
  }
  return (cls) => system.has(cls);
}

function addLineage(set, root) {
  for (let c = root; typeof c === "function" && c !== Function.prototype && !set.has(c); c = Object.getPrototypeOf(c)) set.add(c);
}

function sourceOf(fn) {
  const inner = unwrap(fn);
  return typeof inner === "function" ? Function.prototype.toString.call(inner) : null;
}

function sourceOfMethod(label) {
  const parsed = parseMethodLabel(label);
  if (!parsed || parsed.kind === "local") return null;
  if (parsed.kind === "helper") return sourceOf(globalThis.Handlebars?.helpers?.[parsed.name]);
  return sourceOf(findClassMember(parsed, labelRoots(parsed.kind), systemClassTest(), unwrap));
}

const PREFIX = `${MODULE_ID} |`;

function createLog() {
  return Object.freeze({
    info: (...args) => console.log(PREFIX, ...args),
    warn: (...args) => console.warn(PREFIX, ...args),
    error: (...args) => console.error(PREFIX, ...args)
  });
}

function createUtils() {
  return Object.freeze({
    getProperty: (object, key) => foundry.utils.getProperty(object, key),
    setProperty: (object, key, value) => foundry.utils.setProperty(object, key, value),
    hasProperty: (object, key) => foundry.utils.hasProperty(object, key),
    deepClone: (value, options) => foundry.utils.deepClone(value, options),
    randomID: (length) => foundry.utils.randomID(length),
    escapeHTML: (value) => foundry.utils.escapeHTML(value),
    expandObject: (object) => foundry.utils.expandObject(object),
    slugify: (text) => String(text).slugify(),
    getRoute: (path) => foundry.utils.getRoute(path),
    debounce: (fn, ms) => foundry.utils.debounce(fn, ms),
    parseUuid: (uuid) => foundry.utils.parseUuid(uuid),
    enrichHTML: (html, options) => foundry.applications.ux.TextEditor.implementation.enrichHTML(html, options)
  });
}

function createModule() {
  return Object.freeze({
    ...createModuleInfo(),
    setApi: (api) => {
      game.modules.get(MODULE_ID).api = api;
    },
    systemCompatibility: () =>
      [...(game.modules.get(MODULE_ID)?.relationships?.systems ?? [])].find((s) => s.id === game.system.id)
        ?.compatibility
  });
}

function createDice() {
  return Object.freeze({
    get Roll() {
      return foundry.dice.Roll;
    },
    get ChatMessage() {
      return CONFIG.ChatMessage?.documentClass ?? foundry.documents.ChatMessage;
    },
    get DialogV2() {
      return foundry.applications.api.DialogV2;
    }
  });
}

/**
 * Builds the platform. Reads no global now: every port reads on use, so it is safe to create at import time.
 * @returns {Platform}
 */
export function createPlatform() {
  return Object.freeze({
    system: Object.freeze({
      get id() {
        return game.system.id;
      },
      get version() {
        return game.system.version;
      },
      get title() {
        return game.system.title;
      }
    }),
    classes: createClasses(),
    t20: () => globalThis.tormenta20,
    t20Config: () => CONFIG.T20,
    statusEffects: () => CONFIG.statusEffects,
    settings: Object.freeze({
      register: (key, spec) => game.settings.register(MODULE_ID, key, spec),
      registerMenu: (key, spec) => game.settings.registerMenu(MODULE_ID, key, spec),
      get: (key) => game.settings.get(MODULE_ID, key),
      set: (key, value) => game.settings.set(MODULE_ID, key, value),
      /** Whether the world storage holds any setting of this module. It exists before "init" (ClientSettings). */
      hasStoredWorldValues: () => !!game.settings.storage.get("world")?.find((s) => s.key?.startsWith(`${MODULE_ID}.`)),
      /** Whether a world setting of this module is saved, and not just its default. */
      isStored: (key) => !!game.settings.storage.get("world")?.find((s) => s.key === `${MODULE_ID}.${key}`)
    }),
    i18n: Object.freeze({
      localize: (key) => game.i18n.localize(key),
      format: (key, data) => game.i18n.format(key, data),
      has: (key) => game.i18n.has(key),
      lang: () => game.i18n.lang,
      listFormat: (items) => game.i18n.getListFormatter().format(items)
    }),
    notify: Object.freeze({
      info: (message, options) => ui.notifications.info(message, options),
      warn: (message, options) => ui.notifications.warn(message, options),
      error: (message, options) => ui.notifications.error(message, options)
    }),
    hooks: Object.freeze({
      on: (name, fn) => Hooks.on(name, fn),
      once: (name, fn) => Hooks.once(name, fn),
      off: (name, id) => Hooks.off(name, id)
    }),
    user: Object.freeze({
      isGM: () => !!game.user?.isGM,
      isActiveGM: () => !!game.user?.isActiveGM,
      id: () => game.user?.id ?? game.userId,
      /** The user's current targets (a Set of Tokens), read on every call. */
      targets: () => game.user?.targets ?? []
    }),
    documents: createDocuments(),
    utils: createUtils(),
    dice: createDice(),
    forms: Object.freeze({ data: (form) => new foundry.applications.ux.FormDataExtended(form).object }),
    log: createLog(),
    sourceOf,
    sourceOfMethod,
    module: createModule(),
    config: createConfig(),
    core: createCore(),
    settingsOf,
    canvas: createScene(),
    handlebars: createHandlebars(),
    constants: () => globalThis.CONST,
    users: createUsers(),
    chat: createChat(),
    ui: createUi(),
    apps: createApps()
  });
}
