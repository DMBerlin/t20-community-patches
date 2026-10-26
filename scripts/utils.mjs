export const MODULE_ID = "t20-community-patches";

/**
 * Compare dotted numeric versions ("1.6.5"). Returns <0, 0 or >0.
 * @param {string} a
 * @param {string} b
 */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * Whether the installed system version is inside the range known to contain the bug.
 * A patch is only applied inside this range, so an official fix in a newer release is never doubled.
 * @param {string} version
 * @param {{minimum?: string, maximum?: string}} affected
 */
export function isSystemVersionAffected(version, { minimum, maximum } = {}) {
  if (minimum && compareVersions(version, minimum) < 0) return false;
  if (maximum && compareVersions(version, maximum) > 0) return false;
  return true;
}

const WRAPPED = Symbol.for(`${MODULE_ID}.wrapped`);

/**
 * Tags a wrapper with the function it replaced, so runtime probes can inspect the system's original code even
 * after another patch of this module wrapped it.
 * @template {Function} T
 * @param {T} wrapper
 * @param {Function} original
 * @returns {T}
 */
export function markWrapper(wrapper, original) {
  Object.defineProperty(wrapper, WRAPPED, { value: original });
  return wrapper;
}

/**
 * Follows markWrapper tags down to the innermost function.
 * @param {Function} fn
 * @returns {Function}
 */
export function unwrap(fn) {
  const seen = new Set();
  while (typeof fn?.[WRAPPED] === "function" && !seen.has(fn)) {
    seen.add(fn);
    fn = fn[WRAPPED];
  }
  return fn;
}

/**
 * Removes // and block comments from JavaScript source, keeping string and template literals intact, so a
 * source-reading probe never matches a term that only appears in a comment. Regex literals are not parsed; a
 * probe must treat its result as a hint, not proof.
 * @param {string} source
 * @returns {string}
 */
export function stripComments(source) {
  if (typeof source !== "string") return source;
  let out = "";
  let quote = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      out += ch;
      if (ch === "\\") out += source[++i] ?? "";
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
    } else if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 1;
      out += " ";
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * FNV-1a of the source without comments and with collapsed whitespace, plus its length. Never runs the code.
 * @param {string} source
 * @returns {string|null}
 */
export function sourceFingerprint(source) {
  if (typeof source !== "string") return null;
  const text = stripComments(source).replace(/\s+/g, " ").trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}:${text.length}`;
}

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
