import { stripComments } from "../../../lib/source.mjs";

/**
 * Whitespace-free, comment-free source of ItemT20#getAttackToHit and ItemT20#rollDamage in tormenta20 1.6.5
 * (length and FNV-1a hash). Any other code is "unknown", except the usual fix described in `AGILE_FIX`.
 */
export const REFERENCE = {
  attack: { length: 1899, hash: "57f32932" },
  damage: { length: 2493, hash: "953f8861" }
};

/**
 * The same fingerprints for tormenta20 1.6.6 (getAttackToHit, T20:6972-7060, and rollDamage, T20:7936-8019), which
 * fixed the bug.
 */
export const REFERENCE_1_6_6 = {
  attack: { length: 2027, hash: "3f52e31e" },
  damage: { length: 2698, hash: "c5c5ff4f" }
};

// The usual fix widens the light-weapon condition with the agile property, keeping everything else:
// `usarAcuidade && (empunhadura === "leve" || this.system.propriedades?.agi)` (either order, `?.`, `.` or `["agi"]`).
const LIGHT = `empunhadura===["']leve["']`;
const AGI = `(?:(?:this\\.system|itemData)\\??\\.)?propriedades(?:\\??\\.agi|\\??\\.?\\[["']agi["']\\])`;
const AGILE_FIX = new RegExp(`\\((?:${LIGHT}\\|\\|${AGI}|${AGI}\\|\\|${LIGHT})\\)`, "g");
// A fix may also destructure the property next to `empunhadura`.
const DESTRUCTURE_AGI = /const\{empunhadura,proposito,propriedades\}=this\.system;/g;

/**
 * Source without comments and whitespace, so formatting changes do not matter.
 * @param {string|undefined} source
 * @returns {string}
 */
export function normalizeSource(source) {
  const code = typeof source === "string" ? stripComments(source) : "";
  return typeof code === "string" ? code.replace(/\s+/g, "") : "";
}

/**
 * 32-bit FNV-1a hash, as 8 hex digits.
 * @param {string} text
 * @returns {string}
 */
export function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Whether normalized code has exactly the reference length and hash. */
export function matches(code, reference) {
  return code.length === reference.length && fingerprint(code) === reference.hash;
}

/**
 * Classifies one of the system's original methods against its 1.6.5 reference: "light-only" (the 1.6.5 code),
 * "agile" (the 1.6.5 code with only the usual fix) or "unknown" (anything else: rewritten code, another module's
 * wrapper, unrelated reads of "agi"...).
 * @param {string|undefined} source
 * @param {{length: number, hash: string}} reference
 * @returns {"light-only"|"agile"|"unknown"}
 */
export function classifyFinesseSource(source, reference) {
  const code = normalizeSource(source);
  if (!code || !reference) return "unknown";
  if (matches(code, reference)) return "light-only";
  let fixes = 0;
  const restored = code
    .replace(AGILE_FIX, () => {
      fixes++;
      return 'empunhadura==="leve"';
    })
    .replace(DESTRUCTURE_AGI, "const{empunhadura,proposito}=this.system;");
  return fixes > 0 && matches(restored, reference) ? "agile" : "unknown";
}

/**
 * Fallback when the behavior probe is inconclusive. The patch wraps both methods, so it only claims the bug when it
 * recognizes both exactly: an unknown method gives unknown/low (above the verified range, the patch is then not
 * applied). Reading code never proves a fix, so two methods that read the agile property give fixed/low.
 * @param {string|undefined} attackSource  Source of ItemT20#getAttackToHit.
 * @param {string|undefined} damageSource  Source of ItemT20#rollDamage.
 * @returns {import("../../../registry.mjs").Diagnosis}
 */
export function diagnoseFinesseSource(attackSource, damageSource) {
  const attack = classifyFinesseSource(attackSource, REFERENCE.attack);
  const damage = classifyFinesseSource(damageSource, REFERENCE.damage);
  const evidence = `attack: ${attack}, damage: ${damage}`;
  if (attack === "unknown" || damage === "unknown") return { bug: "unknown", confidence: "low", evidence };
  if (attack === "agile" && damage === "agile") return { bug: "fixed", confidence: "low", evidence };
  return { bug: "present", confidence: "high", evidence };
}
