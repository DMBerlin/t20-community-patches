/**
 * Sustained spell cost (tormenta20 1.6.5).
 *
 * Bug: applyOnUseEffects gives every sustained effect of a chat card its own origin
 * (`<actor>.ActiveEffect.<randomID>`), and the active GM creates one "Sustentando" marker per origin. A spell with
 * several effects (Oração: bonus on allies, penalty on enemies) becomes several markers: the turn prompt charges
 * 1 MP per marker, and unchecking one deletes that half of the spell.
 *
 * Fix: before the card is created, every sustained effect of the same caster gets the origin of the first one, so a
 * cast has a single marker, named after the spell. The system's own cost and deletion logic then work per cast.
 */
import { ON_SUSTAIN, install, isNeeded } from "./integration.mjs";

export default {
  id: "sustained-spell-cost",
  group: "usage-effects",
  issue: 61,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  sources: [ON_SUSTAIN, "BaseEffect#_preCreate", "#local:applyOnUseEffects"],
  guarded: true,
  isNeeded,
  install
};
