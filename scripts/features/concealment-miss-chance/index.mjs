/**
 * Optional rule "Chance de falha por camuflagem" (#49).
 *
 * Book rule (Tormenta20 Jogo do Ano, cap. 5, "Situações Especiais", p. 238-239): light concealment gives a 20% miss
 * chance and total concealment 50%, rolled on 1d10 with the attack's d20 (1-2 or 1-5 miss, whatever the attack test).
 * Blind gives total concealment to every target of the character's attacks (p. 394) and an Invisible character has
 * total concealment (p. 195). The system rolls no miss chance at all. This rule adds a dialog field, rolls the d10 for
 * each target marked when the use started, records it in the attack roll, cancels the critical when every target was
 * missed, and shows the result on the chat card.
 */
import { CONCEALMENT_SETTING } from "../../lib/concealment.mjs";
import { install } from "./integration.mjs";

/**
 * World setting. The lifecycle registers it on "init" for every system, so it always exists.
 * @type {import("../../kernel/feature.mjs").SettingSpec}
 */
const SETTING_SPEC = {
  key: CONCEALMENT_SETTING,
  name: "T20CP.Concealment.Setting.Name",
  hint: "T20CP.Concealment.Setting.Hint",
  scope: "world",
  type: String,
  choices: { off: "T20CP.Concealment.Setting.off", on: "T20CP.Concealment.Setting.on" },
  default: "off"
};

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "concealment-miss-chance",
  kind: "rule",
  group: "combat",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  services: ["use-targets", "attack-outcome"],
  install
};
