import { MODULE_ID } from "../utils.mjs";
import { getPatchMode } from "../settings.mjs";
import { MODES, displayState } from "../registry.mjs";
import { GROUPS, PATCHES } from "../patches/index.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const BADGES = {
  applied: "success",
  "applied-unverified": "warning",
  "applied-guarded": "warning",
  "suspected-fixed": "warning",
  forced: "success",
  disabled: "muted",
  "disabled-fixed": "info",
  fixed: "info",
  unverified: "warning",
  incompatible: "muted",
  error: "error"
};

/** Lists the patches by group, with their current state and diagnosis, and edits the mode of each one. */
export class PatchManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "t20cp-patch-manager",
    tag: "form",
    classes: ["t20cp-patch-manager"],
    window: { title: "T20CP.Manager.Title", icon: "fa-solid fa-screwdriver-wrench", contentClasses: ["standard-form"] },
    position: { width: 720, height: "auto" },
    form: { handler: PatchManager.#onSubmit, closeOnSubmit: false }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/patch-manager.hbs`, scrollable: [""] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  /** Modes shown when the form was rendered, so a submit only writes what this user changed. */
  #snapshot = {};

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const status = new Map((game.modules.get(MODULE_ID).api?.status ?? []).map((s) => [s.id, s]));
    const bugs = game.modules.get(MODULE_ID).bugs;

    const modes = Object.fromEntries(MODES.map((m) => [m, `T20CP.Modes.${m}`]));
    const rows = PATCHES.map((patch) => {
      const { state = "disabled", diagnosis, reason } = status.get(patch.id) ?? {};
      const shown = displayState(state, diagnosis);
      return {
        id: patch.id,
        group: patch.group,
        name: game.i18n.localize(`T20CP.Patches.${patch.id}.Name`),
        hint: game.i18n.localize(`T20CP.Patches.${patch.id}.Hint`),
        mode: getPatchMode(patch.id),
        modes,
        state: shown,
        stateLabel: game.i18n.localize(`T20CP.States.${shown}.Label`),
        stateHint: [game.i18n.format(`T20CP.States.${shown}.Hint`, { reason: foundry.utils.escapeHTML(reason ?? "") }), describeDiagnosis(diagnosis)]
          .filter(Boolean)
          .join("<br>"),
        badge: BADGES[shown] ?? "muted",
        issueUrl: patch.issue && bugs ? `${bugs}/${patch.issue}` : null,
        issue: patch.issue
      };
    });

    this.#snapshot = Object.fromEntries(rows.map((r) => [r.id, r.mode]));
    // Saved modes that differ from what was used at load time only take effect after a reload.
    context.pendingReload = rows.some((r) => status.has(r.id) && status.get(r.id).mode !== r.mode);

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
    const changes = PATCHES.filter((p) => MODES.includes(submitted[p.id]) && submitted[p.id] !== this.#snapshot[p.id]);
    if (!changes.length) return this.close();
    const forced = changes.filter((p) => submitted[p.id] === "force");
    if (forced.length) {
      const names = forced.map((p) => `<li>${foundry.utils.escapeHTML(game.i18n.localize(`T20CP.Patches.${p.id}.Name`))}</li>`);
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("T20CP.Manager.ForceTitle") },
        content: `<p>${game.i18n.localize("T20CP.Manager.ForceContent")}</p><ul>${names.join("")}</ul>`,
        rejectClose: false,
        modal: true
      });
      if (!confirmed) return;
    }
    const next = { ...(game.settings.get(MODULE_ID, "patches") ?? {}) };
    for (const { id } of changes) next[id] = submitted[id];
    await game.settings.set(MODULE_ID, "patches", next);
    await this.close();
    await foundry.applications.settings.SettingsConfig.reloadConfirm({ world: true });
  }
}

/**
 * One tooltip line with the diagnosis behind the state.
 * @param {import("../registry.mjs").Diagnosis|undefined} diagnosis
 */
function describeDiagnosis(diagnosis) {
  if (!diagnosis) return "";
  return game.i18n.format("T20CP.Diagnosis.Line", {
    bug: game.i18n.localize(`T20CP.Diagnosis.Bug.${diagnosis.bug}`),
    confidence: game.i18n.localize(`T20CP.Diagnosis.Confidence.${diagnosis.confidence}`),
    evidence: diagnosis.evidence ? ` (${foundry.utils.escapeHTML(diagnosis.evidence)})` : ""
  });
}
