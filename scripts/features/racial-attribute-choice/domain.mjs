import { stripComments } from "../../lib/source.mjs";

export const PICK_COUNT = 3;
const KNOWN_DESCRIPTIONS = ["+1 em tres atributos diferentes", "+1 in three different attributes"];

/**
 * Lowercase, without accents and with collapsed spaces.
 * @param {unknown} text
 */
export function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Whether the dialog description is the "+1 in three different attributes" rule.
 * @param {unknown} description  Text of the dialog heading.
 * @param {string} [localized]   The client's translation of T20.DynamicAbilitiesDesc.
 */
export function isThreeDistinctRule(description, localized) {
  const text = normalizeText(description);
  if (!text) return false;
  if (KNOWN_DESCRIPTIONS.includes(text)) return true;
  return !!localized && localized !== "T20.DynamicAbilitiesDesc" && text === normalizeText(localized);
}

/**
 * Toggles one attribute: removes it when selected, adds it while under the limit, otherwise keeps the selection.
 * @param {string[]} selected
 * @param {string} key
 * @param {number} [limit]
 * @returns {string[]}
 */
export function toggleSelection(selected, key, limit = PICK_COUNT) {
  if (selected.includes(key)) return selected.filter((k) => k !== key);
  if (selected.length >= limit) return selected;
  return [...selected, key];
}

/**
 * Which toggles are locked and whether Apply is allowed.
 * @param {string[]} keys      Attributes shown in the dialog.
 * @param {string[]} selected
 * @param {number} [limit]
 * @returns {{canApply: boolean, locked: string[]}}
 */
export function selectionState(keys, selected, limit = PICK_COUNT) {
  const chosen = [...new Set(selected.filter((k) => keys.includes(k)))];
  const full = chosen.length >= limit;
  return {
    canApply: chosen.length === limit,
    locked: full ? keys.filter((k) => !chosen.includes(k)) : []
  };
}

/**
 * Inspects the system's race creation code (comments stripped).
 * @param {unknown} source  Source of ItemT20.prototype._onCreateOwnedRace
 * @returns {import("../../registry.mjs").Diagnosis}
 */
export function raceDialogDiagnosis(source) {
  const code = typeof source === "string" ? stripComments(source) : "";
  if (code.includes("dynamic-attributes-dialog.hbs") && /base\s*\+\s*\(\s*value\s*\?\?\s*0\s*\)/.test(code)) {
    return { bug: "present", confidence: "high", evidence: "_onCreateOwnedRace adds the typed value without validation" };
  }
  return { bug: "unknown", confidence: "low", evidence: "_onCreateOwnedRace not recognized" };
}
