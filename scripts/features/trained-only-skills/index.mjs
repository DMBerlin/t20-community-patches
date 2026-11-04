/**
 * Optional rule "Perícias somente treinadas" (#62).
 *
 * Book (Tormenta20 Jogo do Ano, chapter 2, "Treinamento e testes", p. 114): a skill marked "treinada" can only be used
 * by characters trained in it. The system knows these skills (CONFIG.T20.pericias[key].trainedOnly, the actor's `st`)
 * but ActorT20#rollPericia (T20:7589) never checks them. Warn lets the roll happen, warns whoever rolled once and adds a
 * note to the card; Block stops the test, unless a usage effect that grants training for the test (Eclético, Cultura
 * Exótica) is checked in the use dialog or set to "Aplicar Sempre". Only characters are checked: the training data of
 * menaces is not reliable.
 *
 * Three points: a synchronous check before rollPericia, a validator of the use dialog (use-dialog-guard) and the
 * card note in ActorT20#displayCard. Nothing is kept between calls.
 */
import { TRAINED_ONLY_SETTING } from "./domain.mjs";
import { install } from "./integration.mjs";

/**
 * World setting. The lifecycle registers it on "init" for every system, so it always exists.
 * @type {import("../../kernel/feature.mjs").SettingSpec}
 */
const SETTING_SPEC = {
  key: TRAINED_ONLY_SETTING,
  name: "T20CP.TrainedOnly.Setting.Name",
  hint: "T20CP.TrainedOnly.Setting.Hint",
  scope: "world",
  type: String,
  choices: {
    off: "T20CP.TrainedOnly.Setting.off",
    warn: "T20CP.TrainedOnly.Setting.warn",
    block: "T20CP.TrainedOnly.Setting.block"
  },
  default: "off"
};

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "trained-only-skills",
  kind: "rule",
  group: "actor",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  after: ["usage-effect-max"],
  // Training ignores the usage effects suppressed-usage-effects hides, as rollPericia does with that patch.
  interactsWith: ["suppressed-usage-effects"],
  services: ["use-dialog-guard"],
  install
};
