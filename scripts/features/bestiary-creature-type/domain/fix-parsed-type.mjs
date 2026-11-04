import { capitalize, classificationTokens, classifyToken, simulateOriginal, typeTokens } from "./statblock.mjs";

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
 * @param {string} statblock
 * @param {object} schema
 * @param {object[]} log
 * @param {{before?: object, labels?: object}} [options]
 */
export function fixParsedType(statblock, schema, log, { before, labels = {} } = {}) {
  const parsed = analyze(statblock, schema, before, labels);
  if (!parsed) return false;
  const fixed = fixFields(parsed);
  const { subtypeWrong, subtypeFixed } = fixSubtype(parsed);
  if (Array.isArray(log) && (fixed.size || subtypeWrong)) updateLog(log, parsed, fixed, subtypeWrong);
  return fixed.size > 0 || subtypeFixed;
}

/** What the original read and what the classification says; null when there is nothing to fix. */
function analyze(statblock, schema, before, labels) {
  const tokens = typeTokens(statblock);
  const detalhes = schema?.detalhes;
  const tracos = schema?.tracos;
  const classification = classificationTokens(statblock);
  if (!tokens || !classification || !detalhes || !tracos || !before) return null;
  const { own, prefix, read } = classification;
  const found = { tipo: null, role: null, size: null };
  const subtypes = [];
  for (const token of own) {
    const hit = classifyToken(token, labels);
    if (hit) found[hit.field] = hit.key;
    else if (token.replace(/,+$/, "")) subtypes.push(token.replace(/,+$/, ""));
  }
  return {
    detalhes,
    tracos,
    before,
    labels,
    prefix,
    found,
    subtypes,
    original: simulateOriginal(tokens, labels),
    // What the original read from the classification itself; words before it (the name) are not a classification.
    ownOriginal: simulateOriginal(read, labels),
    // A type, size or role word, the empty token of a double space, or a name word is not a subtype.
    isFalseSubtype: (token) => !token.replace(/,+$/, "") || !!classifyToken(token, labels)
  };
}

function fixFields({ detalhes, tracos, before, found, original, ownOriginal }) {
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
  return fixed;
}

function fixSubtype({ detalhes, before, subtypes, original, ownOriginal, isFalseSubtype }) {
  const lastSubtype = original.subtypes.at(-1);
  const fromPrefix = !ownOriginal.subtypes.length;
  const subtypeWrong =
    lastSubtype !== undefined &&
    (fromPrefix || isFalseSubtype(lastSubtype)) &&
    detalhes.raca === capitalize(lastSubtype);
  if (!subtypeWrong) return { subtypeWrong, subtypeFixed: false };
  const raca = subtypes.length ? capitalize(subtypes.at(-1)) : before.raca;
  const subtypeFixed = detalhes.raca !== raca;
  detalhes.raca = raca;
  return { subtypeWrong, subtypeFixed };
}

/** Log messages the original wrote for name words and for false subtypes, counted to keep real repeats. */
function falseLogEntries({ labels, prefix, ownOriginal, isFalseSubtype }, fixed) {
  const falseEntries = new Map();
  const count = (message) => falseEntries.set(message, (falseEntries.get(message) ?? 0) + 1);
  // Name words and type, size or role words the original logged as subtypes.
  for (const t of [...simulateOriginal(prefix, labels).subtypes, ...ownOriginal.subtypes.filter(isFalseSubtype)]) {
    count(`Subtipo de Criatura: ${capitalize(t)}`);
  }
  // Every entry a name word logged for a field the patch fixed is outdated.
  for (const [field, key] of simulateOriginal(prefix, labels).reads) {
    if (!fixed.has(field)) continue;
    const [title, group] = MESSAGES[field];
    count(`${title}: ${labels[group]?.[key]}`);
  }
  return falseEntries;
}

/** Removes, from the end, the false entries and the missing-role warning of a role the patch set. */
function pruneLog(log, falseEntries, fixed) {
  for (let i = log.length - 1; i >= 0; i--) {
    const { success, message } = log[i] ?? {};
    const falseRole = fixed.has("role") && success === false && message === "Papel em Combate: Solo";
    const falseSubtype = success === true && falseEntries.get(message) > 0;
    if (falseSubtype) falseEntries.set(message, falseEntries.get(message) - 1);
    if (falseSubtype || falseRole) log.splice(i, 1);
  }
}

function updateLog(log, parsed, fixed, subtypeWrong) {
  const { labels, found, subtypes, detalhes } = parsed;
  pruneLog(log, falseLogEntries(parsed, fixed), fixed);
  const pushOnce = (message) => {
    if (!log.some((entry) => entry?.message === message)) log.push({ success: true, message });
  };
  for (const field of fixed) {
    const [title, group] = MESSAGES[field];
    pushOnce(`${title}: ${labels[group]?.[found[field]] ?? found[field]}`);
  }
  if (subtypeWrong && subtypes.length) pushOnce(`Subtipo de Criatura: ${detalhes.raca}`);
}
