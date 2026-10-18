import { MODULE_ID } from "./utils.mjs";
import { PatchManager } from "./apps/patch-manager.mjs";

export const SETTINGS = {
  /** {[patchId]: boolean}. Missing ids are enabled. */
  patches: "patches",
  /** {[patchId]: PatchState} recorded on the previous load, used to notify the GM about changes. */
  lastStatus: "lastStatus"
};

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.patches, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
  game.settings.register(MODULE_ID, SETTINGS.lastStatus, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
  game.settings.registerMenu(MODULE_ID, "manager", {
    name: "T20CP.Manager.Name",
    label: "T20CP.Manager.Label",
    hint: "T20CP.Manager.Hint",
    icon: "fa-solid fa-screwdriver-wrench",
    type: PatchManager,
    restricted: true
  });
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isPatchEnabled(id) {
  return game.settings.get(MODULE_ID, SETTINGS.patches)?.[id] !== false;
}
