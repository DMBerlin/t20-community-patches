/**
 * Global skill modifiers with attribute formulas (tormenta20 1.6.5).
 *
 * Bug: every CreatureData type's prepareDerivedData (T20:20096-20103, 20248-20252, 20292-20296) calls
 * actor.getRollData() before prepareAtributos. getRollData (T20:7148-7175) already reduces each list of
 * system.modificadores to a number (@pericia, @semataque, @ataque, @resistencia, @dano…) with the attributes as they
 * are then, without the temporary bonuses (system.atributos.*.bonus). prepareAtributos (T20:19821-19827) adds the
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
import { markWrapper, unwrap } from "../utils.mjs";

const LOG = "t20-community-patches | skill-modifier-attributes:";

/** rollData key, modificadores group and list, in getRollData's order (T20:7153-7175). */
export const MODIFIER_KEYS = [
  ["pericia", "pericias", "geral"],
  ["semataque", "pericias", "semataque"],
  ["ataque", "pericias", "ataque"],
  ["resistencia", "pericias", "resistencia"],
  ["atributo", "atributos", "geral"],
  ["fisicos", "atributos", "fisicos"],
  ["mentais", "atributos", "mentais"],
  ["dano", "dano", "geral"],
  ["danoMagico", "dano", "mag"],
  ["danoCAC", "dano", "cac"],
  ["danoAD", "dano", "ad"],
  ["danoALQ", "dano", "alq"],
  ["curaGeral", "cura", "geral"],
  ["curaMagica", "cura", "mag"],
  ["curaALQ", "cura", "alq"]
];

/**
 * The references a modifier change keeps as text: the attribute keys, atributoChave and atributos.* paths that the
 * replacement data defines. Missing references are left out, so they still fail like the core's strict replacement.
 * @param {string} ref   A reference without "@", e.g. "des" or "atributos.des.value".
 * @param {object} data  The replacement data.
 * @returns {boolean}
 */
export function isAttributeRef(ref, data) {
  if (!data || typeof data !== "object") return false;
  const [head, ...path] = ref.split(".");
  if (head === "atributos") {
    let value = data.atributos;
    for (const part of path) value = value?.[part];
    return path.length > 0 && value !== undefined;
  }
  if (path.length) return false;
  if (head === "atributoChave") return data.atributoChave !== undefined;
  return Object.hasOwn(data.atributos ?? {}, head) && data[head] !== undefined;
}

/** Roll.replaceFormulaData's reference pattern (Foundry 14): "@key" or "@{key}". */
const REF_PATTERN = /@{[-.\w]+}|@[-.\w]+/g;

