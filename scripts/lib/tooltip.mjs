/** Breakdown tooltips of the system's `fieldBonuses` helper. */

const signed = (n) => (n >= 0 ? `+${n}` : String(n));
const escapeHTML = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const TOOLTIP_TOTAL = /(<label>Total:<\/label><span>)([+-]?\d+)(<\/span>)/;

/**
 * Adds a line to a breakdown of the system's `fieldBonuses` helper (T20:4258-4463), which rebuilds the total from its
 * own list instead of reading the prepared value: inserts `label: value` before the total and corrects the total.
 * Returns the HTML unchanged when there is nothing to add or the format is not recognized.
 */
export function addTooltipLine(html, label, value) {
  if (!value || typeof html !== "string") return html;
  const hr = html.lastIndexOf("<hr>");
  if (hr < 0 || !TOOLTIP_TOTAL.test(html.slice(hr))) return html;
  const line = `<li class="flexrow"><label>${escapeHTML(label)}:</label><span>${signed(value)}</span></li>\n\t\t\t`;
  const tail = html.slice(hr).replace(TOOLTIP_TOTAL, (_, open, total, close) => `${open}${signed(Number(total) + value)}${close}`);
  return html.slice(0, hr) + line + tail;
}

export const IGNORED_TERMS = new Set(["system", "attributes", "tracos"]);

/**
 * The helper's [type, key] of a field path (T20:4262).
 * @param {string|{string: string}} path
 * @returns {string[]}
 */
export function fieldTerms(path) {
  const text = typeof path === "object" ? path?.string : path;
  return typeof text === "string" ? text.split(".").filter((t) => !IGNORED_TERMS.has(t)) : [];
}
