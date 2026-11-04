/** Award records on the actors and award plans on the GM summary messages. */
import { recipientStatus } from "./award.mjs";

/** Flag kept on each actor that received XP: one record per award id, written in the same update as the XP. */
export const AWARDS_FLAG = "xpAwards";

export const PLAN_FLAG = "xpPlan";

/**
 * Record stored on the actor. `recipients` is the planned list, so an interrupted award can be resumed from it.
 * `before`/`after` and `seq` (one more than the highest seq read on the actor) let auditAwards find XP lost by a
 * stale write; `toPlayers` keeps the summary audience for a resume.
 */
export function awardRecord(award, before, seq) {
  return {
    xp: award.share,
    before,
    after: before + award.share,
    seq,
    at: award.at,
    by: award.by,
    outcome: award.outcome,
    repeat: !!award.repeat,
    toPlayers: award.toPlayers !== false,
    challenges: [...award.challenges],
    recipients: award.recipients.map(({ uuid, name, level }) => ({ uuid, name, level }))
  };
}

/** Next record sequence on one actor. */
export function nextSeq(awards) {
  return Math.max(0, ...Object.values(awards ?? {}).map((r) => (Number.isFinite(r?.seq) ? r.seq : 0))) + 1;
}

/**
 * Checks the confirmed XP against the records on the actor. XP is written as an absolute value computed from a read,
 * and the database has no increment operator (core common/data/operators.mjs), so a write that left with an old read
 * and arrives late overwrites the XP of the awards written meanwhile, while their records stay. The records written
 * last (highest seq; several when they came from the same read) give the expected XP: their common `before` plus
 * their XP. Result:
 * - "ok": the XP is the expected one (or there is nothing to check);
 * - "lost": the XP is a value an earlier write left (a `before` or an `after` recorded), so XP was probably lost;
 * - "edited": any other value, i.e. an edit outside the module; it is reported, not blocked.
 * @returns {{status: "ok"|"lost"|"edited", expected: number|null}}
 */
export function auditAwards(xp, awards) {
  const recs = Object.values(awards ?? {}).filter((r) => [r?.seq, r?.before, r?.after, r?.xp].every(Number.isFinite));
  if (!recs.length) return { status: "ok", expected: null };
  const top = Math.max(...recs.map((r) => r.seq));
  const last = recs.filter((r) => r.seq === top);
  const bases = new Set(last.map((r) => r.before));
  const expected = bases.size === 1 ? last[0].before + last.reduce((sum, r) => sum + r.xp, 0) : null;
  if (xp === expected) return { status: "ok", expected };
  const seen = new Set(recs.flatMap((r) => [r.before, r.after]));
  return { status: seen.has(xp) ? "lost" : "edited", expected };
}

/** Summary audience of a resume: the explicit choice, else the one recorded with the award (public by default). */
export function resumeAudience(collected, toPlayers) {
  return typeof toPlayers === "boolean" ? toPlayers : collected?.toPlayers !== false;
}

/**
 * Plan of an award, stored in the flags of the GM summary message, created before the first write. Players cannot
 * forge it: a message is created only in its author's name and updated only by its author or a GM (core
 * common/documents/chat-message.mjs:74-98). The actor records are editable by the owning player, so a resume takes
 * value, recipients and audience from this plan, never from the records.
 */
export function planRecord(award) {
  return {
    id: award.id,
    at: award.at,
    share: award.share,
    outcome: award.outcome,
    repeat: !!award.repeat,
    toPlayers: award.toPlayers !== false,
    challenges: [...award.challenges],
    recipients: award.recipients.map(({ uuid, name, level }) => ({ uuid, name, level }))
  };
}

/**
 * Plans by award id, only from messages written by a GM.
 * @param {{gm: boolean, plan: object}[]} entries
 * @returns {Map<string, object>}
 */
export function planMap(entries) {
  const plans = new Map();
  for (const { gm, plan } of entries) if (gm && typeof plan?.id === "string" && !plans.has(plan.id)) plans.set(plan.id, plan);
  return plans;
}

/**
 * Awards recorded on the actors, grouped by id, with the planned recipients still without XP. A recipient skipped
 * because another award already paid the same challenge is not pending. With `plans`, an award takes value,
 * recipients, challenges and audience from its GM plan (`verified`); one without a plan is history only (no pending).
 * @param {{uuid: string, awards: object}[]} actors  every actor that may hold the flag
 * @param {Map<string, object>|null} [plans]  planMap of the GM summary messages
 */
export function collectAwards(actors, plans = null) {
  const byUuid = new Map(actors.map((a) => [a.uuid, a.awards ?? {}]));
  const awards = new Map();
  for (const { uuid, awards: records } of actors) {
    for (const [id, rec] of Object.entries(records ?? {})) {
      if (!awards.has(id)) awards.set(id, { id, at: rec.at, share: rec.xp, outcome: rec.outcome, repeat: !!rec.repeat, toPlayers: rec.toPlayers !== false, challenges: rec.challenges ?? [], recipients: rec.recipients ?? [], paid: [] });
      awards.get(id).paid.push(uuid);
    }
  }
  // A plan whose writes all failed left no record on any actor: it is found through the plan alone.
  for (const [id, plan] of plans ?? []) if (!awards.has(id)) awards.set(id, { id, at: plan.at, paid: [] });
  for (const a of awards.values()) {
    if (plans) {
      const plan = plans.get(a.id);
      a.verified = !!plan;
      if (plan) Object.assign(a, { share: plan.share, outcome: plan.outcome, repeat: !!plan.repeat, toPlayers: plan.toPlayers !== false, challenges: plan.challenges ?? [], recipients: plan.recipients ?? [] });
    }
    a.pending = a.verified === false ? [] : a.recipients.filter((r) => !a.paid.includes(r.uuid) && recipientStatus(byUuid.get(r.uuid), a) === null);
  }
  return [...awards.values()].sort((a, b) => b.at - a.at);
}

/** Other awards that share a challenge with this one. */
export function findOverlap(awards, challengeKeys, ownId = null) {
  const keys = new Set(challengeKeys);
  return awards.filter((a) => a.id !== ownId && a.challenges.some((k) => keys.has(k)));
}

/** Rebuilds an interrupted award from its records, to resume it without the dialog, tokens or combat. */
export function awardFromRecords(collected, by, at) {
  return { id: collected.id, at, by, outcome: collected.outcome, repeat: collected.repeat, toPlayers: collected.toPlayers, share: collected.share, challenges: collected.challenges, recipients: collected.recipients };
}
