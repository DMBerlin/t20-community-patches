/**
 * Shared per-use attack outcome for attack-vs-defense (#42) and concealment-miss-chance (#49).
 * Keyed by the per-use clone created by ItemT20#roll (T20:8545), like useTargets.
 */
const concealmentByUse = new WeakMap();

/**
 * Drops the checks of a previous call on this object. Called synchronously on entry of every concealment
 * rollAttack call, before any await and even when the rule is off, so a reused object never carries old checks.
 */
export function invalidateConcealmentChecks(item) {
  if (item) concealmentByUse.delete(item);
}

/** Publishes the checks of this call, only after every d10 was rolled successfully. */
export function setConcealmentChecks(item, checks) {
  if (item) concealmentByUse.set(item, checks);
}

/** @returns {object[]} the checks of the current call, or [] when the concealment rule did not run. */
export function getConcealmentChecks(item) {
  return (item && concealmentByUse.get(item)) ?? [];
}

/** True when the concealment d10 made this attack roll miss this target (targetUuid null = no target). */
export function missedByConcealment(checks, rollName, targetUuid) {
  return checks.some((c) => c.rollName === rollName && c.targetUuid === (targetUuid ?? null) && c.missed);
}

/** Final outcome of one target: concealment wins over the Defense ("independentemente do resultado", p. 238). */
export function finalOutcome(defenseOutcome, concealmentMiss) {
  if (concealmentMiss) return "miss";
  return defenseOutcome === "hit" || defenseOutcome === "miss" ? defenseOutcome : "unknown";
}

/** The critical survives unless there is at least one target and every final outcome is "miss". */
export function keepCritical(outcomes) {
  return !(outcomes.length > 0 && outcomes.every((o) => o === "miss"));
}
