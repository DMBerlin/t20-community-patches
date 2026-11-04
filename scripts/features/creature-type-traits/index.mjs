/**
 * Optional rule "Traços de tipo de criatura" (#50).
 *
 * Book (Tormenta20 Jogo do Ano, cap. 7, "Tipos de Criaturas", p. 284): constructs and undead are immune to fatigue,
 * metabolic and poison effects (undead also to darkness), undead are harmed by magical light healing (Will halves) and
 * healed by darkness damage, and constructs do not recover HP from healing effects. The system stores the creature
 * type (system.detalhes.tipo) but no mechanic reads it.
 *
 * - Immunity: wraps the BaseEffect getter isSuppressedByImunity (T20:17817), reading the type from source data, so a
 *   condition is suppressed already in the "initial" phase; its children follow by inheritance (T20:17780).
 * - Notice: createActiveEffect tells the user who applied an immune condition (if they can see the actor).
 * - Damage: wraps ActorT20#applyDamageV2 (T20:7360) and makes ONE call to the inner chain with rewritten terms, so the
 *   HP change stays a single update; a view of the actor splits the chat card per operation.
 */
import { CREATURE_TYPE_TRAITS_SETTING } from "./domain.mjs";
import { install } from "./integration.mjs";

/**
 * World setting. The lifecycle registers it on "init" for every system, so it always exists.
 * Changing it prepares the actors again (ctx.onSettingChange, in install).
 * @type {import("../../kernel/feature.mjs").SettingSpec}
 */
const SETTING_SPEC = {
  key: CREATURE_TYPE_TRAITS_SETTING,
  name: "T20CP.CreatureTypeTraits.Setting.Name",
  hint: "T20CP.CreatureTypeTraits.Setting.Hint",
  scope: "world",
  type: String,
  choices: { off: "T20CP.CreatureTypeTraits.Setting.off", on: "T20CP.CreatureTypeTraits.Setting.on" },
  default: "off"
};

/** @type {import("../../kernel/feature.mjs").Feature} */
export default {
  id: "creature-type-traits",
  kind: "rule",
  group: "actor",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  after: ["death-threshold-floor", "nonlethal-damage"],
  install
};
