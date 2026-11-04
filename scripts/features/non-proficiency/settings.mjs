import { NON_PROFICIENCY_SETTING } from "./domain/index.mjs";

/**
 * World setting. The lifecycle registers it on "init" for every system, so it always exists. Changing it prepares the
 * actors again and repeats the unrecognized-code warning (ctx.onSettingChange, in the install).
 * @type {import("../../kernel/feature.mjs").SettingSpec}
 */
export const SETTING_SPEC = {
  key: NON_PROFICIENCY_SETTING,
  name: "T20CP.NonProficiency.Setting.Name",
  hint: "T20CP.NonProficiency.Setting.Hint",
  scope: "world",
  type: String,
  choices: { off: "T20CP.NonProficiency.Setting.off", on: "T20CP.NonProficiency.Setting.on" },
  default: "off"
};
