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

const REGEX_KEYWORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

/** True when a `/` after `prev` (the code emitted so far) starts a regex literal rather than a division. */
function startsRegex(prev) {
  const code = prev.trimEnd();
  if (!code) return true;
  const last = code.at(-1);
  if (/[)\]\w$]/.test(last)) {
    const word = /[\w$]+$/.exec(code)?.[0];
    return word !== undefined && REGEX_KEYWORDS.has(word) && !/[.\w$]/.test(code.at(-word.length - 1) ?? "");
  }
  return !(last === "}" || last === '"' || last === "'" || last === "`");
}

/** End index (exclusive) of the string or template literal opened at `i`. */
function quotedEnd(source, i) {
  const quote = source[i];
  for (let j = i + 1; j < source.length; j++) {
    if (source[j] === "\\") j++;
    else if (source[j] === quote) return j + 1;
  }
  return source.length;
}

/** End index (exclusive) of the regex literal opened at `i`, flags included. */
function regexEnd(source, i) {
  let inClass = false;
  let j = i + 1;
  for (; j < source.length && source[j] !== "\n"; j++) {
    const ch = source[j];
    if (ch === "\\") j++;
    else if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) break;
  }
  j++;
  while (j < source.length && /[a-z]/i.test(source[j])) j++;
  return j;
}

/**
 * Splits JavaScript source in code and literals: comments become one blank (a newline for //), and string, template
 * and regex literals are kept verbatim. With `collapse`, every run of whitespace outside literals becomes one space.
 */
function scan(source, collapse) {
  let out = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    let end = -1;
    if (ch === '"' || ch === "'" || ch === "`") end = quotedEnd(source, i);
    else if (ch === "/" && next !== "/" && next !== "*" && startsRegex(out)) end = regexEnd(source, i);
    if (end >= 0) {
      out += source.slice(i, end);
      i = end - 1;
    } else if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      if (!collapse) out += "\n";
      else if (!out.endsWith(" ")) out += " ";
    } else if (ch === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close < 0 ? source.length : close + 1;
      if (!collapse || !out.endsWith(" ")) out += " ";
    } else if (collapse && /\s/.test(ch)) {
      if (!out.endsWith(" ")) out += " ";
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Removes // and block comments from JavaScript source, keeping string, template and regex literals intact, so a
 * source-reading probe never matches a term that only appears in a comment. Regex literals are told from divisions
 * by the preceding token; a probe must still treat its result as a hint, not proof.
 * @param {string} source
 * @returns {string}
 */
export function stripComments(source) {
  if (typeof source !== "string") return source;
  return scan(source, false);
}

/**
 * FNV-1a of the source without comments and with collapsed whitespace outside literals (strings, templates and
 * regexes count byte for byte), plus its length. Never runs the code.
 * @param {string} source
 * @returns {string|null}
 */
export function sourceFingerprint(source) {
  if (typeof source !== "string") return null;
  const text = scan(source, true).trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}:${text.length}`;
}
