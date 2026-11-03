/**
 * HP below the death threshold (#51). Belongs to the death-threshold patch, but exists in every patch mode: the
 * system's damage clamp always does. The wrappers keep "death-threshold" as owner.
 */
import { MODULE_ID } from "../utils.mjs";
import { DEATH_FLOOR_MODES, DEATH_FLOOR_SETTING, allowsBelowThreshold, installDamageFloor } from "../patches/death-threshold.mjs";
import { coversActor } from "./dying-states.mjs";

/** @type {import("../kernel/feature.mjs").Feature} */
export default {
  id: "death-threshold-floor",
  kind: "rule",
  group: "actor",
  system: { id: "tormenta20" },
  settings: [
    {
      key: DEATH_FLOOR_SETTING,
      name: "T20CP.Patches.death-threshold.Floor.Name",
      hint: "T20CP.Patches.death-threshold.Floor.Hint",
      scope: "world",
      type: String,
      choices: Object.fromEntries(DEATH_FLOOR_MODES.map((m) => [m, `T20CP.Patches.death-threshold.Floor.${m}`])),
      default: "unbounded",
      // Shown with the dying states, as before #85.
      centerId: "dying-states"
    }
  ],
  after: ["dying-states"],
  install: () =>
    installDamageFloor((actor) =>
      allowsBelowThreshold({ floor: game.settings.get(MODULE_ID, DEATH_FLOOR_SETTING), covered: coversActor(actor) })
    )
};
