import { plainText } from "../../lib/text.mjs";

const LINK_KEY = "efeito";
const DROPPED_KEYS = new Set(["efeito", "condicao"]);
/**
 * Candidates for a linked effect named `value` among `effects`, excluding the usage effect itself.
 * @param {Iterable<{id: string, name?: string, description?: string}>} effects
 * @param {string} value
 * @param {string} [excludeId]
 * @returns {object[]}
 */
export function findLinkedCandidates(effects, value, excludeId) {
  const wanted = String(value ?? "").trim();
  if (!wanted) return [];
  return [...(effects ?? [])].filter(
    (e) => e?.id !== excludeId && (e?.name === wanted || plainText(e?.description) === wanted)
  );
}

/**
 * Values of the "efeito" changes of a usage effect.
 * @param {{key?: string, value?: unknown}[]} changes
 * @returns {string[]}
 */
export function linkedValues(changes) {
  return [...(changes ?? [])]
    .filter((c) => c?.key === LINK_KEY && c.value != null)
    .map((c) => String(c.value).trim())
    .filter(Boolean);
}

/** Array whose push drops "efeito"/"condicao" changes; derived arrays (map, filter, deepClone) are plain arrays. */
export class OwnChangeList extends Array {
  static get [Symbol.species]() {
    return Array;
  }
  push(...items) {
    return super.push(...items.filter((c) => !DROPPED_KEYS.has(c?.key)));
  }
}
