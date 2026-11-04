import { stripComments } from "../../lib/source.mjs";
import { fieldTerms } from "../../lib/tooltip.mjs";

export const CONDITION_KEY = "T20CP.FieldBonuses.Condition";
/**
 * Condition penalty the Defesa breakdown leaves out, or 0.
 * @param {string|{string: string}} path
 * @param {{condi?: unknown}} [defesa]  Prepared system.attributes.defesa.
 * @returns {number}
 */
export function missingDefenseCondition(path, defesa) {
  const [type, key] = fieldTerms(path);
  if (type !== "defesa" || key === "pda") return 0;
  const value = Number(defesa?.condi);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Whether the breakdown already lists the Defesa conditions one by one (field-bonuses-breakdown).
 * @param {unknown} html
 */
export function hasConditionLines(html) {
  return typeof html === "string" && html.includes('data-t20cp="condi"');
}

/**
 * The template root to give the system's helper: for a token actor, a copy whose actor has no _id and whose uuid is
 * the token actor's, so `game.actors.get` misses and `fromUuidSync` finds the sheet's own actor.
 * @param {object} root  options.data.root of the helper.
 * @returns {object}
 */
export function rootForHelper(root) {
  const actor = root?.actor;
  if (!actor?.isToken || typeof actor.uuid !== "string") return root;
  return Object.create(root, {
    actor: { value: { _id: null }, enumerable: true },
    uuid: { value: actor.uuid, enumerable: true }
  });
}

/**
 * The bugs recognized in the helper's source (comments ignored).
 * @param {string|undefined} source
 * @returns {{lookup: boolean, noCondition: boolean}}
 */
export function helperBugs(source) {
  if (typeof source !== "string" || !source) return { lookup: false, noCondition: false };
  const code = stripComments(source);
  const lookup = /game\.actors\.get\(\s*sheet\.actor\._id\s*\)\s*\|\|\s*fromUuidSync\(\s*sheet\.uuid\s*\)/.test(code);
  const branch = /case\s*["']defesa["']\s*:([\s\S]*?)case\s*["']rd["']/.exec(code)?.[1];
  return { lookup, noCondition: typeof branch === "string" && !/\bcondi\b/.test(branch) };
}

/**
 * Reads the helper's source. Source reading never proves a fix.
 * @param {string|undefined} source
 * @returns {import("../../registry.mjs").Diagnosis}
 */
export function diagnoseHelperSource(source) {
  if (typeof source !== "string" || !source) return { bug: "unknown", confidence: "low", evidence: "fieldBonuses source unavailable" };
  const { lookup, noCondition } = helperBugs(source);
  const found = [lookup && "actor looked up by _id first", noCondition && "Defesa without condi"].filter(Boolean);
  if (lookup && noCondition) return { bug: "present", confidence: "high", evidence: found.join("; ") };
  if (found.length) return { bug: "present", confidence: "low", evidence: `${found.join("; ")}; the rest not recognized` };
  return { bug: "unknown", confidence: "low", evidence: "fieldBonuses not recognized" };
}
