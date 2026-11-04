/** Dialogs of "Manobras de combate" (#48): the defender's resistance and the "Manobra" field of the use dialog. */
import { FORM_KIND, FORM_VERSATILE, LUTA, MANEUVERS, isVersatile, parseManeuverChoice, versatileDefault } from "../domain/index.mjs";
import { FIELD_CLASS } from "./classes.mjs";
import { el, escapeHTML, t } from "./cards.mjs";

/** @typedef {import("../../../kernel/feature.mjs").FeatureContext} FeatureContext */

function formValues(form) {
  const get = (name) => form?.elements?.namedItem?.(name) ?? form?.elements?.[name] ?? null;
  return {
    kind: get("kind")?.value,
    weapon: get("weapon")?.value,
    versatile: !!get("versatile")?.checked,
    other: get("other")?.value
  };
}

function numberRow(ctx) {
  return [
    '<div class="form-group">',
    `<label>${escapeHTML(t(ctx, "Dialog.Other"))}</label>`,
    '<input type="number" name="other" value="0" step="1">',
    "</div>",
    `<p class="hint">${escapeHTML(t(ctx, "Dialog.OtherHint"))}</p>`
  ].join("");
}

function versatileRow(ctx, checked, hidden) {
  return [
    `<div class="form-group t20cp-maneuver-versatile"${hidden ? " hidden" : ""}>`,
    `<label>${escapeHTML(t(ctx, "Dialog.Versatile"))}</label>`,
    `<input type="checkbox" name="versatile"${checked ? " checked" : ""}>`,
    "</div>"
  ].join("");
}

function resistContent(ctx, actor, kind, weapons) {
  const hasLuta = !!actor.system?.pericias?.[LUTA];
  const rows = weapons.map((w) => {
    const versatile = isVersatile(w);
    return `<option value="${escapeHTML(w.id)}" data-versatile="${versatile ? 1 : 0}">${escapeHTML(w.name)}</option>`;
  });
  if (hasLuta) rows.push(`<option value="${LUTA}" data-versatile="0">${escapeHTML(t(ctx, "Dialog.NoWeapon"))}</option>`);
  const first = weapons[0] ?? null;
  const firstVersatile = isVersatile(first);
  return [
    '<div class="t20cp-maneuver-dialog">',
    `<p>${escapeHTML(t(ctx, "Dialog.ResistPrompt", { kind: t(ctx, `Kind.${kind}`) }))}</p>`,
    `<div class="form-group"><label>${escapeHTML(t(ctx, "Dialog.Weapon"))}</label><select name="weapon">${rows.join("")}</select></div>`,
    `<p class="hint t20cp-maneuver-luta-hint"${first ? " hidden" : ""}>${escapeHTML(t(ctx, "Dialog.NoWeaponHint"))}</p>`,
    versatileRow(ctx, firstVersatile && versatileDefault(kind, first.system.propriedades), !firstVersatile),
    numberRow(ctx),
    `<p class="hint">${escapeHTML(t(ctx, "Reference"))}</p>`,
    "</div>"
  ].join("");
}

/** Keeps "Arma versátil" and the Luta hint in step with the chosen weapon. */
function bindWeaponSelect(dialog, kind, weapons) {
  const form = dialog.element?.querySelector?.("form") ?? dialog.form;
  const select = form?.elements?.namedItem?.("weapon");
  const versatile = form?.elements?.namedItem?.("versatile");
  select?.addEventListener("change", () => {
    const option = select.selectedOptions?.[0];
    const weapon = weapons.find((w) => w.id === select.value);
    const allowed = option?.dataset?.versatile === "1";
    versatile?.closest?.(".form-group")?.toggleAttribute?.("hidden", !allowed);
    if (versatile) versatile.checked = allowed && versatileDefault(kind, weapon?.system?.propriedades);
    form.querySelector?.(".t20cp-maneuver-luta-hint")?.toggleAttribute?.("hidden", select.value !== LUTA);
  });
}

/**
 * Defender's dialog: melee weapon or Luta, Versátil and other modifiers. Resolves null when dismissed.
 * @param {FeatureContext} ctx
 */
export async function promptResist(ctx, actor, kind, weapons) {
  const result = await ctx.platform.dice.DialogV2.wait({
    window: { title: t(ctx, "Dialog.ResistTitle") },
    content: resistContent(ctx, actor, kind, weapons),
    buttons: [
      {
        action: "ok",
        label: t(ctx, "Button.Resist"),
        default: true,
        callback: (_event, btn) => {
          const values = formValues(btn.form);
          const weapon = weapons.find((w) => w.id === values.weapon) ?? null;
          if (!weapon && values.weapon !== LUTA) return null;
          const choice = parseManeuverChoice({ ...values, kind }, { versatileAllowed: isVersatile(weapon) });
          return { weapon, versatile: choice.versatile, other: choice.other };
        }
      }
    ],
    render: (_event, dialog) => bindWeaponSelect(dialog, kind, weapons)
  });
  return result && typeof result === "object" ? result : null;
}

/**
 * The "Manobra" field (and "Arma versátil") of the use dialog; disabled with a hint when the targets cannot take one.
 * @param {FeatureContext} ctx
 * @returns {{box: HTMLElement, select: HTMLSelectElement, versatile: HTMLInputElement | null}}
 */
export function buildUseField(ctx, item, problem) {
  const box = el("div", FIELD_CLASS);
  const row = el("div", "form-group");
  row.dataset.tooltip = t(ctx, "Reference");
  const label = el("label", "", t(ctx, "Dialog.Kind"));
  const fields = el("div", "form-fields");
  const select = el("select");
  select.name = FORM_KIND;
  const none = el("option", "", t(ctx, "Dialog.None"));
  none.value = "";
  select.append(none);
  for (const kind of MANEUVERS) {
    const option = el("option", "", t(ctx, `Kind.${kind}`));
    option.value = kind;
    select.append(option);
  }
  select.value = "";
  fields.append(select);
  let versatile = null;
  if (isVersatile(item)) {
    const check = el("label", "checkbox");
    versatile = el("input");
    versatile.type = "checkbox";
    versatile.name = FORM_VERSATILE;
    versatile.checked = false;
    check.append(versatile, document.createTextNode(t(ctx, "Dialog.Versatile")));
    fields.append(check);
  }
  row.append(label, fields);
  box.append(row);
  if (problem) {
    select.disabled = true;
    if (versatile) versatile.disabled = true;
    box.append(el("p", "hint t20cp-maneuver-use-hint", t(ctx, `Warn.${problem}`)));
  }
  return { box, select, versatile };
}
