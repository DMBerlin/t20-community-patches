/**
 * Installation: one engine (the fold state) per install, then the wrappers and the sheet hooks. Must run after the
 * patches and the other rules (after: ["*"]), so these wrappers are the outermost ones.
 */
import { USAGE_EFFECT_MAX_SETTING, usageLimitMode } from "../../../lib/usage-limits.mjs";
import { DEFAULT_MODE, ITEM_EFFECTIVE_STATS_SETTING, normalizeMode } from "../domain/index.mjs";
import { createEngine } from "./engine.mjs";
import { installSheets } from "./sheets.mjs";
import { installWrappers } from "./wrappers.mjs";

/**
 * The engine over the feature context: mode, applied patches and the usage-effect-max mode read on every use.
 * @param {import("../../../kernel/feature.mjs").FeatureContext} ctx
 */
export function createContextEngine(ctx) {
  const { platform } = ctx;
  return createEngine({
    mode: () => {
      try {
        return normalizeMode(ctx.setting(ITEM_EFFECTIVE_STATS_SETTING));
      } catch {
        return DEFAULT_MODE;
      }
    },
    patches: () => ({
      penaltyFix: !!ctx.features.isActive("armor-penalty-reduction"),
      threatFix: !!ctx.features.isActive("threatening-crit-range")
    }),
    usage: {
      mode: () => usageLimitMode(() => ctx.features.setting("usage-effect-max", USAGE_EFFECT_MAX_SETTING)),
      getProperty: (obj, path) => platform.utils.getProperty(obj, path)
    },
    parseUuid: () => platform.utils.parseUuid,
    equipmentSlots: () => platform.settingsOf("tormenta20").get("equipmentSlots"),
    log: ctx.log
  });
}

/** @param {import("../../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const engine = createContextEngine(ctx);
  installWrappers(ctx, engine, ctx.services["applied-changes"]);
  installSheets(ctx, engine);
}
