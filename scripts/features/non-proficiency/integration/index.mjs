/** Installs the rule; every piece of runtime state lives in the `env` created here, one per install. */
import { allActors } from "../../../lib/actors.mjs";
import { NON_PROFICIENCY_SETTING } from "../domain/index.mjs";
import { installAttack, notifyUnrecognized } from "./attack.mjs";
import { installSkillTooltip, installSkills, markRows } from "./skills.mjs";

/**
 * @param {import("../../../kernel/feature.mjs").FeatureContext} ctx
 */
function createEnv(ctx) {
  const appliedChanges = ctx.services["applied-changes"] ?? null;
  const env = {
    platform: ctx.platform,
    log: ctx.log,
    wrap: ctx.wrap,
    stateByRollData: new WeakMap(),
    /** Extra penalty added to each skill in the last preparation, by the actor's system data (read by the tooltip). */
    extraBySystem: new WeakMap(),
    unrecognized: new Set(),
    warned: false,
    appliedChanges,
    isOn: () => ctx.setting(NON_PROFICIENCY_SETTING) === "on",
    /** The armor penalty follows armor-penalty-reduction when that patch is applied. */
    reductionApplied: () => ctx.features.isActive("armor-penalty-reduction"),
    // Only for an actor whose preparation was recorded: otherwise the breakdown has no contribution to list.
    breakdownOwnsLine: (actor) => Boolean(appliedChanges?.changes(actor)) && ctx.features.isActive("field-bonuses-breakdown"),
    warnOnce(err) {
      if (env.warned) return;
      env.warned = true;
      ctx.log.error("failed, the system's value was kept", err);
    }
  };
  return env;
}

function refreshActors(ctx) {
  for (const actor of allActors(ctx.platform.documents)) {
    try {
      actor.reset();
      if (actor.sheet?.rendered) actor.sheet.render(false);
    } catch (err) {
      ctx.log.error(`failed to refresh ${actor?.name}`, err);
    }
  }
}

/** Installs both wrappers and the sheet marker. The wrappers are inert while the setting is off. */
export function install(ctx) {
  const env = createEnv(ctx);
  installAttack(env);
  installSkills(env);
  installSkillTooltip(env);
  ctx.hooks.once("ready", () => notifyUnrecognized(env));
  ctx.hooks.on("renderActorSheetT20", (app, html) => {
    try {
      markRows(env, app.actor, html);
    } catch (err) {
      env.warnOnce(err);
    }
  });
  ctx.onSettingChange(NON_PROFICIENCY_SETTING, () => {
    refreshActors(ctx);
    notifyUnrecognized(env);
  });
}
