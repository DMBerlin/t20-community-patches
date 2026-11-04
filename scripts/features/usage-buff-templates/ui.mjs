const escapeHTML = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Asks which weapon receives the buff.
 * @param {{i18n: object, dice: {DialogV2: object}}} platform
 * @param {string} effectName
 * @param {{name: string}} actor
 * @param {{id: string, name: string, wielded: boolean}[]} choices
 * @returns {Promise<string|null>} The chosen weapon id.
 */
export async function askWeapon({ i18n, dice }, effectName, actor, choices) {
  const options = choices
    .map((w) => `<option value="${escapeHTML(w.id)}">${escapeHTML(w.name)}${w.wielded ? ` (${escapeHTML(i18n.localize("T20CP.UsageBuffTemplates.Wielded"))})` : ""}</option>`)
    .join("");
  const label = escapeHTML(i18n.localize("T20CP.UsageBuffTemplates.Weapon"));
  const content = `<p>${escapeHTML(i18n.format("T20CP.UsageBuffTemplates.Prompt", { effect: effectName, actor: actor.name }))}</p>
    <div class="form-group"><label>${label}</label><select name="weapon">${options}</select></div>`;
  return dice.DialogV2.wait({
    window: { title: effectName },
    content,
    buttons: [
      {
        action: "apply",
        label: i18n.localize("T20CP.UsageBuffTemplates.Apply"),
        default: true,
        callback: (event, button) => button.form.elements.weapon.value
      },
      { action: "cancel", label: i18n.localize("Cancel"), callback: () => null }
    ],
    rejectClose: false
  });
}
