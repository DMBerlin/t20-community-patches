/**
 * Platform adapter of the Center (#86): registers its settings menu and, once the translations load, appends the
 * system compatibility line to the menu hint.
 */
import { MODULE_ID } from "../utils.mjs";
import { PatchManager } from "../apps/patch-manager.mjs";

const MENU = "manager";

/**
 * @param {import("./foundry.mjs").Platform} platform
 */
export function registerManagerMenu(platform) {
  platform.settings.registerMenu(MENU, {
    name: "T20CP.Manager.Name",
    label: "T20CP.Manager.Label",
    hint: "T20CP.Manager.Hint",
    icon: "fa-solid fa-screwdriver-wrench",
    type: PatchManager,
    restricted: true
  });
  // Translations only load after init: the hint gains the compatibility line once they are ready.
  platform.hooks.once("i18nInit", () => {
    const menu = game.settings.menus.get(`${MODULE_ID}.${MENU}`);
    const compat = platform.module.systemCompatibility();
    if (!menu || !compat) return;
    const line = platform.i18n.format("T20CP.Manager.Compatibility", {
      minimum: compat.minimum,
      verified: compat.verified,
      installed: platform.system.version
    });
    menu.hint = `${platform.i18n.localize("T20CP.Manager.Hint")} ${line}`;
  });
}
