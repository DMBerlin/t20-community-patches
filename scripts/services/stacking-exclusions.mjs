/**
 * Exclusions from the source dispute of the source-stacking rule (#45). A feature registers a predicate that keeps a
 * change out of the dispute (for example, a condition's own reduction handled by petrified-damage-reduction, #63).
 */

/** The registry: a set of predicates. Registering the same function twice has no effect. */
export function createStackingExclusions() {
  const exclusions = new Set();
  return {
    /**
     * @param {(effect: object, change: object) => boolean} predicate
     * @returns {() => void}  Unregisters the predicate.
     */
    register(predicate) {
      exclusions.add(predicate);
      return () => exclusions.delete(predicate);
    },
    /** Whether a registered predicate keeps the change out of the plan; a predicate that throws excludes nothing. */
    isExcluded(effect, change) {
      for (const predicate of exclusions) {
        try {
          if (predicate(effect, change)) return true;
        } catch {
          // A broken predicate must not hide a change from the rule.
        }
      }
      return false;
    }
  };
}

/** @type {import("../kernel/services.mjs").Service} */
export default {
  id: "stacking-exclusions",
  install: () => createStackingExclusions()
};
