/** Source of a spell DC bonus (spell-dc-bonus, nonlethal-attack). */

/**
 * Whether a document is a copy of a compendium entry, by source id or by name.
 * @param {{name?: string, _stats?: {compendiumSource?: string}, flags?: object}} doc
 * @param {{id: string, names: Set<string>}} ref
 * @returns {boolean}
 */
export function matchesSource(doc, { id, names }) {
  if (sourceId(doc) === id) return true;
  return names.has(String(doc?.name ?? "").trim().toLowerCase());
}

/**
 * Last segment of the document's compendium source, or "".
 * @param {{_stats?: {compendiumSource?: string}, flags?: object}} doc
 * @returns {string}
 */
export function sourceId(doc) {
  const source = String(doc?._stats?.compendiumSource ?? doc?.flags?.core?.sourceId ?? "");
  return source ? source.split(".").pop() : "";
}
