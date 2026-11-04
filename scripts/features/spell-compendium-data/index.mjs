/**
 * Spell usage effects whose compendium data diverges from the core rulebook (tormenta20 1.6.5).
 *
 * Bug: in `tormenta20.magias`, 18 usage effects carry wrong data: the Curar Ferimentos cantrip keeps the 2d8+2
 * healing roll, Sono moves the target change to the wrong enhancement, the Raio do Enfraquecimento cantrip offers
 * Exausto while its +5 PM enhancement does nothing, Arma Mágica's "+2d6" costs 5 PM, and 12 enhancements have
 * the "multiple applications" flag (`abilityUse.aumenta`) swapped.
 *
 * Fix: in memory only, while each effect is prepared. An effect is corrected only when its id and its whole
 * source (description, usage settings and changes, field by field) still match the buggy data. Nothing is saved;
 * edited or upstream-fixed effects are left untouched.
 */
import { install, isNeeded, lateProbe } from "./integration.mjs";

export default {
  id: "spell-compendium-data",
  group: "items",
  issue: 32,
  guarded: true,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  probeKind: "behavior",
  isNeeded,
  lateProbe,
  install
};
