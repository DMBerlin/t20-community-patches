/**
 * Effect lines of the sheet breakdowns (tormenta20 1.6.5).
 *
 * Bug: ActorT20#modifiedFields (T20:5776-5787), the list of effect changes the sheet breakdowns (`fieldBonuses`) show
 * per field, skips changes whose *value* is 3 or 4. The test was meant for the old Downgrade (3) and Upgrade (4)
 * modes; in Foundry 14 the mode is the change `type` ("downgrade", "upgrade"). So an effect that adds the number 3
 * or 4 (for example Defesa +3) disappears from the breakdown, whose total no longer matches the sheet, while
 * downgrade/upgrade changes are listed as if they were additions.
 *
 * Fix: the getter skips changes of type downgrade or upgrade, whatever their value, and keeps everything else in
 * the same order and shape ({label, value, type}).
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "modified-fields-filter",
  group: "sheet-effects",
  issue: 39,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  probeKind: "behavior",
  sources: ["ActorT20#modifiedFields"],
  isNeeded,
  install
};
