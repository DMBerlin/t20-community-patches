/** The skill picker dialog. */
import { isValidSelection } from "./domain.mjs";

function dialogContent(platform, { actorName, options, limits }) {
  const escape = platform.utils.escapeHTML;
  const i18n = platform.i18n;
  const prompt =
    limits.min === limits.max
      ? i18n.format("T20CP.SkillPicker.Prompt", { count: limits.max, actor: escape(actorName) })
      : i18n.format("T20CP.SkillPicker.PromptRange", { min: limits.min, max: limits.max, actor: escape(actorName) });
  const boxes = options
    .map(
      (option) =>
        `<label class="checkbox"><input type="checkbox" name="skills" value="${escape(option.key)}"> ${escape(option.label)}</label>`
    )
    .join("");
  return `<p>${prompt}</p><div class="t20cp-skill-picker" style="display:grid;grid-template-columns:1fr 1fr;gap:0.25em 1em">${boxes}</div>`;
}

/**
 * Asks for the skills. Returns the picked keys, or null when the dialog was closed.
 * @param {import("../../platform/foundry.mjs").Platform} platform
 * @returns {Promise<string[]|null>}
 */
export async function promptSkills(platform, { itemName, actorName, options, limits }) {
  const content = dialogContent(platform, { actorName, options, limits });
  while (true) {
    const picked = await platform.dice.DialogV2.wait({
      window: { title: platform.i18n.format("T20CP.SkillPicker.Title", { item: itemName }) },
      content,
      rejectClose: false,
      buttons: [
        {
          action: "ok",
          label: "T20CP.SkillPicker.Confirm",
          icon: "fa-solid fa-check",
          default: true,
          callback: (event, button) =>
            [...button.form.querySelectorAll('input[name="skills"]:checked')].map((input) => input.value)
        }
      ],
      render: (event, dialog) => {
        const root = dialog.element;
        const inputs = [...root.querySelectorAll('input[name="skills"]')];
        const confirm = root.querySelector('button[data-action="ok"]');
        const sync = () => {
          const count = inputs.filter((input) => input.checked).length;
          for (const input of inputs) input.disabled = !input.checked && count >= limits.max;
          if (confirm) confirm.disabled = !isValidSelection(count, limits);
        };
        for (const input of inputs) input.addEventListener("change", sync);
        sync();
      }
    });
    if (!Array.isArray(picked)) return null;
    if (isValidSelection(picked.length, limits)) return picked;
  }
}
