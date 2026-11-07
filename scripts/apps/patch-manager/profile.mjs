/**
 * Profile selector of the Center's "Optional rules" tab (#96). Choosing a ready-made profile previews its values in
 * the form (nothing is saved before Save); changing any rule afterwards switches the selector to "custom". The
 * profiles come in by parameter (scripts/platform/manager-menu.mjs); this file reads nothing global.
 */
import { CUSTOM, PROFILE_SETTING, profileIds, profileKeys, profileValues } from "../../kernel/profiles.mjs";
import { SETTING_INPUT, settingField } from "./rows.mjs";
import { ruleBucket } from "./view.mjs";

/** Name of the selector. It is not a setting input, so collectChanges ignores it. */
export const PROFILE_INPUT = "profile";

/** @type {import("../../kernel/profiles.mjs").RuleProfiles} */
const NO_PROFILES = Object.freeze({ values: {}, neutral: null, recommended: null });

/**
 * Options of the selector, with the recommended profile marked.
 * @param {import("../../kernel/profiles.mjs").RuleProfiles} catalog
 * @param {string} current
 * @param {(key: string) => string} localize
 */
export function profileOptions({ values, recommended }, current, localize) {
  return profileIds(values).map((id) => {
    const name = localize(`T20CP.Profiles.${id}.Name`);
    return {
      id,
      label: id === recommended ? `${name} ${localize("T20CP.Profiles.Recommended")}` : name,
      hint: localize(`T20CP.Profiles.${id}.Hint`),
      selected: id === current
    };
  });
}

/**
 * Sets a control to a value: a checkbox is checked, any other control (select, input, range-picker) takes the value.
 * Setting it in code fires no "change", so a preview never counts as an edit.
 * @param {HTMLElement} control
 * @param {unknown} value
 */
export function setControl(control, value) {
  if (control.type === "checkbox") control.checked = !!value;
  else control.value = String(value);
}

/**
 * @param {object} deps
 * @param {import("../../platform/foundry.mjs").Platform} deps.platform
 * @param {import("../../kernel/profiles.mjs").RuleProfiles} [deps.catalog]
 * @param {(key: string) => object|undefined} deps.entry  The registered setting of a key.
 */
export function createProfileController({ platform, catalog = NO_PROFILES, entry }) {
  const { localize } = platform.i18n;
  const neutral = profileValues(catalog.values, catalog.neutral) ?? {};
  const enabled = Object.keys(catalog.values).length > 0;
  const keys = new Set(profileKeys(catalog.values));

  /** The saved profile; "custom" when the setting is missing. */
  function stored() {
    try {
      return platform.settings.get(PROFILE_SETTING) ?? CUSTOM;
    } catch {
      return CUSTOM;
    }
  }

  /** What the template shows, or null without profiles. */
  function context() {
    if (!enabled) return null;
    const current = stored();
    const options = profileOptions(catalog, current, localize);
    return { options, hint: options.find((o) => o.selected)?.hint ?? "" };
  }

  /** @param {HTMLElement} root */
  const selector = (root) => root.querySelector(`select[name="${PROFILE_INPUT}"]`);

  /** The profile selected in the form; the saved one when there is no selector. */
  function selected(root) {
    return selector(root)?.value ?? stored();
  }

  /** Values of the rule controls in the form, cleaned like a submit. */
  function formValues(root) {
    const submitted = platform.forms.data(root);
    const values = {};
    for (const [name, raw] of Object.entries(submitted)) {
      if (!name.startsWith(SETTING_INPUT)) continue;
      const key = name.slice(SETTING_INPUT.length);
      const setting = entry(key);
      if (setting) values[key] = settingField(setting, platform.core.fields).clean(raw);
    }
    return values;
  }

  /** Recomputes the "on"/"off" bucket of each rule row from the form. */
  function refreshBuckets(root) {
    const values = formValues(root);
    for (const row of root.querySelectorAll(".t20cp-rules .t20cp-row[data-keys]")) {
      const keys = row.dataset.keys.split(" ").filter((key) => key in values);
      if (keys.length) row.dataset.bucket = ruleBucket(keys.map((k) => values[k]), neutralOf(keys));
    }
  }

  /** The neutral values of some keys, or undefined when one of them has none. */
  function neutralOf(keys) {
    return keys.every((key) => Object.hasOwn(neutral, key)) ? keys.map((key) => neutral[key]) : undefined;
  }

  function showHint(root, id) {
    const hint = root.querySelector(".t20cp-profile-hint");
    if (hint) hint.textContent = localize(`T20CP.Profiles.${id}.Hint`);
  }

  /** Fills the rule controls with a ready-made profile. */
  function preview(root, id) {
    for (const [key, value] of Object.entries(profileValues(catalog.values, id) ?? {})) {
      const control = root.querySelector(`[name="${SETTING_INPUT}${key}"]`);
      if (control) setControl(control, value);
    }
  }

  /**
   * Handles a change in the form: the selector previews its profile; a rule control switches a ready-made profile
   * to "custom" and announces it; other settings never do. Returns whether the rule rows need refreshing.
   * @param {HTMLElement} root
   * @param {EventTarget} target
   */
  function onChange(root, target) {
    const select = selector(root);
    if (!select) return false;
    if (target === select) {
      if (select.value !== CUSTOM) preview(root, select.value);
      showHint(root, select.value);
      refreshBuckets(root);
      return true;
    }
    if (!target?.name?.startsWith(SETTING_INPUT)) return false;
    refreshBuckets(root);
    // Settings of patches shown in the tab (segmentedSceneMaxSegments) belong to no profile.
    if (select.value === CUSTOM || !keys.has(target.name.slice(SETTING_INPUT.length))) return true;
    select.value = CUSTOM;
    showHint(root, CUSTOM);
    const live = root.querySelector(".t20cp-profile-live");
    if (live) live.textContent = localize("T20CP.Profiles.SwitchedToCustom");
    return true;
  }

  return Object.freeze({ context, selected, stored, onChange, neutralOf, enabled });
}
