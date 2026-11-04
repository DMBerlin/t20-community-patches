/** Proficiencies of a character, derived from its initial class, recognized powers and Traits tab (pure). */

export const SCOPED = { melee: "marcial-melee", ranged: "marcial-ranged" };
/** Custom entries (Traits tab, weapons) that record a scoped martial proficiency instead of naming a weapon. */
export const RESERVED_CUSTOM = { "marciais corpo a corpo": SCOPED.melee, "marciais a distancia": SCOPED.ranged };
/** Choice candidate: one weapon chosen by name (custom entry). */
export const NAMED = "named";
const CLASS_CANDIDATES = ["marcial", "pes", "esc"];

/** Proficiencies of each class (Tormenta20 Jogo do Ano, ch. 1, "Proficiências"). Ids: tormenta20.classes (1.6.5). */
export const CLASS_PROFICIENCIES = [
  { key: "arcanista", id: "TH7OIKaDqtLLQUrs", weapons: [], armor: [] }, // p. 37
  { key: "barbaro", id: "FiMbJLurhpstUxu1", weapons: ["marcial"], armor: ["esc"] }, // p. 41
  { key: "bardo", id: "u3fr3IOtTXmsk2BT", weapons: ["marcial"], armor: [] }, // p. 44
  { key: "bucaneiro", id: "uvMolF7vcMs0KbQl", weapons: ["marcial"], armor: [] }, // p. 47
  { key: "cacador", id: "xwI9ItqovNe5RMdF", weapons: ["marcial"], armor: ["esc"] }, // p. 50
  { key: "cavaleiro", id: "fzTv6gS1qu4lpstx", weapons: ["marcial"], armor: ["pes", "esc"] }, // p. 53
  { key: "clerigo", id: "EnHy1teosvZmcp4D", weapons: [], armor: ["pes", "esc"] }, // p. 57
  { key: "druida", id: "ROLLbOHDe9gWNazQ", weapons: [], armor: ["esc"] }, // p. 61
  { key: "guerreiro", id: "DPhWNP689FygcOSZ", weapons: ["marcial"], armor: ["pes", "esc"] }, // p. 65
  { key: "inventor", id: "WAyBowpFRVKRr0mq", weapons: [], armor: [] }, // p. 68
  { key: "ladino", id: "hBx9rVg3XGQ5wsd1", weapons: [], armor: [] }, // p. 73
  { key: "lutador", id: "pBABExUf8ATkRnHM", weapons: [], armor: [] }, // p. 76
  { key: "nobre", id: "kg8tLXlPNJSlwWcc", weapons: ["marcial"], armor: ["pes", "esc"] }, // p. 79
  { key: "paladino", id: "VnjstNLqk1lgxsEn", weapons: ["marcial"], armor: ["pes", "esc"] } // p. 82
];

/** Powers whose text grants proficiencies. Ids: tormenta20.poderes (1.6.5). */
export const POWER_GRANTS = [
  { key: "pistoleiro", id: "EMramxpu1YogEN9u", weapons: ["fogo"] },
  { key: "vanguardista", id: "kV4orwvtjHg0Ao2M", weapons: ["fogo"] },
  { key: "couraceiro", id: "XbndSZpX3PC0tiWv", armor: ["pes", "esc"] },
  { key: "armeiro", id: "hLBSifFJA7jAu7zg", scoped: [SCOPED.melee] },
  { key: "escavador", id: "p4KZ2EwgXEdrLKGp", weaponNames: ["picareta"] },
  { key: "tradicao de samurai", id: "MQVfA5kgyBGEqz3D", weaponNames: ["katana"] },
  { key: "mestre do tridente", id: "FHVUcdvlv8Omr6qv", weaponNames: ["tridente"] },
  { key: "tradicao", id: "ZfvrgyuDZB7CAptc", race: "anao", weaponNames: ["machado", "machadinha", "martelo", "marreta", "picareta"] },
  { key: "proficiencia", id: "AD22Tx3t0ur2lL2e", choice: ["marcial", "exotica", "fogo", "pes", "esc"] },
  { key: "balistica", id: "i5EbR8SrD8UcA7Gz", choice: [SCOPED.ranged, "fogo"] },
  { key: "abencoar arma", id: "GOlzi3jTSSbwVWy4", choice: [NAMED] }
];

