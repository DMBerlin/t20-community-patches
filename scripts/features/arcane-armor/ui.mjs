/**
 * Texts and HTML of the "Magia arcana de armadura" rule (#46): the test message parts, the line in the use dialog
 * and the item sheet field. Everything comes in through parameters (ctx for i18n and utils).
 */
import { MODULE_ID } from "../../lib/module.mjs";
import { SPELL_FLAG, SPELL_SOURCES, WAIVER_FLAG, WAIVERS, failureKey } from "./domain.mjs";

/**
 * Localized text of the rule (T20CP.ArcaneArmor.<key>).
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 */
export function t(ctx, key, data) {
  const { i18n } = ctx.platform;
  return data ? i18n.format(`T20CP.ArcaneArmor.${key}`, data) : i18n.localize(`T20CP.ArcaneArmor.${key}`);
}

/** A flag of this module on a document. */
export const flagOf = (ctx, doc, key) => ctx.platform.utils.getProperty(doc ?? {}, `flags.${MODULE_ID}.${key}`);

function toElement(html) {
  if (html instanceof HTMLElement) return html;
  return html?.[0] instanceof HTMLElement ? html[0] : null;
}

export function header(ctx, item, check) {
  const escape = ctx.platform.utils.escapeHTML;
  return t(ctx, "Flavor", {
    spell: escape(item.name ?? ""),
    armor: escape(check.armor?.name ?? ""),
    dc: check.dc
  });
}

export function reference(ctx) {
  return `<p class="t20cp-arcane-armor-ref"><em>${ctx.platform.utils.escapeHTML(t(ctx, "Reference"))}</em></p>`;
}

export function grantList(ctx, names) {
  const escaped = [...new Set(names.filter(Boolean))].map((n) => ctx.platform.utils.escapeHTML(n));
  try {
    return new Intl.ListFormat(ctx.platform.i18n.lang(), { type: "disjunction" }).format(escaped);
  } catch {
    return escaped.join(" / ");
  }
}

/** @param {boolean} autoSpend  Setting tormenta20.automaticManaSpend. */
export function failureLine(ctx, item, check, autoSpend) {
  return t(ctx, failureKey({ cost: check.cost, autoSpend }), {
    spell: ctx.platform.utils.escapeHTML(item.name ?? ""),
    cost: check.cost
  });
}

/**
 * Line of the use dialog: the armor and its penalty, or the ambiguous source.
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 * @param {object} app
 * @param {unknown} html
 * @param {(item: object) => {actor: object, armor: object, requirement: object}|null} requirementFor
 */
export function renderDialogLine(ctx, app, html, requirementFor) {
  const root = toElement(html);
  const total = root?.querySelector(".total-cost");
  if (!total || root.querySelector(".t20cp-arcane-armor-line")) return;
  const info = requirementFor(app.item);
  if (!info) return;
  const { armor, requirement } = info;
  if (!requirement.required && !requirement.ambiguous) return;
  const row = document.createElement("div");
  row.className = "form-group t20cp-arcane-armor-line";
  const label = document.createElement("label");
  label.textContent = t(ctx, "Dialog.Label");
  const value = document.createElement("span");
  value.textContent = requirement.ambiguous
    ? t(ctx, "Dialog.Ambiguous")
    : t(ctx, "Dialog.Value", {
        armor: armor.name ?? "",
        penalty: -Math.abs(Number(info.actor.system?.attributes?.defesa?.pda) || 0)
      });
  row.append(label, value);
  total.after(row);
  app.setPosition?.({ height: "auto" });
}

/** The select of the item sheet: the source of a spell, or the waiver of a power. */
export function renderItemField(ctx, app, html) {
  const item = app.document ?? app.item;
  const field = item?.type === "magia" ? "Spell" : item?.type === "poder" ? "Waiver" : null;
  if (!field) return;
  const root = toElement(html);
  const costInput = root?.querySelector('input[name="system.ativacao.custo"]');
  const key = field === "Spell" ? SPELL_FLAG : WAIVER_FLAG;
  const name = `flags.${MODULE_ID}.${key}`;
  if (!costInput || root.querySelector(`select[name="${name}"]`)) return;
  const choices = field === "Spell" ? [["", "auto"], ...SPELL_SOURCES.map((s) => [s, s])] : [["", "none"], ...WAIVERS.map((w) => [w, w])];
  const current = String(flagOf(ctx, item, key) ?? "");
  const anchor = costInput.closest(".form-group") ?? costInput;
  const row = document.createElement("div");
  row.className = "form-group t20cp-arcane-armor-field";
  const label = document.createElement("label");
  label.textContent = t(ctx, `${field}Field.Label`);
  label.dataset.tooltip = t(ctx, `${field}Field.Hint`);
  const fields = document.createElement("div");
  fields.className = "form-fields";
  const select = document.createElement("select");
  select.name = name;
  select.disabled = app.isEditable === false;
  for (const [value, labelKey] of choices) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = t(ctx, `${field}Field.${labelKey}`);
    option.selected = value === current;
    select.append(option);
  }
  fields.append(select);
  row.append(label, fields);
  anchor.after(row);
}
