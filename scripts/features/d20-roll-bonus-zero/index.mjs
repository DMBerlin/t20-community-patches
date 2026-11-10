/**
 * Null parts in d20 roll formulas.
 *
 * Bug (tormenta20 1.6.5–1.6.7): d20Roll always appends `parts.concat(["@bonus"])` (T20:4013), but nothing puts
 * `bonus` in the roll data, so Roll.parse replaces it with "0" and every skill, ability and attack roll ends in
 * "+ 0". damageRoll drops it with `if (!data.bonus)` (T20:4088); d20Roll does not. Weapon attacks also carry the
 * item's own attack bonus, stored as "0", into the formula through getAttackToHit's `roll.parts.map` (T20:6978).
 *
 * Fix: Roll.parse drops a trailing "+@bonus" when the data has no `bonus` (the core would read it as 0), and
 * getAttackToHit drops literal zero parts. Totals never change.
 */
import { D20_ROLL, GET_ATTACK_TO_HIT } from "./domain.mjs";
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "d20-roll-bonus-zero",
  group: "actor",
  issue: 92,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  sources: [D20_ROLL, GET_ATTACK_TO_HIT],
  probeKind: "behavior",
  isNeeded,
  install
};
