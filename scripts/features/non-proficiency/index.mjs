/**
 * Optional rule "Penalidades por não proficiência" (#39).
 *
 * Book rules (Tormenta20 Jogo do Ano, ch. 3): attacking with a weapon without proficiency gives -5 on the attack
 * (p. 142); wearing armor or a shield without proficiency applies its armor penalty to every Strength and Dexterity
 * skill (p. 152). Everyone is proficient with simple weapons, light armor, unarmed attacks and natural weapons
 * (p. 32, 142). The system stores proficiencies (system.tracos.profArmas/profArmaduras) but never reads them, and
 * no class or power fills them, so the proficiencies are derived here (initial class, recognized powers, Traits tab)
 * on every use, without writing anything. Characters only: threats have no proficiencies recorded.
 *
 * Wrappers: ItemT20#getAttackToHit (attack), the character data model's prepareSkill (skills, T20:19829-19833) and
 * the fieldBonuses Handlebars helper (tooltip line). Their owner keeps the historical name "non-proficiency-penalties".
 */
import { install } from "./integration/index.mjs";
import { SETTING_SPEC } from "./settings.mjs";

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "non-proficiency",
  kind: "rule",
  group: "items",
  system: { id: "tormenta20" },
  wrapOwner: "non-proficiency-penalties",
  settings: [SETTING_SPEC],
  // The armor penalty follows armor-penalty-reduction when that patch is applied; the skill breakdown line belongs to
  // field-bonuses-breakdown when it is applied.
  interactsWith: ["armor-penalty-reduction", "field-bonuses-breakdown"],
  services: ["applied-changes"],
  install
};
