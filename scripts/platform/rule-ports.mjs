/**
 * Ports added for the optional rules and the Center migrated to scripts/features and scripts/apps (#89). Same rules
 * as foundry.mjs: every port reads the globals on use, never at import time.
 */
import { MODULE_ID } from "../lib/module.mjs";

/**
 * @typedef {object} UsersPort
 * @property {() => object|undefined} current       game.user (the User document: testUserPermission, character…).
 * @property {() => object|undefined} activeGM      game.users.activeGM
 * @property {() => object[]} players               game.users.players
 * @property {(predicate: (user: object) => boolean) => object|null} designated  game.users.getDesignatedUser
 * @property {(name: string) => object[]} whisperRecipients  ChatMessage.getWhisperRecipients(name)
 *
 * @typedef {object} ChatPort
 * @property {(data: object, options?: object) => Promise<object>} create  ChatMessage document class #create.
 * @property {(options: object) => object} speaker  ChatMessage.getSpeaker
 * @property {(data: object, mode?: string) => object} applyMode  ChatMessage.applyMode
 * @property {(message: object) => void} updateMessage  ui.chat.updateMessage, when the chat log exists.
 *
 * @typedef {object} UiPort
 * @property {(options?: object) => void} renderControls  ui.controls.render(options), when the controls exist.
 * @property {(id: string) => object|undefined} application  foundry.applications.instances.get(id)
 * @property {(options?: object) => Promise<unknown>} reloadConfirm  SettingsConfig.reloadConfirm(options)
 *
 * @typedef {object} ScenePort
 * @property {() => object|undefined} tokenHud     canvas.hud.token
 * @property {() => object[]} controlledTokens    canvas.tokens.controlled
 * @property {() => object|undefined} scene        canvas.scene
 * @property {() => object|undefined} activeCombat game.combat
 *
 * @typedef {object} AppsPort  Base classes of the module's applications (read on use: only after "init").
 * @property {Function} ApplicationV2
 * @property {Function} HandlebarsApplicationMixin
 *
 * @typedef {object} ModuleInfo
 * @property {() => string|undefined} version      This module's version.
 * @property {() => string|undefined} coreVersion  game.version
 * @property {() => string|undefined} bugs         This module's manifest "bugs" URL.
 */

/** @returns {UsersPort} */
export function createUsers() {
  return Object.freeze({
    current: () => game.user,
    activeGM: () => game.users?.activeGM,
    players: () => [...(game.users?.players ?? [])],
    designated: (predicate) => game.users?.getDesignatedUser?.(predicate) ?? null,
    whisperRecipients: (name) => [...(chatClass()?.getWhisperRecipients?.(name) ?? [])]
  });
}

const chatClass = () => CONFIG.ChatMessage?.documentClass ?? foundry.documents.ChatMessage;

/** @returns {ChatPort} */
export function createChat() {
  return Object.freeze({
    create: (data, options) => chatClass().create(data, options),
    speaker: (options) => chatClass().getSpeaker(options),
    applyMode: (data, mode) => chatClass().applyMode(data, mode),
    updateMessage: (message) => ui.chat?.updateMessage?.(message)
  });
}

/** @returns {UiPort} */
export function createUi() {
  return Object.freeze({
    renderControls: (options) => ui.controls?.render?.(options),
    application: (id) => foundry.applications.instances.get(id),
    reloadConfirm: (options) => foundry.applications.settings.SettingsConfig.reloadConfirm(options)
  });
}

/** @returns {ScenePort} */
export function createScene() {
  return Object.freeze({
    tokenHud: () => globalThis.canvas?.hud?.token,
    controlledTokens: () => [...(globalThis.canvas?.tokens?.controlled ?? [])],
    scene: () => globalThis.canvas?.scene ?? undefined,
    activeCombat: () => game.combat ?? undefined
  });
}

/** @returns {AppsPort} */
export function createApps() {
  return Object.freeze({
    get ApplicationV2() {
      return foundry.applications.api.ApplicationV2;
    },
    get HandlebarsApplicationMixin() {
      return foundry.applications.api.HandlebarsApplicationMixin;
    }
  });
}

/** @returns {ModuleInfo} */
export function createModuleInfo() {
  return Object.freeze({
    version: () => game.modules.get(MODULE_ID)?.version,
    coreVersion: () => game.version,
    bugs: () => game.modules.get(MODULE_ID)?.bugs
  });
}
