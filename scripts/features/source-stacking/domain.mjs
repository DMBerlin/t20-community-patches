/** Pure logic of the source-stacking rule: source categories, amounts, the suppression plan and the messages. */

export const SOURCE_STACKING_SETTING = "sourceStackingRule";
export const SOURCE_FLAG = "source";
export const SOURCE_STACKING_MODES = ["off", "on"];
export const DEFENSE_KEY = "system.attributes.defesa.bonus";
export const PENALTY_KEY = "system.attributes.defesa.pda";

const ITEM_CATEGORIES = { magia: "magia", arma: "item", equipamento: "item", consumivel: "item", tesouro: "item" };
export const ARMOR_TIPOS = new Set(["leve", "pesada", "escudo"]);
export const CATEGORIES = new Set(["magia", "item"]);

/**
 * Source of an item type: spells, items, or null for everything else (abilities, classes, races, base rooms).
 * @param {unknown} itemType
 * @returns {"magia"|"item"|null}
 */
export function itemCategory(itemType) {
  return Object.hasOwn(ITEM_CATEGORIES, String(itemType)) ? ITEM_CATEGORIES[itemType] : null;
}

/**
 * Source of an effect.
 * @param {{parent: "Item"|"Actor"|string, itemType?: string, transfer?: boolean, flag?: unknown, originItemType?: string}} p
 *   `itemType`: type of the item holding a transferred effect. `flag`: the source stamped by the chat card.
 *   `originItemType`: type of the owned item a legacy actor effect points to through its origin.
 * @returns {"magia"|"item"|null}  null = not part of the rule (stacks as the system does).
 */
export function sourceCategory({ parent, itemType, transfer, flag, originItemType }) {
  if (parent === "Item") return transfer ? itemCategory(itemType) : null;
  if (parent !== "Actor") return null;
  if (CATEGORIES.has(flag)) return flag;
  return originItemType ? itemCategory(originItemType) : null;
}

/**
 * Armor exception: the Defense and armor penalty of the equipped armor and shield, upgrades included, always add.
 * @param {{itemType?: string, tipo?: string, key: string}} p
 * @returns {boolean}
 */
export function isArmorExempt({ itemType, tipo, key }) {
  return itemType === "equipamento" && ARMOR_TIPOS.has(tipo) && (key === DEFENSE_KEY || key === PENALTY_KEY);
}

/**
 * Signed amount of a change, or NaN when it does not take part (other types, dice, invalid formulas, other fields).
 * Follows the core semantics of the target field: on a number field "subtract" is a negative "add"; on an array
 * of formula parts "add" appends a part and "subtract" removes a matching one, so only "add" takes part. The armor
 * penalty field casts every value and every result to −|v|: "add" makes the penalty worse by |v|, and "subtract",
 * whose result depends on what came before, does not take part.
 * @param {{key: string, type: string, value: unknown}} change
 * @param {(formula: string) => number} [resolve]  Evaluates a formula without dice; NaN when it cannot.
 * @param {"number"|"array"} [target]  Kind of the target field; anything else does not take part.
 * @returns {number}
 */
export function changeAmount(change, resolve = () => NaN, target) {
  if (!change) return NaN;
  const ok = change.type === "add" ? target === "number" || target === "array" : change.type === "subtract" && target === "number";
  if (!ok) return NaN;
  let amount = NaN;
  const value = change.value;
  if (typeof value === "number") amount = value;
  else if (typeof value === "string" && value.trim()) {
    amount = Number(value);
    if (!Number.isFinite(amount)) {
      try {
        amount = Number(resolve(value.trim()));
      } catch {
        amount = NaN;
      }
    }
  }
  if (!Number.isFinite(amount)) return NaN;
  if (change.key === PENALTY_KEY) {
    // The field cleans the result back to −|v| after the operation, so a "subtract" depends on the order.
    if (change.type === "subtract") return NaN;
    return -Math.abs(amount);
  }
  if (change.type === "subtract") amount = -amount;
  return amount;
}

