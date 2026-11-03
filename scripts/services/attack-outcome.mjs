/**
 * Per-use attack outcome shared by attack-vs-defense (#42) and concealment-miss-chance (#49) (service, #87).
 * Keyed by the per-use clone created by ItemT20#roll (T20:8545), like the use-targets service.
 */

/** The concealment checks of each use, in a store of its own. */
export function createAttackOutcome() {
  const concealmentByUse = new WeakMap();
  return {
    /**
     * Drops the checks of a previous call on this object. Called synchronously on entry of every concealment
     * rollAttack call, before any await and even when the rule is off, so a reused object never carries old checks.
     */
    invalidateConcealmentChecks(item) {
      if (item) concealmentByUse.delete(item);
    },
    /** Publishes the checks of this call, only after every d10 was rolled successfully. */
    setConcealmentChecks(item, checks) {
      if (item) concealmentByUse.set(item, checks);
    },
    /** @returns {object[]} the checks of the current call, or [] when the concealment rule did not run. */
    getConcealmentChecks(item) {
      return (item && concealmentByUse.get(item)) ?? [];
    }
  };
}

/** @type {import("../kernel/services.mjs").Service} */
export default {
  id: "attack-outcome",
  install: () => createAttackOutcome()
};
