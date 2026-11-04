import { stripComments } from "../../../lib/source.mjs";
import { classifyToken, simulateOriginal } from "./statblock.mjs";
import { BOOK_WORDS } from "./words.mjs";

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

/**
 * Rulebook words the original loop misreads with these labels, judged on whole blocks "<type> (sub) <size>[,] <role>"
 * as the rulebook prints them. A size or role misread also costs the subtype, so the words cover both failures.
 */
export function parserFailures(labels) {
  const failures = new Set();
  const sizes = BOOK_WORDS.size.flatMap((word) => [word, `${word},`]);
  const blocks = BOOK_WORDS.tipo.flatMap((type) =>
    sizes.flatMap((size) => BOOK_WORDS.role.map((role) => [type, size, role]))
  );
  for (const [type, size, role] of blocks) {
    const read = simulateOriginal([type, "sub", size, role], labels);
    for (const [field, word] of [["tipo", type], ["size", size], ["role", role]]) {
      if (read[field] !== classifyToken(word)?.key) failures.add(word);
    }
  }
  return [...failures];
}
