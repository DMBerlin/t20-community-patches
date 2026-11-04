/**
 * Optional GM tool: awards encounter XP (Tormenta20 Jogo do Ano, cap. 7, "Pontos de Experiência", p. 326).
 * Each defeated challenge is worth ND × 1,000 XP, split evenly among the characters; a draw is worth half and a
 * defeat a quarter; a challenge 5 or more points below the group level is worth nothing. Treasure is not generated:
 * the GM summary only points to the creature's treasure text and to the book table.
 *
 * Publishes api.rewards ({open, pending, resume, divergences}), used by user macros.
 */
import { SETTING_SPEC, install } from "./integration/index.mjs";

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "encounter-xp",
  kind: "rule",
  group: "settings",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  install
};
