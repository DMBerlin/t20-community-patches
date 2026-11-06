/**
 * Ports added for the patches migrated to scripts/features (#88). Same rules as foundry.mjs: every port reads the
 * globals on use, never at import time.
 */

/**
 * @typedef {object} ConfigPort
 * @property {(documentName: string) => object|undefined} document  CONFIG[documentName] (documentClass, dataModels,
 *   initiative…), read on every call.
 * @property {(name: string, value: string) => void} setControlIcon     CONFIG.controlIcons[name] = value.
 * @property {(name: string, statusId: string) => void} setSpecialStatus CONFIG.specialStatusEffects[name] = statusId.
 * @property {(entries: object[]) => void} setStatusEffects  CONFIG.statusEffects = entries (through the core setter).
 *
 * @typedef {object} CorePort  Core classes (never CONFIG, which the system and other modules replace).
 * @property {Function|undefined} Actor        foundry.documents.Actor
 * @property {Function|undefined} Item
 * @property {Function|undefined} ActiveEffect
 * @property {Function|undefined} Combat
 * @property {Function|undefined} Combatant
 * @property {Function|undefined} ActorSheetV1 foundry.appv1.sheets.ActorSheet
 * @property {Function|undefined} ApplicationV2
 * @property {object|undefined} fields         foundry.data.fields
 * @property {object|undefined} operators      foundry.data.operators
 *
 * @typedef {object} NamespaceSettings  Settings of another namespace (the system's, or core).
 * @property {(key: string) => unknown} get
 * @property {(key: string, value: unknown) => Promise<unknown>} set
 * @property {(key: string) => object|undefined} entry  The registered SettingConfig (game.settings.settings).
 * @property {(key: string, spec: object) => void} registerMenu
 */

/** @returns {ConfigPort} */
export function createConfig() {
  return Object.freeze({
    document: (documentName) => globalThis.CONFIG?.[documentName],
    setControlIcon: (name, value) => {
      CONFIG.controlIcons[name] = value;
    },
    setSpecialStatus: (name, statusId) => {
      CONFIG.specialStatusEffects[name] = statusId;
    },
    setStatusEffects: (entries) => {
      CONFIG.statusEffects = entries;
    }
  });
}

/** @returns {CorePort} */
export function createCore() {
  const documents = () => globalThis.foundry?.documents;
  return Object.freeze({
    get Actor() {
      return documents()?.Actor;
    },
    get Item() {
      return documents()?.Item;
    },
    get ActiveEffect() {
      return documents()?.ActiveEffect;
    },
    get Combat() {
      return documents()?.Combat;
    },
    get Combatant() {
      return documents()?.Combatant;
    },
    get ActorSheetV1() {
      return globalThis.foundry?.appv1?.sheets?.ActorSheet;
    },
    get ApplicationV2() {
      return globalThis.foundry?.applications?.api?.ApplicationV2;
    },
    get fields() {
      return globalThis.foundry?.data?.fields;
    },
    get operators() {
      return globalThis.foundry?.data?.operators;
    }
  });
}

/**
 * @param {string} namespace
 * @returns {NamespaceSettings}
 */
export function settingsOf(namespace) {
  return Object.freeze({
    get: (key) => game.settings.get(namespace, key),
    set: (key, value) => game.settings.set(namespace, key, value),
    entry: (key) => game.settings.settings.get(`${namespace}.${key}`),
    registerMenu: (key, spec) => game.settings.registerMenu(namespace, key, spec)
  });
}

/** @returns {{helpers(): Record<string, Function>|undefined}} */
export function createHandlebars() {
  return Object.freeze({ helpers: () => globalThis.Handlebars?.helpers });
}

/** World collections and uuid lookup, read on every call. */
export function createDocuments() {
  return Object.freeze({
    fromUuid: (uuid, options) => foundry.utils.fromUuid(uuid, options),
    fromUuidSync: (uuid, options) => foundry.utils.fromUuidSync(uuid, options),
    actors: () => game.actors,
    messages: () => game.messages,
    combats: () => game.combats,
    packs: () => game.packs,
    scenes: () => game.scenes,
    items: () => game.items
  });
}
