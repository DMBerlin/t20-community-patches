/**
 * Save bonuses of "skills except attacks" (tormenta20 1.6.5).
 *
 * Bug: CreatureData#prepareSkill (T20:18676-18713) chooses the actor-wide skill bonus with an else-if chain: a save
 * (Fortitude, Reflexos, Vontade) that has "Testes de Perícias de Resistências" bonuses never receives the "Testes de
 * Perícias, exceto de Ataque" (semataque) bonuses. Without a save bonus, it does. The sheet breakdown lists both, and
 * the roll uses the prepared value, so the sheet, the breakdown and the roll disagree.
 *
 * Fix: when a save has both kinds of bonus, "@semataque" is appended to the save's own bonus list for the duration of
 * the system's call (and removed afterwards), so the term enters the system's formula before its integer conversion,
 * as in any other skill; no roll data variable is redefined. Only the saves the probe still finds buggy are touched,
 * so a partial fix upstream is never doubled. semataque bonuses with dice are left alone.
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "save-skill-bonus",
  group: "actor",
  issue: 39,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  probeKind: "behavior",
  sources: ["CreatureData#prepareSkill", "ActorT20#getRollData"],
  isNeeded,
  install
};
