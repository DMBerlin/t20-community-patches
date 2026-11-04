/** Pure logic of the "Teste de resistência pelo card" rule (#58): save text, outcome and result index. */
export const SAVE_BUTTON_SETTING = "saveButtonRule";
export const SAVE_FLAG = "save";
export const SAVE_RESULT_FLAG = "saveResult";

const SKILL_PATTERNS = [
  ["fort", "\\bfort(?:itude)?\\b"],
  // "Relfexos" is a typo in the compendium data (Erupção Glacial).
  ["refl", "\\bre(?:fl|lf)exos?\\b|\\brefl\\b"],
  ["vont", "\\bvont(?:ade)?\\b"]
];
const EFFECT_PATTERNS = [
  ["metade", /\bmetade\b/],
  // "anual" is a typo in the compendium data (Possessão).
  ["anula", /\banula\b|\banual\b/],
  ["parcial", /\bparcial\b/],
  ["desacredita", /\bdesacredita\b/],
  ["evita", /\bevita\b/]
];
const HEALING_FLAVORS = new Set(["curapv", "curatpv", "curapm", "curatpm"]);

/** @param {unknown} text */
export function normalizeSaveText(text) {
  return String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Skills and effects written in the free-text save of an item ("Vontade anula, Fortitude parcial").
 * @param {unknown} text
 * @returns {{skill: "fort"|"refl"|"vont", effect: "metade"|"anula"|"parcial"|"desacredita"|"evita"|null}[]}
 */
export function parseSaveText(text) {
  const norm = normalizeSaveText(text);
  const hits = [];
  for (const [skill, source] of SKILL_PATTERNS) {
    for (const match of norm.matchAll(new RegExp(source, "g"))) {
      hits.push({ skill, start: match.index, end: match.index + match[0].length });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const saves = [];
  hits.forEach((hit, i) => {
    if (saves.some((save) => save.skill === hit.skill)) return;
    const segment = norm.slice(hit.end, hits[i + 1]?.start ?? norm.length);
    const effect = EFFECT_PATTERNS.find(([, re]) => re.test(segment))?.[0] ?? null;
    saves.push({ skill: hit.skill, effect });
  });
  return saves;
}

/**
 * Data stored on the item card, or null when there is nothing to roll.
 * @param {{txt?: unknown, dc?: unknown, itemName?: string, casterType?: string,
 *   targets?: ({uuid: string, name: string, displayName: number} | null)[]}} params
 */
export function buildSaveData({ txt, dc, itemName = "", casterType = "", targets = [] }) {
  const saves = parseSaveText(txt);
  const value = Number(dc);
  if (!saves.length || !Number.isFinite(value) || value <= 0) return null;
  const unique = new Map();
  for (const target of targets ?? []) if (target?.uuid && !unique.has(target.uuid)) unique.set(target.uuid, target);
  return { text: String(txt), dc: value, itemName: String(itemName ?? ""), casterType: String(casterType ?? ""), saves, targets: [...unique.values()] };
}

/**
 * The natural d20 of a test, or null when the first die is not a single kept d20.
 * @param {{dice?: {faces?: number, results?: {result: number, active?: boolean, discarded?: boolean}[]}[]}} roll
 */
export function naturalD20(roll) {
  const die = roll?.dice?.[0];
  if (die?.faces !== 20) return null;
  const kept = (die.results ?? []).filter((r) => r.active !== false && !r.discarded);
  return kept.length === 1 ? Number(kept[0].result) : null;
}

/**
 * Book p. 220-221: pass with total >= DC; a natural 20 always passes and a natural 1 always fails.
 * @param {{total: unknown, natural: number|null, dc: unknown}} params
 * @returns {{success: boolean, auto: boolean} | null}
 */
export function saveOutcome({ total, natural, dc }) {
  const value = Number(dc);
  const sum = Number(total);
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(sum)) return null;
  if (natural === 20) return { success: true, auto: true };
  if (natural === 1) return { success: false, auto: true };
  return { success: sum >= value, auto: false };
}

/** Same rule as ChatMessageT20#_hideDC. */
export function shouldHideDc({ showFoeDc, isGM, casterType }) {
  return !showFoeDc && !isGM && Boolean(casterType) && casterType !== "character";
}

export function resultKey(tokenUuid, skill) {
  return `${tokenUuid}|${skill}`;
}

export function pendingKey(cardId, tokenUuid, skill) {
  return `${cardId}|${tokenUuid}|${skill}`;
}

/**
 * Latest result per target and skill; ties go to the greater message id, so every client agrees.
 * @template {{id: string, timestamp: number, result: {tokenUuid?: string, skill?: string}}} T
 * @param {Iterable<T>} entries
 * @returns {Map<string, T>}
 */
export function latestResults(entries) {
  const latest = new Map();
  for (const entry of entries ?? []) {
    const { tokenUuid, skill } = entry?.result ?? {};
    if (!tokenUuid || !skill) continue;
    const key = resultKey(tokenUuid, skill);
    const previous = latest.get(key);
    const newer = !previous
      || entry.timestamp > previous.timestamp
      || (entry.timestamp === previous.timestamp && entry.id > previous.id);
    if (newer) latest.set(key, entry);
  }
  return latest;
}

/** @returns {number|null}  Damage multiplier for a "reduz à metade" save, null for any other effect. */
export function damageMultiplier({ effect, success }) {
  if (effect !== "metade") return null;
  return success ? 0.5 : 1;
}

/**
 * The single damage roll of a card, or null (none, several, or healing).
 * @param {{options?: {type?: string}, terms?: {options?: {flavor?: string}}[]}[]} rolls
 */
export function pickDamageRoll(rolls) {
  const damage = (rolls ?? []).filter((roll) => roll?.options?.type === "damage");
  if (damage.length !== 1) return null;
  const healing = (damage[0].terms ?? []).some((term) => HEALING_FLAVORS.has(term?.options?.flavor));
  return healing ? null : damage[0];
}
