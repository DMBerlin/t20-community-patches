/**
 * Optional rule "Manobras de combate" (#48).
 *
 * Book rule (Tormenta20 Jogo do Ano, cap. 5, "Manobras de Combate", p. 234; "Atropelar", p. 233; size, p. 106): a
 * maneuver is a melee attack resolved as an opposed maneuver test, with the size modifier on both sides and its own
 * tie rule. The system has no maneuver at all (T20.tableSize.maneuver, T20:4082, is never read).
 *
 * Flow, without sockets and without writing other users' documents:
 * - the use dialog of a melee attack gets "Manobra": with a maneuver declared, the attack roll is the maneuver test,
 *   damage is not rolled and the maneuver card (B) replaces the system's attack card, with the target frozen when
 *   ItemT20#roll started; without a declaration, the system's attack card is untouched;
 * - B is created by the attacker and never updated; it has "Resistir" (and "Dar passagem");
 * - C (the result) is created by whoever resists, in a single ChatMessage.create. The state of B is derived from the
 *   results the current user can read, so a late or duplicate C converges on the next render.
 * With the concealment rule (#49) on, a failed miss chance d10 against the target (recorded in the attack roll) makes
 * the maneuver fail: B is born resolved, with no resistance test and no C.
 * B and C show a summary; clicking the title shows the details (per client, like the system's item cards).
 * The module never applies conditions: the card says which one applies and the GM uses the token HUD.
 */
import { COMBAT_MANEUVERS_SETTING } from "./domain/index.mjs";
import { install } from "./integration/index.mjs";

/** @type {import("../../kernel/feature.mjs").SettingSpec} */
const SETTING_SPEC = {
  key: COMBAT_MANEUVERS_SETTING,
  name: "T20CP.CombatManeuvers.Setting.Name",
  hint: "T20CP.CombatManeuvers.Setting.Hint",
  scope: "world",
  type: String,
  choices: { off: "T20CP.CombatManeuvers.Setting.off", on: "T20CP.CombatManeuvers.Setting.on" },
  default: "off"
};

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "combat-maneuvers",
  kind: "rule",
  group: "combat",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  // The concealment checks of the attack show on the maneuver card while that rule is on.
  interactsWith: ["concealment-miss-chance"],
  services: ["use-targets"],
  install: (ctx) => install(ctx)
};
