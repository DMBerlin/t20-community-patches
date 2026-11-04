/** Install of the encounter rewards: scene control, end-of-combat hook, audits, setting listener and api.rewards. */
import { MODULE_ID } from "../../../lib/module.mjs";
import { AWARDS_FLAG, auditAwards, partitionSnapshot } from "../domain/index.mjs";
import { XP_AWARDS_SETTING, createWorld, recordedAwards, xpOf } from "./world.mjs";
import { createRewards } from "./rewards.mjs";

export { XP_AWARDS_SETTING };

/**
 * The onChange (re-render the scene controls, close the dialog when switched off) is registered by install through
 * ctx.onSettingChange.
 * @type {import("../../../kernel/feature.mjs").SettingSpec}
 */
export const SETTING_SPEC = {
  key: XP_AWARDS_SETTING,
  name: "T20CP.EncounterXp.Setting.Name",
  hint: "T20CP.EncounterXp.Setting.Hint",
  scope: "world",
  type: String,
  choices: {
    off: "T20CP.EncounterXp.Setting.off",
    button: "T20CP.EncounterXp.Setting.button",
    combat: "T20CP.EncounterXp.Setting.combat"
  },
  default: "off"
};

/** @param {import("../../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const { platform } = ctx;
  const world = createWorld(ctx);
  const rewards = createRewards(ctx, world);

  ctx.hooks.on("getSceneControlButtons", (controls) => {
    if (!platform.user.isGM() || world.mode() === "off") return;
    controls.tokens.tools.t20cpRewards = {
      name: "t20cpRewards",
      title: "T20CP.EncounterXp.Control",
      icon: "fa-solid fa-trophy",
      order: Object.keys(controls.tokens.tools).length,
      button: true,
      visible: true,
      onChange: () => rewards.openRewards()
    };
  });
  ctx.hooks.on("deleteCombat", (combat) => {
    // The hook runs on every client; only the active GM opens the dialog, whoever ended the combat.
    if (world.currentBlock() || world.mode() !== "combat" || !combat.started) return;
    const rows = world.snapshotCombat(combat);
    if (!partitionSnapshot(rows).challenges.length) return;
    rewards.openRewards({ rows, source: `combat:${combat.id}` });
  });
  // Another GM connecting (or this one losing the role) changes game.users.activeGM: drop a stale dialog.
  ctx.hooks.on("userConnected", () => {
    if (!platform.user.isActiveGM()) rewards.closeRewardsDialog();
  });
  // Every client receives the update (core client-backend.mjs:596, :337); the active GM audits the sheet when an award
  // record arrives, so a late write that overwrote newer XP is reported instead of passing in silence.
  ctx.hooks.on("updateActor", (actor, change) => {
    if (world.mode() === "off" || !platform.user.isActiveGM() || !platform.utils.hasProperty(change, `flags.${MODULE_ID}.${AWARDS_FLAG}`)) return;
    const audit = auditAwards(xpOf(actor), recordedAwards(actor));
    if (audit.status !== "lost") return;
    platform.notify.error(platform.i18n.format("T20CP.EncounterXp.Warn.Diverged", { name: actor.name, xp: xpOf(actor), expected: audit.expected ?? "?" }), { permanent: true });
  });

  ctx.onSettingChange(XP_AWARDS_SETTING, (value) => {
    platform.ui.renderControls({ reset: true });
    if (value === "off") rewards.closeRewardsDialog();
  });

  // Macros call these names and signatures: keep them.
  ctx.publish("rewards", {
    open: rewards.openRewards,
    pending: rewards.listPending,
    resume: rewards.resumeRewards,
    divergences: rewards.listDivergences
  });
}
