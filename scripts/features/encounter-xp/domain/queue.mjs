/** Distribution of an award: one run at a time per client, one write per recipient. */
import { recipientStatus } from "./award.mjs";
import { auditAwards, awardRecord, nextSeq } from "./records.mjs";

/**
 * Runs distributions one at a time inside one client. Two clients are not coordinated: see the issue (limitation).
 * @returns {(fn: () => Promise<any>) => Promise<any>}
 */
export function createQueue() {
  let queue = Promise.resolve();
  return (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };
}

/**
 * Writes the award to each recipient. Per recipient: read the actor (XP and recorded awards), skip it when it already
 * holds this award or a duplicate, refuse it ("diverged", left pending) when auditAwards finds XP probably lost, unless
 * `acceptDivergence`; check the guard with no await before the update, then write XP and record in a single
 * actor.update (atomic per document), and read back. When the guard blocks, it stops: the rest stays pending.
 * @param {object} award {id, at, by, outcome, repeat, toPlayers, acceptDivergence, share, challenges: string[],
 *   recipients: {uuid, name, level}[]}
 * @param {{queue, guard: () => string|null, readActor: (uuid) => Promise<{xp: number, awards: object}>,
 *   writeAward: (uuid, xp: number, id: string, record: object) => Promise<void>}} deps
 * @returns {Promise<{refused?: string, stopped?: string, results?: object[], pending?: string[]}>}
 */
export function runAward(award, deps) {
  return deps.queue(async () => {
    const first = deps.guard();
    if (first) return { refused: first };
    const results = award.recipients.map((r) => ({ ...r, delta: award.share, status: "pending" }));
    let stopped;
    for (const r of results) {
      try {
        const { xp, awards } = await deps.readActor(r.uuid);
        const skip = recipientStatus(awards, award);
        if (skip) {
          Object.assign(r, { status: skip, before: xp, after: xp });
          continue;
        }
        const audit = auditAwards(xp, awards);
        if (audit.status === "lost" && !award.acceptDivergence) {
          Object.assign(r, { status: "diverged", before: xp, after: xp, expected: audit.expected });
          continue;
        }
        // No await between this check and the update call.
        stopped = deps.guard() ?? undefined;
        if (stopped) break;
        Object.assign(r, { before: xp, target: xp + award.share });
        await deps.writeAward(r.uuid, r.target, award.id, awardRecord(award, xp, nextSeq(awards)));
        const after = (await deps.readActor(r.uuid)).xp;
        Object.assign(r, { after, status: after === r.target ? "done" : "conflict" });
      } catch (err) {
        Object.assign(r, { status: "error", error: String(err?.message ?? err) });
      }
    }
    const pending = results.filter((r) => ["pending", "error", "diverged"].includes(r.status)).map((r) => r.name);
    return { results, stopped, pending };
  });
}
