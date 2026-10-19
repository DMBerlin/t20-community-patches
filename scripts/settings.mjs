import { MODULE_ID } from "./utils.mjs";
import { normalizeMode, planModeMigration } from "./registry.mjs";
import { PatchManager } from "./apps/patch-manager.mjs";

export const SETTINGS = {
  /** {[patchId]: "auto"|"off"|"force"}. Booleans and missing ids are read through normalizeMode. */
  patches: "patches",
  /** {[patchId]: StatusRecord} seen by this user on the previous load, used to notify each GM once per change. */
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
 * @returns {import("./registry.mjs").PatchMode}
 */
export function getPatchMode(id) {
  const value = game.settings.get(MODULE_ID, SETTINGS.patches)?.[id];
  return normalizeMode(value, value === undefined ? game.settings.get(MODULE_ID, legacyKey(id)) : undefined);
}

/**
 * Rewrites booleans and the 0.1.0 settings as modes, keeping the effective behavior. Run by the active GM.
 * @param {{id: string}[]} patches
 */
export async function migrateLegacySettings(patches) {
  const plan = planModeMigration(
    game.settings.get(MODULE_ID, SETTINGS.patches) ?? {},
    patches.map((p) => p.id),
    (id) => game.settings.get(MODULE_ID, legacyKey(id))
  );
  if (!plan) return;
  await game.settings.set(MODULE_ID, SETTINGS.patches, plan.next);
  console.log(`${MODULE_ID} | Migrated patch preferences: ${plan.migrated.join(", ")}`);
}
