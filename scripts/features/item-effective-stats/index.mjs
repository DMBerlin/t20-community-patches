/**
 * Optional rule "Valor efetivo dos itens" (#65).
 *
 * Upgrades, materials and enchantments never show on the item itself: a Full Plate (-5) with Ajustada still shows
 * -5, although the skills use -4, and a Precisa long sword shows 19 but rolls with 18. This rule shows, on the item
 * sheet, the actor inventory and the item chat card, the final value with the breakdown of each source.
 *
 * Modes:
 * - "ends": nothing is drawn or changed (system behavior);
 * - "display" (default): base → effective with a tooltip; item data is untouched;
 * - "effective": same drawing, and the item's derived data (never the stored data) holds the final Defense,
 *   armor penalty and, when the whole chain can be folded, the critical range and multiplier. The actor and the
 *   roll skip what was folded, so nothing is applied twice.
 *
 * Source of truth: what the system and the active patches really apply. Only the item's own effects count.
 *
 * Wrapper order: this rule is installed after the patches and the other rules (after: ["*"]), so its wrappers sit
 * outside those of armor-penalty-reduction (ActiveEffect.applyChange) and threatening-crit-range
 * (_allApplicableOnUseEffects).
 */
import { install } from "./integration/index.mjs";
import { SETTING_SPEC } from "./settings.mjs";

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "item-effective-stats",
  kind: "rule",
  group: "items",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  after: ["*"],
  // Folds like the patches that are applied, and leaves the effects limited by usage-effect-max unfolded.
  interactsWith: ["armor-penalty-reduction", "threatening-crit-range", "usage-effect-max"],
  services: ["applied-changes"],
  install
};
