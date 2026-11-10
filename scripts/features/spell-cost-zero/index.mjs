/**
 * Spell PM cost dropped to zero by a false cantrip (tormenta20 1.6.5).
 *
 * Bug: applyOnUseEffects (module-local) marks the use as a cantrip when `!Number(custo + 1)` for any applied usage
 * effect of a spell. The test was written for the "Truque" text the dialog sends, but it also matches the number -1
 * (ItemT20#roll builds numbers for "Aplicar Sempre" effects when the dialog is skipped) and a missing cost (the dialog
 * template has no hidden cost input for effects with cost 0). The spell then costs 0 PM. The dialog also lets a
 * Truque be combined with other enhancements, which the rules forbid (Tormenta20 JdA, p. 171).
 *
 * Fix: the rolled spell's usage effects reach the system with a cost its test reads correctly (-1 becomes "-1", as
 * the dialog form already sends it), the dialog gets the missing hidden cost input (empty value), and a checked
 * Truque locks the other enhancements and shows a total of 0.
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "spell-cost-zero",
  group: "usage-effects",
  issue: 34,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  sources: ["ItemT20#_allApplicableOnUseEffects", "ItemT20#roll", "AbilityUseDialog#_onInputChange", "#local:applyOnUseEffects"],
  isNeeded,
  install
};
