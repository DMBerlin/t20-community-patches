/**
 * Optional rule "Dano não letal" (#55).
 *
 * Book p. 236: nonlethal damage counts to fall unconscious, but not to start bleeding or to die, and healing recovers
 * the HP lost to nonlethal damage first. The system has no nonlethal damage at all.
 *
 * Storage: pv.value keeps the current HP, already including the nonlethal loss, so the token bar and every other
 * automation keep reading "unconscious at 0 HP or less". The nonlethal HP (N) live in an actor flag, written in the
 * same update as the HP. Lethal HP = pv.value + effective N.
 *
 * - Chat: a "Não letal" toggle next to the system's apply buttons of each damage roll. While pressed, 1x, 2x and ½
 *   call the system's own applyDamageV2/applyDamage with a per-call Proxy as `this`: the update carries the intent in
 *   its options and pv.min reads -Infinity, so the nonlethal loss is never cut by the floor.
 * - preUpdateActor: on every HP change (card, token bar, rest, sheet, unlinked tokens), healing consumes N first and
 *   a nonlethal loss is added to N. Healing consumes N even while the rule is off, so the counter never goes stale.
 * - prepareDerivedData: the floor applies to lethal HP only (min base − N).
 * - Sheet: a "Não letal" field under the HP.
 * - The toggle starts pressed when the damage roll recorded a nonlethal choice (#74, nonlethal-attack).
 *
 * The lethal HP contract (#51: lethalSnapshot, rebaseSnapshot, hpSnapshotOf, nonlethalOf, touchesLethalHp) lives in
 * lib/nonlethal.mjs; the other rules read this rule's mode through ctx.features.
 */
import { NONLETHAL_SETTING } from "../../lib/nonlethal.mjs";
import { install } from "./integration.mjs";

/**
 * World setting. The lifecycle registers it on "init" for every system, so it always exists. Its changes are
 * handled by install (ctx.onSettingChange): the chat toggles follow the mode and the actors are prepared again.
 * @type {import("../../kernel/feature.mjs").SettingSpec}
 */
const SETTING_SPEC = {
  key: NONLETHAL_SETTING,
  name: "T20CP.NonlethalDamage.Setting.Name",
  hint: "T20CP.NonlethalDamage.Setting.Hint",
  scope: "world",
  type: String,
  choices: { off: "T20CP.NonlethalDamage.Setting.off", on: "T20CP.NonlethalDamage.Setting.on" },
  default: "off"
};

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "nonlethal-damage",
  kind: "rule",
  group: "combat",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  after: ["death-threshold"],
  install
};
