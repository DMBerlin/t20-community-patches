/**
 * Lethal or nonlethal attack choice (#74), part of the optional rule "Dano não letal" (#55).
 *
 * Book p. 236: using a weapon to deal nonlethal damage gives -5 on the attack test; unarmed attacks and certain
 * weapons deal nonlethal damage, and using them to deal lethal damage gives the same -5. Ataque Piedoso (p. 132),
 * Estilo Desarmado (p. 128) and Pão e Circo (p. 91) waive the penalty within their own limits.
 *
 * - Use dialog of weapons with attack and damage: a "Dano" line (Letal / Não letal), the weapon's natural type
 *   selected. The choice goes in the dialog options (FormDataExtended, T20:6806).
 * - ItemT20#rollAttack: the penalty goes in the formula of the per-use clone, with a label, like #59.
 * - ItemT20#rollDamage: the damage rolls record the choice; the chat toggle of #55 starts pressed from it.
 * - Shortcut without dialog: the natural type, no penalty.
 * - Only the per-use clone of ItemT20#roll (use-targets service): direct calls of rollAttack/rollDamage on a document
 *   keep the official behavior.
 * - Weapon sheet: the "Dano natural" field (Automático / Letal / Não letal).
 * Everything is gated by the "Dano não letal" setting, read on every use.
 */
import { install } from "./integration.mjs";

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "nonlethal-attack",
  kind: "rule",
  group: "combat",
  system: { id: "tormenta20" },
  after: ["situational-modifiers"],
  // Only acts while the nonlethal damage rule is on.
  interactsWith: ["nonlethal-damage"],
  services: ["use-targets"],
  install
};
