export const ATTACK_SKILLS = new Set(["luta", "pont"]);
export const DEFAULT_SAVES = ["fort", "refl", "vont"];

const listed = (list) => Array.isArray(list) && list.some(Boolean);

const numeric = (v) => (typeof v === "string" && !v.trim() ? NaN : Number(v));

/**
 * Whether the system leaves the semataque bonuses out of this skill: a save that also has resistencia bonuses.
 * @param {object} args
 * @param {string} args.skillId                 Skill key.
 * @param {Iterable<string>} args.saves          Save keys (CONFIG.T20.resistencias).
 * @param {{resistencia?: string[], semataque?: string[]}} [args.bonuses]  system.modificadores.pericias
 * @returns {boolean}
 */
export function skipsSemataque({ skillId, saves, bonuses }) {
  if (ATTACK_SKILLS.has(skillId) || ![...(saves ?? [])].includes(skillId)) return false;
  return listed(bonuses?.resistencia) && listed(bonuses?.semataque);
}

/**
 * Whether @semataque can join the formula: a nonzero number (the system keeps dice in the simplified sum).
 * @param {{semataque?: number|string}} [rollData]
 * @returns {boolean}
 */
export function numericSemataque(rollData) {
  const value = numeric(rollData?.semataque);
  return Number.isFinite(value) && value !== 0;
}

/**
 * The saves whose probe still shows the bug (resistencia only, 1).
 * @param {Record<string, unknown>} values  Probe value per save.
 * @returns {Set<string>}
 */
export function buggySaves(values) {
  return new Set(Object.entries(values ?? {}).filter(([, v]) => v === 1).map(([k]) => k));
}

/** Probe input: no other bonus, resistencia +1 and semataque +2. */
export const PROBE = {
  bonuses: { geral: [], ataque: [], resistencia: ["1"], semataque: ["2"] },
  rollData: { meionivel: 0, con: 0, des: 0, sab: 0, for: 0, treino: 0, pericia: 0, ataque: 0, resistencia: 1, semataque: 2 }
};

/** Saves the probe prepares, with their attributes, and the control skill. */
export const PROBE_SKILLS = { fort: "con", refl: "des", vont: "sab" };

/**
 * Interprets the values the system's original prepareSkill gave to the probe. A save is buggy at 1 (resistencia
 * only) and correct at 3; one buggy save is enough for present.
 * @param {{saves?: Record<string, unknown>, skill?: unknown}} values  saves: by key; skill: Atletismo (control).
 * @returns {import("../../registry.mjs").Diagnosis}
 */
export function diagnoseProbe({ saves = {}, skill } = {}) {
  const values = Object.keys(PROBE_SKILLS).map((k) => saves[k]);
  const evidence = `${Object.keys(PROBE_SKILLS).map((k) => `${k} ${saves[k]}`).join(", ")}, Atletismo ${skill} (resistencia +1, semataque +2)`;
  if (skill !== 2) return { bug: "unknown", confidence: "low", evidence: `control not recognized: ${evidence}` };
  if (!values.every((v) => v === 1 || v === 3)) return { bug: "unknown", confidence: "low", evidence };
  if (values.includes(1)) return { bug: "present", confidence: "high", evidence };
  return { bug: "fixed", confidence: "high", evidence };
}
