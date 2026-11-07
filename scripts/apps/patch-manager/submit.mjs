/**
 * Saving the Center (#89): validates the changed settings, confirms the patches forced on and the rules a profile
 * changes (#96), writes the changes and offers the world reload when they need one.
 */
import { needsReload } from "../../kernel/center.mjs";
import { CUSTOM, PROFILE_SETTING, profileDiff, profileWrites, readProfileValues, saveProfile } from "../../kernel/profiles.mjs";
import { trapFocus } from "./focus.mjs";

/** @type {import("../../kernel/profiles.mjs").RuleProfiles} */
const NO_PROFILES = Object.freeze({ values: {}, neutral: null, recommended: null });

/**
 * @param {import("../../platform/foundry.mjs").Platform} platform
 * @param {{catalog?: import("../../kernel/profiles.mjs").RuleProfiles, entry?: (key: string) => object|undefined}} [deps]
 *   entry: the registered setting of a key.
 */
export function createSubmitFlow(platform, { catalog = NO_PROFILES, entry = () => undefined } = {}) {
  const { localize } = platform.i18n;
  const profiles = catalog.values;
  const exclusive = catalog.exclusive ?? ((task) => task());

  /**
   * Asks to confirm a list. Waits for the dialog to close when the answer is no.
   * @param {string} title  i18n key.
   * @param {string} intro  Already localized text.
   * @param {string[]} items  Plain text, escaped here.
   * @returns {Promise<boolean>}
   */
  async function confirmList(title, intro, items) {
    const list = items.map((item) => `<li>${platform.utils.escapeHTML(item)}</li>`);
    let shown = null;
    const confirmed = await platform.dice.DialogV2.confirm({
      window: { title: localize(title) },
      content: `<p>${platform.utils.escapeHTML(intro)}</p><ul>${list.join("")}</ul>`,
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

  /** @param {{id: string}[]} forced */
  const confirmForced = (forced) =>
    confirmList("T20CP.Manager.ForceTitle", localize("T20CP.Manager.ForceContent"), forced.map((p) => localize(`T20CP.Patches.${p.id}.Name`)));

  /** The label of a setting value: its localized choice, or the value itself. */
  function valueLabel(setting, value) {
    const choice = setting?.choices?.[value];
    return choice === undefined ? String(value) : localize(choice);
  }

  /**
   * Asks to confirm the saved rules a profile changes, as "rule: from → to".
   * @param {string} target
   * @param {{key: string, from: unknown, to: unknown}[]} diff
   */
  function confirmProfile(target, diff) {
    const items = diff.map(({ key, from, to }) => {
      const setting = entry(key);
      return `${localize(setting?.name ?? key)}: ${valueLabel(setting, from)} → ${valueLabel(setting, to)}`;
    });
    const intro = platform.i18n.format("T20CP.Profiles.ConfirmContent", { profile: localize(`T20CP.Profiles.${target}.Name`) });
    return confirmList("T20CP.Profiles.ConfirmTitle", intro, items);
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

  /** Writes the changed settings and the profile ("custom first", kernel/profiles.mjs), then the changed patch modes. */
  async function save(patches, writes, target) {
    if (target === null) for (const { key, value } of writes) await platform.settings.set(key, value);
    else await saveProfile({ settings: platform.settings, profiles, target, writes });
    if (!patches.length) return;
    const next = { ...(platform.settings.get("patches") ?? {}) };
    for (const { id, mode } of patches) next[id] = mode;
    await platform.settings.set("patches", next);
  }

  /**
   * What saving writes. Without a selector (target null), the changes of the form; with one, also every saved value
   * the selected profile changes, compared with the world and not with the form.
   * @param {string|null} target  The selected profile.
   * @param {{key: string}[]} settings  The changes of the form.
   */
  function plan(target, settings) {
    if (target === null) return { writes: settings, diff: [], profileChanged: false };
    const values = readProfileValues(platform.settings.get, profiles);
    const writes = profileWrites({ profiles, target, values, changes: settings }).map((w) => ({
      ...w,
      requiresReload: w.requiresReload ?? !!entry(w.key)?.requiresReload
    }));
    const stored = platform.settings.get(PROFILE_SETTING) ?? CUSTOM;
    return { writes, diff: profileDiff(profiles, target, values), profileChanged: stored !== target };
  }

  /** Whether two profile diffs list the same changes. */
  const sameDiff = (a, b) =>
    a.length === b.length && a.every((d, i) => d.key === b[i].key && d.from === b[i].from && d.to === b[i].to);

  const focusSave = (app) => app.element?.querySelector('footer button[type="submit"]')?.focus();

  /**
   * @param {object} app  The PatchManager.
   * @param {{patches: {id: string, mode: string}[], settings: object[]}} changes  rows.mjs collectChanges.
   * @param {string|null} [target]  The profile selected in the form; null without a selector.
   */
  async function submit(app, { patches, settings }, target = null) {
    let current = plan(target, settings);
    if (!patches.length && !current.writes.length && !current.profileChanged) return app.close();
    validate(settings);

    const forced = patches.filter((p) => p.mode === "force");
    if (forced.length && !(await confirmForced(forced))) return focusSave(app);

    // The world may change while a dialog is open: plan again right before saving, and confirm again when the rules
    // the profile changes are no longer the ones confirmed.
    let confirmed = [];
    let saved = null;
    while (!saved) {
      if (current.diff.length && !sameDiff(current.diff, confirmed) && !(await confirmProfile(target, current.diff))) {
        return focusSave(app);
      }
      confirmed = current.diff;
      saved = await exclusive(async () => {
        current = plan(target, settings);
        if (!sameDiff(current.diff, confirmed)) return null;
        await save(patches, current.writes, target);
        return current;
      });
    }
    await app.close();
    if (needsReload(patches.map((p) => p.id), saved.writes)) await confirmReload();
  }

  return Object.freeze({ submit });
}
