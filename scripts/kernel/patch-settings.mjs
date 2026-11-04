/**
 * Settings of the patch modes (#86, formerly scripts/settings.mjs). The kernel never reads Foundry globals: every
 * function receives the platform's settings port, whose keys already belong to this module.
 */
import { normalizeMode, planModeMigration } from "./modes.mjs";

export const SETTINGS = {
  /** {[patchId]: "auto"|"off"|"force"}. Booleans and missing ids are read through normalizeMode. */
  patches: "patches",
  /** {[patchId]: StatusRecord} seen by this user on the previous load, used to notify each GM once per change. */
  lastStatus: "lastStatus"
};

/** Setting used by 0.1.0, one Boolean per patch. Kept hidden only to migrate its value. */
const legacyKey = (id) => `patch.${id}`;

/**
 * @typedef {object} SettingsPort
 * @property {(key: string, spec: object) => void} register
 * @property {(key: string) => unknown} get
 * @property {(key: string, value: unknown) => Promise<unknown>} set
 */

/**
 * @param {SettingsPort} settings
 * @param {{id: string}[]} patches
 */
export function registerPatchSettings(settings, patches) {
  settings.register(SETTINGS.patches, { scope: "world", config: false, type: Object, default: {} });
  settings.register(SETTINGS.lastStatus, { scope: "user", config: false, type: Object, default: {} });
  for (const { id } of patches) {
    settings.register(legacyKey(id), { scope: "world", config: false, type: Boolean, default: true });
  }
}

/**
 * @param {SettingsPort} settings
 * @param {string} id
 * @returns {import("./diagnosis.mjs").PatchMode}
 */
export function getPatchMode(settings, id) {
  const value = settings.get(SETTINGS.patches)?.[id];
  return normalizeMode(value, value === undefined ? settings.get(legacyKey(id)) : undefined);
}

/**
 * Rewrites booleans and the 0.1.0 settings as modes, keeping the effective behavior. Run by the active GM.
 * @param {SettingsPort} settings
 * @param {{id: string}[]} patches
 * @param {{info: Function}} log
 */
export async function migrateLegacySettings(settings, patches, log) {
  const plan = planModeMigration(
    settings.get(SETTINGS.patches) ?? {},
    patches.map((p) => p.id),
    (id) => settings.get(legacyKey(id))
  );
  if (!plan) return;
  await settings.set(SETTINGS.patches, plan.next);
  log.info(`Migrated patch preferences: ${plan.migrated.join(", ")}`);
}
