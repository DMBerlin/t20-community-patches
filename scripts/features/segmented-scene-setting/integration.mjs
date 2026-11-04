import {
  DEFAULT_LIMIT,
  LIMIT_KEY,
  MENU_KEY,
  SETTING_KEY,
  SETTING_NAMESPACE,
  exceedsLimit,
  needsFix,
  resolveLimit
} from "./domain.mjs";
import { createConfigClass } from "./ui.mjs";

const systemSettings = (ctx) => ctx.platform.settingsOf(SETTING_NAMESPACE);

function getSetting(ctx) {
  return systemSettings(ctx).entry(SETTING_KEY);
}

function getLimit(ctx) {
  return resolveLimit(ctx.setting(LIMIT_KEY));
}

/** Warns the GMs when the stored number of segments is above the cap. */
function warnIfOverLimit(ctx) {
  if (!ctx.platform.user.isGM()) return;
  const scene = systemSettings(ctx).get(SETTING_KEY);
  const limit = getLimit(ctx);
  if (!exceedsLimit(scene, limit)) return;
  ctx.platform.notify.warn(ctx.platform.i18n.format("T20CP.SegmentedScene.StoredOverLimit", { max: scene.max, limit }), {
    permanent: true
  });
}

/**
 * The scene limit. The lifecycle registers it only while this patch is applied (before install()).
 * @type {import("../../kernel/feature.mjs").SettingSpec}
 */
export const LIMIT_SPEC = {
  key: LIMIT_KEY,
  name: "T20CP.SegmentedScene.Limit.Name",
  hint: "T20CP.SegmentedScene.Limit.Hint",
  scope: "world",
  // Built on registration, during "init": the core fields are not available when the module is imported by the tests.
  typeOf: (platform) =>
    new platform.core.fields.NumberField({
      required: true,
      nullable: false,
      integer: true,
      min: 1,
      initial: DEFAULT_LIMIT
    }),
  default: DEFAULT_LIMIT,
  centerId: "segmented-scene-limit"
};

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const setting = getSetting(ctx);
  if (!setting) throw new Error(`${SETTING_NAMESPACE}.${SETTING_KEY} is not registered`);
  ctx.onSettingChange(LIMIT_KEY, () => warnIfOverLimit(ctx));
  if (!needsFix(setting, ctx.platform.core.fields.DataField)) return;

  setting.config = false;
  systemSettings(ctx).registerMenu(MENU_KEY, {
    name: "T20CP.SegmentedScene.Name",
    label: "T20CP.SegmentedScene.Button",
    hint: "T20CP.SegmentedScene.Hint",
    icon: "fa-solid fa-film",
    type: createConfigClass(ctx, () => getLimit(ctx)),
    restricted: true
  });

  ctx.hooks.once("ready", () => warnIfOverLimit(ctx));
  // The first save of a world setting creates its document; later saves update it.
  const onSettingChange = (doc) => {
    if (doc?.key === `${SETTING_NAMESPACE}.${SETTING_KEY}`) warnIfOverLimit(ctx);
  };
  ctx.hooks.on("createSetting", onSettingChange);
  ctx.hooks.on("updateSetting", onSettingChange);
}

/**
 * The bug exists while the setting is shown in the settings window with a field type that cannot be rendered.
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 * @returns {boolean|undefined}
 */
export function isNeeded(ctx) {
  const setting = getSetting(ctx);
  const DataField = ctx.platform.core.fields?.DataField;
  if (!setting || !DataField) return undefined;
  return needsFix(setting, DataField);
}
