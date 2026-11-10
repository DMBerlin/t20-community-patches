/**
 * Condition upgrade chain (tormenta20 1.6.5–1.6.7).
 *
 * Bug: a condition is suppressed while its upgraded version is on the actor (BaseEffect#isSuppressedByUpgrade,
 * T20:16649), but the 38 conditions of the system pack ("efeitos") ship with `system.status.upgrade` empty, and the getter
 * reads `actor.statuses`, which the core fills while it applies the effects (core actor.mjs:240-256). A condition
 * created before its upgrade is evaluated before the upgrade's status is in the set, so both apply.
 *
 * Once the upgrade suppresses Fatigued, its Vulnerable child (suppressed by inheritance) still suppresses Exhausted's
 * older Vulnerable as a duplicate (BaseEffect#isSuppressedByDuplicated, T20:16635), so both are lost.
 *
 * Fix: the getter takes the link from `system.status.upgrade` or, when empty, from the book's chain (JdA p. 394), and
 * looks for another active effect of the actor with that status instead of the partial set. A newer duplicate whose
 * origin condition is inactive no longer suppresses the older one. Nothing is stored.
 */
import { SOURCES, install, isNeeded } from "./integration.mjs";

export default {
  id: "condition-upgrade-chain",
  group: "conditions",
  issue: 94,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  sources: [...SOURCES, "BaseEffect#isSuppressed", "ActiveEffectT20#isSuppressed", "BaseEffect#isSuppressedByInheritance"],
  isNeeded,
  install
};
