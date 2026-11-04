/**
 * "Padrão" damage attribute.
 *
 * Bug (tormenta20 1.6.6): ItemT20#rollDamage only resolves the "Padrão" damage attribute (`padrao`) for light or
 * agile weapons at index 1 (T20:7963-7982). Anywhere else `padrao` reaches the Roll as a string and
 * Roll#evaluate throws "Unresolved StringTerm padrao requested for evaluation": a new weapon (created with
 * "Padrão") that is not light or agile cannot roll damage. 1.6.5 resolved every `padrao` part.
 *
 * Fix: while the system computes the damage, each `padrao` part the system will not resolve is replaced with the
 * 1.6.5 attribute (fired: Des with Estilo de Disparo or nothing; thrown: Des with Acuidade and Des > For, else For;
 * melee and other items: For). Parts the system resolves itself, explicit attributes and stored data are untouched.
 */
import { ROLL_DAMAGE } from "./domain.mjs";
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "default-damage-attribute",
  group: "items",
  issue: 77,
  system: { id: "tormenta20", affected: { minimum: "1.6.6", maximum: "1.6.6" } },
  sources: [ROLL_DAMAGE],
  isNeeded,
  install
};
