/**
 * Ability use dialog total cost (tormenta20 1.6.5).
 *
 * Bug: AbilityUseDialog.create pre-adds the cost of every usage effect with disabled=false to the initial cost
 * (usage effects are pre-checked by abilityUse.automatic, not by disabled) and stores that sum in
 * data-initial-cost, so checked costs are counted twice and automatic effects are missing until the first click.
 * _onInputChange also overwrites the accumulated `hasCost` flag with `initialCost > 0`, showing 0 for rolls
 * without base cost. Display only: the cost actually spent comes from the submitted form.
 *
 * Fix: data-initial-cost holds only the base activation cost, and the total is computed from the checked boxes.
 */
import { SOURCES } from "./domain.mjs";
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "ability-dialog-cost",
  group: "usage-effects",
  issue: 7,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  sources: SOURCES,
  isNeeded,
  install
};
