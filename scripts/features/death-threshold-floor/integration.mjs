/** Foundry integration of the HP floor below the death threshold (#51): the damage method wrappers. */
import { DEATH_FLOOR_SETTING, allowsBelowThreshold, wrapDamageFloor } from "../../lib/death-threshold.mjs";
import { DYING_STATES_SETTING, isTracked } from "../../lib/dying-states.mjs";
import { fromFactory } from "../../kernel/wrap.mjs";

/** A setting read on every damage; a missing one (not registered yet) counts as `fallback`. */
function read(get, fallback) {
  try {
    return get();
  } catch {
    return fallback;
  }
}

/** Whether damage may take `actor` below the threshold, from the settings read on every call. */
export function floorAllows(ctx) {
  return (actor) =>
    allowsBelowThreshold({
      floor: ctx.setting(DEATH_FLOOR_SETTING),
      covered: isTracked(actor?.type, read(() => ctx.features.setting("dying-states", DYING_STATES_SETTING), "off"))
    });
}

/** Wraps the system's damage methods; the owner is the feature's wrapOwner ("death-threshold"). */
export function install(ctx) {
  const proto = ctx.platform.classes.actor.prototype;
  const allows = floorAllows(ctx);
  for (const name of ["applyDamage", "applyDamageV2"]) {
    if (typeof proto[name] === "function") {
      ctx.wrap(proto, name, fromFactory((original) => wrapDamageFloor(original, allows)));
    }
  }
}
