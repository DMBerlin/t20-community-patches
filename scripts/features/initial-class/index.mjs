/**
 * Initial class bookkeeping (tormenta20 1.6.5).
 *
 * Bug: ItemT20#_onUpdate and ItemT20#_onDelete move the "Inicial" mark whenever some class is not initial, instead
 * of only when no class is initial. Marking a third class as initial, or deleting a class while the initial one is
 * not the first, leaves the mark on another class; unmarking the only class throws. ItemT20#_preCreate keeps the
 * "inicial" value of the created data, so a class copied from another character, or a folder with several classes
 * dropped on a new character, leaves two initial classes. AttributesFields.preparePVPM gives the 1st level of every
 * initial class 4× its PV per level.
 *
 * Fix: while the actor has classes, exactly one is initial. The mark moves only when the user marks another class,
 * or when no class is initial anymore (the initial class was unmarked or deleted). A created class is initial only
 * when the actor had no class and it is the first class accepted in its creation operation.
 */
import { SOURCES } from "./domain.mjs";
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "initial-class",
  group: "actor",
  issue: 54,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  sources: [...Object.values(SOURCES), "AttributesFields.preparePVPM"],
  isNeeded,
  install
};
