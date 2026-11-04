/**
 * Upgrade and magic item data (tormenta20 1.6.5).
 *
 * Bug: several upgrades of the "tormenta20.efeitos" compendium do not follow the book. Guardião, Protetor,
 * Relampejante, Sombrio, Mitral (armor) and Incandescente are not transferred to the actor (and Incandescente has
 * no change); Gelo Eterno (weapon) uses the key "daon"; Gelo Eterno (armor) gives cold resistance 15 instead of
 * fire 5/10; Adamante (armor) gives DR 7 instead of 2/5; Invulnerável gives Defense instead of DR. The magic item
 * Manto da Resistência comes with its passive effect disabled. Rules that change the upgraded item itself are missing:
 * heavy armor of Mitral (up to 2) or Delicada (up to 1, instead of a flat +1 Defense) lets the wearer apply points of
 * the Defense attribute, and Mitral or Discreto items take –1 space (minimum 1).
 *
 * Fix: while an item effect is prepared, when its compendium source and every relevant field of its source data
 * match the known defect exactly, the prepared copy is corrected in memory (persisted data is never changed).
 * The item rules are applied in memory to the prepared item (`system.armadura.maxAtr`, `system.espacos`); an update
 * that only echoes those prepared values back (the item sheet submits every field) does not persist them.
 * A Manto da Resistência created straight from the compendium data is created with its effect enabled.
 */
import { install, isNeeded, lateProbe } from "./integration.mjs";

export default {
  id: "enchantment-data",
  group: "items",
  issue: 43,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  probeKind: "behavior",
  guarded: true,
  isNeeded,
  // The armor penalty of an enchantment follows armor-penalty-reduction when that patch is applied.
  interactsWith: ["armor-penalty-reduction"],
  lateProbe,
  install
};
