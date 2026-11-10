/** Penalties of a character without proficiency and the recognition of the system code they extend (pure). */
import { sourceFingerprint } from "../../../lib/source.mjs";
import { NAMED, SCOPED, matchesName } from "./proficiency.mjs";

export const NON_PROFICIENCY_SETTING = "nonProficiencyRule";
export const WEAPON_PENALTY = -5;
export const PDA_KEY = "system.attributes.defesa.pda";
const WEAPON_CATEGORIES = new Set(["marcial", "exotica", "fogo"]);
const ARMOR_REQUIREMENTS = { pesada: "pes", escudo: "esc" };
const PHYSICAL_ABILITIES = new Set(["for", "des"]);
const MELEE = new Set(["corpo-a-corpo", "corpo-a-corpo-arremesso"]); // T20:14854
const RANGED = new Set(["arremesso", "corpo-a-corpo-arremesso", "disparo"]); // T20:14855

/** Normalized source fingerprints of the original methods this rule extends, by system version. */
export const KNOWN_SOURCES = {
  getAttackToHit: { "1.6.5": "a81d1734:2142", "1.6.6": "2497aedc:2281", "1.6.7": "2497aedc:2281" },
  prepareSkill: { "1.6.5": "3f09d08e:1504", "1.6.6": "3f09d08e:1504", "1.6.7": "3f09d08e:1504" }
};

/**
 * @param {{proficiencia?: string, adaptable?: boolean, twoHanded?: boolean}} weapon
 * @returns {string[]}  Accepted proficiencies; empty when none is needed (or the category is unknown).
 */
export function weaponRequirements({ proficiencia, adaptable = false, twoHanded = false }) {
  if (!WEAPON_CATEGORIES.has(proficiencia)) return [];
  if (proficiencia === "exotica" && adaptable && twoHanded) return ["exotica", "marcial"];
  return [proficiencia];
}

/**
 * @param {{name?: string, proficiencia?: string, proposito?: string, adaptable?: boolean, twoHanded?: boolean}} weapon
 * @param {ReturnType<typeof resolveProficiencies>} profs
 * @returns {"ok"|"penalty"|"indeterminate"}
 */
export function weaponStatus(weapon, profs) {
  const accepted = weaponRequirements(weapon);
  if (!accepted.length || matchesName(weapon.name, profs.weaponNames)) return "ok";
  if (accepted.some((c) => profs.weapons.has(c))) return "ok";
  const martial = accepted.includes("marcial");
  const scopes = [MELEE.has(weapon.proposito) && SCOPED.melee, RANGED.has(weapon.proposito) && SCOPED.ranged].filter(Boolean);
  if (martial && scopes.some((s) => profs.scoped.has(s))) return "ok";
  const covers = (c) => c === NAMED || accepted.includes(c) || (martial && scopes.includes(c));
  return profs.pending.some((p) => p.candidates.some(covers)) ? "indeterminate" : "penalty";
}

/**
 * @param {{name?: string, tipo?: string}} item
 * @param {ReturnType<typeof resolveProficiencies>} profs
 * @returns {"ok"|"penalty"|"indeterminate"}
 */
export function armorStatus({ name, tipo }, profs) {
  const required = ARMOR_REQUIREMENTS[tipo];
  if (!required || profs.armor.has(required) || matchesName(name, profs.armorNames)) return "ok";
  return profs.pending.some((p) => p.candidates.includes(required)) ? "indeterminate" : "penalty";
}

/**
 * Armor penalty of one item (<= 0): its base penalty, made worse by its own upgrades (Reforçada, p. 166) and lowered
 * by its reductions (Ajustada, Sob Medida, Mitral) when #19 is applied, never above 0. Equals the item's share of
 * #19's computePenaltyAdjustments (new base plus the increases it does not cancel).
 */
export function itemArmorPenalty({ base = 0, increase = 0, reduction = 0 } = {}) {
  return Math.min(0, -Math.abs(Number(base) || 0) - Math.abs(increase) + Math.abs(reduction)) || 0;
}

/** Extra penalty of one skill. Skills that already apply the armor penalty (pda, T20:19850) never get it again. */
export function skillExtraPenalty({ ability, appliesArmorPenalty = false, penalty = 0 }) {
  if (!penalty || appliesArmorPenalty || !PHYSICAL_ABILITIES.has(ability)) return 0;
  return penalty;
}

/** Recognizes the exact original code; anything else (official change, helper, other module's wrapper) is unknown. */
export function diagnoseSource(name, source, version, known = KNOWN_SOURCES) {
  const fingerprint = sourceFingerprint(source);
  if (fingerprint && known[name]?.[version] === fingerprint) {
    return { bug: "present", confidence: "high", evidence: `${name} is the Tormenta20 ${version} code` };
  }
  return { bug: "unknown", confidence: "low", evidence: `${name} not recognized (${fingerprint ?? "no source"})` };
}
