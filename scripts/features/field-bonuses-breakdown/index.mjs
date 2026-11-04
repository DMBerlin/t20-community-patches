/**
 * Sheet breakdowns that disagree with the prepared value (tormenta20 1.6.5).
 *
 * The `fieldBonuses` Handlebars helper (T20:3081-3290) rebuilds the total of PV, PM, perícias and Defesa from its own
 * list. That list diverges from the prepared value:
 * - manual: the manual PV/PM bonuses per level are summed once ("Configuração Manual") and the manual total is missing;
 * - zeroLevel: a per-even-level bonus at level 1 has multiplier 0, which is falsy, so it is added once;
 * - formula: a value without "@" goes through Number() ("2+1" is NaN) and "1+1" per level becomes "1+1 * 5";
 * - types: modifiedFields entries carry `type` but the helper reads `mode`, so override and multiply show as additions;
 * - wildcard: `system.pericias.*.bonus` keeps its literal key in modifiedFields and never reaches a skill;
 * - heavyArmor: with heavy armor the Defesa drops the attribute; prepareDefense adds clamp(attr, 0, maxAtr);
 * - defenseSources: the Defesa shows "Outros" as one aggregated number and the conditions as one line, so the player
 *   cannot tell which effect changes it nor why a condition did nothing;
 * - armorSlots: the Defesa lists every equipped item with a Defesa value, while AttributesFields.prepareDefense (T20:18717) only
 *   adds the first armor and the first shield.
 *
 * modifiedFields also lists changes that never reached the actor (#91): the ones a feature cut (item-effective-stats,
 * source-stacking, prone-defense) and, outside effects, what non-proficiency adds in prepareSkill is missing. When
 * the applied-changes service has a published cycle for the actor, the copy is built from what was really applied,
 * the cut contributions are listed muted with their reason and, for the Defesa and the skills, a residual line
 * ("Outros (não identificado)") makes the total match the sheet.
 *
 * Fix: during the call the actor's modifiedFields is shadowed by a normalized copy (array fields simulated as the core
 * applies them, wildcards expanded, values evaluated, manual elements listed); afterwards the system's "Configuração
 * Manual" line is removed, the heavy armor attribute line is added and the Defesa "Outros" line is split by source.
 * Each part is installed only when its bug is recognized in the helper's source, so a partial fix upstream is never
 * doubled.
 */
import { HELPER, install, isNeeded } from "./integration.mjs";

export default {
  id: "field-bonuses-breakdown",
  group: "sheet-effects",
  issue: 70,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  sources: [
    HELPER,
    "ActorT20#modifiedFields",
    "ActiveEffectT20._prepareProxyChange",
    "AttributesFields.prepareDefense",
    "AttributesFields.preparePVPM",
    "MenaceData#prepareBaseData"
  ],
  // The breakdown lists the Defesa conditions only when field-bonuses-tooltip is applied; what the other features cut
  // or add comes from applied-changes (#91).
  interactsWith: ["field-bonuses-tooltip"],
  services: ["applied-changes"],
  isNeeded,
  install
};
