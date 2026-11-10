/**
 * Usage effect toggle (tormenta20 1.6.5).
 *
 * Bug: on usage effect rows the sheet toggle is titled "Toggle Always Apply" but flips `disabled`, which usage
 * effects ignore (all of them are stored with disabled=true by design); the icon also follows `disabled`.
 * "Always Apply" (system.abilityUse.automatic), the field used to pre-select/auto-apply usage effects, can only
 * be changed in the effect configuration.
 *
 * Fix: the toggle of usage rows flips system.abilityUse.automatic and the icon reflects it. Temporary usage
 * effects held by items keep toggling `disabled` (default vs optional application on the chat card).
 */
import { MANAGE, install, isNeeded } from "./integration.mjs";

export default {
  id: "usage-effect-toggle",
  group: "sheet-effects",
  issue: 5,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  sources: [MANAGE],
  isNeeded,
  install
};
