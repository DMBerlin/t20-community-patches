/**
 * Initiative ties broken by the Initiative skill (tormenta20 1.6.5, Foundry v14).
 *
 * Bug: the system leaves the turn order to the core, which breaks initiative ties by combatant id
 * (Combat#_sortCombatants, core client/documents/combat.mjs:569-573). The book (p. 231) breaks them by the higher
 * skill value, and the order holds for the whole combat.
 *
 * Fix: when a combatant gets an initiative result, its Initiative skill value at that moment is saved in a flag of
 * the same write (preCreateCombatant/preUpdateCombatant), together with the value of the skill's key attribute
 * (Destreza by default). Ties between two numeric results are broken by the saved skill and then by the saved attribute,
 * so the order stays the same for the whole combat even if they change. A combatant without a saved value comes after
 * the ones with it; with equal values, or none on both sides, the core order (id) is kept.
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "initiative-tiebreak",
  group: "combat",
  issue: 53,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  probeKind: "behavior",
  sources: ["CombatT20#_sortCombatants"],
  isNeeded,
  install
};
