/**
 * Foundry side of the "Limite de PM por uso" rule (#25): the dialog guard, the limit line in the use dialog and the
 * per-item field. Everything goes through ctx.
 */
import { MODULE_ID } from "../../lib/module.mjs";
import { evaluateManaLimit, automaticApplied } from "../../lib/mana.mjs";
import {
  CHARACTER_FORMULA,
  MANA_LIMIT_FLAG,
  MANA_LIMIT_MODES,
  MANA_LIMIT_SETTING,
  SKIPPED_TYPES,
  checkManaLimit,
  estimateUseCost,
  manaLimitSource,
  resolveManaLimitFormula
} from "./domain.mjs";

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
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
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
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

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
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

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
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

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
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
 * Installs the rule. The mode is read on every use, so a change applies without reloading.
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 */
export function install(ctx) {
  ctx.services["use-dialog-guard"].register((context) => validate(ctx, context));
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
