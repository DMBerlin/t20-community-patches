/**
 * Optional rule "Teste de resistência pelo card" (#58).
 *
 * The system prints "Reflexos reduz à metade (CD 21)" on the card of items with a saving throw, but nobody can roll
 * against it from the chat. When the rule is on, the item card records the save (skills, effects, DC) and the
 * tokens the user targeted. The card lists the targets with a roll button per skill; the owner of each target (the
 * GM for NPCs) rolls the system's skill test, the roll message stores the outcome and every client redraws the card.
 */
import { SAVE_BUTTON_SETTING } from "./domain.mjs";
import { install } from "./integration.mjs";

/** @type {import("../../kernel/feature.mjs").SettingSpec} */
const SETTING_SPEC = {
  key: SAVE_BUTTON_SETTING,
  name: "T20CP.SaveButton.Setting.Name",
  hint: "T20CP.SaveButton.Setting.Hint",
  scope: "world",
  type: String,
  choices: { off: "T20CP.SaveButton.Setting.off", on: "T20CP.SaveButton.Setting.on" },
  default: "on"
};

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "save-button",
  kind: "rule",
  group: "combat",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  services: ["use-targets"],
  install
};
