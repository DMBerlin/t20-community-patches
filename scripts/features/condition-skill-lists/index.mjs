/**
 * Condition skill lists (tormenta20 1.6.5).
 *
 * Bug: Cego, Fraco, Debilitado, Frustrado and Esmorecido list their skill penalties one skill at a time
 * (`system.pericias.<key>.condi`), and the lists miss skills whose key attribute the book names: Ladinagem (Des) in
 * Cego, Fraco and Debilitado, and the six Ofícios (Int) in Frustrado and Esmorecido. Custom skills (Ofícios
 * "ofi1-9", other skills "_pc1-9") are never listed.
 *
 * Fix: while an actor applies its effects, each of these conditions gets, for that application only, a copy of its
 * own skill penalty for every skill of the actor whose key attribute it names and that it does not list. The copies
 * go through the core like the system's changes (shouldApplyChange, priority order). The condition is skipped when
 * it penalizes skills in any other way. Stored data is never changed.
 */
import { install, isNeeded, lateProbe } from "./integration.mjs";

export default {
  id: "condition-skill-lists",
  group: "conditions",
  issue: 38,
  guarded: true,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  probeKind: "behavior",
  isNeeded,
  lateProbe,
  install
};
