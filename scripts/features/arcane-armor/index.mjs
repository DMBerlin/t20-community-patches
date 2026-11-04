/**
 * Optional rule "Magia arcana de armadura" (#46).
 *
 * Book (Tormenta20 Jogo do Ano, chapter 4, "Armaduras e Magia Arcana", p. 171; Misticismo, p. 121): casting an arcane
 * spell while wearing armor requires a Misticismo test (DC 20 + the spell's PM cost) with the armor penalty. On a
 * failure the spell does not work, but the PM are spent. The system never checks it: ItemT20#roll (T20:8543) spends the
 * PM (T20:8669, without await) and always calls displayCard (T20:8724).
 *
 * This rule wraps ItemT20#displayCard: on a real cast (isCastUse) of an arcane spell by a character in armor, it rolls
 * the test after the system started spending the PM and before the card. A failure posts only the test message, marks
 * the cast as failed on the use's options (cast-outcome.mjs) and returns null, like the system when a use does not
 * happen. Skill training follows the shared contract of #62 (skill-training.mjs); the cost of a training grant
 * (Eclético) is charged in the actor's turn of the mana queue, after the spell's own spend.
 */
import { ARCANE_ARMOR_SETTING } from "./domain.mjs";
import { install } from "./integration.mjs";

/**
 * World setting. The lifecycle registers it on "init" for every system, so it always exists.
 * @type {import("../../kernel/feature.mjs").SettingSpec}
 */
const SETTING_SPEC = {
  key: ARCANE_ARMOR_SETTING,
  name: "T20CP.ArcaneArmor.Setting.Name",
  hint: "T20CP.ArcaneArmor.Setting.Hint",
  scope: "world",
  type: String,
  choices: { off: "T20CP.ArcaneArmor.Setting.off", roll: "T20CP.ArcaneArmor.Setting.roll" },
  default: "off"
};

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "arcane-armor",
  kind: "rule",
  group: "usage-effects",
  system: { id: "tormenta20" },
  // The wrappers keep their historical owner (api.wraps(), wrap-order snapshot).
  wrapOwner: "arcane-armor-casting",
  settings: [SETTING_SPEC],
  // Training ignores the usage effects suppressed-usage-effects hides, as rollPericia does with that patch.
  interactsWith: ["suppressed-usage-effects"],
  services: ["mana-queue"],
  install
};
