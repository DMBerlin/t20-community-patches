/**
 * Bug: creature types diverge from the core rulebook (Tormenta20 JdA, pp. 297-310):
 *  - tormenta20.ameacas: 7 undead and 4 monsters are stored as Humanoide;
 *  - StatblockParser#parseData matches type, size and role words exactly against the localized labels, so the book
 *    spelling "Morto-vivo" (label "Morto-Vivo") and every Portuguese word under another UI language become the
 *    creature subtype and the type stays Humanoide.
 * Fix: correct the world copy of the 11 threats in ActorT20#_preCreate, only when it comes from the known entry and
 * still holds the exact 1.6.5 type data; after the original parseData, fix each field the original failed to read.
 */
import { readEntries, sameSignature, summarize, wrapPreCreate } from "../compendium-copy.mjs";
import { MODULE_ID, markWrapper, stripComments, unwrap } from "../utils.mjs";

const PATCH_ID = "bestiary-creature-type";

/** Rulebook creature type of each threat (pp. 297-310); [id, name, 1.6.5 subtype, type]. */
export const THREATS = [
  ["aDJoJf7PgQ33UvNA", "Zumbi", "Morto-vivo", "mor"],
  ["XAJNOpuVGZSZpjW7", "Esqueleto", "Morto-vivo", "mor"],
  ["0QJaEz9fdHb47RXi", "Esqueleto de Elite", "Morto-vivo", "mor"],
  ["Qk9okLSrfLXz55jd", "Turba Zumbi", "bando", "mor"],
  ["xMTYBQqQ15QmIqPH", "Falange", "bando", "mor"],
  ["MKKB4eECVXAjyvRy", "Aparição", "Morto-vivo", "mor"],
  ["d5Im71VWcxIz9xKM", "Vampiro", "Morto-vivo", "mor"],
  ["hIieRUWgmv87ExIL", "Finntroll Caçador", "finntroll", "mon"],
  ["Uo4OND7Ih8o4Jh2D", "Finntroll Feitor", "finntroll", "mon"],
  ["QmbDo3LPMBsBDcno", "Cultista da Traição", "medusa", "mon"],
  ["ZPxFnXhUZ2dbcedC", "Enxame Kobold", "kobold", "mon"]
];

export const threatSignature = (src) => ({
  type: src?.type,
  name: src?.name,
  tipo: src?.system?.detalhes?.tipo,
  raca: src?.system?.detalhes?.raca
});

/** Sets the type; a subtype that only repeats the type ("Morto-vivo") is cleared, a real subtype is kept. */
export function fixThreat(src, [, name, raca, tipo]) {
  if (!sameSignature(threatSignature(src), { type: "npc", name, tipo: "hum", raca })) return null;
  const detalhes = { tipo };
  if (TYPE_WORDS[raca.toLowerCase()] === tipo) detalhes.raca = "";
  return { system: { detalhes } };
}

export const ENTRIES = THREATS.map((threat) => ({
  pack: "ameacas",
  id: threat[0],
  name: threat[1],
  fix: (src) => fixThreat(src, threat),
  isCorrect: (src) => src?.type === "npc" && src?.system?.detalhes?.tipo === threat[3]
}));

/** Rulebook words (lower case) of types, sizes and roles, with accent-less variants. */
export const TYPE_WORDS = {
  animal: "ani",
  construto: "con",
  "espírito": "esp",
  espirito: "esp",
  humanoide: "hum",
  "humanóide": "hum",
  monstro: "mon",
  "morto-vivo": "mor",
  // "Morto-\nvivo": _parseStatblock removes a hyphen at a line break (T20:11307).
  mortovivo: "mor"
};
export const SIZE_WORDS = {
  "minúsculo": "min",
  minusculo: "min",
  pequeno: "peq",
  "médio": "med",
  medio: "med",
  grande: "gra",
  enorme: "eno",
  colossal: "col"
};
export const ROLE_WORDS = { solo: "solo", lacaio: "lackey", especial: "special" };

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const TYPE_LINE = /.*\s(especial|solo|lacaio|Iniciativa)/i;

/** The tokens StatblockParser#parseData reads for type, size, role and subtype (T20:11463-11469). */
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
 * The original reads the first line as the name (T20:11442), and _parseStatblock joins a line starting in lower case
 * to the previous one (T20:11308). When the text the original reads starts on the name line, only the tokens after
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

