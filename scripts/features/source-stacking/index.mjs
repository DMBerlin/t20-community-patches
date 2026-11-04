/**
 * Optional rule "Bônus de itens e magias" (#28).
 *
 * By the book (chapter 5, "Acumulando Efeitos", p. 232), effects of items and spells stack with other sources, but
 * not among themselves: two spells, or two items, giving +1 Fortitude give +1. The armor exception lets the armor,
 * the shield and one other item add to Defense. The system adds everything.
 *
 * When the rule is on, for every statistic (change key) and inside each source (spells, items), only the greatest
 * bonus and the greatest penalty apply; the others are suppressed while the actor is prepared, never deleted.
 * Armor and shield Defense (and their upgrades) always add; among the other equipped items, only the one with the
 * greatest Defense counts. The user who caused a suppression is notified, and the sheet marks what is suppressed.
 * Turning the rule on or off prepares every actor again (ctx.onSettingChange, in the install).
 */
import { SOURCE_STACKING_SETTING } from "./domain.mjs";
import { install } from "./integration/index.mjs";

/**
 * World setting. The lifecycle registers it on "init" for every system, so it always exists.
 * @type {import("../../kernel/feature.mjs").SettingSpec}
 */
const SETTING_SPEC = {
  key: SOURCE_STACKING_SETTING,
  name: "T20CP.SourceStacking.Setting.Name",
  hint: "T20CP.SourceStacking.Setting.Hint",
  scope: "world",
  type: String,
  choices: { off: "T20CP.SourceStacking.Setting.off", on: "T20CP.SourceStacking.Setting.on" },
  default: "off"
};

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "source-stacking",
  kind: "rule",
  group: "sheet-effects",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  services: ["stacking-exclusions", "applied-changes"],
  install
};