/** The core's strict check ignores "@Uuid[...]"-style links (DataField#_replaceDataRefs). */
const stripLinks = (formula) => String(formula).replace(/@\w+\[[^#\]]+]/g, "");

/** The "@" references in a formula, without "@", "{" and "}", ignoring "@Uuid[...]"-style links. */
export function formulaRefs(formula) {
  return (stripLinks(formula).match(REF_PATTERN) ?? []).map((ref) => ref.replace(/^@{?|}?$/g, ""));
}

/**
 * Resolves the references of a modifier change value, keeping the attribute ones as text so getRollData and
 * prepareAtributos reduce them with the prepared attributes, like on Foundry 13. Strictness stays the field's own:
 * the kept references are masked and the result goes through the original method again with the caller's options.
 * @param {string} raw      The change value.
 * @param {object} data     The replacement data.
 * @param {(raw: string, data: object, options: object) => string} replace  The field's original _replaceDataRefs.
 * @param {{strict?: boolean}} [options]
 * @returns {string}
 */
export function keepAttributeRefs(raw, data, replace, options = {}) {
  const kept = formulaRefs(raw).filter((ref) => isAttributeRef(ref, data));
  if (!kept.length) return replace(raw, data, options);
  const replacement = { ...data };
  for (const ref of kept) {
    if (ref.startsWith("atributos.")) delete replacement.atributos;
    else delete replacement[ref];
  }
  const resolved = replace(raw, replacement, { ...options, strict: false });
  if (options.strict ?? true) {
    const masked = resolved.replace(REF_PATTERN, (ref) => (kept.includes(ref.replace(/^@{?|}?$/g, "")) ? "0" : ref));
    replace(masked, replacement, options);
  }
  return resolved;
}

/**
 * Whether any attribute has a temporary bonus, the only change prepareAtributos makes to the attributes.
 * @param {Record<string, {bonus?: unknown}>} [atributos]  system.atributos
 * @returns {boolean}
 */
export function hasTemporaryBonus(atributos) {
  return Object.values(atributos ?? {}).some((atr) => (Number(atr?.bonus) || 0) !== 0);
}

/**
 * The formula getRollData builds for one modifier list: the truthy entries joined by " + ", or "".
 * @param {object} system  The actor's system data.
 * @param {string} group   modificadores group (pericias, atributos, dano, cura).
 * @param {string} field   List inside the group.
 * @returns {string}
 */
export function modifierFormula(system, group, field) {
  const list = system?.modificadores?.[group]?.[field];
  return Array.isArray(list) ? list.filter(Boolean).join(" + ") : "";
}

/**
 * Reduces again, in place, the values getRollData computed before the attributes were final: atributoChave first
 * (T20:7131-7132, before the modifiers), then the modifier lists in getRollData's order. Only lists whose formula has
 * a data reference are touched; the others do not depend on attributes. A formula that fails keeps the value it had.
 * @param {object} system                      The actor's system data, attributes already final.
 * @param {object} rollData                    The rollData shared by prepareDerivedData.
 * @param {(formula: string, data: object) => string} simplify  The system's simplifyRollFormula.
 * @returns {string[]}                         The keys whose value changed.
 */
export function refreshModifiers(system, rollData, simplify) {
  // getRollData only defines these keys for actors with skills (T20:7148).
  if (!rollData || typeof rollData !== "object" || !("pericia" in rollData)) return [];
  const changed = [];
  const chave = system?.attributes?.conjuracao;
  if (chave) {
    const value = system.atributos?.[chave]?.value ?? 0;
    if (value !== rollData.atributoChave) {
      rollData.atributoChave = value;
      changed.push("atributoChave");
    }
  }
  for (const [key, group, field] of MODIFIER_KEYS) {
    const formula = modifierFormula(system, group, field);
    if (!formula.includes("@")) continue;
    let value;
    try {
      value = simplify(formula, rollData) || 0;
    } catch (err) {
      continue;
    }
    if (value !== rollData[key]) {
      rollData[key] = value;
      changed.push(key);
    }
  }
  return changed;
}

/** Probe: Destreza 3 with a +2 bonus; every modifier list is "@des" and starts reduced to 3. */
export function probeInput() {
  const lists = {};
  for (const [, group, field] of MODIFIER_KEYS) (lists[group] ??= {})[field] = ["@des"];
  const rollData = { des: 3, atributoChave: 3 };
  for (const [key] of MODIFIER_KEYS) rollData[key] = 3;
  const system = {
    parent: { flags: {} },
    atributos: { des: { base: 3, racial: 0, bonus: 2, value: 3 } },
    attributes: { conjuracao: "des" },
    modificadores: lists
  };
  return { system, rollData };
}

/**
 * Reads the rollData the original prepareAtributos left for the probe.
 * @param {object} rollData
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseProbe(rollData) {
  const keys = [...MODIFIER_KEYS.map(([key]) => key), "atributoChave"];
  const values = keys.map((key) => Number(rollData?.[key]));
  if (Number(rollData?.des) !== 5) {
    return { bug: "unknown", confidence: "low", evidence: `control not recognized: des ${rollData?.des}` };
  }
  const stale = keys.filter((_, i) => values[i] === 3);
  const fresh = keys.filter((_, i) => values[i] === 5);
  if (stale.length + fresh.length !== keys.length) {
    return { bug: "unknown", confidence: "low", evidence: `unexpected values: ${keys.map((k, i) => `${k} ${values[i]}`).join(", ")}` };
  }
  if (!fresh.length) return { bug: "present", confidence: "high", evidence: "prepareAtributos keeps the modifiers reduced before the temporary bonus" };
  if (!stale.length) return { bug: "fixed", confidence: "high", evidence: "prepareAtributos reduces the modifiers again" };
  return { bug: "present", confidence: "low", evidence: `still stale: ${stale.join(", ")}` };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function creaturePrototype() {
  let proto = CONFIG.Actor.dataModels?.character?.prototype;
  while (proto && !Object.hasOwn(proto, "prepareAtributos")) proto = Object.getPrototypeOf(proto);
  return proto ?? null;
}

function modifierElementFields() {
  const fields = new Set();
  for (const model of Object.values(CONFIG.Actor.dataModels ?? {})) {
    let schema;
    try {
      schema = model?.schema;
    } catch (err) {
      continue;
    }
    for (const [, group, field] of MODIFIER_KEYS) {
      const element = schema?.getField?.(`modificadores.${group}.${field}`)?.element;
      if (typeof element?._replaceDataRefs === "function") fields.add(element);
    }
  }
  return fields;
}

function systemSimplify() {
  const fn = (globalThis.tormenta20 ?? globalThis.game?.tormenta20)?.dice?.simplifyRollFormula;
  return typeof fn === "function" ? fn : null;
}

let warned = false;

function apply() {
  const proto = creaturePrototype();
  if (typeof proto?.prepareAtributos !== "function") throw new Error("CreatureData#prepareAtributos not found");
  const simplify = systemSimplify();
  if (!simplify) throw new Error("tormenta20.dice.simplifyRollFormula not found");
  const fields = modifierElementFields();
  if (!fields.size) throw new Error("modificadores list fields not found");
  for (const field of fields) {
    const replaceRefs = field._replaceDataRefs;
    field._replaceDataRefs = markWrapper(function (raw, data, options = {}) {
      return keepAttributeRefs(raw, data, (r, d, o) => replaceRefs.call(this, r, d, o), options ?? {});
    }, replaceRefs);
  }
  const original = proto.prepareAtributos;
  proto.prepareAtributos = markWrapper(function (options, ...rest) {
    const result = original.call(this, options, ...rest);
    try {
      if (hasTemporaryBonus(this.atributos)) refreshModifiers(this, options?.rollData, simplify);
    } catch (err) {
      if (!warned) console.warn(`${LOG} could not refresh the modifiers`, this.parent?.uuid, err);
      warned = true;
    }
    return result;
  }, original);
}

/**
 * Combines the two links: the change application (Foundry 14 freezes the attribute references) and prepareAtributos.
 * @param {"resolves" | "keeps" | "unknown"} application  What a modifier field does with "@des" when applied.
 * @param {import("../registry.mjs").Diagnosis} prepare      diagnoseProbe's result.
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function combineDiagnosis(application, prepare) {
  if (application === "resolves") {
    const evidence = `change application resolves attribute references in modificadores; ${prepare.evidence ?? prepare.bug}`;
    return { bug: "present", confidence: "high", evidence };
  }
  if (application === "unknown") {
    return prepare.bug === "present" ? prepare : { bug: "unknown", confidence: "low", evidence: `change application not recognized; ${prepare.evidence ?? prepare.bug}` };
  }
  return prepare;
}

function probeApplication() {
  const fields = [...modifierElementFields()];
  if (!fields.length) return "unknown";
  const results = new Set(fields.map((field) => {
    try {
      return unwrap(field._replaceDataRefs).call(field, "@des", { des: 3, atributos: { des: { value: 3 } } });
    } catch (err) {
      return "error";
    }
  }));
  if (results.size !== 1) return "unknown";
  const [result] = results;
  if (result === "3") return "resolves";
  if (result === "@des") return "keeps";
  return "unknown";
}

function isNeeded() {
  const original = creaturePrototype()?.prepareAtributos;
  if (typeof original !== "function") return { bug: "unknown", confidence: "low", evidence: "prepareAtributos not found" };
  let prepare;
  try {
    const { system, rollData } = probeInput();
    unwrap(original).call(system, { rollData });
    prepare = diagnoseProbe(rollData);
  } catch (err) {
    prepare = { bug: "unknown", confidence: "low", evidence: `prepareAtributos probe failed: ${err.message}` };
  }
  return combineDiagnosis(probeApplication(), prepare);
}

export default {
  id: "skill-modifier-attributes",
  group: "actor",
  issue: 68,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  apply
};