/** What the original loop does with the tokens: exact match against the localized labels (T20:11469-11495). */
export function simulateOriginal(tokens, { types = {}, roles = {}, sizes = {} } = {}) {
  const invert = (labels) => Object.fromEntries(Object.entries(labels).map(([key, value]) => [value, key]));
  const cType = invert(types);
  const cRole = invert(roles);
  const cSize = invert(sizes);
  const out = { tipo: null, role: null, size: null, subtypes: [], reads: [] };
  for (const m of tokens) {
    const t = cType[m] || cRole[capitalize(m)] || cSize[m] || m;
    const field = types[t] ? "tipo" : roles[t] ? "role" : sizes[t] ? "size" : null;
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

const MESSAGES = {
  tipo: ["Tipo de Criatura", "types"],
  role: ["Papel em Combate", "roles"],
  size: ["Tamanho", "sizes"]
};

/**
 * Fixes, after the original parseData, each field the original failed to read. `before` holds detalhes.tipo,
 * detalhes.role, detalhes.raca and tracos.tamanho before the original ran. A field is set only when the original
 * read no word for it and left it untouched; the subtype is replaced only when it is a type, size or role word.
 * Idempotent. Returns true when it changed anything.
 */
export function fixParsedType(statblock, schema, log, before, labels = {}) {
  const tokens = typeTokens(statblock);
  const detalhes = schema?.detalhes;
  const tracos = schema?.tracos;
  const classification = classificationTokens(statblock);
  if (!tokens || !classification || !detalhes || !tracos || !before) return false;
  const { own, prefix, read } = classification;
  const original = simulateOriginal(tokens, labels);
  // What the original read from the classification itself; words before it (the name) are not a classification.
  const ownOriginal = simulateOriginal(read, labels);
  const found = { tipo: null, role: null, size: null };
  const subtypes = [];
  for (const token of own) {
    const hit = classifyToken(token, labels);
    if (hit) found[hit.field] = hit.key;
    else if (token.replace(/,+$/, "")) subtypes.push(token.replace(/,+$/, ""));
  }
  const fields = {
    tipo: [detalhes, "tipo", before.tipo],
    role: [detalhes, "role", before.role],
    size: [tracos, "tamanho", before.tamanho]
  };
  const fixed = new Set();
  for (const [field, [target, prop, previous]] of Object.entries(fields)) {
    // Without a read in the classification, the original left the field as before or as a name word set it.
    // A name word that already set the right value leaves nothing to fix.
    if (ownOriginal[field] || !found[field] || original[field] === found[field]) continue;
    if (target[prop] !== (original[field] ?? previous)) continue;
    target[prop] = found[field];
    fixed.add(field);
  }

  // A type, size or role word, the empty token of a double space, or a name word is not a subtype.
  const isFalseSubtype = (token) => !token.replace(/,+$/, "") || !!classifyToken(token, labels);
  const lastSubtype = original.subtypes.at(-1);
  const fromPrefix = !ownOriginal.subtypes.length;
  const subtypeWrong =
    lastSubtype !== undefined &&
    (fromPrefix || isFalseSubtype(lastSubtype)) &&
    detalhes.raca === capitalize(lastSubtype);
  let subtypeFixed = false;
  if (subtypeWrong) {
    const raca = subtypes.length ? capitalize(subtypes.at(-1)) : before.raca;
    subtypeFixed = detalhes.raca !== raca;
    detalhes.raca = raca;
  }

  if (Array.isArray(log) && (fixed.size || subtypeWrong)) {
    // Name words and type, size or role words the original logged as subtypes, counted to keep real repeats.
    const falseEntries = new Map();
    for (const t of [
      ...simulateOriginal(prefix, labels).subtypes,
      ...ownOriginal.subtypes.filter(isFalseSubtype)
    ]) {
      const message = `Subtipo de Criatura: ${capitalize(t)}`;
      falseEntries.set(message, (falseEntries.get(message) ?? 0) + 1);
    }
    // Every entry a name word logged for a field the patch fixed is outdated.
    for (const [field, key] of simulateOriginal(prefix, labels).reads) {
      if (!fixed.has(field)) continue;
      const [title, group] = MESSAGES[field];
      const message = `${title}: ${labels[group]?.[key]}`;
      falseEntries.set(message, (falseEntries.get(message) ?? 0) + 1);
    }
    for (let i = log.length - 1; i >= 0; i--) {
      const { success, message } = log[i] ?? {};
      const falseRole = fixed.has("role") && success === false && message === "Papel em Combate: Solo";
      const falseSubtype = success === true && falseEntries.get(message) > 0;
      if (falseSubtype) falseEntries.set(message, falseEntries.get(message) - 1);
      if (falseSubtype || falseRole) log.splice(i, 1);
    }
    for (const field of fixed) {
      const [title, group] = MESSAGES[field];
      const message = `${title}: ${labels[group]?.[found[field]] ?? found[field]}`;
      if (!log.some((entry) => entry?.message === message)) log.push({ success: true, message });
    }
    if (subtypeWrong && subtypes.length) {
      const message = `Subtipo de Criatura: ${detalhes.raca}`;
      if (!log.some((entry) => entry?.message === message)) log.push({ success: true, message });
    }
  }
  return fixed.size > 0 || subtypeFixed;
}

/** Fragments of the 1.6.5 type block, compared without whitespace (T20:11458-11495). */
export const PARSER_MARKERS = [
  "const cType = Object.fromEntries(Object.entries(CONFIG.T20.creatureTypes).map(([key, value]) => [value, key]));",
  "const cRole = Object.fromEntries(Object.entries(CONFIG.T20.creatureRoles).map(([key, value]) => [value, key]));",
  "const cSize = Object.fromEntries(Object.entries(CONFIG.T20.actorSizes).map(([key, value]) => [value, key]));",
  ".capitalize().match(/.*\\s(especial|solo|lacaio|Iniciativa)/i)[0].replace(/Iniciativa|\\(|\\)/gi, \"\").trim().split(\" \")",
  ".map((m) => cType[m] || cRole[m.capitalize()] || cSize[m] || m);",
  "if (CONFIG.T20.creatureTypes[t]) { schema.detalhes.tipo = t;",
  "} else if (CONFIG.T20.creatureRoles[t]) { schema.detalhes.role = t;",
  "} else if (CONFIG.T20.actorSizes[t]) { schema.tracos.tamanho = t;",
  "} else { schema.detalhes.raca = t.capitalize();",
  "if (!schema.detalhes.role) log.push({ success: false, message: \"Papel em Combate: Solo\" });"
];

/** Whether the parseData source is the 1.6.5 code the correction reproduces. */
export function parserRecognized(source) {
  const code = stripComments(source);
  if (typeof code !== "string") return false;
  const flat = code.replace(/\s+/g, "");
  return PARSER_MARKERS.every((marker) => flat.includes(marker.replace(/\s+/g, "")));
}

/** Rulebook spelling of every type, size and role word. */
export const BOOK_WORDS = {
  tipo: ["Animal", "Construto", "Espírito", "Humanoide", "Monstro", "Morto-vivo"],
  size: ["Minúsculo", "Pequeno", "Médio", "Grande", "Enorme", "Colossal"],
  role: ["Solo", "Lacaio", "Especial"]
};

/**
 * Rulebook words the original loop misreads with these labels, judged on whole blocks "<type> (sub) <size>[,] <role>"
 * as the rulebook prints them. A size or role misread also costs the subtype, so the words cover both failures.
 */
export function parserFailures(labels) {
  const failures = new Set();
  const sizes = BOOK_WORDS.size.flatMap((word) => [word, `${word},`]);
  for (const type of BOOK_WORDS.tipo) {
    for (const size of sizes) {
      for (const role of BOOK_WORDS.role) {
        const read = simulateOriginal([type, "sub", size, role], labels);
        for (const [field, word] of [["tipo", type], ["size", size], ["role", role]]) {
          if (read[field] !== classifyToken(word)?.key) failures.add(word);
        }
      }
    }
  }
  return [...failures];
}

const labelsNow = () => ({
  types: CONFIG.T20?.creatureTypes ?? {},
  roles: CONFIG.T20?.creatureRoles ?? {},
  sizes: CONFIG.T20?.actorSizes ?? {}
});

function wrapParseData(original) {
  return markWrapper(function (statblock, schema, itemsList, log, ...more) {
    const before = {
      tipo: schema?.detalhes?.tipo,
      role: schema?.detalhes?.role,
      raca: schema?.detalhes?.raca,
      tamanho: schema?.tracos?.tamanho
    };
    const result = original.call(this, statblock, schema, itemsList, log, ...more);
    try {
      fixParsedType(statblock, schema, log, before, labelsNow());
    } catch (error) {
      console.warn(`${MODULE_ID} | ${PATCH_ID}: parser correction skipped`, error);
    }
    return result;
  }, original);
}

function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "compendium data and localized labels are read after ready" };
}

