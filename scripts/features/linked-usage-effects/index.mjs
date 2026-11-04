/**
 * Linked usage effects (tormenta20 1.6.5).
 *
 * Bug: an "efeito" usage change only finds its target among the rolled item's effects; the fallback reads
 * `ef.parent.items` (the parent is an Item in v14) and matches by name, while Arte Mágica/Esgrima Mágica keep the
 * linked text in the target's description. addToChange also dumps "efeito"/"condicao" changes into the main effect.
 *
 * Fix: the single matching effect of the usage effect's own item is injected (as an isolated, disabled clone named
 * after the change value) into the rolled item's clone, and "efeito"/"condicao" are not appended to own effects.
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "linked-usage-effects",
  group: "usage-effects",
  issue: 24,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  sources: ["#local:applyEffectChanges", "#local:applyOnUseEffects"],
  isNeeded,
  install
};
