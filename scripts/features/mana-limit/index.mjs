/**
 * Optional rule "Limite de PM por uso" (#25).
 *
 * Book rule: a use cannot spend more PM than the level in the class that grants the ability (or the character
 * level for race, origin, general and granted powers), but the minimum cost is always allowed. The system does
 * not enforce it. This rule checks the cost the system will actually spend, before the dialog applies the form,
 * and warns or blocks (setting). A per-item flag overrides the limit; an unknown source only warns.
 */
import { MANA_LIMIT_SETTING } from "./domain.mjs";
import { install } from "./integration.mjs";

/**
 * World setting. The lifecycle registers it on "init" for every system, so it always exists.
 * @type {import("../../kernel/feature.mjs").SettingSpec}
 */
const SETTING_SPEC = {
  key: MANA_LIMIT_SETTING,
  name: "T20CP.ManaLimit.Setting.Name",
  hint: "T20CP.ManaLimit.Setting.Hint",
  scope: "world",
  type: String,
  choices: {
    off: "T20CP.ManaLimit.Setting.off",
    warn: "T20CP.ManaLimit.Setting.warn",
    block: "T20CP.ManaLimit.Setting.block"
  },
  default: "warn"
};

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "mana-limit",
  kind: "rule",
  group: "usage-effects",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  services: ["use-dialog-guard"],
  install
};
