import { isCandidate, repairUpdate, sameStatus, statusFromFlags, undoPlan } from "../domain.mjs";

/** Writing needs the active GM. Checked when a run starts and before every parent, so a run stops if it moves. */
export const canWrite = (platform) => platform.user.isGM() && platform.user.isActiveGM();

const byId = (sources, id) => (sources ?? []).find((source) => source?._id === id);

/** Only the previewed effects that are still candidates and would still get the status the GM approved. */
export function repairUpdates(group, sources, meta) {
  const updates = [];
  let skipped = 0;
  for (const { id, status } of group.candidates) {
    const source = byId(sources, id);
    const same = isCandidate(source) && sameStatus(statusFromFlags(source.flags.tormenta20), status);
    if (same) updates.push(repairUpdate(source, meta));
    else skipped += 1;
  }
  return { updates, skipped };
}

/** Only the marks shown in the preview, read again from the parent's own sources. */
export function undoUpdates(group, sources) {
  const updates = [];
  let skipped = 0;
  for (const { id } of group.marks) {
    const plan = undoPlan(byId(sources, id));
    if (plan?.kind === "undo") updates.push(plan.update);
    else skipped += 1;
  }
  return { updates, skipped };
}

async function writeGroup(ctx, group, build, result) {
  const size = (group.candidates ?? group.marks).length;
  try {
    const target = group.locate();
    if (!target) {
      result.skipped += size;
      return;
    }
    const { updates, skipped } = build(group, target.sources);
    result.skipped += skipped;
    if (!updates.length) return;
    // The core may cancel (preUpdate hooks) or drop (validation) some updates without rejecting: count what came back.
    const changed = await target.doc.updateEmbeddedDocuments("ActiveEffect", updates);
    const written = new Set((changed ?? []).map((doc) => doc?.id));
    const done = updates.filter((update) => written.has(update._id)).length;
    result.done += done;
    if (done < updates.length) result.failed.push(`${group.label} (${updates.length - done})`);
  } catch (err) {
    ctx.log.error(`failed on ${group.label}`, err);
    result.failed.push(group.label);
  }
}

/**
 * One write over the previewed groups. `lock` is created by install() and shared by repair, undo and every window.
 * @returns {Promise<{done: number, skipped: number, failed: string[], stopped: boolean}|null>} null when another run
 *   is in progress or the user cannot write.
 */
export async function runWrite(ctx, lock, groups, build) {
  if (lock.busy || !canWrite(ctx.platform)) return null;
  lock.busy = true;
  const result = { done: 0, skipped: 0, failed: [], stopped: false };
  try {
    for (const group of groups) {
      if (!canWrite(ctx.platform)) {
        result.stopped = true;
        break;
      }
      await writeGroup(ctx, group, build, result);
    }
  } finally {
    lock.busy = false;
  }
  return result;
}

export function repairAll(ctx, lock, groups) {
  const meta = { at: new Date().toISOString(), moduleVersion: ctx.platform.module.version() };
  return runWrite(ctx, lock, groups, (group, sources) => repairUpdates(group, sources, meta));
}

export function undoAll(ctx, lock, groups) {
  return runWrite(ctx, lock, groups, undoUpdates);
}
