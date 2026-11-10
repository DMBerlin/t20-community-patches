/**
 * Global skill modifiers with attribute formulas (tormenta20 1.6.5).
 *
 * Bug: every CreatureData type's prepareDerivedData (T20:18937-18944, 19089-19093, 19133-19137) calls
 * actor.getRollData() before prepareAtributos. getRollData (T20:5909-6003) already reduces each list of
 * system.modificadores to a number (@pericia, @semataque, @ataque, @resistencia, @dano…) with the attributes as they
 * are then, without the temporary bonuses (system.atributos.*.bonus). prepareAtributos (T20:18662-18668) adds the
 * bonus and updates rollData[attr], but not the reduced modifiers, so prepareSkill uses the stale numbers: a skill
 * modifier "@car" with Carisma 3 + 2 adds 3, on the sheet and on the roll, while the sheet breakdown shows 5.
 *
 * On Foundry 14 a second link freezes the same stale values earlier: Actor#applyActiveEffects resolves the "@" references
 * of every change value with the rollData taken before the phase (DataField#_replaceDataRefs), so a change "@car" to
 * system.modificadores.pericias.geral is stored as "3", and getRollData has no formula left to reduce again.
 *
 * Fix: the element fields of the 15 modifier lists keep attribute references (@for…@car, @atributoChave,
 * @atributos.*) as text when a change is applied, resolving every other reference as the core does. Then, after the
 * original prepareAtributos, when an attribute has a temporary bonus, atributoChave and the modifiers
 * getRollData reduces are reduced again, in getRollData's order and with the system's own simplifyRollFormula, in the
 * same rollData, before Defesa and skills are prepared. PV/PM are prepared earlier and keep ignoring temporary bonuses.
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "skill-modifier-attributes",
  group: "actor",
  issue: 68,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  probeKind: "behavior",
  sources: [
    "CreatureData#prepareAtributos",
    "CharacterData#prepareDerivedData",
    "MenaceData#prepareDerivedData",
    "SimpleData#prepareDerivedData",
    "ActorT20#getRollData"
  ],
  isNeeded,
  install
};
