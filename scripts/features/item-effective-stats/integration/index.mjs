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
 * Readable names of the change targets shown under "Effects on the bearer": the actor's skill labels (crafts and
 * custom skills) over CONFIG.T20.pericias, CONFIG.T20.atributos and a few fixed stats.
 * @param {import("../../../kernel/feature.mjs").FeatureContext["platform"]} platform
 * @param {object} item
 */
export function targetNamesOf(platform, item) {
  const config = platform.t20Config() ?? {};
  const loc = (value) => platform.i18n.localize(String(value ?? ""));
  const own = (key) => platform.i18n.localize(`T20CP.ItemEffectiveStats.Stat.${key}`);
  const skills = { ...skillLabels(config.pericias, loc), ...skillLabels(item?.parent?.system?.pericias, loc) };
  const abilities = Object.fromEntries(Object.entries(config.atributos ?? {}).map(([id, label]) => [id, loc(label)]));
  const hp = loc("T20.HP");
  const mp = loc("T20.MP");
  const named = {
    "attributes.defesa": own("defense"),
    "attributes.defesa.pda": own("penalty"),
    "attributes.pv": hp,
    "attributes.pv.max": hp,
    "attributes.pm": mp,
    "attributes.pm.max": mp
  };
  return { skills, abilities, named };
}

function skillLabels(skills, loc) {
  return Object.fromEntries(
    Object.entries(skills ?? {})
      .filter(([, skill]) => skill?.label)
      .map(([id, skill]) => [id, loc(skill.label)])
  );
}

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
    targetNames: (item) => targetNamesOf(platform, item),
    log: ctx.log
  });
}

/** @param {import("../../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const engine = createContextEngine(ctx);
  installWrappers(ctx, engine, ctx.services["applied-changes"]);
  installSheets(ctx, engine);
}
