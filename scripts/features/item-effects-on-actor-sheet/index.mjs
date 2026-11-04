/**
 * Item effects on the actor sheet (tormenta20 1.6.5, GitLab #101 part 1).
 *
 * Bug: ActorSheetT20#getData lists only `actor.effects`. Since Foundry v11 transferred item effects are applied
 * from the item and are no longer copied to the actor, so they never appear on the actor sheet, and the effect
 * controls/drag resolve the effect on the actor only.
 *
 * Fix: the effects tab lists `actor.allApplicableEffects()` (actor effects + item effects with transfer, the
 * same set Foundry v10 showed). Rows of item effects show the item as source; Toggle/Edit/Delete (with
 * confirmation) and drag act on the effect inside the item.
 */
import { SOURCES, install, isNeeded } from "./integration.mjs";

export default {
  id: "item-effects-on-actor-sheet",
  group: "sheet-effects",
  issue: 2,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  sources: [...SOURCES, "ActorSheetT20#_onDragStart"],
  isNeeded,
  install
};
