import { MODULE_ID } from "../utils.mjs";
import { isPatchEnabled } from "../settings.mjs";
import { GROUPS, PATCHES } from "../patches/index.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const BADGES = {
  applied: "success",
  "applied-unverified": "warning",
  disabled: "muted",
  fixed: "info",
  unverified: "warning",
  incompatible: "muted",
  error: "error"
};

/** Lists the patches by group, with their current state, and edits which ones are enabled. */
export class PatchManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "t20cp-patch-manager",
    tag: "form",
    classes: ["t20cp-patch-manager"],
    window: { title: "T20CP.Manager.Title", icon: "fa-solid fa-screwdriver-wrench", contentClasses: ["standard-form"] },
    position: { width: 640, height: "auto" },
    form: { handler: PatchManager.#onSubmit, closeOnSubmit: true }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/patch-manager.hbs`, scrollable: [""] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  /** Toggle values shown when the form was rendered, so a submit only writes what this user changed. */
  #snapshot = {};

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const status = new Map((game.modules.get(MODULE_ID).api?.status ?? []).map((s) => [s.id, s]));
    const bugs = game.modules.get(MODULE_ID).bugs;

    const rows = PATCHES.map((patch) => {
      const { state = "disabled", reason } = status.get(patch.id) ?? {};
      return {
        id: patch.id,
        group: patch.group,
        name: game.i18n.localize(`T20CP.Patches.${patch.id}.Name`),
        hint: game.i18n.localize(`T20CP.Patches.${patch.id}.Hint`),
        enabled: isPatchEnabled(patch.id),
        state,
        stateLabel: game.i18n.localize(`T20CP.States.${state}.Label`),
        stateHint: game.i18n.format(`T20CP.States.${state}.Hint`, { reason: reason ?? "" }),
        badge: BADGES[state] ?? "muted",
        issueUrl: patch.issue && bugs ? `${bugs}/${patch.issue}` : null,
        issue: patch.issue
      };
    });

    this.#snapshot = Object.fromEntries(rows.map((r) => [r.id, r.enabled]));
    // Saved toggles that differ from what was installed at load time only take effect after a reload.
    context.pendingReload = rows.some((r) => status.has(r.id) && status.get(r.id).enabled !== r.enabled);

    const groupIds = [...GROUPS, ...new Set(rows.map((r) => r.group).filter((g) => !GROUPS.includes(g)))];
    context.groups = groupIds
      .map((id) => ({ id, label: game.i18n.localize(`T20CP.Groups.${id}`), patches: rows.filter((r) => r.group === id) }))
      .filter((g) => g.patches.length);
    context.buttons = [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "T20CP.Manager.Save" }];
    return context;
  }

  /**
   * @this {PatchManager}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   */
  static async #onSubmit(event, form, formData) {
    const submitted = formData.object;
    const changes = PATCHES.filter((p) => !!submitted[p.id] !== this.#snapshot[p.id]);
    if (!changes.length) return;
    const next = { ...(game.settings.get(MODULE_ID, "patches") ?? {}) };
    for (const { id } of changes) next[id] = !!submitted[id];
    await game.settings.set(MODULE_ID, "patches", next);
    await foundry.applications.settings.SettingsConfig.reloadConfirm({ world: true });
  }
}
