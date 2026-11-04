/**
 * Agile weapons (Ágil) and Acuidade com Arma.
 *
 * Bug (tormenta20 1.6.5): the rule that lets Acuidade com Arma (or the optional rule "Armas Leves e Ágeis") use
 * Dexterity instead of Strength only checks `empunhadura === "leve"`, in ItemT20#getAttackToHit (attack) and
 * ItemT20#rollDamage (damage with the "Padrão" attribute). Agile weapons (`propriedades.agi`: chicote, cimitarra,
 * corrente de espinhos, florete, katana) keep using Strength, although the book says they "can be used with
 * Acuidade com Arma, even if they are not light weapons".
 *
 * Fix: while the system computes the attack or the damage of an agile melee weapon that meets the system's own
 * condition (Acuidade or the optional rule, and Des > For), the default attribute is temporarily filled with
 * Dexterity, exactly as the system already does for light weapons. Explicit attributes, ranged weapons, light
 * weapons and stored data are untouched.
 *
 * Probe: tormenta20 1.6.6 fixed the bug (`isFinesse`, T20:6999 and T20:7968). isNeeded() calls the system's
 * original methods with a fake agile weapon and a light control, and reads the attribute they pick. It only runs code
 * it recognizes (1.6.5 or 1.6.6); otherwise, or when the probe is inconclusive, the source diagnosis is the fallback.
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "finesse-agile-weapons",
  group: "items",
  issue: 44,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  probeKind: "behavior",
  sources: ["ItemT20#getAttackToHit", "ItemT20#rollDamage"],
  isNeeded,
  install
};
