/**
 * Pure attack outcome shared by attack-vs-defense (#42) and concealment-miss-chance (#49). The per-use concealment
 * checks are the attack-outcome service (scripts/services/attack-outcome.mjs).
 */

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
