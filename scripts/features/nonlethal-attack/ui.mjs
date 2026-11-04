/** Dialog line and weapon sheet field of the lethal or nonlethal attack choice (#74). */
import { MODULE_ID } from "../../lib/module.mjs";
import { NONLETHAL_FIELD } from "../../lib/nonlethal.mjs";
import { CHOICES, FIELD_CLASS, LINE_CLASS, NATURAL_FLAG, NATURAL_MODES, decide, weaponContext } from "./domain.mjs";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

/** @param {FeatureContext} ctx */
export function t(ctx, key, data) {
  const path = `T20CP.NonlethalAttack.${key}`;
  return data ? ctx.platform.i18n.format(path, data) : ctx.platform.i18n.localize(path);
}

function waiverNames(ctx, ids) {
  return ids.map((id) => t(ctx, `Waiver.${id}`)).join(", ");
}

/** Text next to the choice: the penalty, the waiver or nothing. */
export function penaltyText(ctx, decision) {
  if (decision.penalty) return t(ctx, "Penalty", { value: String(decision.penalty).replace("-", "\u2212") });
  if (decision.waivers.length) return t(ctx, "Waived", { powers: waiverNames(ctx, decision.waivers) });
  return "";
}

/**
 * The dialog line.
 * @param {FeatureContext} ctx
 */
export function buildLine(ctx, item) {
  const context = weaponContext(item);
  const decisions = Object.fromEntries(CHOICES.map((choice) => [choice, decide({ choice, ...context })]));
  const row = document.createElement("div");
  row.className = `form-group ${LINE_CLASS}`;
  row.dataset.tooltip = t(ctx, "Reference");
  const label = document.createElement("label");
  label.textContent = t(ctx, "Label");
  const fields = document.createElement("div");
  fields.className = "form-fields";
  fields.style.cssText = "justify-content:flex-start; gap:8px;";
  const note = document.createElement("span");
  note.className = "hint";
  const update = (choice) => {
    note.textContent = penaltyText(ctx, decisions[choice]);
  };
  for (const choice of CHOICES) {
    const option = document.createElement("label");
    option.className = "checkbox";
    option.style.cssText = "display:flex; align-items:center; gap:4px; flex:none;";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = NONLETHAL_FIELD;
    input.value = choice;
    input.checked = choice === context.natural;
    input.addEventListener?.("change", () => update(choice));
    option.append(input, document.createTextNode(t(ctx, `Choice.${choice}`)));
    fields.append(option);
  }
  update(context.natural);
  fields.append(note);
  row.append(label, fields);
  return row;
}

/**
 * The "Dano natural" field of a weapon sheet, after "Empunhadura". Idempotent.
 * @param {FeatureContext} ctx
 */
export function addNaturalField(ctx, app, item, root) {
  const name = `flags.${MODULE_ID}.${NATURAL_FLAG}`;
  const wielding = root?.querySelector?.('select[name="system.empunhadura"]');
  if (!wielding || root.querySelector(`select[name="${name}"]`)) return;
  const current = String(item.flags?.[MODULE_ID]?.[NATURAL_FLAG] ?? "auto");
  const row = document.createElement("div");
  row.className = `form-group ${FIELD_CLASS}`;
  const label = document.createElement("label");
  label.textContent = t(ctx, "Field.Label");
  label.dataset.tooltip = t(ctx, "Field.Hint");
  const fields = document.createElement("div");
  fields.className = "form-fields";
  const select = document.createElement("select");
  select.name = name;
  select.disabled = app.isEditable === false;
  for (const mode of NATURAL_MODES) {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = t(ctx, `Field.${mode}`);
    option.selected = mode === (NATURAL_MODES.includes(current) ? current : "auto");
    select.append(option);
  }
  fields.append(select);
  row.append(label, fields);
  (wielding.closest(".form-group") ?? wielding).after(row);
}
