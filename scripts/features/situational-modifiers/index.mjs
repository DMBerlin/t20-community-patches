/**
 * Optional rule "Modificadores situacionais" (#59).
 *
 * Book rule (Tormenta20 Jogo do Ano, cap. 5): Table 5-3 (p. 239), "Investida" (p. 235) and "Ataque à distância"
 * (p. 233). The system applies none of these modifiers. With the rule on, the use dialog of items with an attack roll
 * gets a "Situação de combate" section:
 * - attack modifiers go into the formula of the per-use clone, with a label, like the dialog's own bonus (T20:8592);
 * - Defense adjustments are per target and never touch the formula: they are registered in the shared use context
 *   (defenseAdjustmentsFor, read by attack-vs-defense) and recorded in the roll, so the card can show them as a note;
 * - a charge gives the attacker a -2 Defense effect, which the table removes by hand.
 */
import { SITUATIONAL_SETTING } from "./domain.mjs";
import { install } from "./integration.mjs";

/**
 * World setting. The lifecycle registers it on "init" for every system, so it always exists.
 * @type {import("../../kernel/feature.mjs").SettingSpec}
 */
const SETTING_SPEC = {
  key: SITUATIONAL_SETTING,
  name: "T20CP.SituationalModifiers.Setting.Name",
  hint: "T20CP.SituationalModifiers.Setting.Hint",
  scope: "world",
  type: String,
  choices: { off: "T20CP.SituationalModifiers.Setting.off", on: "T20CP.SituationalModifiers.Setting.on" },
  default: "off"
};

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "situational-modifiers",
  kind: "rule",
  group: "combat",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  services: ["use-targets"],
  install
};
