import { MODULE_ID } from "../utils.mjs";
import {
  canLevelUp,
  computeAward,
  createPlanMessage,
  encounterNd,
  findOverlap,
  groupLevel,
  ndLabel,
  knownAwards,
  listDivergences,
  listPending,
  parseNd,
  recipientsError,
  reportRun,
  resolveEncounterNd,
  resumeRewards,
  runAward,
  foundryDeps
} from "../rules/encounter-xp.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM dialog of the encounter rewards: pick challenges, characters and options, preview, confirm. The award id is fixed
 * when the dialog opens; after an interrupted run the form is locked and "Retomar" runs the same id again.
 */
export class RewardsDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "t20cp-rewards",
    tag: "form",
    classes: ["t20cp-rewards"],
    window: { title: "T20CP.EncounterXp.Dialog.Title", icon: "fa-solid fa-trophy", contentClasses: ["standard-form"] },
    position: { width: 640, height: "auto" },
    form: { handler: RewardsDialog.#onSubmit, closeOnSubmit: false },
    actions: { resume: RewardsDialog.#onResume }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/rewards-dialog.hbs`, scrollable: [""] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  #challenges;
  #recipients;
  #source;
  #awardId;
  #locked = false;
  #options = { outcome: "victory", mode: "creature", encounter: "", skipIrrelevant: true, level: null, publicSummary: true, repeat: false, completeOnly: false, confirmUnlinked: false, acceptDivergence: false };
  #submitting = false;

  constructor({ awardId, challenges, recipients, source, ...options }) {
    super(options);
    this.#awardId = awardId;
    this.#challenges = challenges.map((c) => ({ ...c }));
    this.#recipients = recipients.map((r) => ({ ...r }));
    this.#source = source;
  }

  #selected() {
    return this.#recipients.filter((r) => r.selected);
  }

  #level() {
    return this.#options.level ?? groupLevel(this.#selected().map((r) => r.level));
  }

  #suggestedEncounter() {
    return encounterNd(this.#challenges.filter((c) => c.won && c.nd).map((c) => c.nd)) || null;
  }

  #award() {
    let encounter = null;
    if (this.#options.mode === "encounter") {
      const resolved = resolveEncounterNd(this.#options.encounter, this.#suggestedEncounter());
      if (resolved.error) return { error: resolved.error };
      encounter = resolved.value;
    }
    const award = computeAward({
      challenges: this.#challenges,
      recipientCount: this.#selected().length,
      mode: this.#options.mode,
      encounter,
      outcome: this.#options.outcome,
      skipIrrelevant: this.#options.skipIrrelevant,
      level: this.#level()
    });
    if (award.error) return award;
    const error = recipientsError(this.#selected(), this.#options.confirmUnlinked);
    return error ? { ...award, error } : award;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const award = this.#award();
    const rows = new Map((award.rows ?? []).map((r) => [r.key, r]));
    const table = CONFIG.T20?.xpPorNivel ?? [];
    const awards = knownAwards();
    const overlap = findOverlap(awards, this.#challenges.filter((c) => c.won).map((c) => c.key), this.#awardId);
    const describe = (a, list) => ({
      id: a.id,
      date: new Date(a.at).toLocaleString(game.i18n.lang),
      share: a.share,
      names: list.map((r) => r.name).join(", "),
      private: a.toPlayers === false
    });

    context.challenges = this.#challenges.map((c, i) => ({
      ...c,
      index: i,
      invalid: c.won && !c.nd,
      xp: rows.get(c.key)?.irrelevant ? game.i18n.localize("T20CP.EncounterXp.Chat.Irrelevant") : rows.get(c.key)?.xp ?? ""
    }));
    context.recipients = this.#recipients.map((r, i) => ({
      ...r,
      index: i,
      levelUp: r.selected && !award.error && canLevelUp(r.level, r.xp + award.share, table)
    }));
    context.hasUnlinked = this.#selected().some((r) => r.unlinked);
    context.hasChallenges = this.#challenges.length > 0;
    context.options = { ...this.#options, level: this.#level(), encounterSuggested: ndLabel(this.#suggestedEncounter() ?? 0) };
    context.outcomes = { victory: "T20CP.EncounterXp.Dialog.Outcomes.victory", draw: "T20CP.EncounterXp.Dialog.Outcomes.draw", defeat: "T20CP.EncounterXp.Dialog.Outcomes.defeat" };
    context.modes = { creature: "T20CP.EncounterXp.Dialog.Modes.creature", encounter: "T20CP.EncounterXp.Dialog.Modes.encounter" };
    context.award = award;
    context.error = award.error && context.hasChallenges ? game.i18n.localize(`T20CP.EncounterXp.Error.${award.error}`) : "";
    context.overlap = overlap.map((a) => describe(a, a.recipients));
    context.pending = awards.filter((a) => a.pending.length && a.id !== this.#awardId).map((a) => describe(a, a.pending));
    context.locked = this.#locked;
    context.frozen = this.#locked || this.#submitting;
    context.divergences = listDivergences().map((d) => ({ ...d, expected: d.expected ?? "?" }));
    context.acceptDivergence = this.#options.acceptDivergence;
    context.buttons = [{
      type: "submit",
      icon: this.#locked ? "fa-solid fa-rotate-right" : "fa-solid fa-check",
      label: this.#locked ? "T20CP.EncounterXp.Dialog.Resume" : "T20CP.EncounterXp.Dialog.Confirm",
      disabled: !!award.error || this.#submitting || (!this.#locked && overlap.length && !this.#options.repeat && !this.#options.completeOnly)
    }];
    return context;
  }

  /** Keeps the dialog state in sync with the form and refreshes the preview. */
  _onChangeForm(formConfig, event) {
    super._onChangeForm(formConfig, event);
    const data = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    // Outside the locked fieldset: the only choice still open after an interruption.
    this.#options.acceptDivergence = !!data.acceptDivergence;
    if (this.#locked || this.#submitting) return this.render();
    for (const [i, c] of this.#challenges.entries()) {
      const row = data.challenges?.[i] ?? {};
      c.won = !!row.won;
      const parsed = parseNd(row.nd);
      c.nd = parsed?.value ?? null;
      c.ndLabel = parsed?.label ?? String(row.nd ?? "");
      c.special = !!parsed?.special;
    }
    for (const [i, r] of this.#recipients.entries()) r.selected = !!data.recipients?.[i]?.selected;
    const levelTouched = event.target?.name === "level";
    Object.assign(this.#options, {
      outcome: data.outcome,
      mode: data.mode,
      encounter: String(data.encounter ?? ""),
      skipIrrelevant: !!data.skipIrrelevant,
      level: levelTouched ? Math.max(1, Math.min(20, Number(data.level) || 1)) : this.#options.level,
      publicSummary: !!data.publicSummary,
      repeat: !!data.repeat,
      completeOnly: !!data.completeOnly,
      confirmUnlinked: !!data.confirmUnlinked
    });
    this.render();
  }

  static async #onSubmit() {
    if (this.#submitting) return;
    // After an interruption the same award is resumed from its GM plan, never recomputed from the form.
    if (this.#locked) return this.#resume(this.#awardId);
    const award = this.#award();
    if (award.error) return ui.notifications.warn(`T20CP.EncounterXp.Error.${award.error}`, { localize: true });
    this.#submitting = true;
    let run;
    let failed;
    try {
      // Frozen before the first await: later form edits cannot change this award.
      const won = this.#challenges.filter((c) => c.won).map((c) => ({ ...c }));
      const data = {
        id: this.#awardId,
        at: Date.now(),
        by: game.user.id,
        source: this.#source,
        outcome: this.#options.outcome,
        repeat: this.#options.repeat,
        toPlayers: this.#options.publicSummary,
        acceptDivergence: this.#options.acceptDivergence,
        share: award.share,
        challenges: won.map((c) => c.key),
        recipients: this.#selected().map((r) => ({ uuid: r.actorUuid, name: r.name, level: r.level }))
      };
      this.render();
      const plan = await createPlanMessage(data, won, award);
      run = await runAward(data, foundryDeps);
      if (run.pending?.length) this.#locked = true;
      await reportRun(run, { outcome: data.outcome, repeat: data.repeat, challenges: won, computed: award, toPlayers: data.toPlayers, plan });
    } catch (err) {
      failed = err;
    } finally {
      this.#submitting = false;
    }
    if (failed) {
      // The form unfreezes; after a partial run it stays locked on "Retomar" (#locked is set before reportRun).
      console.error(`${MODULE_ID} | Encounter rewards failed`, failed);
      ui.notifications.error(String(failed?.message ?? failed));
    }
    if (run && (run.refused || !run.pending.length)) return this.close();
    this.render();
  }

  async #resume(id) {
    if (this.#submitting) return;
    this.#submitting = true;
    try {
      // The value, recipients and summary audience come from the GM plan of that award.
      await resumeRewards(id, { acceptDivergence: this.#options.acceptDivergence });
    } catch (err) {
      console.error(`${MODULE_ID} | Encounter rewards resume failed`, err);
      ui.notifications.error(String(err?.message ?? err));
    } finally {
      this.#submitting = false;
    }
    if (id === this.#awardId && !listPending().some((a) => a.id === id)) return this.close();
    this.render();
  }

  static async #onResume(event, target) {
    return this.#resume(target.dataset.id);
  }
}
