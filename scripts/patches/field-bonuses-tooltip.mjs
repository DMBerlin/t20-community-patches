/**
 * Sheet breakdowns of tokens and of the Defesa (tormenta20 1.6.5).
 *
 * The `fieldBonuses` Handlebars helper (T20:4254-4463) builds the breakdown shown when hovering a value on the actor
 * sheet (atributos, PV, PM, Defesa, perícias). It rebuilds the total from its own list instead of reading the
 * prepared value, and has two bugs:
 * - It finds the actor with `game.actors.get(sheet.actor._id)` before `fromUuidSync(sheet.uuid)`. The sheet of an
 *   unlinked token has the base actor's _id, so every breakdown of that sheet shows the base actor's data.
 * - The Defesa branch never lists `defesa.condi`, the Defesa penalty of conditions (Desprevenido, Cego, Enredado,
 *   Vulnerável…), which prepareDefense (T20:19910) adds to the value.
 *
 * Fix: for a token sheet the helper receives a root whose actor has no _id, so it resolves the sheet's own actor by
 * uuid; the Defesa breakdown gets a "Condição" line before the total, which is corrected. Each part is installed
 * only when its bug is recognized in the helper's source, so a partial fix upstream is never undone or doubled.
 */
import { addTooltipLine, markWrapper, stripComments, unwrap } from "../utils.mjs";

const LOG = "t20-community-patches | field-bonuses-tooltip:";
export const CONDITION_KEY = "T20CP.FieldBonuses.Condition";
const IGNORED_TERMS = new Set(["system", "attributes", "tracos"]);

/**
 * The helper's [type, key] of a field path (T20:4262).
 * @param {string|{string: string}} path
 * @returns {string[]}
 */
export function fieldTerms(path) {
  const text = typeof path === "object" ? path?.string : path;
  return typeof text === "string" ? text.split(".").filter((t) => !IGNORED_TERMS.has(t)) : [];
}

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
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseHelperSource(source) {
  if (typeof source !== "string" || !source) return { bug: "unknown", confidence: "low", evidence: "fieldBonuses source unavailable" };
  const { lookup, noCondition } = helperBugs(source);
  const found = [lookup && "actor looked up by _id first", noCondition && "Defesa without condi"].filter(Boolean);
  if (lookup && noCondition) return { bug: "present", confidence: "high", evidence: found.join("; ") };
  if (found.length) return { bug: "present", confidence: "low", evidence: `${found.join("; ")}; the rest not recognized` };
  return { bug: "unknown", confidence: "low", evidence: "fieldBonuses not recognized" };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

let warned = false;

function sheetActor(root) {
  if (root?.actor?.system) return root.actor;
  return (root?.uuid && foundry.utils.fromUuidSync(root.uuid)) || game.actors?.get(root?.actor?._id) || null;
}

function helperSource(fn) {
  const base = unwrap(fn);
  return typeof base === "function" ? Function.prototype.toString.call(base) : undefined;
}

function apply() {
  const original = globalThis.Handlebars?.helpers?.fieldBonuses;
  if (typeof original !== "function") throw new Error("Handlebars helper fieldBonuses not found");
  const bugs = helperBugs(helperSource(original));
  if (!bugs.lookup && !bugs.noCondition) console.warn(`${LOG} fieldBonuses not recognized; nothing to fix`);
  Handlebars.registerHelper(
    "fieldBonuses",
    markWrapper(function (path, options) {
      let args = options;
      const root = options?.data?.root;
      try {
        const fixed = bugs.lookup ? rootForHelper(root) : root;
        if (fixed !== root) args = { ...options, data: { ...options.data, root: fixed } };
      } catch (err) {
        args = options;
      }
      const html = original.call(this, path, args);
      // field-bonuses-breakdown already listed the conditions by name.
      if (!bugs.noCondition || hasConditionLines(html)) return html;
      try {
        const condi = missingDefenseCondition(path, sheetActor(root)?.system?.attributes?.defesa);
        return condi ? addTooltipLine(html, game.i18n.localize(CONDITION_KEY), condi) : html;
      } catch (err) {
        if (!warned) console.warn(`${LOG} could not add the Defesa condition`, err);
        warned = true;
        return html;
      }
    }, original)
  );
}

function isNeeded() {
  return diagnoseHelperSource(helperSource(globalThis.Handlebars?.helpers?.fieldBonuses));
}

export default {
  id: "field-bonuses-tooltip",
  group: "sheet-effects",
  issue: 39,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  apply
};