/** Lowercase, without accents and repeated spaces. */
export function normalizeName(text) {
  return String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Entries of a trait's custom field, split by ";" like the system's sheet (T20:13541). */
export function parseCustom(custom) {
  return String(custom ?? "").split(";").map(normalizeName).filter(Boolean);
}

/** An entry covers the item whose name equals it or starts with it followed by a space. */
export function matchesName(name, entries = []) {
  const n = normalizeName(name);
  return Boolean(n) && entries.some((e) => n === e || n.startsWith(`${e} `));
}

/** Last segment of the compendium source (v12+ `_stats.compendiumSource`, legacy `flags.core.sourceId`). */
export function sourceId(doc) {
  return String(doc?._stats?.compendiumSource ?? doc?.flags?.core?.sourceId ?? "").split(".").pop();
}

/** A table entry matches by compendium id or by name (equal, or followed by " ("); the race, when required, always. */
export function matchesEntry(entry, { id, name, race } = {}) {
  if (entry.race && entry.race !== normalizeName(race)) return false;
  if (id && id === entry.id) return true;
  const n = normalizeName(name);
  return n === entry.key || n.startsWith(`${entry.key} (`);
}

/**
 * Size of a maximum bipartite matching (augmenting paths, Kuhn) between choice copies and Traits entries; each
 * entry resolves at most one copy. Sizes are tiny.
 * @param {string[][]} candidates  Accepted entries of each choice copy.
 * @param {string[]} pool          Entries that no fixed source explains.
 */
export function maxMatching(candidates, pool) {
  const owner = pool.map(() => -1);
  const augment = (i, seen) => {
    for (let j = 0; j < pool.length; j++) {
      if (seen[j] || !candidates[i].includes(pool[j])) continue;
      seen[j] = true;
      if (owner[j] < 0 || augment(owner[j], seen)) {
        owner[j] = i;
        return true;
      }
    }
    return false;
  };
  return candidates.filter((_, i) => augment(i, pool.map(() => false))).length;
}

/**
 * Indexes of the choice copies that stay unresolved in at least one maximum matching. Empty when the entries resolve
 * every copy; otherwise any copy that might be the unresolved one is reported, so the result never depends on the
 * order of powers or entries and nothing is penalized by an arbitrary assignment.
 */
export function unresolvedChoices(candidates, pool) {
  const best = maxMatching(candidates, pool);
  if (best === candidates.length) return [];
  return candidates.flatMap((_, i) => (maxMatching(candidates.filter((_, k) => k !== i), pool) === best ? [i] : []));
}

/**
 * Derives the character's proficiencies. Only the initial class counts (p. 35). Powers that let the player choose
 * (Proficiência, Balística, Abençoar Arma) consume one compatible entry of the Traits tab that no other source
 * explains; without one, the choice stays pending and items it could cover are "indeterminate", never penalized.
 * @param {{classes?: {id?: string, name?: string, inicial?: boolean}[], powers?: {id?: string, name?: string}[],
 *          race?: string, traits?: object}} data
 */
export function resolveProficiencies({ classes = [], powers = [], race = "", traits = {} } = {}) {
  const weapons = new Set();
  const armor = new Set();
  const scoped = new Set();
  const weaponNames = [];
  const armorNames = parseCustom(traits.profArmaduras?.custom);
  const pending = [];
  const warnings = [];
  const grant = (def) => {
    def.weapons?.forEach((w) => weapons.add(w));
    def.armor?.forEach((a) => armor.add(a));
    def.scoped?.forEach((s) => scoped.add(s));
    if (def.weaponNames) weaponNames.push(...def.weaponNames);
  };

  const initial = classes.filter((c) => c.inicial);
  const cls = initial.length === 1 ? initial[0] : !initial.length && classes.length === 1 ? classes[0] : null;
  if (cls) {
    const def = CLASS_PROFICIENCIES.find((d) => matchesEntry(d, cls));
    if (def) grant(def);
    else {
      warnings.push({ code: "unknown-class", name: cls.name });
      pending.push({ source: cls.name, candidates: CLASS_CANDIDATES });
    }
  } else if (classes.length) {
    warnings.push({ code: "no-initial-class" });
    pending.push({ source: null, candidates: CLASS_CANDIDATES });
  }

  const choices = [];
  for (const power of powers) {
    const def = POWER_GRANTS.find((d) => matchesEntry(d, { ...power, race }));
    if (def?.choice) choices.push({ def, name: power.name });
    else if (def) grant(def);
  }

  // Entries of the Traits tab are always honored; only the ones that no fixed source (class, powers) already
  // explains can resolve a choice. Unrestricted martial explains both scoped entries; a granted name explains the
  // entries it covers (Tradição de Samurai explains "katana").
  const fixedNames = [...weaponNames];
  const explainedScope = (s) => scoped.has(s) || weapons.has("marcial");
  const pool = [];
  for (const w of traits.profArmas?.value ?? []) if (!weapons.has(w)) pool.push(w);
  for (const a of traits.profArmaduras?.value ?? []) if (!armor.has(a)) pool.push(a);
  const scopedEntries = [];
  for (const entry of parseCustom(traits.profArmas?.custom)) {
    const s = RESERVED_CUSTOM[entry];
    if (s) {
      if (!explainedScope(s)) pool.push(s);
      scopedEntries.push(s);
    } else {
      if (!matchesName(entry, fixedNames)) pool.push(NAMED);
      weaponNames.push(entry);
    }
  }
  scopedEntries.forEach((s) => scoped.add(s));
  (traits.profArmas?.value ?? []).forEach((w) => weapons.add(w));
  (traits.profArmaduras?.value ?? []).forEach((a) => armor.add(a));

  const allowed = (c) => c !== "exotica" || weapons.has("marcial");
  const candidates = choices.map(({ def }) => def.choice.filter(allowed));
  for (const i of unresolvedChoices(candidates, pool)) pending.push({ source: choices[i].name, candidates: candidates[i] });
  return { weapons, armor, scoped, weaponNames, armorNames, pending, warnings };
}
