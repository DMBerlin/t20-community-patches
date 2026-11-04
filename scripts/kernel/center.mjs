/** Pure helpers of the Center: state categories, reload, issue report and focus (#89, split from scripts/registry.mjs). */

import { BUGS } from "./diagnosis.mjs";

/** @typedef {import("./diagnosis.mjs").PatchMode} PatchMode */
/** @typedef {import("./diagnosis.mjs").Diagnosis} Diagnosis */

/**
 * @typedef {"active"|"unneeded"|"attention"|"off"} StateCategory
 */

const CATEGORIES = {
  active: ["applied", "forced", "applied-unverified", "applied-guarded", "suspected-fixed"],
  unneeded: ["fixed", "disabled-fixed"],
  attention: ["unverified", "error"],
  off: ["disabled", "incompatible"]
};
const CATEGORY_OF = new Map(Object.entries(CATEGORIES).flatMap(([category, states]) => states.map((s) => [s, category])));

/** Category order, as shown in the Center header. */
export const STATE_CATEGORIES = ["active", "unneeded", "attention", "off"];

/**
 * Groups the display states in the four categories the GM sees. An unknown state needs attention.
 * @param {string} state  Display state (see displayState).
 * @returns {StateCategory}
 */
export function stateCategory(state) {
  return /** @type {StateCategory} */ (CATEGORY_OF.get(state) ?? "attention");
}

/**
 * Counts the display states by category.
 * @param {string[]} states
 * @returns {Record<StateCategory, number>}
 */
export function countCategories(states) {
  const counts = Object.fromEntries(STATE_CATEGORIES.map((c) => [c, 0]));
  for (const state of states) counts[stateCategory(state)]++;
  return /** @type {Record<StateCategory, number>} */ (counts);
}

/**
 * Whether saving needs a world reload: any patch mode change (apply() only runs on init) or a changed setting
 * registered with `requiresReload`.
 * @param {string[]} changedPatches                    Ids whose mode changed.
 * @param {{requiresReload?: boolean}[]} changedSettings
 * @returns {boolean}
 */
export function needsReload(changedPatches, changedSettings) {
  return changedPatches.length > 0 || changedSettings.some((s) => !!s?.requiresReload);
}

/**
 * URL of a new prefilled issue for a patch that needs attention. Only closed fields go in the URL: evidence and
 * reason may hold arbitrary exception messages, so they never do.
 * @param {object} args
 * @param {string} [args.bugs]           The module's `bugs` URL.
 * @param {{id: string, issue?: number}} args.patch
 * @param {string} args.name             Localized patch name.
 * @param {string} args.state            Display state.
 * @param {PatchMode} args.mode
 * @param {Diagnosis} [args.diagnosis]
 * @param {{system?: string, foundry?: string, module?: string}} [args.versions]
 * @returns {string|null}
 */
export function reportIssueUrl({ bugs, patch, name, state, mode, diagnosis, versions = {} }) {
  if (!bugs || !patch?.id) return null;
  const base = String(bugs).replace(/\/+$/, "");
  const title = `[${patch.id}] ${state}`;
  const lines = [
    `**Correção:** ${name} (\`${patch.id}\`)`,
    patch.issue ? `**Issue original:** #${patch.issue}` : null,
    `**Tormenta20:** ${versions.system ?? "?"} · **Foundry:** ${versions.foundry ?? "?"} · **Módulo:** ${versions.module ?? "?"}`,
    `**Modo:** ${mode} · **Estado:** ${state}`,
    diagnosis && BUGS.has(diagnosis.bug)
      ? `**Diagnóstico:** ${diagnosis.bug}/${diagnosis.confidence === "high" ? "high" : "low"}`
      : null,
    "",
    "**O que aconteceu:**",
    ""
  ].filter((l) => l !== null);
  return `${base}/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

/**
 * Where Tab moves the focus inside a focus-trapped container: the next or previous element, wrapping around at the
 * ends, and back inside when the focus escaped.
 * @param {number} count       Focusable elements in the container.
 * @param {number} index       Index of the focused element, or -1 when the focus is outside.
 * @param {boolean} backwards  Shift+Tab.
 * @returns {number|null}      Null when there is nothing to focus.
 */
export function nextFocusIndex(count, index, backwards) {
  if (count < 1) return null;
  if (index < 0) return backwards ? count - 1 : 0;
  return (index + (backwards ? count - 1 : 1)) % count;
}
