/** Patch preferences (auto, off, force) and their migration (#89, split from scripts/registry.mjs). Pure. */

/** @typedef {import("./diagnosis.mjs").PatchMode} PatchMode */

/** Preference values, in the order shown in the patch manager. */
export const MODES = ["auto", "off", "force"];

/**
 * Reads a stored preference. Booleans from earlier versions: true → "auto", false → "off". Without a value, the
 * 0.1.0 setting decides (false → "off"), and otherwise "auto".
 * @param {unknown} value        `patches[id]`
 * @param {unknown} [legacy]     The 0.1.0 Boolean setting of the patch.
 * @returns {PatchMode}
 */
export function normalizeMode(value, legacy) {
  if (MODES.includes(value)) return /** @type {PatchMode} */ (value);
  if (value === true) return "auto";
  if (value === false) return "off";
  return legacy === false ? "off" : "auto";
}

/**
 * Rewrites booleans and 0.1.0 settings as modes, keeping the effective behavior.
 * @param {Record<string, unknown>} current  `patches` setting.
 * @param {string[]} ids
 * @param {(id: string) => unknown} legacy   Reads the 0.1.0 setting of a patch.
 * @returns {{next: Record<string, unknown>, migrated: string[]}|null}  null when nothing changes.
 */
export function planModeMigration(current, ids, legacy) {
  const next = { ...(current ?? {}) };
  const migrated = [];
  for (const id of ids) {
    if (MODES.includes(next[id])) continue;
    const mode = normalizeMode(next[id], next[id] === undefined ? legacy(id) : undefined);
    if (next[id] === undefined && mode === "auto") continue;
    next[id] = mode;
    migrated.push(id);
  }
  return migrated.length ? { next, migrated } : null;
}

/**
 * Mode saved for the switch and the "Apply always" box. A switch turned off ignores the box.
 * @param {{enabled: boolean, always?: boolean}} controls
 * @returns {PatchMode}
 */
export function modeFromControls({ enabled, always }) {
  if (!enabled) return "off";
  return always ? "force" : "auto";
}

/**
 * Inverse of modeFromControls.
 * @param {PatchMode} mode
 * @returns {{enabled: boolean, always: boolean}}
 */
export function controlsFromMode(mode) {
  return { enabled: mode !== "off", always: mode === "force" };
}
