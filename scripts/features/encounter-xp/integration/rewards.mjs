/** Opening, running, reporting and resuming awards: the dialog's actions and the module API (api.rewards). */
import { MODULE_ID } from "../../../lib/module.mjs";
import { PLAN_FLAG, awardFromRecords, partitionSnapshot, planRecord, resumeAudience, runAward } from "../domain/index.mjs";
import { gmSummaryHtml, publicSummaryHtml } from "../ui/summary.mjs";
import { createRewardsDialogClass } from "../ui/rewards-dialog.mjs";

export const DIALOG_ID = "t20cp-rewards";

/**
 * @param {import("../../../kernel/feature.mjs").FeatureContext} ctx
 * @param {ReturnType<import("./world.mjs").createWorld>} world
 */
export function createRewards(ctx, world) {
  const { platform } = ctx;
  const t = (key, data) => (data ? platform.i18n.format(key, data) : platform.i18n.localize(key));
  const gmIds = () => platform.users.whisperRecipients("GM").map((u) => u.id);

  const warnBlock = (block) =>
    platform.notify.warn(platform.i18n.format(`T20CP.EncounterXp.Warn.Block.${block}`, { name: platform.users.activeGM()?.name ?? "?" }));

  /** Closes the open dialog: it belongs to a GM that may no longer distribute. */
  const closeRewardsDialog = () => platform.ui.application(DIALOG_ID)?.close();

  /** API: interrupted awards ({id, at, share, pending: [{uuid, name}]}), read from the actor flags. */
  const listPending = () => world.knownAwards().filter((a) => a.pending.length);

  /**
   * GM summary message, created before the first write with the plan in its flags; reportRun fills in the results.
   * @returns {Promise<object>}
   */
  const createPlanMessage = (award, challenges, computed) =>
    platform.chat.create({
      content: gmSummaryHtml(award, [], challenges, computed, t),
      whisper: gmIds(),
      flags: { [MODULE_ID]: { [PLAN_FLAG]: planRecord(award) } }
    });

  /**
   * Reports a run: warnings for refusal or stop, then the chat summaries. With `plan` (the GM message created before
   * the run), the GM summary is that message, updated with the results; a refused run deletes it, since nothing was
   * written.
   */
  async function reportRun(run, { outcome, repeat, challenges = [], computed = null, toPlayers = true, plan = null }) {
    if (run.refused) {
      warnBlock(run.refused);
      await plan?.delete();
      return run;
    }
    if (run.stopped) warnBlock(run.stopped);
    if (run.pending.length) platform.notify.warn(platform.i18n.format("T20CP.EncounterXp.Warn.Pending", { names: run.pending.join(", ") }));
    const gm = gmIds();
    const content = publicSummaryHtml(outcome, run.results, t, platform.t20Config()?.xpPorNivel ?? []);
    if (content) await platform.chat.create({ content, whisper: toPlayers ? [] : gm });
    if (computed) {
      const details = gmSummaryHtml({ repeat }, run.results, challenges, computed, t);
      if (plan) await plan.update({ content: details });
      else await platform.chat.create({ content: details, whisper: gm });
    }
    return run;
  }

  /**
   * API and dialog: resumes an interrupted award by id. Value, recipients and audience come from its GM plan (the
   * actor records are editable by players); only recipients without the award are written. The summary keeps the
   * audience of the plan unless `toPlayers` is given explicitly.
   */
  async function resumeRewards(id, { toPlayers, acceptDivergence = false } = {}) {
    const found = world.knownAwards().find((a) => a.id === id && a.verified);
    if (!found) {
      platform.notify.warn("T20CP.EncounterXp.Warn.Missing", { localize: true });
      return { refused: "missing" };
    }
    const audience = resumeAudience(found, toPlayers);
    const run = await runAward({ ...awardFromRecords(found, platform.user.id(), Date.now()), toPlayers: audience, acceptDivergence }, world.deps);
    return reportRun(run, { outcome: found.outcome, repeat: found.repeat, toPlayers: audience });
  }

  const actions = { world, createPlanMessage, reportRun, resumeRewards, listPending };
  let DialogClass;
  const dialogClass = () => (DialogClass ??= createRewardsDialogClass(ctx, actions));

  /** Snapshot rows of the explicit source, else of the selection, else of the active combat. */
  function snapshot({ combat, tokens, rows, source }) {
    if (rows) return { rows, source };
    if (!tokens && !combat) {
      tokens = platform.canvas.controlledTokens();
      if (!tokens.length) combat = platform.canvas.activeCombat();
    }
    if (tokens?.length) return { rows: world.snapshotTokens(tokens), source: "tokens" };
    if (combat) return { rows: world.snapshotCombat(combat), source: `combat:${combat.id}` };
    return { rows: [], source };
  }

  /**
   * Opens the dialog with a new award id. Only the active GM (core: game.users.activeGM) distributes. With nothing to
   * award, the dialog still opens when an interrupted award exists, so it can be resumed after its challenges are gone.
   * @param {{combat?: object, tokens?: object[], rows?: object[], source?: string}} [options]
   */
  async function openRewards(options = {}) {
    const block = world.currentBlock();
    if (block) return warnBlock(block);
    const { rows, source } = snapshot(options);
    const partition = partitionSnapshot(rows);
    const { challenges } = partition;
    let { recipients } = partition;
    if (!challenges.length) {
      if (!listPending().length) {
        return platform.notify.warn(rows.length ? "T20CP.EncounterXp.Warn.NoChallenges" : "T20CP.EncounterXp.Warn.NoSource", { localize: true });
      }
      recipients = [];
    } else if (!recipients.length) recipients = partitionSnapshot(world.snapshotPlayers()).recipients;
    const RewardsDialog = dialogClass();
    return new RewardsDialog({ awardId: platform.utils.randomID(), challenges, recipients, source }).render({ force: true });
  }

  return {
    openRewards,
    listPending,
    resumeRewards,
    listDivergences: world.listDivergences,
    closeRewardsDialog,
    warnBlock
  };
}
