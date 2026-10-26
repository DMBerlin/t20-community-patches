/**
 * Initiative ties broken by the Initiative skill (tormenta20 1.6.5, Foundry v14).
 *
 * Bug: the system leaves the turn order to the core, which breaks initiative ties by combatant id
 * (Combat#_sortCombatants, core client/documents/combat.mjs:569-573). The book (p. 231) breaks them by the higher
 * skill value, and the order holds for the whole combat.
 *
 * Fix: when a combatant gets an initiative result, its Initiative skill value at that moment is saved in a flag of
 * the same write (preCreateCombatant/preUpdateCombatant), together with the value of the skill's key attribute
 * (Destreza by default). Ties between two numeric results are broken by the saved skill and then by the saved attribute,
 * so the order stays the same for the whole combat even if they change. A combatant without a saved value comes after
 * the ones with it; with equal values, or none on both sides, the core order (id) is kept.
 */
import { MODULE_ID, markWrapper, sourceFingerprint, unwrap } from "../utils.mjs";

const LOG = `${MODULE_ID} | initiative-tiebreak:`;
export const FLAG = "tiebreak";
export const ABILITY_FLAG = "tiebreakAbility";
const DEFAULT_ABILITY = "des";
export const SYSTEM_FORMULA = "1d20 + @pericias.inic.value";
/** sourceFingerprint of foundry.documents.Combat#_sortCombatants in Foundry v14 (combat.mjs:569-573). */
export const KNOWN_SORT = "5b9a77c3:209";

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

/** A finite number from a number or a numeric string; null otherwise. */
function toNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * @param {object|null|undefined} actor
 * @returns {number|null}  The Initiative skill value, or null when it is not a number.
 */
export function initiativeSkill(actor) {
  return toNumber(actor?.system?.pericias?.inic?.value);
}

/**
 * @param {object|null|undefined} actor
 * @returns {number|null}  The value of the Initiative skill's key attribute (Destreza by default), or null.
 */
export function initiativeAbility(actor) {
  const system = actor?.system;
  const key = system?.pericias?.inic?.atributo || DEFAULT_ABILITY;
  return toNumber(system?.atributos?.[key]?.value);
}

/**
 * The tie-break values to save with an initiative change: the skill and its attribute for a numeric result, nulls when
 * the result is cleared, undefined when the initiative is not changing.
 * @param {object} changed   Update or creation data of the combatant
 * @param {object|null} actor
 * @returns {{skill: number|null, ability: number|null}|undefined}
 */
export function tiebreakValues(changed, actor) {
  if (!changed || typeof changed !== "object" || !("initiative" in changed)) return undefined;
  if (toNumber(changed.initiative) === null) return { skill: null, ability: null };
  return { skill: initiativeSkill(actor), ability: initiativeAbility(actor) };
}

/** Saved values first, higher first; 0 when both or neither have one and they are equal. */
function compareSaved(a, b) {
  const hasA = isNumber(a);
  const hasB = isNumber(b);
  if (hasA !== hasB) return hasA ? -1 : 1;
  return hasA ? b - a : 0;
}

/**
 * Compares two combatants that may be tied. Negative: `a` acts first. 0: let the core decide.
 * Among tied numeric results: by the saved skill, then by the saved attribute; for each, saved values first, higher
 * first, and combatants without a saved value after them.
 * @param {{initiative: number|null, flags?: object}} a
 * @param {{initiative: number|null, flags?: object}} b
 * @returns {number}
 */
export function compareInitiativeTie(a, b) {
  if (!isNumber(a?.initiative) || a.initiative !== b?.initiative) return 0;
  const fa = a.flags?.[MODULE_ID];
  const fb = b.flags?.[MODULE_ID];
  return compareSaved(fa?.[FLAG], fb?.[FLAG]) || compareSaved(fa?.[ABILITY_FLAG], fb?.[ABILITY_FLAG]);
}

/**
 * Recognizes the code involved without running it. Never returns fixed: it only knows the current code.
 * @param {{sortFingerprint: string|null, sortOverridden: boolean, formula: string, formulaOverridden: boolean}} facts
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnose({ sortFingerprint, sortOverridden, formula, formulaOverridden }) {
  if (sortOverridden) return { bug: "unknown", confidence: "low", evidence: "_sortCombatants overridden" };
  if (sortFingerprint !== KNOWN_SORT) {
    return { bug: "unknown", confidence: "low", evidence: `unrecognized _sortCombatants (${sortFingerprint})` };
  }
  if (formula !== SYSTEM_FORMULA || formulaOverridden) {
    return { bug: "unknown", confidence: "low", evidence: `unrecognized initiative formula (${formula})` };
  }
  return { bug: "present", confidence: "high", evidence: "core breaks initiative ties by combatant id" };
}

function readFacts() {
  const coreSort = unwrap(foundry.documents.Combat?.prototype?._sortCombatants);
  const sort = CONFIG.Combat?.documentClass?.prototype?._sortCombatants;
  let source = null;
  try {
    if (typeof coreSort === "function") source = Function.prototype.toString.call(coreSort);
  } catch {
    source = null;
  }
  return {
    sortFingerprint: sourceFingerprint(source),
    sortOverridden: typeof sort !== "function" || unwrap(sort) !== coreSort,
    formula: String(CONFIG.Combat?.initiative?.formula ?? ""),
    formulaOverridden:
      CONFIG.Combatant?.documentClass?.prototype?._getInitiativeFormula !==
      foundry.documents.Combatant?.prototype?._getInitiativeFormula
  };
}

function isNeeded() {
  return diagnose(readFacts());
}

function apply() {
  // Only on the verified code: a different sort or formula may already break ties in its own way.
  const diagnosis = diagnose(readFacts());
  if (diagnosis.bug !== "present") {
    console.warn(`${LOG} unrecognized initiative code, not changing it (${diagnosis.evidence})`);
    return;
  }
  const skillPath = `flags.${MODULE_ID}.${FLAG}`;
  const abilityPath = `flags.${MODULE_ID}.${ABILITY_FLAG}`;
  Hooks.on("preCreateCombatant", (combatant, data) => {
    try {
      const values = tiebreakValues(data, combatant.actor);
      if (values) combatant.updateSource({ [skillPath]: values.skill, [abilityPath]: values.ability });
    } catch (err) {
      console.warn(LOG, err);
    }
  });
  Hooks.on("preUpdateCombatant", (combatant, changed) => {
    try {
      const values = tiebreakValues(changed, combatant.actor);
      if (values) {
        // Changes made to `changed` in a pre-update hook are saved with the same update.
        foundry.utils.setProperty(changed, skillPath, values.skill);
        foundry.utils.setProperty(changed, abilityPath, values.ability);
      }
    } catch (err) {
      console.warn(LOG, err);
    }
  });

  const prototype = CONFIG.Combat.documentClass.prototype;
  const original = prototype._sortCombatants;
  // setupTurns passes this method unbound to Array#sort (combat.mjs:496), so the wrapper never relies on `this`.
  prototype._sortCombatants = markWrapper(function (a, b) {
    let tie = 0;
    try {
      tie = compareInitiativeTie(a, b);
    } catch {
      tie = 0;
    }
    return tie || original.call(this, a, b);
  }, original);
}

export default {
  id: "initiative-tiebreak",
  group: "combat",
  issue: 53,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  apply
};
