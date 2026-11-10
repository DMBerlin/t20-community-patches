/**
 * Initiative rolled from the actor sheet (tormenta20 1.6.5).
 *
 * Bug: ActorT20#rollPericia (T20:6413-6524) writes the Initiative total to the combat tracker in a local closure,
 * toInitiative (T20:6487-6502). It finds the combatant with `combatant.actor.id === actor.id`, but an unlinked
 * token's synthetic actor keeps the base actor's id, so with two tokens of the same creature in combat the roll of
 * token B goes to token A (or nowhere, if A already has initiative). It also only acts when the skill label is the
 * Portuguese "Iniciativa", so a renamed or translated label writes nothing (in 1.6.5 the system maps "en" to
 * lang/pt-BR.json, so the language setting alone keeps "Iniciativa").
 *
 * Fix: the closure cannot be wrapped. rollPericia is wrapped: while any skill roll is in flight, the
 * Combat#setInitiative call made from the toInitiative frame (read from the call stack, so a macro's call goes through)
 * is suppressed, and after the "inic" chat card is created its total is written to the
 * combatants of this token (or of this actor, when linked) that have no initiative yet, as core
 * Actor#rollInitiative selects them.
 */
import { ROLL_PERICIA } from "./domain.mjs";
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "sheet-initiative-token",
  group: "actor",
  issue: 67,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  sources: [ROLL_PERICIA],
  isNeeded,
  install
};
