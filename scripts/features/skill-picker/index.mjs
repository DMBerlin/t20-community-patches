/**
 * Optional rule "Escolha de perícias" (#60).
 *
 * Book: Treinamento em Perícia, Versátil and other powers make the character trained in skills of their choice.
 * The compendium items have no effects, and the system's picker (PericiaSelection) only runs for items tagged
 * "pericia", which no item has, and never for powers granted by a race. When on, this rule asks for the skills
 * while one of these powers is created on a character (any path) and stores the training as transfer effects on
 * the power, in the same shape as the system's _applyTreinado, so removing the power removes the training.
 */
import { install } from "./integration.mjs";
import { SETTING_SPEC } from "./settings.mjs";

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "skill-picker",
  kind: "rule",
  group: "actor",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  after: ["initial-class"],
  install
};