/** Total order of sources: creation time, then id. */
export function compareOrder(a, b) {
  const ta = Number(a?.[0]) || 0;
  const tb = Number(b?.[0]) || 0;
  if (ta !== tb) return ta - tb;
  const ia = String(a?.[1] ?? "");
  const ib = String(b?.[1] ?? "");
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/**
 * @typedef {object} StackEntry
 * @property {unknown} ref           What gets suppressed (a change object, or an accessory field).
 * @property {string} source         Source id: one owned item (all its effects and data) or one actor effect.
 * @property {[number, string]} order Tie-break order of the source.
 * @property {string} name           Display name of the source.
 * @property {"magia"|"item"|null} category
 * @property {string} key            Change key.
 * @property {number} amount         Signed amount (NaN = not comparable, always applies).
 * @property {boolean} [exempt]      Armor exception.
 * @property {string[]} [effects]    Effect uuids of the source.
 * @property {string[]} [items]      Item ids of the source.
 */

const describeSource = (s, total) => ({ source: s.source, name: s.name, total, effects: [...s.effects], items: [...s.items] });

/** Keeps the greatest source of one sign in a group and suppresses the others, recording each loss. */
function resolveSign(group, sources, sign, { suppressed, report }) {
  const field = sign > 0 ? "pos" : "neg";
  const contenders = sources.filter((s) => s[field] !== 0);
  if (contenders.length < 2) return;
  let winner = contenders[0];
  for (const s of contenders) if (s[field] * sign > winner[field] * sign) winner = s;
  for (const s of contenders) {
    if (s === winner) continue;
    for (const ref of s[sign > 0 ? "posRefs" : "negRefs"]) suppressed.add(ref);
    report.push({ category: group.category, key: group.key, sign, loser: describeSource(s, s[field]), winner: describeSource(winner, winner[field]) });
  }
}

/**
 * Plans the suppressions. Inside each category and key, each source sums its bonuses and its penalties separately;
 * the source with the greatest bonus keeps its bonuses and the one with the greatest penalty keeps its penalties.
 * Ties go to the first source in order. Every other source loses its bonuses (or penalties) on that key.
 * @param {StackEntry[]} entries
 * `amounts` has the signed amount of each suppressed ref, as it was compared.
 * @returns {{suppressed: Set<unknown>, amounts: Map<unknown, number>, report: {category: string, key: string, sign: 1|-1,
 *   loser: {source: string, name: string, total: number, effects: string[], items: string[]},
 *   winner: {source: string, name: string, total: number, effects: string[], items: string[]}}[]}}
 */
export function planSuppression(entries) {
  const groups = new Map();
  const amountOf = new Map();
  for (const entry of entries ?? []) {
    if (!entry || !CATEGORIES.has(entry.category) || entry.exempt) continue;
    if (!Number.isFinite(entry.amount) || entry.amount === 0 || typeof entry.key !== "string" || !entry.key) continue;
    amountOf.set(entry.ref, (amountOf.get(entry.ref) ?? 0) + entry.amount);
    const groupKey = `${entry.category}\u0000${entry.key}`;
    let group = groups.get(groupKey);
    if (!group) groups.set(groupKey, (group = { category: entry.category, key: entry.key, sources: new Map() }));
    let source = group.sources.get(entry.source);
    if (!source) {
      source = { source: entry.source, name: entry.name, order: entry.order, pos: 0, neg: 0, posRefs: [], negRefs: [], effects: new Set(), items: new Set() };
      group.sources.set(entry.source, source);
    }
    if (compareOrder(entry.order, source.order) < 0) source.order = entry.order;
    for (const uuid of entry.effects ?? []) source.effects.add(uuid);
    for (const id of entry.items ?? []) source.items.add(id);
    if (entry.amount > 0) {
      source.pos += entry.amount;
      source.posRefs.push(entry.ref);
    } else {
      source.neg += entry.amount;
      source.negRefs.push(entry.ref);
    }
  }

  const suppressed = new Set();
  const report = [];
  for (const group of groups.values()) {
    const sources = [...group.sources.values()].sort((a, b) => compareOrder(a.order, b.order));
    for (const sign of [1, -1]) resolveSign(group, sources, sign, { suppressed, report });
  }
  const amounts = new Map([...suppressed].map((ref) => [ref, amountOf.get(ref)]));
  return { suppressed, amounts, report };
}

/**
 * Label of a statistic for messages.
 * @param {string} key
 * @param {{defense?: string, penalty?: string, pericias?: Record<string, string>, atributos?: Record<string, string>}} labels
 * @returns {string}
 */
export function keyLabel(key, labels = {}) {
  if (key === DEFENSE_KEY && labels.defense) return labels.defense;
  if (key === PENALTY_KEY && labels.penalty) return labels.penalty;
  const skill = /^system\.pericias\.([^.]+)\.(?:bonus|value)$/.exec(key);
  if (skill && labels.pericias?.[skill[1]]) return labels.pericias[skill[1]];
  const ability = /^system\.atributos\.([^.]+)\.(?:bonus|value)$/.exec(key);
  if (ability && labels.atributos?.[ability[1]]) return labels.atributos[ability[1]];
  return key;
}

/** Signed number for messages: +2, −1. */
export function signed(value) {
  const n = Number(value) || 0;
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}

/**
 * Suppressions that are new and involve a changed document, as the loser or the winner.
 * @param {ReturnType<typeof planSuppression>["report"]} report
 * @param {Set<string>} known  Signatures already notified.
 * @param {{effect?: string, item?: string}} doc  Uuid of the changed effect or id of the changed item.
 */
export function newSuppressions(report, known, doc) {
  const docs = [doc].flat().filter(Boolean);
  const involves = (side) => docs.some((d) => (d.effect && side.effects.includes(d.effect)) || (d.item && side.items.includes(d.item)));
  return (report ?? []).filter((r) => !known.has(reportSignature(r)) && (involves(r.loser) || involves(r.winner)));
}


/** @param {ReturnType<typeof planSuppression>["report"][number]} r */
export function reportSignature(r) {
  return [r.category, r.key, r.sign, r.loser.source, r.winner.source].join("\u0000");
}
