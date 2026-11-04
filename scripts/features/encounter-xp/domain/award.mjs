/** XP of an award, its recipients and who may distribute it. */
import { MAX_LEVEL, encounterNd, parseNd } from "./nd.mjs";

export const OUTCOME_FACTOR = Object.freeze({ victory: 1, draw: 0.5, defeat: 0.25 });

const CHALLENGE_TYPES = new Set(["npc", "hazard"]);

/** "Desafios Irrelevantes" (p. 326): 5 or more points below the group level. */
export function isIrrelevant(nd, level) {
  return level - nd >= 5;
}

/**
 * @param {object} input
 * @param {{key: string, nd: number|null, won: boolean}[]} input.challenges
 * @param {number} input.recipientCount
 * @param {"creature"|"encounter"} [input.mode]
 * @param {number|null} [input.encounter]      encounter rating typed by the GM; null → computed
 * @param {"victory"|"draw"|"defeat"} [input.outcome]
 * @param {boolean} [input.skipIrrelevant]
 * @param {number} [input.level]
 * @returns {{error?: string, total?: number, share?: number, encounter?: number|null, irrelevant?: boolean,
 *   rows?: {key: string, xp: number|null, irrelevant: boolean}[]}}  error: outcome | recipients | challenges | nd | zero
 */
export function computeAward({ challenges, recipientCount, mode = "creature", encounter = null, outcome = "victory", skipIrrelevant = true, level = 1 }) {
  const factor = OUTCOME_FACTOR[outcome];
  if (factor === undefined) return { error: "outcome" };
  if (!Number.isInteger(recipientCount) || recipientCount < 1) return { error: "recipients" };
  const won = challenges.filter((c) => c.won);
  if (!won.length) return { error: "challenges" };
  if (won.some((c) => !Number.isFinite(c.nd) || c.nd <= 0)) return { error: "nd" };

  if (mode === "encounter") {
    const nd = encounter ?? encounterNd(won.map((c) => c.nd));
    if (!Number.isFinite(nd) || nd <= 0) return { error: "nd" };
    const irrelevant = skipIrrelevant && isIrrelevant(nd, level);
    const total = irrelevant ? 0 : Math.round(nd * 1000);
    const rows = won.map((c) => ({ key: c.key, xp: null, irrelevant: false }));
    return withShare({ total, encounter: nd, irrelevant, rows }, factor, recipientCount);
  }

  const rows = won.map((c) => {
    const irrelevant = skipIrrelevant && isIrrelevant(c.nd, level);
    return { key: c.key, xp: irrelevant ? 0 : Math.round(c.nd * 1000), irrelevant };
  });
  const total = rows.reduce((sum, r) => sum + r.xp, 0);
  return withShare({ total, encounter: null, irrelevant: false, rows }, factor, recipientCount);
}

/** Nothing to award (only irrelevant challenges, or a share rounded to 0) is reported, never recorded. */
function withShare(award, factor, recipientCount) {
  const share = Math.floor((award.total * factor) / recipientCount);
  return share > 0 ? { ...award, share } : { ...award, share: 0, error: "zero" };
}

/** Level up available: xp reaches the next level threshold (the system's xpPorNivel) below level 20. */
export function canLevelUp(level, xp, table) {
  return Number.isInteger(level) && level >= 1 && level < MAX_LEVEL && xp >= table[level];
}

/**
 * Splits snapshot rows into challenges (npc, hazard; one per token) and recipients (character; one per actor
 * document, so two tokens of the same linked character are one recipient).
 */
export function partitionSnapshot(rows) {
  const challenges = new Map();
  const recipients = new Map();
  for (const row of rows) {
    if (CHALLENGE_TYPES.has(row.type)) {
      if (challenges.has(row.key)) continue;
      const parsed = parseNd(row.ndText);
      challenges.set(row.key, { ...row, nd: parsed?.value ?? null, ndLabel: parsed?.label ?? "", special: !!parsed?.special, won: !!row.hostile });
    } else if (row.type === "character") {
      if (recipients.has(row.actorUuid)) continue;
      // An unlinked token holds its own synthetic actor: XP written there dies with the token. Opt-in only.
      recipients.set(row.actorUuid, { ...row, selected: !!row.playerOwned && !row.unlinked });
    }
  }
  return { challenges: [...challenges.values()], recipients: [...recipients.values()] };
}

/** Selected recipients on unlinked tokens need an explicit confirmation. */
export function recipientsError(selected, confirmUnlinked) {
  return selected.some((r) => r.unlinked) && !confirmUnlinked ? "unlinked" : null;
}

/**
 * Why this client may not distribute now (null: it may). Checked when the dialog opens, inside the queue and before
 * each write, so a GM that stops being the active GM, a tool switched off or XP disabled stops the distribution.
 */
export function executorBlock({ isGm, isActiveGm, mode, disabled }) {
  if (!isGm) return "notGm";
  if (mode === "off") return "off";
  if (disabled) return "disabled";
  if (!isActiveGm) return "notActiveGm";
  return null;
}

/**
 * How a recipient relates to an award, read from the awards recorded on its own actor:
 * "already" when it holds this award id (a resume or a second click), "duplicate" when another award shares a
 * challenge token (the button, then the end of the combat) and the GM did not ask to award again; null to write.
 */
export function recipientStatus(awards, award) {
  if (awards?.[award.id]) return "already";
  if (award.repeat) return null;
  const keys = new Set(award.challenges);
  const clash = Object.entries(awards ?? {}).some(([id, a]) => id !== award.id && a?.challenges?.some((k) => keys.has(k)));
  return clash ? "duplicate" : null;
}
