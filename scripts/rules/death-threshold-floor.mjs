/**
 * HP below the death threshold (#51). Belongs to the death-threshold patch, but exists in every patch mode: the
 * system's damage clamp always does. The wrappers keep "death-threshold" as owner.
 */
import { DEATH_FLOOR_MODES, DEATH_FLOOR_SETTING, allowsBelowThreshold, wrapDamageFloor } from "../lib/death-threshold.mjs";
import { DYING_STATES_SETTING, isTracked } from "../lib/dying-states.mjs";
import { fromFactory, wraps } from "../kernel/wrap.mjs";

/** Wraps the system's damage methods. `allows` reads the settings on every call. */
export function installDamageFloor(allows) {
  const proto = CONFIG.Actor.documentClass.prototype;
  for (const name of ["applyDamage", "applyDamageV2"]) {
    if (typeof proto[name] === "function") {
      wraps.wrap(proto, name, "death-threshold", fromFactory((original) => wrapDamageFloor(original, allows)));
    }
  }
}

/** A setting read on every damage; a missing one (not registered yet) counts as `fallback`. */
function read(get, fallback) {
  try {
    return get();
  } catch {
    return fallback;
  }
}

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
  // Only actors covered by the dying states, in their current mode, go below the threshold.
  interactsWith: ["dying-states"],
  install: (ctx) =>
    installDamageFloor((actor) =>
      allowsBelowThreshold({
        floor: ctx.setting(DEATH_FLOOR_SETTING),
        covered: isTracked(actor?.type, read(() => ctx.features.setting("dying-states", DYING_STATES_SETTING), "off"))
      })
    )
};
