/**
 * Checks the `T20:<line>` references in comments against a bundle (#90). Each reference is anchored on the code-like
 * name closest before it in the same line (`Class#method`, `name.member`, camelCase, `backticks`); the name is
 * searched in the bundle around the cited line. Only a hint for the reviewer: it never rewrites a file.
 */

const REF = /T20:(\d+)(?:-(\d+))?/g;
const ANCHOR = /`([^`]+)`|([A-Za-z_$][\w$]*(?:[#.][A-Za-z_$][\w$]*)+)|\b([a-z_$][\w$]*[A-Z_][\w$]*)\b|\b([A-Z][a-z]+[A-Z0-9][\w$]*)\b/g;
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;
const VERSION = /\b\d+\.\d+\.\d+\b/g;

/** Lines around the cited ones where the anchor still counts as "ok". */
export const REF_TOLERANCE = 3;
/** How far from the cited line the anchor is searched. */
export const REF_WINDOW = 200;

/** Last identifier of a code-like token: `ActorT20#rollPericia` → rollPericia, `this.update` → update. */
function lastIdentifier(token) {
  const names = token.match(IDENTIFIER) ?? [];
  return names.at(-1) ?? null;
}

/**
 * The anchor of a reference: the code-like name closest before `index` in the line, else the first one after it.
 * @param {string} line
 * @param {number} index  Position of the reference in the line.
 * @returns {string|null}
 */
export function refAnchor(line, index) {
  let before = null;
  let after = null;
  for (const match of line.matchAll(ANCHOR)) {
    const name = lastIdentifier(match[0]);
    if (!name || name.length < 3 || /^T20$/.test(name)) continue;
    if (match.index < index) before = name;
    else if (after === null && match.index > index) after = name;
  }
  return before ?? after;
}

/**
 * Every reference of a source file.
 * @param {string} text
 * @returns {{fileLine: number, start: number, end: number, anchor: string|null, versions: string[]}[]}
 */
export function findRefs(text) {
  const refs = [];
  text.split("\n").forEach((line, i) => {
    for (const match of line.matchAll(REF)) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : start;
      refs.push({ fileLine: i + 1, start, end, anchor: refAnchor(line, match.index), versions: line.match(VERSION) ?? [] });
    }
  });
  return refs;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where the anchor of a reference is in a bundle.
 * - `ok`: within the cited lines (± REF_TOLERANCE);
 * - `shifted`: elsewhere within ± REF_WINDOW, at `line` (the closest);
 * - `missing`: not within the window;
 * - `pinned`: the comment names a system version other than the bundle's (a historical reference);
 * - `no-anchor`: no code-like name in the line.
 * @param {{start: number, end: number, anchor: string|null, versions: string[]}} ref
 * @param {string[]} lines  The bundle, split in lines.
 * @param {string} [version]  Version of the audited bundle.
 * @returns {{status: "ok"|"shifted"|"missing"|"pinned"|"no-anchor", line?: number}}
 */
export function checkRef(ref, lines, version) {
  if (version && ref.versions.length && !ref.versions.includes(version)) return { status: "pinned" };
  if (!ref.anchor) return { status: "no-anchor" };
  const word = new RegExp(`(^|[^\\w$])${escapeRegExp(ref.anchor)}(?![\\w$])`);
  const from = Math.max(1, ref.start - REF_WINDOW);
  const to = Math.min(lines.length, ref.end + REF_WINDOW);
  let closest = null;
  for (let n = from; n <= to; n++) {
    if (!word.test(lines[n - 1])) continue;
    if (n >= ref.start - REF_TOLERANCE && n <= ref.end + REF_TOLERANCE) return { status: "ok" };
    const distance = n < ref.start ? ref.start - n : n - ref.end;
    if (closest === null || distance < closest.distance) closest = { line: n, distance };
  }
  return closest ? { status: "shifted", line: closest.line } : { status: "missing" };
}
