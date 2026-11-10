/**
 * Prone (Caído) Defense penalty (tormenta20 1.6.5).
 *
 * Bug: the Caído condition applies -5 to `system.attributes.defesa.outros` with the "downgrade" mode. That field is
 * the manual "Outros" Defense bonus typed on the character sheet, so the result is min(Outros, -5) instead of
 * Outros - 5: with Outros +3 the Defense drops 8, with Outros -5 or lower Caído does nothing.
 *
 * Fix: when the change is applied to an actor in the "initial" phase, it is passed on as "add". Only the most severe
 * Caído penalty of that phase counts, legacy ("downgrade") and fixed ("add") copies alike, so duplicated copies of
 * the condition do not stack (book, p. 394). Stored effects are never changed.
 */
import { install, isNeeded, lateProbe } from "./integration.mjs";

export default {
  id: "prone-defense",
  group: "conditions",
  issue: 40,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  probeKind: "behavior",
  guarded: true,
  // The breakdowns of field-bonuses-breakdown list the Caído copies left out.
  services: ["applied-changes"],
  isNeeded,
  lateProbe,
  install
};
