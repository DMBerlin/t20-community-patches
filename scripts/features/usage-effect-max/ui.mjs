/**
 * Rendering of the usage-effect-max rule: the maximum next to each counter of the use dialog, and the maximum field
 * on the "onuse" tab of the effect config. Receives the platform and the limits by parameter.
 */
import { DEFAULTS, FLAG_PATH, nameKey, ownerSource, resolveMaxFormula, sourceKey } from "../../lib/usage-limits.mjs";

function toElement(html) {
  if (html instanceof HTMLElement) return html;
  return html?.[0] instanceof HTMLElement ? html[0] : null;
}

/**
 * @param {object} platform
 * @param {object} app   The AbilityUseDialog.
 * @param {unknown} html
 * @param {(item: object) => Record<string, {max: number, name: string}>} limitsOf  Maximum of each effect of the item.
 */
export function renderDialogLimits(platform, app, html, limitsOf) {
  const root = toElement(html);
  if (!root) return;
  const limits = limitsOf(app.item);
  let changed = false;
  for (const [id, { max }] of Object.entries(limits)) {
    for (const input of root.querySelectorAll(`input[name="aprs.${id}.aplica"]`)) {
      if (input.type === "number") input.max = String(max);
      const container = input.closest(".item-cost") ?? input.parentElement;
      if (!container || container.querySelector(".t20cp-usage-effect-max")) continue;
      const hint = root.ownerDocument.createElement("span");
      hint.className = "t20cp-usage-effect-max";
      hint.textContent = platform.i18n.format("T20CP.UsageEffectMax.DialogHint", { max });
      container.append(hint);
      changed = true;
    }
  }
  if (changed) app.setPosition?.({ height: "auto" });
}

/** Lookup keys of an effect, without its flag (used for the inherited placeholder). */
function resolveKeys(platform, effect) {
  const owner = effect?.parent;
  return {
    sourceKey: sourceKey(ownerSource(effect, platform.utils.getProperty), effect?.id),
    nameKey: owner?.documentName === "Item" ? nameKey(owner.name, effect?.name) : ""
  };
}

/** The maximum field: a text input named after the flag, with the inherited default as placeholder. */
function maxInput(platform, doc, effect, editable) {
  const input = doc.createElement("input");
  input.type = "text";
  input.name = FLAG_PATH;
  input.value = String(platform.utils.getProperty(effect ?? {}, FLAG_PATH) ?? "");
  const inherited = resolveMaxFormula({ ...resolveKeys(platform, effect), defaults: DEFAULTS });
  input.placeholder =
    inherited.kind === "formula"
      ? platform.i18n.format("T20CP.UsageEffectMax.FieldPlaceholderDefault", { formula: inherited.formula })
      : platform.i18n.localize("T20CP.UsageEffectMax.FieldPlaceholder");
  input.disabled = editable === false;
  return input;
}

/**
 * @param {object} platform
 * @param {object} app   The ActiveEffectConfig.
 * @param {unknown} html
 */
export function renderEffectField(platform, app, html) {
  const root = toElement(html) ?? toElement(app.element);
  const tab = root?.querySelector("section.tab.onuse, section.tab[data-tab='onuse']");
  if (!tab || tab.querySelector(`input[name="${FLAG_PATH}"]`)) return;
  const doc = root.ownerDocument;
  const row = doc.createElement("div");
  row.className = "form-group t20cp-usage-effect-max-field";
  const label = doc.createElement("label");
  label.textContent = platform.i18n.localize("T20CP.UsageEffectMax.FieldLabel");
  const fields = doc.createElement("div");
  fields.className = "form-fields";
  fields.append(maxInput(platform, doc, app.document, app.isEditable));
  const hint = doc.createElement("p");
  hint.className = "hint";
  hint.textContent = platform.i18n.localize("T20CP.UsageEffectMax.FieldHint");
  row.append(label, fields, hint);
  tab.append(row);
}
