import { findLegacyFieldsets } from "./domain.mjs";

/** AppV1 passes jQuery: the whole window on first render, the inner form on re-renders. */
export function onRenderItemSheet(_app, html) {
  try {
    const root = globalThis.HTMLElement && html instanceof HTMLElement ? html : html?.[0];
    if (!root?.querySelectorAll) return;
    for (const fieldset of findLegacyFieldsets(root)) fieldset.remove();
  } catch (err) {
    console.error("t20-community-patches | hide-legacy-upgrades:", err);
  }
}
