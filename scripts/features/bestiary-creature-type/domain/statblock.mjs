import { ROLE_WORDS, SIZE_WORDS, TYPE_WORDS } from "./words.mjs";

export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const TYPE_LINE = /.*\s(especial|solo|lacaio|Iniciativa)/i;

/** The tokens StatblockParser#parseData reads for type, size, role and subtype (`types`, T20:10298-10304). */
export function typeTokens(statblock) {
  if (typeof statblock !== "string") return null;
  const line = capitalize(statblock).match(TYPE_LINE)?.[0];
  return line ? line.replace(/Iniciativa|\(|\)/gi, "").trim().split(" ") : null;
}

const lineTokens = (line) => line.replace(/Iniciativa|\(|\)/gi, "").trim().split(" ");
const afterNd = (tokens) => {
  const nd = tokens.findIndex((token, i) => token === "ND" && /^\d/.test(tokens[i + 1] ?? ""));
  return nd < 0 ? null : tokens.slice(nd + 2);
};

/**
 * The creature classification of a statblock, as tokens:
 *  - own: the classification words;
 *  - prefix: the tokens the original read before them (name words);
 *  - read: the tokens of own the original read (its result on them is what it "read" from the classification).
 * The original reads the first line as the `name` (T20:10277), and _parseStatblock joins a line starting in lower case
 * to the previous one (T20:10144). When the text the original reads starts on the name line, only the tokens after
 * "ND <value>" are the classification. When a blank line separates the classification from "Iniciativa", the original
 * reads only the empty line; the classification is then the last line with text before it. With no ND on the name
 * line (a name with "Especial…"), null keeps the official behavior.
 */
export function classificationTokens(statblock) {
  const tokens = typeTokens(statblock);
  if (!tokens) return null;
  const match = capitalize(statblock).match(TYPE_LINE);
  const before = capitalize(statblock).slice(0, match.index);
  if (tokens.every((token) => !token)) {
    const lines = before.split("\n");
    const last = lines.findLastIndex((line) => line.trim());
    if (last < 0) return null;
    const own = last === 0 ? afterNd(lineTokens(lines[0])) : lineTokens(lines[last]);
    return own && { own, prefix: [], read: tokens };
  }
  if (before.includes("\n")) return { own: tokens, prefix: [], read: tokens };
  const own = afterNd(tokens);
  return own && { own, prefix: tokens.slice(0, tokens.length - own.length), read: own };
}

/** The field whose labels have the key `t`, in the original's order (type, role, size), or null. */
function labelField(t, types, roles, sizes) {
  if (types[t]) return "tipo";
  if (roles[t]) return "role";
  return sizes[t] ? "size" : null;
}

/** What the original loop does with the tokens: exact match against the localized labels (T20:10304-10331). */
export function simulateOriginal(tokens, { types = {}, roles = {}, sizes = {} } = {}) {
  const invert = (labels) => Object.fromEntries(Object.entries(labels).map(([key, value]) => [value, key]));
  const cType = invert(types);
  const cRole = invert(roles);
  const cSize = invert(sizes);
  const out = { tipo: null, role: null, size: null, subtypes: [], reads: [] };
  for (const m of tokens) {
    const t = cType[m] || cRole[capitalize(m)] || cSize[m] || m;
    const field = labelField(t, types, roles, sizes);
    if (field) {
      out[field] = t;
      out.reads.push([field, t]);
    } else out.subtypes.push(t);
  }
  return out;
}

/** Category and key of a token, case-insensitive, with the rulebook words and the localized labels. */
export function classifyToken(token, { types = {}, roles = {}, sizes = {} } = {}) {
  const word = String(token).replace(/^,+|,+$/g, "").toLowerCase();
  if (!word) return null;
  const lookup = (book, labels) => {
    if (Object.hasOwn(book, word)) return book[word];
    return Object.keys(labels).find((key) => String(labels[key]).toLowerCase() === word) ?? null;
  };
  for (const [field, book, labels] of [
    ["tipo", TYPE_WORDS, types],
    ["role", ROLE_WORDS, roles],
    ["size", SIZE_WORDS, sizes]
  ]) {
    const key = lookup(book, labels);
    if (key) return { field, key };
  }
  return null;
}