async function lateProbe() {
  try {
    const results = await readEntries(ENTRIES);
    const parse = unwrap(globalThis.tormenta20?.applications?.StatblockParser?.prototype?.parseData);
    const recognized = parserRecognized(String(parse ?? ""));
    const failures = recognized ? parserFailures(labelsNow()) : [];
    results.push({
      name: `StatblockParser${failures.length ? ` (${failures.join(", ")})` : ""}`,
      state: !recognized ? "unknown" : failures.length ? "present" : "fixed"
    });
    // The parser is judged from its source: never fixed/high.
    return summarize(results, "low");
  } catch (error) {
    console.warn(`${MODULE_ID} | ${PATCH_ID}: probe failed`, error);
    return undefined;
  }
}

function apply() {
  const actor = CONFIG.Actor.documentClass?.prototype;
  if (typeof actor?._preCreate === "function") {
    actor._preCreate = wrapPreCreate(actor._preCreate, "Actor", ENTRIES, PATCH_ID);
  }
  const parser = globalThis.tormenta20?.applications?.StatblockParser?.prototype;
  if (typeof parser?.parseData !== "function") return;
  if (!parserRecognized(String(unwrap(parser.parseData)))) {
    console.warn(`${MODULE_ID} | ${PATCH_ID}: StatblockParser#parseData not recognized; parser correction inactive`);
    return;
  }
  parser.parseData = wrapParseData(parser.parseData);
}

export default {
  id: PATCH_ID,
  group: "actor",
  issue: 47,
  guarded: true,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  lateProbe,
  apply
};
