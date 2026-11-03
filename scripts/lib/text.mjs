/** Plain text of item descriptions and chat flavors (linked-usage-effects, usage-buff-templates, nonlethal-attack…). */

export const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/**
 * Plain text of an HTML description: tags removed, common entities decoded, whitespace collapsed.
 * @param {string} html
 * @returns {string}
 */
export function plainText(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m])
    .replace(/\s+/g, " ")
    .trim();
}

/** Roll flavor cannot hold brackets (core:client/dice/grammar.pegjs). */
export const sanitizeFlavor = (text) => String(text ?? "").replace(/[[\]]/g, "").trim();
