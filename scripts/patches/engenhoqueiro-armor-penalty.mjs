/**
 * Bug: CONFIG.T20.pericias.enge (Ofício: Engenhoqueiro) has armorPenalty, so new actors store pericias.enge.pda =
 * true and CreatureData#prepareSkill adds @pda to the skill (T20:3447, 18908, 19835-19853). Ofício takes no armor
 * penalty (Tabela 2-1, p. 115; "Int • Treinada", p. 121).
 * Fix: in memory, before the 1.6.5 prepareSkill builds the Engenhoqueiro formula, turn its prepared pda off. Nothing is
 * written: CONFIG and stored actor data are left as they are, and the condition penalty (condi) is untouched. Updates
 * that carry the prepared value back (the system's custom Ofício creation) get the stored pda again.
 */
import { MODULE_ID, markWrapper, stripComments, unwrap } from "../utils.mjs";

const PATCH_ID = "engenhoqueiro-armor-penalty";

/** Fragments of the 1.6.5 CreatureData#prepareSkill, compared without whitespace (T20:19835-19853). */
export const PREPARE_SKILL_MARKERS = [
  "skillData ??= foundry.utils.deepClone(this.pericias[skillId]);",
  'if (skillData.pda && rollData.pda) parts.push("@pda");',
  "if (skillData.condi) parts.push(skillData.condi);"
];

export function prepareSkillRecognized(source) {
  const code = stripComments(source);
  if (typeof code !== "string") return false;
  const flat = code.replace(/\s+/g, "");
  return PREPARE_SKILL_MARKERS.every((marker) => flat.includes(marker.replace(/\s+/g, "")));
}

/** Turns the prepared armor penalty of Ofício (Engenhoqueiro) off. Returns true when it changed it. */
export function dropEngeArmorPenalty(skillId, skillData) {
  if (skillId !== "enge" || skillData?.pda !== true) return false;
  skillData.pda = false;
  return true;
}

/** Distinct prototypes that define prepareSkill for the actor data models. */
export function prepareSkillOwners(models) {
  const owners = new Set();
  for (const model of Object.values(models ?? {})) {
    let proto = model?.prototype;
    while (proto && !Object.hasOwn(proto, "prepareSkill")) proto = Object.getPrototypeOf(proto);
    if (proto) owners.add(proto);
  }
  return [...owners];
}

const PDA_PATH = ["system", "pericias", "enge", "pda"];

/** foundry.data.operators.DataFieldOperator (ForcedReplacement and ForcedDeletion), when available. */
function coreOperator() {
  return globalThis.foundry?.data?.operators?.DataFieldOperator;
}

const unwrapOperator = (value, Operator) =>
  typeof Operator === "function" && value instanceof Operator ? Operator.get(value) : value;

/**
 * Places in update data that hold pericias.enge.pda: nested, dotted or mixed keys, "==" keys before cleaning, and
 * ForcedReplacement values (on the pda itself or on an ancestor) after cleaning.
 */
export function engePdaHolders(changes, path = PDA_PATH, Operator = coreOperator()) {
  const holders = [];
  const data = unwrapOperator(changes, Operator);
  if (!data || typeof data !== "object") return holders;
  for (const key of Object.keys(data)) {
    const parts = key.replace(/^==/, "").split(".");
    if (!parts.every((part, i) => part.replace(/^==/, "") === path[i])) continue;
    if (parts.length === path.length) holders.push({ container: data, key });
    else holders.push(...engePdaHolders(data[key], path.slice(parts.length), Operator));
  }
  return holders;
}

/**
 * The prepared pda this patch turned off can reach an update when the system writes prepared skills back (adding a
 * custom Ofício sends every prepared skill, T20:13950-13974). Puts the stored value back so nothing is persisted.
 * Returns true when it changed the update data.
 */
export function keepStoredEngePda(changes, storedPda, Operator = coreOperator()) {
  if (storedPda !== true) return false;
  let changed = false;
  for (const { container, key } of engePdaHolders(changes, PDA_PATH, Operator)) {
    const raw = container[key];
    if (unwrapOperator(raw, Operator) !== false) continue;
    if (raw === false) container[key] = true;
    else Operator.set(raw, true);
    changed = true;
  }
  return changed;
}

function onPreUpdate(document, changes) {
  try {
    const source = (document.syntheticActor ?? document)._source;
    keepStoredEngePda(changes, source?.system?.pericias?.enge?.pda);
  } catch (error) {
    console.warn(`${MODULE_ID} | ${PATCH_ID}: could not keep the stored pda`, error);
  }
}

export function wrapPrepareSkill(original) {
  return markWrapper(function (skillId, options, ...rest) {
    try {
      dropEngeArmorPenalty(skillId, options?.skillData ?? this.pericias?.[skillId]);
    } catch (error) {
      console.warn(`${MODULE_ID} | ${PATCH_ID}: correction skipped`, error);
    }
    return original.call(this, skillId, options, ...rest);
  }, original);
}

function isNeeded() {
  const enge = globalThis.CONFIG?.T20?.pericias?.enge;
  if (!enge) return { bug: "unknown", confidence: "low", evidence: "CONFIG.T20.pericias.enge not found" };
  const owners = prepareSkillOwners(globalThis.CONFIG?.Actor?.dataModels);
  if (!owners.length || !owners.every((o) => prepareSkillRecognized(String(unwrap(o.prepareSkill))))) {
    return { bug: "unknown", confidence: "low", evidence: "CreatureData#prepareSkill not recognized" };
  }
  if (enge.armorPenalty === true) {
    return { bug: "present", confidence: "high", evidence: "CONFIG.T20.pericias.enge.armorPenalty is true" };
  }
  return {
    bug: "fixed",
    confidence: "low",
    evidence: "armorPenalty is off in CONFIG, but actors created before may still store pericias.enge.pda"
  };
}

function apply() {
  let wrapped = false;
  for (const owner of prepareSkillOwners(CONFIG.Actor?.dataModels)) {
    if (!prepareSkillRecognized(String(unwrap(owner.prepareSkill)))) {
      console.warn(`${MODULE_ID} | ${PATCH_ID}: prepareSkill not recognized; correction inactive`);
      continue;
    }
    owner.prepareSkill = wrapPrepareSkill(owner.prepareSkill);
    wrapped = true;
  }
  if (!wrapped) return;
  // Unlinked token actors are updated through their ActorDelta, which fires preUpdateActorDelta instead.
  Hooks.on("preUpdateActor", onPreUpdate);
  Hooks.on("preUpdateActorDelta", onPreUpdate);
}

export default {
  id: PATCH_ID,
  group: "actor",
  issue: 41,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  apply
};
