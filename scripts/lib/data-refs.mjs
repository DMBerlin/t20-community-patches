/** Data references of formulas, as core resolves them (armor-penalty-reduction, field-bonuses-breakdown, non-proficiency-penalties). */

/**
 * Mirrors core DataField#_replaceDataRefs: recursive, throws on unresolved references.
 * @param {string} raw
 * @param {object} data
 * @param {{replaceFormulaData: Function}} RollClass  foundry.dice.Roll.defaultImplementation.
 */
export function resolveDataRefs(raw, data, RollClass) {
  const resolved = RollClass.replaceFormulaData(raw, data, { recursive: true });
  if (resolved.replace(/@\w+\[[^#\]]+]/g, "").includes("@")) {
    throw new Error(`Unable to replace all data references in ${JSON.stringify(raw)}`);
  }
  return resolved;
}
