/**
 * Threat XP for fractional challenge ratings (ND 1/4, 1/2).
 *
 * Bug (tormenta20 1.6.5): MenaceData#prepareBaseData turns the ND into the creature level with
 * `Number(nd) || 1`, so "1/4" and "1/2" become level 1, and then computes the XP from that level instead of
 * the ND. Every ND 1/4 or 1/2 threat shows 1000 XP on its sheet. The book gives ND × 1000: 250 and 500.
 *
 * Fix: after the system's prepareBaseData, ND "1/4" and "1/2" (the only fractional NDs in the books and in the
 * system's ND table) get 250 and 500 XP. The creature level (1, the book minimum) and everything derived from
 * it stay as the system computes them. Any other ND is untouched.
 */
import { markWrapper, stripComments, unwrap } from "../utils.mjs";

/** Fractional NDs handled by the patch, with the XP the book gives them (ND × 1000). */
export const FRACTIONAL_XP = Object.freeze({ "1/4": 250, "1/2": 500 });

/**
 * MenaceData#prepareBaseData of verified system versions, after normalizeSource. The probe only executes a
 * method whose source matches one of these; recognition alone never proves the bug or the fix.
 */
export const KNOWN_SOURCES = Object.freeze({
  "1.6.5":
    'prepareBaseData() { const flags = this.parent.flags; let npcFlags = {}; if (this.parent.getFlag("tormenta20", "showCD") === undefined) npcFlags.showCD = true; let nd = this.attributes.nd; if (["S", "S+"].includes(nd)) this.attributes.nivel.value = 20; else this.attributes.nivel.value = Number(nd) || 1; const nivel = this.attributes.nivel.value; this.attributes.treino = nivel > 14 ? 6 : nivel > 6 ? 4 : 2; this.attributes.meionivel = Math.floor(this.attributes.nivel.value / 2); this.attributes.defesa.condi = 0; this.attributes.nivel.xp.value = Math.floor(parseFraction(nivel) * 1000); if (this.biography?.value) { this.detalhes.biography.value += this.biography.value; } let baseFlags = { tormenta20: npcFlags }; if (!foundry.utils.isEmpty(npcFlags)) foundry.utils.mergeObject(flags, baseFlags); this.prepareBaseAtributos(); }'
});

/**
 * XP of a threat with ND "1/4" or "1/2". Any other value returns null and keeps the system's XP.
 * @param {unknown} nd  `system.attributes.nd`
 * @returns {number|null}
 */
export function fractionalCrXp(nd) {
  return Object.hasOwn(FRACTIONAL_XP, nd) ? FRACTIONAL_XP[nd] : null;
}

/**
 * Writes the corrected XP into prepared NPC attributes. Only acts when the system's value is wrong.
 * @param {object} attributes  `this.attributes` of MenaceData, after the system's prepareBaseData.
 * @returns {boolean}          Whether the XP was changed.
 */
export function applyMenaceXp(attributes) {
  const xp = fractionalCrXp(attributes?.nd);
  const target = attributes?.nivel?.xp;
  if (xp === null || !target || typeof target !== "object" || target.value === xp) return false;
  target.value = xp;
  return true;
}

/**
 * Comments removed and whitespace collapsed, so formatting changes do not matter.
 * @param {string} source
 * @returns {string}
 */
export function normalizeSource(source) {
  return String(stripComments(String(source ?? ""))).replace(/\s+/g, " ").trim();
}

/**
 * @param {string} source  Source of the method to be probed.
 * @returns {string|null}  The verified version whose method has exactly this source, or null.
 */
export function recognizeSource(source) {
  const normalized = normalizeSource(source);
  return Object.keys(KNOWN_SOURCES).find((version) => KNOWN_SOURCES[version] === normalized) ?? null;
}

/**
 * Runs a recognized prepareBaseData on a minimal stand-in with the given ND and returns the XP it computes.
 * The stand-in only has what the 1.6.5 method reads; it never touches a real actor.
 * @param {Function} prepareBaseData
 * @param {string} nd
 * @returns {unknown}
 */
export function probeMenaceXp(prepareBaseData, nd) {
  const stub = {
    parent: { flags: {}, getFlag: () => true },
    attributes: { nd, nivel: { value: 0, xp: { value: 0 } }, defesa: {} },
    detalhes: { biography: { value: "" } },
    prepareBaseAtributos() {}
  };
  prepareBaseData.call(stub);
  return stub.attributes.nivel.xp.value;
}

/**
 * @param {Record<string, unknown>} results  XP computed by the system for each ND of FRACTIONAL_XP.
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseMenaceXp(results) {
  const entries = Object.entries(FRACTIONAL_XP);
  const evidence = entries.map(([nd]) => `ND ${nd} → ${results?.[nd]} XP`).join(", ");
  if (entries.every(([nd, xp]) => results?.[nd] === xp)) return { bug: "fixed", confidence: "high", evidence };
  if (entries.some(([nd]) => results?.[nd] === 1000)) return { bug: "present", confidence: "high", evidence };
  return { bug: "unknown", confidence: "low", evidence };
}

/**
 * Diagnoses the system's method. Unrecognized code is never executed.
 * @param {Function} prepareBaseData  The system's MenaceData#prepareBaseData (without this module's wrappers).
 * @param {(fn: Function) => string} [sourceOf]
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseMethod(prepareBaseData, sourceOf = (fn) => Function.prototype.toString.call(fn)) {
  if (typeof prepareBaseData !== "function") {
    return { bug: "unknown", confidence: "low", evidence: "npc data model without prepareBaseData" };
  }
  let version;
  try {
    version = recognizeSource(sourceOf(prepareBaseData));
  } catch {
    version = null;
  }
  if (!version) return { bug: "unknown", confidence: "low", evidence: "unrecognized MenaceData#prepareBaseData; not executed" };
  const results = {};
  for (const nd of Object.keys(FRACTIONAL_XP)) {
    try {
      results[nd] = probeMenaceXp(prepareBaseData, nd);
    } catch (err) {
      return { bug: "unknown", confidence: "low", evidence: `probe of the ${version} method failed: ${err?.message ?? err}` };
    }
  }
  const diagnosis = diagnoseMenaceXp(results);
  return { ...diagnosis, evidence: `${version} method: ${diagnosis.evidence}` };
}

function isNeeded() {
  return diagnoseMethod(unwrap(CONFIG.Actor.dataModels?.npc?.prototype?.prepareBaseData));
}

function apply() {
  const proto = CONFIG.Actor.dataModels?.npc?.prototype;
  const prepareBaseData = proto?.prepareBaseData;
  if (typeof prepareBaseData !== "function") {
    console.warn("t20-community-patches | menace-xp-fraction: npc data model not found; nothing patched.");
    return;
  }
  proto.prepareBaseData = markWrapper(function (...args) {
    const result = prepareBaseData.apply(this, args);
    try {
      applyMenaceXp(this.attributes);
    } catch (err) {
      console.warn("t20-community-patches | menace-xp-fraction: could not correct the XP.", err);
    }
    return result;
  }, prepareBaseData);
}

export default {
  id: "menace-xp-fraction",
  group: "actor",
  issue: 36,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  guarded: true,
  isNeeded,
  apply
};
