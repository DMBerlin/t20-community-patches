/**
 * Spell DC bonuses (tormenta20 1.6.5).
 *
 * Bug: Tormenta20ItemData#prepareFinalAttributes computes a character's save DC as 10 + half level + ability +
 * item bonus and ignores system.attributes.cd, the "CD de Magias" key shown in the sheet header. For NPCs it uses
 * system.attributes.cd and drops resistencia.bonus (item bonus and "cd" usage effects). Fortalecimento Arcano, a
 * passive +1 (+2 with 4th-circle spells) in the book, ships as a manual, repeatable usage effect.
 *
 * Fix: owned spells of characters use attributes.cd + ability + bonus; NPC items use attributes.cd + bonus.
 * Copies of Fortalecimento Arcano that still have the shipped usage effect become a single passive bonus on
 * attributes.cd, and their usage effects are no longer offered.
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "spell-dc-bonus",
  group: "items",
  issue: 35,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  probeKind: "behavior",
  sources: ["Tormenta20ItemData#prepareFinalAttributes", "CharacterData#prepareBaseData"],
  isNeeded,
  install
};
