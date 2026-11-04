import { DEFAULT_MODE, I18N, ITEM_EFFECTIVE_STATS_SETTING, MODES } from "./domain/index.mjs";

/**
 * World setting. The lifecycle registers it on "init" for every system, so it always exists.
 * @type {import("../../kernel/feature.mjs").SettingSpec}
 */
export const SETTING_SPEC = {
  key: ITEM_EFFECTIVE_STATS_SETTING,
  name: `${I18N}.Setting.Name`,
  hint: `${I18N}.Setting.Hint`,
  scope: "world",
  type: String,
  choices: Object.fromEntries(MODES.map((m) => [m, `${I18N}.Setting.${m}`])),
  default: DEFAULT_MODE,
  // Derived data only changes on a new preparation: a reload prepares every document again.
  requiresReload: true
};
