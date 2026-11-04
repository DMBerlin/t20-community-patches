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
  // "Morto-\nvivo": _parseStatblock removes a hyphen at a line break of `statblock.value` (T20:10143).
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

/** Rulebook spelling of every type, size and role word. */
export const BOOK_WORDS = {
  tipo: ["Animal", "Construto", "Espírito", "Humanoide", "Monstro", "Morto-vivo"],
  size: ["Minúsculo", "Pequeno", "Médio", "Grande", "Enorme", "Colossal"],
  role: ["Solo", "Lacaio", "Especial"]
};
