/** Wrapper tags and source-reading helpers for the runtime probes. */
import { MODULE_ID } from "./module.mjs";

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
