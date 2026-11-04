/**
 * Bug: tormenta20.racas and tormenta20.poderes diverge from the core rulebook (Tormenta20 JdA):
 *  - Minotauro gives Des +1 instead of Con +1 (p. 25);
 *  - Hynne "Pequeno e Rechonchudo" lacks size Small and the 6m speed (p. 28);
 *  - Anão "Conhecimento das Rochas" lacks darkvision (p. 20);
 *  - Elfo "Sentidos Élficos" lacks low-light vision (p. 22).
 * Fix: in ItemT20#_preCreate (and in Actor#_preCreate for the items of a new actor, whose own _preCreate the core does
 * not call), before the system code, correct the copy when it comes from the known entry and its mechanical data is
 * still exactly the 1.6.5 data. Copies created before stay as they are and are marked on the actor sheet.
 */
import { PATCH_ID } from "./domain.mjs";
import { install, isNeeded, lateProbe } from "./integration.mjs";

export default {
  id: PATCH_ID,
  group: "items",
  issue: 57,
  guarded: true,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  probeKind: "behavior",
  isNeeded,
  lateProbe,
  install
};
