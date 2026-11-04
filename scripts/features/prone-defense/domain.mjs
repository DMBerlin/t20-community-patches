import { OUTROS_KEY } from "../../lib/prone.mjs";

const DEFENSE_PREFIX = "system.attributes.defesa.";

/**
 * Whether a change is the system's Caído Defense penalty: a negative "downgrade" on the manual Outros field.
 * @param {{key?: string, type?: string, value?: unknown}} change
 * @returns {boolean}
 */
export function isBuggyProneChange(change) {
  if (change?.key !== OUTROS_KEY || change.type !== "downgrade") return false;
  if (change.value === null || change.value === "" || typeof change.value === "boolean") return false;
  const value = Number(change.value);
  return Number.isFinite(value) && value < 0;
}

/**
 * Copy of the change that adds its value instead of downgrading the field. The original is not modified.
 * @param {object} change
 * @returns {object}
 */
export function toAdditive(change) {
  return { ...change, type: "add" };
}

/**
 * Reads the Caído condition data the system ships (CONFIG.T20.conditions.caido.system.changes up to 1.6.5, the
 * world.statuses copy in CONFIG.statusEffects.caido._source from 1.6.6).
 * It does not cover every copy applied in play (world.statuses is editable and actors store their own copies), so a
 * fix is never high confidence.
 * @param {unknown} changes
 * @returns {import("../../registry.mjs").Diagnosis}
 */
export function diagnoseProneChanges(changes) {
  if (!Array.isArray(changes)) return { bug: "unknown", confidence: "low", evidence: "Caído condition data not found" };
  if (changes.some(isBuggyProneChange)) {
    return { bug: "present", confidence: "high", evidence: "Caído downgrades defesa.outros to -5" };
  }
  const additive = changes.find(
    (c) => typeof c?.key === "string" && c.key.startsWith(DEFENSE_PREFIX) && c.type === "add" && Number(c.value) < 0
  );
  if (additive) {
    return { bug: "fixed", confidence: "low", evidence: `Caído adds ${additive.value} to ${additive.key}` };
  }
  return { bug: "unknown", confidence: "low", evidence: "Caído has no recognized Defense change" };
}
