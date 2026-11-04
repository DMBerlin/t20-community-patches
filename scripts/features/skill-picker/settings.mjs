import { SKILL_PICKER_SETTING } from "./domain.mjs";

/**
 * World setting. The lifecycle registers it on "init" for every system, so it always exists.
 * @type {import("../../kernel/feature.mjs").SettingSpec}
 */
export const SETTING_SPEC = {
  key: SKILL_PICKER_SETTING,
  name: "T20CP.SkillPicker.Setting.Name",
  hint: "T20CP.SkillPicker.Setting.Hint",
  scope: "world",
  type: String,
  choices: { off: "T20CP.SkillPicker.Setting.off", on: "T20CP.SkillPicker.Setting.on" },
  default: "off"
};
