/**
 * The only layer that reads Foundry globals (#86). Every port reads on demand (getters and arrow functions), because
 * CONFIG.*.documentClass, game.user, CONFIG.statusEffects and the translations change between "init" and "ready".
 * Methods of game.settings, game.i18n, Hooks and ui.notifications are always called on their owner, never detached.
 */
import { MODULE_ID } from "../lib/module.mjs";
import { unwrap } from "../lib/source.mjs";

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
 * @property {{localize(key: string): string, format(key: string, data?: object): string, has(key: string): boolean}} i18n
 * @property {{info(msg: string, opts?: object), warn(msg: string, opts?: object), error(msg: string, opts?: object)}} notify
 * @property {{on(name: string, fn: Function): number, once(name: string, fn: Function): number,
 *   off(name: string, id: number|Function): void}} hooks
 * @property {{isGM(): boolean, isActiveGM(): boolean, id(): string|undefined, targets(): Iterable<object>}} user
 * @property {{fromUuid(uuid: string): Promise<object|null>, fromUuidSync(uuid: string): object|null,
 *   actors(): object, messages(): object, combats(): object, packs(): object, scenes(): object}} documents
 * @property {{getProperty: Function, setProperty: Function, hasProperty: Function, deepClone: Function,
 *   randomID: Function, escapeHTML: Function, expandObject: Function, slugify(text: string): string}} utils
 * @property {{Roll: Function, ChatMessage: Function, DialogV2: object}} dice
 * @property {{data(form: HTMLFormElement): object}} forms  FormDataExtended#object of a form.
 * @property {{info(...a: unknown[]), warn(...a: unknown[]), error(...a: unknown[])}} log  Prefixed with the module id.
 * @property {(fn: Function) => string|null} sourceOf   Source of the innermost function under the module's wrappers.
 * @property {{setApi(api: object): void, systemCompatibility(): {minimum?: string, verified?: string}|undefined}} module
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
    slugify: (text) => String(text).slugify()
  });
}

function createDocuments() {
  return Object.freeze({
    fromUuid: (uuid) => foundry.utils.fromUuid(uuid),
    fromUuidSync: (uuid) => foundry.utils.fromUuidSync(uuid),
    actors: () => game.actors,
    messages: () => game.messages,
    combats: () => game.combats,
    packs: () => game.packs,
    scenes: () => game.scenes
  });
}

function createModule() {
  return Object.freeze({
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
      set: (key, value) => game.settings.set(MODULE_ID, key, value)
    }),
    i18n: Object.freeze({
      localize: (key) => game.i18n.localize(key),
      format: (key, data) => game.i18n.format(key, data),
      has: (key) => game.i18n.has(key)
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
    sourceOf: (fn) => {
      const inner = unwrap(fn);
      return typeof inner === "function" ? Function.prototype.toString.call(inner) : null;
    },
    module: createModule()
  });
}
