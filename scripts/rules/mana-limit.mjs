/**
 * Optional rule "Limite de PM por uso" (#25).
 *
 * Book rule: a use cannot spend more PM than the level in the class that grants the ability (or the character
 * level for race, origin, general and granted powers), but the minimum cost is always allowed. The system does
 * not enforce it. This rule checks the cost the system will actually spend, before the dialog applies the form,
 * and warns or blocks (setting). A per-item flag overrides the limit; an unknown source only warns.
 */
import { MODULE_ID } from "../utils.mjs";
import { installUseDialogGuard, registerUseValidator } from "./use-dialog-guard.mjs";

export const MANA_LIMIT_SETTING = "manaLimitRule";
export const MANA_LIMIT_FLAG = "manaLimit";
export const MANA_LIMIT_MODES = ["off", "warn", "block"];

const CLASS_TYPES = new Set(["classe", "ability"]);
const CHARACTER_TYPES = new Set(["racial", "origem", "geral", "concedido"]);
const CHARACTER_FORMULA = "@nivel";
// rollPericia/rollAtributo open the same dialog with pseudo-items whose cost ignores custoPM.
const SKIPPED_TYPES = new Set(["pericia", "atributo"]);

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
 * Evaluates a dice-free formula with the actor's roll data. Never uses eval: the formula goes through Roll.
 * @param {string} formula
 * @param {object} rollData
 * @param {typeof foundry.dice.Roll} Roll
 * @returns {number|null}  null when the formula is invalid, references missing data, has dice or is not finite.
 */
export function evaluateManaLimit(formula, rollData, Roll) {
  try {
    // Roll replaces missing data with 0, which would turn a typo into a limit of 0: resolve it first.
    const resolved = Roll.replaceFormulaData(String(formula), rollData);
    if (resolved.includes("@")) return null;
    const roll = new Roll(resolved);
    if (!roll.isDeterministic) return null;
    roll.evaluateSync({ strict: true });
    const total = Number(roll.total);
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
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
    if (effect.changes?.some((ch) => ch?.key === "custo" && ch.value == "/2")) halfCost = true;
  }
  if (cantrip || !(base > 0 || total > 0)) return 0;
  let cost = Math.max(total, 0) || (base > 0 ? 1 : 0);
  cost += Number(extraCost) || 0;
  if (halfCost) cost = Math.floor(cost / 2);
  return cost;
}

/**
 * The `aprs` the system builds when the item is used without the dialog: only "Aplicar Sempre" effects.
 * @param {UseEffect[]} effects
 */
