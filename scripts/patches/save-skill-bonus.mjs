/**
 * Save bonuses of "skills except attacks" (tormenta20 1.6.5).
 *
 * Bug: CreatureData#prepareSkill (T20:19835-19872) chooses the actor-wide skill bonus with an else-if chain: a save
 * (Fortitude, Reflexos, Vontade) that has "Testes de Perícias de Resistências" bonuses never receives the "Testes de
 * Perícias, exceto de Ataque" (semataque) bonuses. Without a save bonus, it does. The sheet breakdown lists both, and
 * the roll uses the prepared value, so the sheet, the breakdown and the roll disagree.
 *
 * Fix: when a save has both kinds of bonus, "@semataque" is appended to the save's own bonus list for the duration of
 * the system's call (and removed afterwards), so the term enters the system's formula before its integer conversion,
 * as in any other skill; no roll data variable is redefined. Only the saves the probe still finds buggy are touched,
 * so a partial fix upstream is never doubled. semataque bonuses with dice are left alone.
 */
import { markWrapper, unwrap } from "../utils.mjs";

const LOG = "t20-community-patches | save-skill-bonus:";
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
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseProbe({ saves = {}, skill } = {}) {
  const values = Object.keys(PROBE_SKILLS).map((k) => saves[k]);
  const evidence = `${Object.keys(PROBE_SKILLS).map((k) => `${k} ${saves[k]}`).join(", ")}, Atletismo ${skill} (resistencia +1, semataque +2)`;
  if (skill !== 2) return { bug: "unknown", confidence: "low", evidence: `control not recognized: ${evidence}` };
  if (!values.every((v) => v === 1 || v === 3)) return { bug: "unknown", confidence: "low", evidence };
  if (values.includes(1)) return { bug: "present", confidence: "high", evidence };
  return { bug: "fixed", confidence: "high", evidence };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function creaturePrototype() {
  let proto = CONFIG.Actor.dataModels?.character?.prototype;
  while (proto && !Object.hasOwn(proto, "prepareSkill")) proto = Object.getPrototypeOf(proto);
  return proto ?? null;
}

function saveKeys() {
  const saves = CONFIG.T20?.resistencias;
  return saves && typeof saves === "object" ? Object.keys(saves) : DEFAULT_SAVES;
}

let warned = false;

/** Runs the original prepareSkill on synthetic data; it only reads `this` and the arguments it receives. */
function runProbe(fn, skillId, atributo) {
  const skillData = { atributo, label: skillId, treinado: false, bonus: [], pda: false, size: false, outros: 0, condi: 0 };
  const data = { pericias: {}, modificadores: { pericias: foundry.utils.deepClone(PROBE.bonuses) } };
  return fn.call(data, skillId, { skillData, rollData: { ...PROBE.rollData } })?.value;
}

function probeSaves(fn, keys) {
  return Object.fromEntries(keys.map((k) => [k, runProbe(fn, k, PROBE_SKILLS[k] ?? "con")]));
}

function apply() {
  const proto = creaturePrototype();
  if (typeof proto?.prepareSkill !== "function") throw new Error("CreatureData#prepareSkill not found");
  const original = proto.prepareSkill;
  let targets;
  try {
    targets = buggySaves(probeSaves(unwrap(original), saveKeys()));
  } catch (err) {
    targets = new Set();
  }
  if (!targets.size) console.warn(`${LOG} no save shows the bug; nothing to fix`);
  proto.prepareSkill = markWrapper(function (skillId, options = {}) {
    let args = options;
    let skillData;
    let bonus;
    try {
      const bonuses = foundry.utils.getProperty(this, "modificadores.pericias");
      if (targets.has(skillId) && skipsSemataque({ skillId, saves: saveKeys(), bonuses })) {
        const rollData = options?.rollData ?? this.parent?.getRollData?.();
        skillData = options?.skillData ?? foundry.utils.deepClone(this.pericias?.[skillId]);
        if (numericSemataque(rollData) && Array.isArray(skillData?.bonus)) {
          bonus = skillData.bonus;
          skillData.bonus = [...bonus, "@semataque"];
          args = { ...options, skillData, rollData };
        }
      }
    } catch (err) {
      if (!warned) console.warn(`${LOG} could not add the bonus`, this.parent?.uuid, err);
      warned = true;
      args = options;
    }
    try {
      return original.call(this, skillId, args);
    } finally {
      if (bonus) skillData.bonus = bonus;
    }
  }, original);
}

function isNeeded() {
  const original = creaturePrototype()?.prepareSkill;
  if (typeof original !== "function") return { bug: "unknown", confidence: "low", evidence: "prepareSkill not found" };
  const fn = unwrap(original);
  try {
    return diagnoseProbe({ saves: probeSaves(fn, Object.keys(PROBE_SKILLS)), skill: runProbe(fn, "atle", "for") });
  } catch (err) {
    return { bug: "unknown", confidence: "low", evidence: `prepareSkill probe failed: ${err.message}` };
  }
}

export default {
  id: "save-skill-bonus",
  group: "actor",
  issue: 39,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  apply
};
