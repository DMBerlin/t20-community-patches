/**
 * Death threshold (minimum HP).
 *
 * Bug (tormenta20 1.6.5): the system sets the minimum HP to -floor(max / 2) (AttributesFields.preparePVPM for
 * characters, MenaceData#prepareDerivedData for threats). The core rulebook (p. 236) says a creature dies at -10
 * or at a negative value equal to half its maximum HP, whichever is lower, so creatures with less than 20 HP stop
 * above -10. Characters with manual HP configuration or without class levels, and "simple" actors, never get a
 * computed minimum and keep the stored value (0). Damage is clamped to pv.min (applyDamage, applyDamageV2).
 *
 * Fix: after each actor type prepares its derived data, pv.min is set to -max(10, floor(max / 2)). Nothing is
 * stored: pv.min is derived data.
 *
 * Setting "HP below the death threshold" (#51): independent of this patch's mode, damage may take actors covered by
 * the "Zero HP states" rule below pv.min, which then marks them Dead. Installed by the death-threshold-floor rule,
 * from lib/death-threshold.mjs, so the patch never imports the rule.
 */
import { NPC_DERIVED, install, isNeeded, lateProbe } from "./integration.mjs";

export default {
  id: "death-threshold",
  group: "conditions",
  issue: 29,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  sources: [
    NPC_DERIVED,
    "AttributesFields.preparePVPM",
    "CharacterData#prepareDerivedData",
    "SimpleData#prepareDerivedData",
    "CreatureData.schemaResources"
  ],
  isNeeded,
  lateProbe,
  install
};
