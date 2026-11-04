/**
 * Optional rule "Ataque contra Defesa" (#42).
 *
 * Book rule (Tormenta20 Jogo do Ano, p. 230-231): an attack hits when the result is equal to or higher than the
 * target's Defense, and a critical hit needs a hit. Natural 20 always succeeds and natural 1 always fails (p. 221).
 * Prone gives +5 Defense against ranged attacks (p. 394). The system never compares the attack with a Defense and
 * multiplies the weapon damage on a threat even when the attack misses (T20:9093, T20:9116). This rule records, in
 * the attack roll, the result against each target the user marked when the use started, cancels the critical when
 * every target was missed, and shows the result on the chat card.
 */
import { ATTACK_VS_DEFENSE_SETTING, ATTACK_VS_DEFENSE_VISIBILITY_SETTING, VISIBILITY_MODES } from "./domain.mjs";
import { install } from "./integration.mjs";

/**
 * World settings. The lifecycle registers them on "init" for every system, so they always exist.
 * @type {import("../../kernel/feature.mjs").SettingSpec}
 */
const SETTING_SPEC = {
  key: ATTACK_VS_DEFENSE_SETTING,
  name: "T20CP.AttackVsDefense.Setting.Name",
  hint: "T20CP.AttackVsDefense.Setting.Hint",
  scope: "world",
  type: String,
  choices: { off: "T20CP.AttackVsDefense.Setting.off", on: "T20CP.AttackVsDefense.Setting.on" },
  default: "off"
};

/** Changing it redraws the displayed cards (ctx.onSettingChange, in install). @type {import("../../kernel/feature.mjs").SettingSpec} */
const VISIBILITY_SPEC = {
  key: ATTACK_VS_DEFENSE_VISIBILITY_SETTING,
  name: "T20CP.AttackVsDefense.Visibility.Name",
  hint: "T20CP.AttackVsDefense.Visibility.Hint",
  scope: "world",
  type: String,
  choices: Object.fromEntries(VISIBILITY_MODES.map((m) => [m, `T20CP.AttackVsDefense.Visibility.${m}`])),
  default: "show"
};

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "attack-vs-defense",
  kind: "rule",
  group: "combat",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC, VISIBILITY_SPEC],
  services: ["use-targets", "attack-outcome"],
  install
};