export function automaticApplied(effects = []) {
  const applied = {};
  for (const effect of effects) {
    if (effect.automatic) applied[effect.id] = { aplica: 1, custo: effect.custo || 0 };
  }
  return applied;
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

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

/** @param {import("../kernel/feature.mjs").FeatureContext} ctx */
function getMode(ctx) {
  try {
    const mode = ctx.setting(MANA_LIMIT_SETTING);
    return MANA_LIMIT_MODES.includes(mode) ? mode : "warn";
  } catch {
    return "off";
  }
}

/** The element of a render hook argument: an HTMLElement, or the first element of a jQuery object. */
function toElement(html) {
  if (typeof html?.querySelector === "function") return html;
  return typeof html?.[0]?.querySelector === "function" ? html[0] : null;
}

/** @returns {UseEffect[]} */
function readEffects(item) {
  return (item.applicableOnUseEffects ?? []).map((ef) => ({
    id: ef.id,
    automatic: !!ef.system?.abilityUse?.automatic,
    custo: ef.system?.abilityUse?.custo,
    changes: ef.system?.changes ?? []
  }));
}

/** Class slugs of the actor (as in getRollData's @nvl) mapped to the class names. */
function actorClasses(actor, slugify) {
  const classes = new Map();
  for (const cls of actor.items ?? []) {
    if (cls.type === "classe") classes.set(slugify(cls.name), cls.name);
  }
  return classes;
}

/**
 * Limit of the item for its actor, with the text shown after it. null when there is no limit to check.
 * @param {import("../kernel/feature.mjs").FeatureContext} ctx
 * @returns {{limit: number, enforce: boolean, label: string} | null}
 */
function describeLimit(ctx, item) {
  const actor = item?.actor;
  if (!actor || SKIPPED_TYPES.has(item.type)) return null;
  const { utils, dice, i18n } = ctx.platform;
  const classes = actorClasses(actor, utils.slugify);
  const resolved = resolveManaLimitFormula({
    flag: utils.getProperty(item, `flags.${MODULE_ID}.${MANA_LIMIT_FLAG}`),
    source: manaLimitSource(item, classes.keys(), utils.slugify)
  });
  if (resolved.kind === "none") return null;
  const rollData = actor.getRollData();
  const Roll = dice.Roll;
  let limit = evaluateManaLimit(resolved.formula, rollData, Roll);
  let { kind, enforce } = resolved;
  if (limit === null) {
    // Invalid item formula: same as an unknown source.
    kind = "invalid";
    enforce = false;
    limit = evaluateManaLimit(CHARACTER_FORMULA, rollData, Roll);
    if (limit === null) return null;
  }
  const label = i18n.format(`T20CP.ManaLimit.Source.${kind}`, {
    class: classes.get(resolved.slug) ?? resolved.slug ?? "",
    formula: resolved.formula ?? ""
  });
  return { limit, enforce, label };
}

/** @param {import("../kernel/feature.mjs").FeatureContext} ctx */
function validate(ctx, { item, formData }) {
  const mode = getMode(ctx);
  if (mode === "off") return null;
  const info = describeLimit(ctx, item);
  if (!info) return null;
  const { i18n, utils } = ctx.platform;
  const effects = readEffects(item);
  const common = {
    itemType: item.type,
    baseCost: item.system?.ativacao?.custo,
    effects,
    extraCost: item.actor.system?.modificadores?.custoPM
  };
  const cost = estimateUseCost({ ...common, applied: utils.expandObject(formData ?? {}).aprs ?? {} });
  const minimumCost = estimateUseCost({ ...common, applied: automaticApplied(effects) });
  if (checkManaLimit({ cost, minimumCost, limit: info.limit }).ok) return null;

  const block = mode === "block" && info.enforce;
  const data = { name: item.name, cost, limit: info.limit, source: info.label, minimum: minimumCost };
  const parts = [i18n.format("T20CP.ManaLimit.Exceeded", data)];
  if (block) parts.push(i18n.format("T20CP.ManaLimit.Blocked", data));
  if (!info.enforce) parts.push(i18n.localize("T20CP.ManaLimit.Unknown"));
  return { message: parts.join(" "), block };
}

/** @param {import("../kernel/feature.mjs").FeatureContext} ctx */
function renderDialogLine(ctx, app, html) {
  if (getMode(ctx) === "off") return;
  const root = toElement(html);
  const total = root?.querySelector(".total-cost");
  if (!total || root.querySelector(".t20cp-mana-limit")) return;
  const info = describeLimit(ctx, app.item);
  if (!info) return;
  const { i18n } = ctx.platform;
  const doc = root.ownerDocument;
  const row = doc.createElement("div");
  row.className = "form-group t20cp-mana-limit";
  const label = doc.createElement("label");
  label.textContent = i18n.localize("T20CP.ManaLimit.DialogLabel");
  const value = doc.createElement("span");
  value.textContent = i18n.format("T20CP.ManaLimit.DialogValue", { limit: info.limit, source: info.label });
  row.append(label, value);
  total.after(row);
  app.setPosition?.({ height: "auto" });
}

/** @param {import("../kernel/feature.mjs").FeatureContext} ctx */
function renderItemField(ctx, app, html) {
  if (getMode(ctx) === "off") return;
  const root = toElement(html);
  const costInput = root?.querySelector('input[name="system.ativacao.custo"]');
  const name = `flags.${MODULE_ID}.${MANA_LIMIT_FLAG}`;
  if (!costInput || root.querySelector(`input[name="${name}"]`)) return;
  const { i18n, utils } = ctx.platform;
  const doc = root.ownerDocument;
  const anchor = costInput.closest(".form-group") ?? costInput;
  const row = doc.createElement("div");
  row.className = "form-group t20cp-mana-limit-field";
  const label = doc.createElement("label");
  label.textContent = i18n.localize("T20CP.ManaLimit.FieldLabel");
  label.dataset.tooltip = i18n.localize("T20CP.ManaLimit.FieldHint");
  const fields = doc.createElement("div");
  fields.className = "form-fields";
  const input = doc.createElement("input");
  input.type = "text";
  input.name = name;
  input.value = String(utils.getProperty(app.document ?? app.item ?? {}, name) ?? "");
  input.placeholder = i18n.localize("T20CP.ManaLimit.FieldPlaceholder");
  input.disabled = app.isEditable === false;
  fields.append(input);
  row.append(label, fields);
  anchor.after(row);
}

/**
 * World setting. The lifecycle registers it on "init" for every system, so it always exists.
 * @type {import("../kernel/feature.mjs").SettingSpec}
 */
const SETTING_SPEC = {
  key: MANA_LIMIT_SETTING,
  name: "T20CP.ManaLimit.Setting.Name",
  hint: "T20CP.ManaLimit.Setting.Hint",
  scope: "world",
  type: String,
  choices: {
    off: "T20CP.ManaLimit.Setting.off",
    warn: "T20CP.ManaLimit.Setting.warn",
    block: "T20CP.ManaLimit.Setting.block"
  },
  default: "warn"
};

/**
 * Installs the rule. The mode is read on every use, so a change applies without reloading.
 * @param {import("../kernel/feature.mjs").FeatureContext} ctx
 */
export function installManaLimitRule(ctx) {
  installUseDialogGuard(ctx.platform);
  registerUseValidator((context) => validate(ctx, context));
  ctx.hooks.on("renderAbilityUseDialog", (app, html) => {
    try {
      renderDialogLine(ctx, app, html);
    } catch (err) {
      ctx.log.error("failed to show the limit", err);
    }
  });
  ctx.hooks.on("renderItemSheet", (app, html) => {
    try {
      renderItemField(ctx, app, html);
    } catch (err) {
      ctx.log.error("failed to add the item field", err);
    }
  });
}

/** @type {import("../kernel/feature.mjs").Feature} */
export default {
  id: "mana-limit",
  kind: "rule",
  group: "usage-effects",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  install: (ctx) => installManaLimitRule(ctx)
};
