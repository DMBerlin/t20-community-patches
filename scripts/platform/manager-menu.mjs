/**
 * Platform adapter of the Center (#86, #89): builds its class, registers its settings menu and, once the translations
 * load, appends the system compatibility line to the menu hint.
 */
import { createPatchManagerClass } from "../apps/patch-manager/app.mjs";

const MENU = "manager";

/**
 * Called during "init", when the application classes exist.
 * @param {import("./foundry.mjs").Platform} platform
 * @param {{features: object[], patches: object[], groups: string[],
 *   status: () => import("../kernel/lifecycle.mjs").StatusEntry[]}} center  See createPatchManagerClass.
 */
export function registerManagerMenu(platform, { features, patches, groups, status }) {
  // The core keeps this very object as the menu entry (ClientSettings#registerMenu), so its hint can change later.
  const menu = {
    name: "T20CP.Manager.Name",
    label: "T20CP.Manager.Label",
    hint: "T20CP.Manager.Hint",
    icon: "fa-solid fa-screwdriver-wrench",
    type: createPatchManagerClass({ platform, features, patches, groups, status }),
    restricted: true
  };
  platform.settings.registerMenu(MENU, menu);
  // Translations only load after init: the hint gains the compatibility line once they are ready.
  platform.hooks.once("i18nInit", () => {
    const compat = platform.module.systemCompatibility();
    if (!compat) return;
    const line = platform.i18n.format("T20CP.Manager.Compatibility", {
      minimum: compat.minimum,
      verified: compat.verified,
      installed: platform.system.version
    });
    menu.hint = `${platform.i18n.localize("T20CP.Manager.Hint")} ${line}`;
  });
}
