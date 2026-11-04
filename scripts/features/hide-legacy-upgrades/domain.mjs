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
