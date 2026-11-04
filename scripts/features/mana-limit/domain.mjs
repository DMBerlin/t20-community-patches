/**
 * Pure logic of the "Limite de PM por uso" rule (#25): where the limit comes from, its formula, the cost of a use
 * and the check.
 */

export const MANA_LIMIT_SETTING = "manaLimitRule";
export const MANA_LIMIT_FLAG = "manaLimit";
export const MANA_LIMIT_MODES = ["off", "warn", "block"];

const CLASS_TYPES = new Set(["classe", "ability"]);
const CHARACTER_TYPES = new Set(["racial", "origem", "geral", "concedido"]);
export const CHARACTER_FORMULA = "@nivel";
// rollPericia/rollAtributo open the same dialog with pseudo-items whose cost ignores custoPM.
export const SKIPPED_TYPES = new Set(["pericia", "atributo"]);

const defaultSlugify = (text) => String(text).slugify();

/**
 * Where the limit of an item comes from, read from the power's type and subtype (only powers record them).
 * @param {{type?: string, system?: {tipo?: string, subtipo?: string}}} item
 * @param {Iterable<string>} classSlugs        Slugs of the actor's class names, as in getRollData's @nvl.
 * @param {(text: string) => string} [slugify]
 * @returns {{kind: "class", slug: string} | {kind: "character"} | {kind: "unknown"}}
 */
export function manaLimitSource(item, classSlugs, slugify = defaultSlugify) {
  if (item?.type !== "poder") return { kind: "unknown" };
  const { tipo, subtipo } = item.system ?? {};
  if (CLASS_TYPES.has(tipo)) {
    const slug = typeof subtipo === "string" && subtipo.trim() ? slugify(subtipo) : "";
    return slug && new Set(classSlugs).has(slug) ? { kind: "class", slug } : { kind: "unknown" };
  }
  if (CHARACTER_TYPES.has(tipo)) return { kind: "character" };
  return { kind: "unknown" };
}

/**
 * Formula of the limit: the item flag wins (empty = automatic, "none" = no limit), then the source.
 * An unknown source falls back to the character level, the widest class limit, and never blocks.
 * @param {{flag?: unknown, source: ReturnType<typeof manaLimitSource>}} params
 * @returns {{kind: "none"} | {kind: "item"|"class"|"character"|"unknown", formula: string, enforce: boolean,
 *   slug?: string}}
 */
export function resolveManaLimitFormula({ flag, source }) {
  const text = flag === undefined || flag === null ? "" : String(flag).trim();
  if (text.toLowerCase() === "none") return { kind: "none" };
  if (text) return { kind: "item", formula: text, enforce: true };
  if (source?.kind === "class") return { kind: "class", slug: source.slug, formula: `@nvl.${source.slug}`, enforce: true };
  if (source?.kind === "character") return { kind: "character", formula: CHARACTER_FORMULA, enforce: true };
  return { kind: "unknown", formula: CHARACTER_FORMULA, enforce: false };
}

/**
 * @typedef {object} UseEffect
 * @property {string} id
 * @property {boolean} [automatic]  abilityUse.automatic ("Aplicar Sempre").
 * @property {unknown} [custo]      abilityUse.custo.
 * @property {{key: string, value: unknown}[]} [changes]
 */

/**
 * PM the system will spend for a use, as applyOnUseEffects (cost sum, cantrip, halfCost) and ItemT20#roll
 * (manaCost, custoPM) compute it. The dialog's "ajustecusto" field is display-only in the system and ignored.
 * @param {object} params
 * @param {string} params.itemType
 * @param {unknown} params.baseCost        ativacao.custo of the rolled item.
 * @param {UseEffect[]} params.effects     The item's applicable usage effects.
 * @param {Record<string, {aplica?: unknown, custo?: unknown}>} [params.applied]  Expanded `aprs` of the form.
 * @param {unknown} [params.extraCost]     actor.system.modificadores.custoPM.
 * @returns {number}
 */
export function estimateUseCost({ itemType, baseCost, effects = [], applied = {}, extraCost = 0 }) {
  const base = Number(baseCost) || 0;
  let total = base;
  let cantrip = false;
  let halfCost = false;
  for (const effect of effects) {
    const entry = applied?.[effect.id];
    if (!entry?.aplica) continue;
    // Same expressions as the system, including its string coercions ("Truque" + 1 is NaN, a cantrip).
    const cost = Number(entry.custo) * entry.aplica || entry.custo;
    total += Number(cost) || 0;
    if (!Number(entry.custo + 1) && itemType === "magia") cantrip = true;
    // eslint-disable-next-line eqeqeq -- loose, as the system compares the change value.
    if (effect.changes?.some((ch) => ch?.key === "custo" && ch.value == "/2")) halfCost = true;
  }
  if (cantrip || !(base > 0 || total > 0)) return 0;
  let cost = Math.max(total, 0) || (base > 0 ? 1 : 0);
  cost += Number(extraCost) || 0;
  if (halfCost) cost = Math.floor(cost / 2);
  return cost;
}

/**
 * A cost up to the limit, or up to the minimum cost, is allowed.
 * @param {{cost: number, minimumCost: number, limit: number|null}} params
 * @returns {{ok: boolean, exceededBy: number}}
 */
export function checkManaLimit({ cost, minimumCost, limit }) {
  if (!Number.isFinite(limit) || cost <= limit || cost <= minimumCost) return { ok: true, exceededBy: 0 };
  return { ok: false, exceededBy: cost - limit };
}
