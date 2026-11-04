/**
 * Whether the sheet toggle of this effect should mean "Always Apply".
 * @param {object} effect
 * @returns {boolean}
 */
export function usesAutomaticToggle(effect) {
  if (!effect?.system?.onuse) return false;
  return !(effect.isTemporary && effect.parent?.documentName === "Item");
}

/**
 * Icon classes for a usage toggle.
 * @param {boolean} automatic
 * @returns {{add: string, remove: string}}
 */
export function toggleIconClasses(automatic) {
  return automatic ? { add: "fa-square-check", remove: "fa-square" } : { add: "fa-square", remove: "fa-square-check" };
}

/**
 * Inspects the source of ActiveEffectT20.onManageActiveEffect: true when the toggle still flips `disabled` for
 * every effect, false when it already knows about "Always Apply", undefined otherwise.
 * @param {string} source
 * @returns {boolean|undefined}
 */
export function toggleFlipsDisabled(source) {
  if (typeof source !== "string") return undefined;
  if (source.includes("abilityUse.automatic")) return false;
  if (/case\s*["']toggle["']\s*:\s*return\s+effect\.update\(\s*\{\s*disabled\s*:\s*!\s*effect\.disabled\s*\}\s*\)/.test(source)) {
    return true;
  }
  return undefined;
}
