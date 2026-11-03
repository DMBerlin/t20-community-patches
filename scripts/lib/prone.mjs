/** Defense penalty of the Prone condition (prone-defense, field-bonuses-breakdown). */

export const PRONE = "caido";

export const OUTROS_KEY = "system.attributes.defesa.outros";

/**
 * Whether a change is a Caído Defense penalty in either form: the system's "downgrade" or an already fixed "add"
 * (a copy edited by hand or a corrected system). Both kinds compete when choosing the penalty that counts.
 * @param {{key?: string, type?: string, value?: unknown}} change
 * @returns {boolean}
 */
export function isProneDefenseChange(change) {
  if (change?.key !== OUTROS_KEY || !["downgrade", "add"].includes(change.type)) return false;
  if (change.value === null || change.value === "" || typeof change.value === "boolean") return false;
  const value = Number(change.value);
  return Number.isFinite(value) && value < 0;
}

/**
 * Caído Defense penalties that will reach prepareDefense: active effects with the "caido" status whose change is
 * applied in the "initial" phase (the effect's own shouldApplyChange decides, as the core does). Changes from the
 * "final" phase run after prepareDefense and never compete. Each candidate keeps the index of its change in the
 * effect, so the winner is a change, not just an effect.
 * @param {Iterable<{active?: boolean, statuses?: Set<string>, system?: {changes?: object[]},
 *   shouldApplyChange?: Function}>} effects
 * @returns {{effect: object, index: number, value: number, buggy: boolean}[]}
 */
export function collectProneCandidates(effects) {
  const candidates = [];
  for (const effect of effects ?? []) {
    if (!effect?.active || !effect.statuses?.has(PRONE)) continue;
    const changes = effect.system?.changes ?? [];
    changes.forEach((change, index) => {
      if (!isProneDefenseChange(change)) return;
      if (typeof effect.shouldApplyChange === "function" && !effect.shouldApplyChange(change, { phase: "initial" })) {
        return;
      }
      candidates.push({ effect, index, value: Number(change.value), buggy: change.type === "downgrade" });
    });
  }
  return candidates;
}

/**
 * Picks the Caído penalty that counts: the most severe, the first one on ties.
 * @param {{effect: object, index: number, value: number, buggy: boolean}[]} candidates
 * @returns {{effect: object, index: number, value: number, buggy: boolean}|null}
 */
export function pickProneChange(candidates) {
  let best = null;
  for (const candidate of candidates ?? []) {
    if (!best || candidate.value < best.value) best = candidate;
  }
  return best;
}

/**
 * Whether the change handed to applyChange (a deep clone made by the core) has the content of a stored change.
 * @param {object|undefined} stored
 * @param {object} change
 * @returns {boolean}
 */
export function isSameChange(stored, change) {
  if (!stored || !change) return false;
  return (
    stored.key === change.key &&
    stored.type === change.type &&
    String(stored.value) === String(change.value) &&
    stored.phase === change.phase
  );
}

/**
 * What to do with a Caído Defense change being applied.
 * - "keep": apply it as is, untouched (not in the "initial" phase, or no candidate has the bug: system behavior).
 * - "add": it is the penalty that counts and still a "downgrade": apply it as "add".
 * - "count": it is the penalty that counts and already an "add": apply it as is.
 * - "skip": another change counts, or the winner was already applied in this preparation (an identical duplicate
 *   inside the same effect); conditions with the same effect do not stack (book, p. 394).
 * @param {{effect: object, change: object, eligible: boolean, alreadyCounted?: boolean}} current
 * @param {{effect: object, index: number, value: number, buggy: boolean}[]} candidates
 * @returns {"keep"|"add"|"count"|"skip"}
 */
export function planProneChange({ effect, change, eligible, alreadyCounted = false }, candidates) {
  if (!eligible || !candidates?.some((c) => c.buggy)) return "keep";
  const winner = pickProneChange(candidates);
  if (!winner) return "keep";
  if (winner.effect !== effect || !isSameChange(effect.system?.changes?.[winner.index], change)) return "skip";
  if (alreadyCounted) return "skip";
  return winner.buggy ? "add" : "count";
}
