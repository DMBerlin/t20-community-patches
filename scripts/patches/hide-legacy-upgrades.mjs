/**
 * Hide the legacy "Deprecated" upgrades area (tormenta20 1.6.5).
 *
 * Bug: templates/item/parts/item-enhancements.hbs renders a <fieldset><legend>Deprecated</legend> block with the
 * old upgrade UI. Its selects have no `name` (never saved), its checkbox targets a non-existent field and its only
 * change handler returns immediately. It duplicates the new upgrade fields and misleads users.
 *
 * Fix: remove the fieldset from item sheets on render. No data is changed.
 */

export const LEGACY_SELECTOR = 'input[name="system.enableAutoUpgrades"], select.updateUpgrades';
export const LEGACY_LEGEND = "Deprecated";

/**
 * Whether a fieldset is the legacy upgrades area.
 * @param {{querySelector: Function}} fieldset
 * @returns {boolean}
 */
export function isLegacyFieldset(fieldset) {
  if (fieldset.querySelector(LEGACY_SELECTOR)) return true;
  return fieldset.querySelector(":scope > legend")?.textContent?.trim() === LEGACY_LEGEND;
}

/**
 * Find legacy upgrade fieldsets inside the enhancements tab.
 * @param {{querySelectorAll: Function}} root
 * @returns {Element[]}
 */
export function findLegacyFieldsets(root) {
  return [...root.querySelectorAll(".tab.enhancements fieldset")].filter(isLegacyFieldset);
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

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

function apply() {
  Hooks.on("renderItemSheetT20", onRenderItemSheet);
}

export default {
  id: "hide-legacy-upgrades",
  group: "items",
  issue: 8,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  // The template can't be inspected synchronously during init; the hook only acts when the legacy block exists.
  guarded: true,
  isNeeded: () => ({ bug: "unknown", confidence: "low", evidence: "the item sheet template is only read when rendered" }),
  apply
};
