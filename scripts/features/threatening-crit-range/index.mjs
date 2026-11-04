/**
 * Threatening critical range (tormenta20 1.6.5).
 *
 * Bug: the Ameaçadora enchantment stores "criticoM multiply 2". criticoM is the lowest d20 result that threatens a
 * critical hit, but applyItemChanges multiplies it as a plain number (19 -> 38), so the weapon never crits, not even
 * on a natural 20.
 *
 * Fix: in the rolled weapon's own usage effects, "criticoM multiply v" becomes "criticoM add -(21 - M)(v - 1)",
 * where M is the weapon's base criticoM. The threat range doubles (19 -> 17) and, since additions commute, the
 * doubling counts before any increase whatever the order of the usage effects (Tormenta20 JdA, p. 335).
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "threatening-crit-range",
  group: "items",
  issue: 30,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  sources: ["#local:applyItemChanges"],
  isNeeded,
  install
};
