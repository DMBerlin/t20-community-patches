/** Pure decisions of the "Chance de falha por camuflagem" rule (#49). */
import { MODULE_ID } from "../../lib/module.mjs";
import { canSeeTokenName } from "../../lib/targets.mjs";
import { finalOutcome, keepCritical, missedByConcealment } from "../../lib/attack-outcome.mjs";
import { DATA_KEY, DATA_VERSION } from "../../lib/concealment.mjs";

export const CONCEALMENT_FIELD = "t20cpConcealment";
export const CONCEALMENT_CHOICES = ["auto", "light", "total", "scent", "none"];
export const CHANCE = { light: 20, total: 50 };
export const SCENT_CHANCE = 20; // Faro, p. 229
export const MAX_MISS_CHANCE = 75; // p. 226
export const BLIND = "cego";
export const INVISIBLE = "invisivel";
export const FIELD_CLASS = "t20cp-concealment";
export const BLOCK_CLASS = "t20cp-miss-chance";

/** Automatic concealment sources against one target. */
export function autoSources({ attackerStatuses = [], targetStatuses = [] } = {}) {
  const sources = [];
  if (new Set(attackerStatuses).has(BLIND)) sources.push({ reason: "blind", chance: CHANCE.total });
  if (new Set(targetStatuses).has(INVISIBLE)) sources.push({ reason: "invisible", chance: CHANCE.total });
  return sources;
}

/**
 * Final chance against one target. Concealment does not stack with itself: the highest wins.
 * "none" ignores everything; "scent" replaces any detected concealment with 20%. Unknown choice = "auto".
 * @returns {{chance: number, reasons: string[]}}
 */
export function resolveMissChance({ sources = [], choice = "auto" } = {}) {
  if (choice === "none") return { chance: 0, reasons: [] };
  const all = [...sources];
  if (choice === "light" || choice === "total") all.push({ reason: choice, chance: CHANCE[choice] });
  const chance = Math.min(MAX_MISS_CHANCE, Math.max(0, ...all.map((s) => s.chance)));
  const reasons = all.filter((s) => s.chance === chance && chance > 0).map((s) => s.reason);
  if (choice === "scent" && chance > 0) return { chance: SCENT_CHANCE, reasons: [...reasons, "scent"] };
  return { chance, reasons };
}

/** The book's die: 1d10 for multiples of 10 (1-2 at 20%, 1-5 at 50%); 1d100 otherwise. */
export function missDie(chance) {
  if (!(chance > 0)) return null;
  return chance % 10 === 0 ? { formula: "1d10", threshold: chance / 10 } : { formula: "1d100", threshold: chance };
}

export function isMiss(total, threshold) {
  return Number.isFinite(total) && total >= 1 && total <= threshold;
}

/**
 * One check per (attack roll × target with chance > 0). No targets: a single null target.
 * Attack names are deduplicated: the system keeps only the last roll of each name in `rolled` (T20:9096), so a
 * shadowed duplicate gets no d10.
 * @param {{attackNames: string[], attackerStatuses: Iterable<string>, targets: {uuid: string, name: string,
 *   displayName: number, statuses: Iterable<string>}[], choice: string}} p
 */
export function planChecks({ attackNames = [], attackerStatuses = [], targets = [], choice = "auto" } = {}) {
  const list = targets.length ? targets : [null];
  const checks = [];
  for (const rollName of new Set(attackNames)) {
    list.forEach((target, i) => {
      const sources = autoSources({ attackerStatuses, targetStatuses: target?.statuses ?? [] });
      const { chance, reasons } = resolveMissChance({ sources, choice });
      const die = missDie(chance);
      if (!die) return;
      checks.push({
        rollName,
        targetUuid: target?.uuid ?? null,
        index: i + 1,
        name: target?.name ?? null,
        displayName: target?.displayName ?? null,
        chance,
        reasons,
        ...die
      });
    });
  }
  return checks;
}

/** Final outcomes of one attack roll when only this rule knows anything (Defense unknown). */
export function concealmentOutcomes(checks, rollName, targetUuids) {
  const uuids = targetUuids.length ? targetUuids : [null];
  return uuids.map((uuid) => finalOutcome(undefined, missedByConcealment(checks, rollName, uuid)));
}

/**
 * Card label of a target, decided by each client at render time.
 * @returns {{name: string|null, index: number}}  name null → "Alvo {index}"
 */
export function targetLabel({ name, index, isGM, isOwner, displayName }) {
  return { name: name && canSeeTokenName({ isGM, isOwner, displayName }) ? name : null, index };
}

/**
 * Records the checks in each new attack roll and cancels the critical when every target was missed.
 * `before` holds the rolled entries seen before the original ran: an entry that did not change (attack cancelled,
 * T20:9092) is left alone.
 */
export function annotate(item, targets, checks, before = {}) {
  const rolled = item?.system?.rolled;
  if (!rolled) return;
  const uuids = targets.map((target) => target.uuid);
  for (const rollName of new Set(checks.map((c) => c.rollName))) {
    const roll = rolled[rollName];
    if (!roll?.options || roll.options.type !== "attack" || roll === before[rollName]) continue;
    const own = checks.filter((c) => c.rollName === rollName).map((c) => ({ ...c, reasons: [...c.reasons] }));
    let criticalCancelled = false;
    // Only cancels, never restores: another rule may have decided already.
    if (roll._critical === true && !keepCritical(concealmentOutcomes(checks, rollName, uuids))) {
      roll._critical = false;
      criticalCancelled = true;
    }
    (roll.options[MODULE_ID] ??= {})[DATA_KEY] = { v: DATA_VERSION, checks: own, criticalCancelled };
  }
}
