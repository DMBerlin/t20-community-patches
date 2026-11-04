/**
 * Bug: CONFIG.T20.pericias.enge (Ofício: Engenhoqueiro) has armorPenalty, so new actors store pericias.enge.pda =
 * true and CreatureData#prepareSkill adds @pda to the skill (`armorPenalty`, T20:2274, 17749, 18676-18694). Ofício
 * takes no armor penalty (Tabela 2-1, p. 115; "Int • Treinada", p. 121).
 * Fix: in memory, before the 1.6.5 prepareSkill builds the Engenhoqueiro formula, turn its prepared pda off. Nothing is
 * written: CONFIG and stored actor data are left as they are, and the condition penalty (condi) is untouched. Updates
 * that carry the prepared value back (the system's custom Ofício creation) get the stored pda again.
 */
import { PATCH_ID } from "./domain.mjs";
import { install, isNeeded } from "./integration.mjs";

export default {
  id: PATCH_ID,
  group: "actor",
  issue: 41,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  probeKind: "behavior",
  sources: ["CreatureData#prepareSkill", "CreatureData._initialSkillValue"],
  isNeeded,
  install
};
