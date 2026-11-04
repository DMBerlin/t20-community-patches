/**
 * Bug: tormenta20.parceiros "Combatente" usage effects give attack +1/+2/+3; the core rulebook (p. 261) and the item
 * description give +2/+3/+4 (Iniciante/Veterano/Mestre).
 * Fix: in ItemT20#_preCreate (and in Actor#_preCreate for the items of a new actor, whose own _preCreate the core does
 * not call), before the system code, correct each of the three effects on its own, only when the copy comes from the
 * known entry and that effect is still exactly the 1.6.5 effect. Copies created before stay as they are and are marked
 * on the actor sheet.
 */
import { PATCH_ID } from "./domain.mjs";
import { install, isNeeded, lateProbe } from "./integration.mjs";

export default {
  id: PATCH_ID,
  group: "items",
  issue: 56,
  guarded: true,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  probeKind: "behavior",
  isNeeded,
  lateProbe,
  install
};
