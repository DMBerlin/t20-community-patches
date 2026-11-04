/**
 * Suppressed usage effects (tormenta20 1.6.5).
 *
 * Bug: the three collection paths of usage effects (ItemT20#_allApplicableOnUseEffects, ActorT20#rollPericia and
 * ActorT20#rollAtributo) ignore suppression, so usage effects of suppressed items (stored, not wielded) still apply.
 *
 * Fix: the item path filters its result, and the skill/attribute paths filter the actor traversal inside their
 * synchronous collection window.
 */
import { SOURCES } from "./domain.mjs";
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "suppressed-usage-effects",
  group: "usage-effects",
  issue: 4,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  sources: SOURCES,
  isNeeded,
  install
};
