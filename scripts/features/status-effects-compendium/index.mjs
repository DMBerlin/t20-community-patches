/**
 * Empty condition list (tormenta20 1.6.5).
 *
 * Bug: prepareStatusesCompendium copies conditions from `tormenta20.efeitos` filtering by folder
 * "69zW3EVSgASXTmsp", which does not exist in the 1.6.5 pack (conditions live in "STATUSEFFECTS000").
 * `world.statuses` stays empty, CONFIG.statusEffects ends up empty and the routine throws before setting
 * specialStatusEffects and locking the pack.
 *
 * Fix: when the system copies an empty list into an empty `world.statuses`, the copy is replaced by the
 * conditions of the system pack, so the system's own routine builds CONFIG and locks the pack. Clients that
 * were connected during the repair rebuild CONFIG.statusEffects when the pack is filled.
 */
import { install, isNeeded, lateProbe } from "./integration.mjs";

export default {
  id: "status-effects-compendium",
  group: "conditions",
  issue: 1,
  guarded: true,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  probeKind: "behavior",
  sources: ["#local:hooks"],
  isNeeded,
  lateProbe,
  install
};
