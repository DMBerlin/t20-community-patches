import { MODULE_ID } from "../../lib/module.mjs";
import { markWrapper, stripComments } from "../../lib/source.mjs";

export const PATCH_ID = "engenhoqueiro-armor-penalty";

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

const unwrapOperator = (value, Operator) =>
  typeof Operator === "function" && value instanceof Operator ? Operator.get(value) : value;

/**
 * Places in update data that hold pericias.enge.pda: nested, dotted or mixed keys, "==" keys before cleaning, and
 * ForcedReplacement values (on the pda itself or on an ancestor) after cleaning.
 * `Operator` is foundry.data.operators.DataFieldOperator (ForcedReplacement and ForcedDeletion), when available.
 */
export function engePdaHolders(changes, path = PDA_PATH, Operator = undefined) {
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
 * custom Ofício sends every prepared skill, `system.pericias`, T20:12790-12814). Puts the stored value back so
 * nothing is persisted.
 * Returns true when it changed the update data.
 */
export function keepStoredEngePda(changes, storedPda, Operator = undefined) {
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
