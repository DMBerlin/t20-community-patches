/**
 * Optional rule "Máximo de aplicações de efeitos de uso" (#26).
 *
 * The system lets an "Aumenta" usage effect be applied any number of times, but many abilities grow with the
 * level (the Bard's Inspiration: +1 every four levels). Each usage effect may have a maximum number of
 * applications, given by a dice-free formula: the effect's flag wins, then a built-in default for known
 * effects. The use dialog shows the maximum and the submit is checked; the GM picks warn, block or off.
 * A misconfigured formula never blocks: it means "no limit", with a single console warning.
 */
import { USAGE_EFFECT_MAX_SETTING } from "../../lib/usage-limits.mjs";
import { install } from "./integration.mjs";

/**
 * World setting. The lifecycle registers it on "init" for every system, so it always exists.
 * @type {import("../../kernel/feature.mjs").SettingSpec}
 */
const SETTING_SPEC = {
  key: USAGE_EFFECT_MAX_SETTING,
  name: "T20CP.UsageEffectMax.Setting.Name",
  hint: "T20CP.UsageEffectMax.Setting.Hint",
  scope: "world",
  type: String,
  choices: {
    off: "T20CP.UsageEffectMax.Setting.off",
    warn: "T20CP.UsageEffectMax.Setting.warn",
    block: "T20CP.UsageEffectMax.Setting.block"
  },
  default: "warn"
};

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "usage-effect-max",
  kind: "rule",
  group: "usage-effects",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  services: ["use-dialog-guard"],
  install
};
