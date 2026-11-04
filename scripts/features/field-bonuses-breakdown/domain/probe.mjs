import { stripComments } from "../../../lib/source.mjs";

export const PARTS = ["manual", "zeroLevel", "formula", "types", "wildcard", "heavyArmor", "defenseSources", "armorSlots"];
/** The parts fixed by shadowing modifiedFields during the call. */
export const INPUT_PARTS = ["manual", "zeroLevel", "formula", "types", "wildcard"];

/**
 * The bugs recognized in the helper's source (comments ignored).
 * @param {string|undefined} source
 * @returns {Record<string, boolean>}
 */
export function helperParts(source) {
  const parts = Object.fromEntries(PARTS.map((p) => [p, false]));
  if (typeof source !== "string" || !source) return parts;
  const code = stripComments(source);
  parts.manual = /Number\(\s*nivel\[0\]\s*\)\s*\+\s*Number\(\s*nivelImpar\[0\]\s*\)\s*\+\s*Number\(\s*nivelPar\[0\]\s*\)/.test(code);
  parts.zeroLevel = /\|\|\s*item\.multiplier\s*\)/.test(code) && /multiplier:\s*Math\.floor\(\s*level\s*\/\s*2\s*\)/.test(code);
  parts.formula =
    /value\.includes\(\s*["']@["']\s*\)/.test(code) &&
    /\$\{value\}\s*\*\s*\$\{item\.multiplier/.test(code) &&
    /Number\(\s*value\s*\)/.test(code);
  parts.types = /switch\s*\(\s*item\.mode\s*\)/.test(code) && !/item\.type\b/.test(code);
  parts.wildcard = /modFields\[\s*path\s*\]/.test(code) && !code.includes(".*");
  return Object.assign(parts, defenseParts(code));
}

/** The Defesa bugs, recognized in the helper's "defesa" case. */
function defenseParts(code) {
  const defense = /case\s*["']defesa["']\s*:([\s\S]*?)case\s*["']rd["']/.exec(code)?.[1] ?? "";
  return {
    heavyArmor: /defesa\.atributo\s*&&\s*!armaduraPesada/.test(defense) && !/maxAtr/.test(defense),
    defenseSources:
      /defesa\.outros\s*\?\s*\{\s*label:\s*["']Outros["']\s*,\s*value:\s*defesa\.outros\s*\}/.test(defense) && !/\bcondi\b/.test(defense),
    armorSlots: /\.filter\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\.system\.armadura\.value\b[\s\S]*?\)\s*\.map\(/.test(defense) && !/\.find\(/.test(defense)
  };
}

/**
 * Reads the helper's source. Source reading never proves a fix.
 * @param {string|undefined} source
 * @returns {import("../../../registry.mjs").Diagnosis}
 */
export function diagnoseHelperSource(source) {
  if (typeof source !== "string" || !source) return { bug: "unknown", confidence: "low", evidence: "fieldBonuses source unavailable" };
  const parts = helperParts(source);
  const found = PARTS.filter((p) => parts[p]);
  const missing = PARTS.filter((p) => !parts[p]);
  if (!missing.length) return { bug: "present", confidence: "high", evidence: `recognized: ${found.join(", ")}` };
  if (found.length) return { bug: "present", confidence: "low", evidence: `recognized: ${found.join(", ")}; not recognized: ${missing.join(", ")}` };
  return { bug: "unknown", confidence: "low", evidence: "fieldBonuses not recognized" };
}
