/**
 * Ongoing damage of Em Chamas / Sangrando (tormenta20 1.6.5).
 *
 * Bug: both conditions store their per-turn damage in a "dano" change (1d6[fogo] / 1d6[perda]), but
 * CombatT20#_manageDOTEffects (through ActiveEffectT20#isOngoingDamage) only rolls "danoContinuo" changes, so the
 * damage is never rolled. Sangrando also lacks the Constitution test (DC 15) that ends the condition.
 *
 * Fix: after the system's own routine, the start of the turn also handles these two conditions when no copy of the
 * condition is already rolled by the system. Em Chamas rolls the damage like the system does; Sangrando first rolls
 * the system's Constitution test: success removes the condition, failure rolls the loss. Turn starts of the same actor
 * run one after the other. No data is changed.
 */
import { MANAGE_DOT, install, isNeeded, lateProbe } from "./integration.mjs";

export default {
  id: "ongoing-damage-conditions",
  group: "conditions",
  issue: 45,
  guarded: true,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  sources: [MANAGE_DOT, "ActiveEffectT20#isOngoingDamage"],
  isNeeded,
  lateProbe,
  install
};
