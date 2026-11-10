/**
 * Armor penalty reduction upgrades (Ajustada, Sob Medida, Mitral).
 *
 * Bug (tormenta20 1.6.5): these upgrades add to `system.attributes.defesa.pda`, a PenaltyField that always
 * casts values to negative numbers. Every change therefore INCREASES the penalty: a Full Plate (-5) with
 * Ajustada shows -6 instead of -4.
 *
 * Fix: changes from these upgrades are intercepted and, while the actor's derived data is prepared, the
 * penalty of the item that carries the upgrade is temporarily reduced (never above 0). The stored item data
 * and the item sheet stay untouched; only the actor's armor penalty (skills and rolls) is corrected.
 * Penalty increases (Reforçada, Sobrecarregado, custom effects) keep the system's behavior.
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "armor-penalty-reduction",
  group: "items",
  issue: 19,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  probeKind: "behavior",
  sources: ["PenaltyField#_cast", "CreatureData.schemaDefense", "AttributesFields.prepareDefense"],
  isNeeded,
  install
};
