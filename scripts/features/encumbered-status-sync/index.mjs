/**
 * Encumbered condition out of sync (tormenta20 1.6.5).
 *
 * Bug: ActorT20._checkEncumbered only runs from ActorT20._onUpdate and ItemT20._onUpdate, so creating or deleting
 * items never applies or removes "sobrecarregado". It also decides before awaiting the creation, so overlapping
 * checks create duplicate copies, and only one copy is ever removed.
 *
 * Fix: the check runs after items are created or deleted on the actor, and is serialized per actor, awaiting the
 * creation/removal. Every copy is removed when the character is no longer encumbered.
 */
import { SOURCES, install, isNeeded } from "./integration.mjs";

export default {
  id: "encumbered-status-sync",
  group: "conditions",
  issue: 21,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  sources: [SOURCES.check, ...SOURCES.create, ...SOURCES.delete],
  isNeeded,
  install
};
