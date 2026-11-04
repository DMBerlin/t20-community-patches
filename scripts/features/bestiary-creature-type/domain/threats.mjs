import { sameSignature } from "../../../lib/compendium-copy/index.mjs";
import { TYPE_WORDS } from "./words.mjs";

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
