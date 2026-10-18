import { MODULE_ID } from "./utils.mjs";
import { PatchManager } from "./apps/patch-manager.mjs";

export const SETTINGS = {
  /** {[patchId]: boolean}. Missing ids fall back to the legacy setting, then to enabled. */
  patches: "patches",
  /** {[patchId]: PatchState} seen by this user on the previous load, used to notify each GM once per change. */
  lastStatus: "lastStatus"
};

/** Setting used by 0.1.0, one Boolean per patch. Kept hidden only to migrate its value. */
const legacyKey = (id) => `patch.${id}`;

/** @param {{id: string}[]} patches */
export function registerSettings(patches) {
  game.settings.register(MODULE_ID, SETTINGS.patches, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
  game.settings.register(MODULE_ID, SETTINGS.lastStatus, {
    scope: "user",
    config: false,
    type: Object,
    default: {}
  });
  for (const { id } of patches) {
    game.settings.register(MODULE_ID, legacyKey(id), { scope: "world", config: false, type: Boolean, default: true });
  }
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
  const value = game.settings.get(MODULE_ID, SETTINGS.patches)?.[id];
  if (typeof value === "boolean") return value;
  return game.settings.get(MODULE_ID, legacyKey(id)) !== false;
}

/**
 * Copies patches disabled through the 0.1.0 settings into the `patches` setting. Run by the active GM.
 * @param {{id: string}[]} patches
 */
export async function migrateLegacySettings(patches) {
  const current = game.settings.get(MODULE_ID, SETTINGS.patches) ?? {};
  const migrated = patches.filter(
    ({ id }) => typeof current[id] !== "boolean" && game.settings.get(MODULE_ID, legacyKey(id)) === false
  );
  if (!migrated.length) return;
  const next = { ...current };
  for (const { id } of migrated) next[id] = false;
  await game.settings.set(MODULE_ID, SETTINGS.patches, next);
  console.log(`${MODULE_ID} | Migrated legacy settings: ${migrated.map((p) => p.id).join(", ")}`);
}
