/**
 * Death threshold (minimum HP).
 *
 * Bug (tormenta20 1.6.5): the system sets the minimum HP to -floor(max / 2) (AttributesFields.preparePVPM for
 * characters, MenaceData#prepareDerivedData for threats). The core rulebook (p. 236) says a creature dies at -10
 * or at a negative value equal to half its maximum HP, whichever is lower, so creatures with less than 20 HP stop
 * above -10. Characters with manual HP configuration or without class levels, and "simple" actors, never get a
 * computed minimum and keep the stored value (0). Damage is clamped to pv.min (applyDamage, applyDamageV2).
 *
 * Fix: after each actor type prepares its derived data, pv.min is set to -max(10, floor(max / 2)). Nothing is
 * stored: pv.min is derived data.
 *
 * Setting "HP below the death threshold" (#51): independent of this patch's mode, damage may take actors covered by
 * the "Zero HP states" rule below pv.min, which then marks them Dead. Installed by main.mjs, so the patch never
 * imports the rule.
 */
import { MODULE_ID, markWrapper, stripComments, unwrap } from "../utils.mjs";

const LOG = "t20-community-patches | death-threshold:";
export const DEATH_FLOOR = -10;
export const ACTOR_TYPES = ["character", "npc", "simple"];
/** The 1.6.5 assignment, as the last statement of the method. */
export const BUGGY_NPC_THRESHOLD =
  /this\.attributes\.pv\.min\s*=\s*Math\.floor\(\s*this\.attributes\.pv\.max\s*\/\s*2\s*\)\s*\*\s*-\s*1\s*;?\s*}\s*$/;

/**
 * Rulebook threshold: -10 or minus half the maximum HP (rounded down), whichever is lower.
 * @param {number|string} max  Maximum HP.
 * @returns {number|null}      The minimum HP, or null when max is not a number.
 */
export function deathThreshold(max) {
  const total = Math.floor(Number(max));
  if (!Number.isFinite(total)) return null;
  return Math.min(DEATH_FLOOR, -Math.floor(total / 2));
}

/**
 * Overwrites pv.min of prepared actor data. Leaves the data untouched when there is no HP or max is not a number.
 * @param {object} system  Prepared actor system data.
 * @returns {boolean}      Whether pv.min was set.
 */
export function applyDeathThreshold(system) {
  const pv = system?.attributes?.pv;
  if (!pv || typeof pv !== "object") return false;
  const min = deathThreshold(pv.max);
  if (min === null) return false;
  pv.min = min;
  return true;
}

/**
 * Reads MenaceData#prepareDerivedData. Only the known buggy assignment is recognized; source reading never proves
 * a fix, and it does not cover characters or "simple" actors. Recognized only when the buggy assignment is the
 * single reference to a minimum and the last statement, so a later correction is never reported as the bug.
 * @param {string|undefined} source
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseNpcSource(source) {
  if (typeof source !== "string" || !source) {
    return { bug: "unknown", confidence: "low", evidence: "MenaceData#prepareDerivedData source unavailable" };
  }
  const code = stripComments(source);
  // Any other reference to a minimum (a later correction, a destructured pv.min) makes the code unrecognized.
  const mentions = code.match(/\.min\b|\[\s*["'`]min["'`]\s*\]/g)?.length ?? 0;
  if (mentions === 1 && BUGGY_NPC_THRESHOLD.test(code)) {
    return { bug: "present", confidence: "high", evidence: "MenaceData sets pv.min to -floor(max / 2), without the -10 floor" };
  }
  return { bug: "unknown", confidence: "low", evidence: "MenaceData#prepareDerivedData not recognized; checked after ready" };
}

/**
 * Compares the minimum HP the system computed for sample actors with the rulebook threshold.
 * Only valid samples count: the system's prepareDerivedData completed and max is the planned one.
 * @param {{label: string, max: number, min: number, expectedMax: number, prepared: boolean}[]} samples
 * @param {string[]} required  Labels that must all be valid and match the rule to report a fix.
 * @returns {import("../registry.mjs").Diagnosis|undefined}
 */
export function diagnoseSamples(samples, required) {
  const wrong = [];
  const matched = new Set();
  for (const { label, max, min, expectedMax, prepared } of samples ?? []) {
    if (!prepared || Number(max) !== expectedMax) continue;
    const expected = deathThreshold(max);
    const actual = Number(min);
    if (expected === null || !Number.isInteger(actual)) continue;
    if (actual > expected) wrong.push(`${label}: max ${max}, min ${actual} (rule ${expected})`);
    else if (actual === expected) matched.add(label);
  }
  if (wrong.length) return { bug: "present", confidence: "high", evidence: wrong.join("; ") };
  if (required.length && required.every((label) => matched.has(label))) {
    return { bug: "fixed", confidence: "high", evidence: `minimum HP follows the rule for ${required.join(", ")}` };
  }
  return undefined;
}

/* -------------------------------------------- */
/*  HP below the threshold (#51)                */
/* -------------------------------------------- */

export const DEATH_FLOOR_SETTING = "deathThresholdFloor";
export const DEATH_FLOOR_MODES = ["unbounded", "clamp"];

/** Registers the world setting. Runs on "init" whatever the patch state: the system's clamp always exists. */
export function registerDeathThresholdFloorSetting() {
  game.settings.register(MODULE_ID, DEATH_FLOOR_SETTING, {
    name: "T20CP.Patches.death-threshold.Floor.Name",
    hint: "T20CP.Patches.death-threshold.Floor.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: Object.fromEntries(DEATH_FLOOR_MODES.map((m) => [m, `T20CP.Patches.death-threshold.Floor.${m}`])),
    default: "unbounded"
  });
}

