import { EPSILON, TOTAL, escapeHTML, signed, tidy } from "./shared.mjs";

/**
 * Removes the last line `label: value` written by the helper before the total and corrects the total.
 * Returns the HTML unchanged when the line or the total is not found.
 * @param {string} html
 * @param {string} label  As the helper writes it (not escaped).
 * @param {number} value
 */
export function removeTooltipLine(html, label, value) {
  if (!value || !Number.isFinite(value) || typeof html !== "string") return html;
  const hr = html.lastIndexOf("<hr>");
  if (hr < 0 || !TOTAL.test(html.slice(hr))) return html;
  const line = `<li class="flexrow"><label>${label}:</label><span>${signed(value)}</span></li>`;
  const at = html.lastIndexOf(line, hr);
  if (at < 0) return html;
  const tail = html.slice(hr).replace(TOTAL, (_, open, total, close) => `${open}${signed(Number(total) - value)}${close}`);
  return html.slice(0, at) + html.slice(at + line.length, hr) + tail;
}

/**
 * Adds a line `label: value` before the total and corrects the total; accepts fractional values.
 * Returns the HTML unchanged when the value is 0 or the total is not found.
 * @param {string} html
 * @param {string} label  Escaped here.
 * @param {number} value
 */
export function appendTooltipLine(html, label, value) {
  if (!value || !Number.isFinite(value) || typeof html !== "string") return html;
  const hr = html.lastIndexOf("<hr>");
  if (hr < 0 || !TOTAL.test(html.slice(hr))) return html;
  const line = `<li class="flexrow"><label>${escapeHTML(label)}:</label><span>${signed(tidy(value))}</span></li>\n\t\t\t`;
  const tail = html.slice(hr).replace(TOTAL, (_, open, total, close) => `${open}${signed(tidy(Number(total) + value))}${close}`);
  return html.slice(0, hr) + line + tail;
}

/**
 * What preparePVPM's Math.floor takes from a fractional breakdown total (0 when the total is whole or not found).
 * @param {string} html
 */
export function roundingDelta(html) {
  if (typeof html !== "string") return 0;
  const hr = html.lastIndexOf("<hr>");
  const total = Number(TOTAL.exec(hr < 0 ? "" : html.slice(hr))?.[2]);
  if (!Number.isFinite(total)) return 0;
  const delta = tidy(Math.floor(tidy(total)) - total);
  return Math.abs(delta) > EPSILON ? delta : 0;
}
