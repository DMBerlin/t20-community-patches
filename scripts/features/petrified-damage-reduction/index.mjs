/**
 * Petrificado damage reduction (tormenta20 1.6.5).
 *
 * Bug: the "Petrificado" condition sets system.tracos.resistencias.dano.value with type "downgrade" (min), which never
 * raises the damage reduction; and initial-phase changes on resistencias.<type>.value are overwritten anyway by
 * AttributesFields.prepareDamageResistances (value = base + bonus) during prepareDerivedData. Copies created on an
 * actor go through the system's migrateResistancesPath, which moves the key to .bonus but keeps "downgrade", a no-op
 * on that ArrayField.
 *
 * Fix: one Petrificado reduction counts per actor and preparation cycle, the greatest among the active copies
 * (conditions with the same effects do not stack, book p. 394). A legacy winner (.value or .bonus, downgrade/upgrade) is applied
 * as "add" on resistencias.dano.bonus, the path every other damage reduction effect of the system uses; native
 * contributions ("add" 8 on .bonus) that do not win are skipped in memory. The condition's reduction is kept out of the
 * optional source-stacking rule. Nothing is written to the documents.
 */
import { install, isNeeded, lateProbe } from "./integration.mjs";

export default {
  id: "petrified-damage-reduction",
  group: "conditions",
  issue: 63,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  probeKind: "behavior",
  sources: ["AttributesFields.prepareDamageResistances", "effectMigration.migrateResistancesPath"],
  services: ["stacking-exclusions"],
  isNeeded,
  lateProbe,
  install
};
