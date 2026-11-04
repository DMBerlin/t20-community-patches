/** rollData key, modificadores group and list, in getRollData's order (`simplifyRollFormula`, T20:5977-5999). */
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
 * (`data.atributoChave`, T20:5956-5957, before the modifiers), then the modifier lists in getRollData's order. Only
 * lists whose formula has a data reference are touched; the others do not depend on attributes. A formula that fails
 * keeps the value it had.
 * @param {object} system                      The actor's system data, attributes already final.
 * @param {object} rollData                    The rollData shared by prepareDerivedData.
 * @param {(formula: string, data: object) => string} simplify  The system's simplifyRollFormula.
 * @returns {string[]}                         The keys whose value changed.
 */
export function refreshModifiers(system, rollData, simplify) {
  // getRollData only defines these keys for actors with skills (`this.system.pericias`, T20:5969).
  if (!rollData || typeof rollData !== "object" || !("pericia" in rollData)) return [];
  const changed = [];
  if (refreshKeyAttribute(system, rollData)) changed.push("atributoChave");
  for (const [key, group, field] of MODIFIER_KEYS) {
    if (refreshModifier(rollData, key, modifierFormula(system, group, field), simplify)) changed.push(key);
  }
  return changed;
}

/** Sets rollData.atributoChave from the final spellcasting attribute; whether it changed. */
function refreshKeyAttribute(system, rollData) {
  const chave = system?.attributes?.conjuracao;
  if (!chave) return false;
  const value = system.atributos?.[chave]?.value ?? 0;
  if (value === rollData.atributoChave) return false;
  rollData.atributoChave = value;
  return true;
}

/** Reduces one modifier formula with a data reference again; whether its value changed. */
function refreshModifier(rollData, key, formula, simplify) {
  if (!formula.includes("@")) return false;
  let value;
  try {
    value = simplify(formula, rollData) || 0;
  } catch {
    return false;
  }
  if (value === rollData[key]) return false;
  rollData[key] = value;
  return true;
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
 * @returns {import("../../registry.mjs").Diagnosis}
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

/**
 * Combines the two links: the change application (Foundry 14 freezes the attribute references) and prepareAtributos.
 * @param {"resolves" | "keeps" | "unknown"} application  What a modifier field does with "@des" when applied.
 * @param {import("../../registry.mjs").Diagnosis} prepare      diagnoseProbe's result.
 * @returns {import("../../registry.mjs").Diagnosis}
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
