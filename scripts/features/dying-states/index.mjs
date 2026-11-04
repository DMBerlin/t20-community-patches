/**
 * Optional rule "Estados de PV zero" (#51).
 *
 * Book rule (core rulebook, p. 236): at 0 HP or less a creature falls unconscious and bleeds; any healing of 1 HP
 * or more stabilizes it, and losing more HP makes it bleed again; recovering to 1 HP or more wakes it up; at -10
 * or minus half its maximum HP (whichever is lower) it dies. Nonlethal damage counts for falling unconscious, but
 * not for bleeding or dying. The system never applies these conditions.
 *
 * One designated client per actor (the active GM, otherwise the active owner chosen by the core) applies or removes
 * the system conditions "inconsciente", "sangrando" and "morto". Effects created here carry a flag, and only those
 * are removed automatically, plus child conditions the system created after their parent was already deleted.
 *
 * The lethal HP contract (snapshots, rebase between nonlethal modes) of the nonlethal damage rule (#55) and the
 * death threshold (#29) come from lib/; the nonlethal mode is read through ctx.features.
 */
import { DYING_STATES_SETTING } from "../../lib/dying-states.mjs";
import { DYING_STATES_MODES } from "./domain.mjs";
import { install } from "./integration.mjs";

/**
 * World setting. The lifecycle registers it on "init" for every system, so it always exists.
 * @type {import("../../kernel/feature.mjs").SettingSpec}
 */
const SETTING_SPEC = {
  key: DYING_STATES_SETTING,
  name: "T20CP.DyingStates.Setting.Name",
  hint: "T20CP.DyingStates.Setting.Hint",
  scope: "world",
  type: String,
  choices: Object.fromEntries(DYING_STATES_MODES.map((m) => [m, `T20CP.DyingStates.Setting.${m}`])),
  default: "off"
};

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "dying-states",
  kind: "rule",
  group: "actor",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  // Lethal HP follows the nonlethal damage rule's mode.
  interactsWith: ["nonlethal-damage"],
  install
};