/** Whether damage may take this actor below the death threshold. */
export function allowsBelowThreshold({ floor, covered }) {
  return floor === "unbounded" && covered === true;
}

/**
 * Runs a damage method with pv.min lifted, so its synchronous clamp keeps values below the threshold.
 * pv.min is derived data; it is restored as soon as the original returns its Promise, before any await resumes.
 */
export function wrapDamageFloor(original, allows) {
  return markWrapper(function (...args) {
    const pv = this?.system?.attributes?.pv;
    let lifted = false;
    let min;
    try {
      // Already lifted (the nonlethal Proxy reads -Infinity but writes to the real data): saving it would keep it.
      if (pv && typeof pv === "object" && pv.min !== Number.NEGATIVE_INFINITY && allows(this)) {
        min = pv.min;
        pv.min = Number.NEGATIVE_INFINITY;
        lifted = true;
      }
    } catch (err) {
      console.warn(`${LOG} could not check the HP floor; keeping the system's clamp.`, err);
    }
    try {
      return original.apply(this, args);
    } finally {
      if (lifted) pv.min = min;
    }
  }, original);
}

/** Wraps the system's damage methods. `allows` reads the settings on every call. */
export function installDamageFloor(allows) {
  const proto = CONFIG.Actor.documentClass.prototype;
  for (const name of ["applyDamage", "applyDamageV2"]) {
    if (typeof proto[name] === "function") proto[name] = wrapDamageFloor(proto[name], allows);
  }
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

/** While true, the wrappers keep the system's value, so lateProbe measures the system and not this patch. */
let bypass = false;
/** Probe actors whose system prepareDerivedData completed while bypassed. */
const prepared = new WeakSet();
let warned = false;

function apply() {
  const prototypes = new Set(ACTOR_TYPES.map((type) => CONFIG.Actor.dataModels?.[type]?.prototype).filter(Boolean));
  for (const proto of prototypes) {
    const original = proto.prepareDerivedData;
    if (typeof original !== "function") continue;
    proto.prepareDerivedData = markWrapper(function (...args) {
      const result = original.apply(this, args);
      if (bypass) {
        if (this.parent) prepared.add(this.parent);
      } else {
        try {
          applyDeathThreshold(this);
        } catch (error) {
          if (!warned) {
            warned = true;
            console.warn(`${LOG} could not set the minimum HP; keeping the system's value.`, error);
          }
        }
      }
      return result;
    }, original);
  }
}

function isNeeded() {
  const fn = CONFIG.Actor.dataModels?.npc?.prototype?.prepareDerivedData;
  const source = typeof fn === "function" ? Function.prototype.toString.call(unwrap(fn)) : undefined;
  return diagnoseNpcSource(source);
}

const classItem = (niveis, pvPorNivel) => ({ name: "Probe", type: "classe", system: { niveis, pvPorNivel, inicial: true } });
const withPV = (max) => ({ attributes: { pv: { value: max, max } } });
const MANUAL = { tormenta20: { lvlconfig: { manual: true } } };

/** Each path once below 20 HP (the -10 floor) and once above (half the maximum). */
const PROBE_ACTORS = [
  { label: "character 8", expectedMax: 8, data: { type: "character", items: [classItem(1, 2)] } },
  { label: "character 30", expectedMax: 30, data: { type: "character", items: [classItem(3, 5)] } },
  { label: "character without class 12", expectedMax: 12, data: { type: "character", system: withPV(12) } },
  { label: "character without class 40", expectedMax: 40, data: { type: "character", system: withPV(40) } },
  { label: "character manual 12", expectedMax: 12, data: { type: "character", flags: MANUAL, system: withPV(12) } },
  { label: "character manual 40", expectedMax: 40, data: { type: "character", flags: MANUAL, system: withPV(40) } },
  { label: "npc 12", expectedMax: 12, data: { type: "npc", system: withPV(12) } },
  { label: "npc 40", expectedMax: 40, data: { type: "npc", system: withPV(40) } },
  { label: "simple 12", expectedMax: 12, data: { type: "simple", system: withPV(12) } },
  { label: "simple 40", expectedMax: 40, data: { type: "simple", system: withPV(40) } }
];

/**
 * After "ready": builds temporary actors (never saved) with the wrappers bypassed and reads the system's pv.min.
 * Construction runs the core's _safePrepareData, which swallows errors, so a sample only counts when the
 * system's prepareDerivedData completed for that actor (see `prepared`).
 * @returns {Promise<import("../registry.mjs").Diagnosis|undefined>}
 */
async function lateProbe() {
  const ActorClass = CONFIG.Actor.documentClass;
  const samples = [];
  bypass = true;
  try {
    for (const { label, expectedMax, data } of PROBE_ACTORS) {
      try {
        const actor = new ActorClass({ name: `t20cp death-threshold probe (${label})`, ...data });
        const pv = actor.system?.attributes?.pv;
        samples.push({ label, expectedMax, max: pv?.max, min: pv?.min, prepared: prepared.has(actor) });
      } catch (error) {
        console.debug(`${LOG} probe actor "${label}" failed`, error);
      }
    }
  } finally {
    bypass = false;
  }
  return diagnoseSamples(samples, PROBE_ACTORS.map((p) => p.label));
}

export default {
  id: "death-threshold",
  group: "conditions",
  issue: 29,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  lateProbe,
  apply
};
