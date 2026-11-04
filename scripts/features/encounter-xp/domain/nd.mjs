/** Challenge ratings (ND): parsing, labels, encounter rating and group level. */

export const MAX_LEVEL = 20;

const FRACTIONS = { "1/4": 0.25, "¼": 0.25, "1/2": 0.5, "½": 0.5 };

/**
 * Challenge rating text → number. S and S+ count as 20 (Ameaças de Arton, p. 376) and are flagged.
 * @param {unknown} raw
 * @returns {{value: number, label: string, special: boolean}|null}
 */
export function parseNd(raw) {
  const text = String(raw ?? "").trim().toUpperCase();
  if (text in FRACTIONS) return { value: FRACTIONS[text], label: ndLabel(FRACTIONS[text]), special: false };
  if (text === "S" || text === "S+") return { value: 20, label: text, special: true };
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    if (value >= 1 && value <= MAX_LEVEL) return { value, label: String(value), special: false };
  }
  return null;
}

/** Number → label used in the summary ("1/4", "1/2", "7"). */
export function ndLabel(value) {
  if (value === 0.25) return "1/4";
  if (value === 0.5) return "1/2";
  return String(value);
}

/** Equal challenge ratings (Tormenta20 p. 282; Ameaças de Arton p. 9). */
function groupNd(value, count) {
  if (count === 1) return value;
  if (value < 1) return value * count;
  return value + 2 * Math.floor(Math.log2(count));
}

/**
 * Encounter challenge rating (Ameaças de Arton, p. 9): group equal ratings, repeat while groups tie, then add +1,
 * +½ or +¼ to the highest for each other group up to 1, 2 or less than 4 points below it; round down.
 * @param {number[]} values
 */
export function encounterNd(values) {
  let groups = values.filter((v) => Number.isFinite(v) && v > 0);
  if (!groups.length) return 0;
  for (;;) {
    const counts = new Map();
    for (const v of groups) counts.set(v, (counts.get(v) ?? 0) + 1);
    if (counts.size === groups.length) break;
    groups = [...counts].map(([v, c]) => groupNd(v, c));
  }
  groups.sort((a, b) => b - a);
  const [base, ...rest] = groups;
  let total = base;
  for (const v of rest) {
    const gap = base - v;
    total += gap <= 1 ? 1 : gap <= 2 ? 0.5 : gap < 4 ? 0.25 : 0;
  }
  return total >= 1 ? Math.floor(total) : total;
}

/** Group level: average character level, rounded down, at least 1. */
export function groupLevel(levels) {
  const valid = levels.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!valid.length) return 1;
  return Math.max(1, Math.floor(valid.reduce((a, b) => a + b, 0) / valid.length));
}

/**
 * Encounter rating field: empty uses the suggestion, anything else must be a valid rating.
 * @returns {{value: number|null}|{error: "encounterNd"}}
 */
export function resolveEncounterNd(text, suggested) {
  if (!String(text ?? "").trim()) return { value: suggested || null };
  const parsed = parseNd(text);
  return parsed ? { value: parsed.value } : { error: "encounterNd" };
}
