/**
 * Saving the Center (#89): validates the changed settings, confirms the patches forced on, writes the changes and
 * offers the world reload when they need one.
 */
import { needsReload } from "../../kernel/center.mjs";
import { trapFocus } from "./focus.mjs";

/**
 * @param {import("../../platform/foundry.mjs").Platform} platform
 */
export function createSubmitFlow(platform) {
  const { localize } = platform.i18n;

  /**
   * Asks to confirm the patches forced on. Waits for the dialog to close when the answer is no.
   * @param {{id: string}[]} forced
   * @returns {Promise<boolean>}
   */
  async function confirmForced(forced) {
    const names = forced.map((p) => `<li>${platform.utils.escapeHTML(localize(`T20CP.Patches.${p.id}.Name`))}</li>`);
    let shown = null;
    const confirmed = await platform.dice.DialogV2.confirm({
      window: { title: localize("T20CP.Manager.ForceTitle") },
      content: `<p>${localize("T20CP.Manager.ForceContent")}</p><ul>${names.join("")}</ul>`,
      rejectClose: false,
      modal: true,
      render: (_event, dialog) => {
        shown = dialog;
        trapFocus(dialog.element);
      }
    });
    // The answer comes before the dialog closes, and closing it moves the focus: wait, so the caller can move it back.
    if (!confirmed && shown && shown.state !== shown.constructor.RENDER_STATES.CLOSED) {
      await new Promise((resolve) => shown.addEventListener("close", resolve, { once: true }));
    }
    return !!confirmed;
  }

  /** The core reload dialog, with the focus kept inside it. */
  async function confirmReload() {
    const hook = platform.hooks.on("renderDialogV2", (dialog) => {
      if (dialog.id === "reload-world-confirm") trapFocus(dialog.element);
    });
    try {
      await platform.ui.reloadConfirm({ world: true });
    } finally {
      platform.hooks.off("renderDialogV2", hook);
    }
  }

  /**
   * Throws, before anything is saved, when a changed setting is invalid.
   * @param {{field: object, value: unknown, label?: string}[]} settings
   */
  function validate(settings) {
    for (const { field, value, label } of settings) {
      const failure = field.validate(value);
      if (failure) throw new Error(`${localize(label ?? "")}: ${failure.asError?.().message ?? failure.message ?? failure}`);
    }
  }

  /** Writes the changed settings, then the changed patch modes. */
  async function save(patches, settings) {
    for (const { key, value } of settings) await platform.settings.set(key, value);
    if (!patches.length) return;
    const next = { ...(platform.settings.get("patches") ?? {}) };
    for (const { id, mode } of patches) next[id] = mode;
    await platform.settings.set("patches", next);
  }

  /**
   * @param {object} app  The PatchManager.
   * @param {{patches: {id: string, mode: string}[], settings: object[]}} changes  rows.mjs collectChanges.
   */
  async function submit(app, { patches, settings }) {
    if (!patches.length && !settings.length) return app.close();
    validate(settings);

    const forced = patches.filter((p) => p.mode === "force");
    if (forced.length && !(await confirmForced(forced))) {
      app.element?.querySelector('footer button[type="submit"]')?.focus();
      return;
    }

    await save(patches, settings);
    await app.close();
    if (needsReload(patches.map((p) => p.id), settings)) await confirmReload();
  }

  return Object.freeze({ submit });
}
