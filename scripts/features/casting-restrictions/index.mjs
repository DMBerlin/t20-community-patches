/**
 * Optional rules "Restrições ao lançar magias" (#37). Each one has its own world setting, off by default.
 *
 * - One sustained spell at a time (Tormenta20 JdA, p. 227), two with Fluxo de Mana (p. 38): warns when casting and when
 *   applying. Card effects are stamped with the cast; cast order comes from the server-managed creation time of the
 *   card messages. Nothing is ended or refused.
 * - Conditions that prevent casting (p. 394-395, p. 170; reactions follow p. 233): checked before the use dialog.
 * - Concentration in a bad condition (p. 170): casting while Caído or Surdo posts the Vontade DC (15 + PM spent).
 */
import {
  CASTING_CONDITION_MODES,
  CASTING_CONDITION_SETTING,
  CONCENTRATION_MODES,
  CONCENTRATION_SETTING,
  SUSTAINED_SPELL_MODES,
  SUSTAINED_SPELL_SETTING
} from "./domain/index.mjs";
import { install } from "./integration/index.mjs";

/** @returns {import("../../kernel/feature.mjs").SettingSpec} */
const settingSpec = (key, prefix, modes) => ({
  key,
  name: `T20CP.CastingRestrictions.${prefix}.Setting.Name`,
  hint: `T20CP.CastingRestrictions.${prefix}.Setting.Hint`,
  scope: "world",
  type: String,
  choices: Object.fromEntries(modes.map((m) => [m, `T20CP.CastingRestrictions.${prefix}.Setting.${m}`])),
  default: "off"
});

/** World settings. The lifecycle registers them on "init" for every system, so they always exist. */
const SETTING_SPECS = [
  settingSpec(SUSTAINED_SPELL_SETTING, "Sustained", SUSTAINED_SPELL_MODES),
  settingSpec(CASTING_CONDITION_SETTING, "Conditions", CASTING_CONDITION_MODES),
  settingSpec(CONCENTRATION_SETTING, "Concentration", CONCENTRATION_MODES)
];

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "casting-restrictions",
  kind: "rule",
  group: "usage-effects",
  system: { id: "tormenta20" },
  settings: SETTING_SPECS,
  after: ["save-button", "attack-vs-defense", "situational-modifiers", "concealment-miss-chance", "combat-maneuvers", "arcane-armor", "usage-effect-max"],
  services: ["use-dialog-guard"],
  install
};
