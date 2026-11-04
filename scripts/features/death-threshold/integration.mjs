import { ACTOR_TYPES, applyDeathThreshold, diagnoseNpcSource, diagnoseSamples } from "./domain.mjs";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

const LOG = "t20-community-patches | death-threshold:";

/** While true, the wrappers keep the system's value, so lateProbe measures the system and not this patch. */
let bypass = false;
/** Probe actors whose system prepareDerivedData completed while bypassed. */
const prepared = new WeakSet();
let warned = false;

/** @param {FeatureContext} ctx */
function setThreshold(ctx, system) {
  try {
    applyDeathThreshold(system);
  } catch (error) {
    if (!warned) {
      warned = true;
      ctx.log.warn("could not set the minimum HP; keeping the system's value.", error);
    }
  }
}

/** @param {FeatureContext} ctx */
export function install(ctx) {
  const dataModels = ctx.platform.config.document("Actor").dataModels;
  const prototypes = new Set(ACTOR_TYPES.map((type) => dataModels?.[type]?.prototype).filter(Boolean));
  for (const proto of prototypes) {
    const original = proto.prepareDerivedData;
    if (typeof original !== "function") continue;
    ctx.wrap(proto, "prepareDerivedData", function (original, ...args) {
      const result = original.apply(this, args);
      if (!bypass) setThreshold(ctx, this);
      else if (this.parent) prepared.add(this.parent);
      return result;
    });
  }
}

export const NPC_DERIVED = "MenaceData#prepareDerivedData";

/** @param {FeatureContext} ctx */
export function isNeeded(ctx) {
  return diagnoseNpcSource(ctx.platform.sourceOfMethod(NPC_DERIVED) ?? undefined);
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
 * @param {FeatureContext} ctx
 * @returns {Promise<import("../../registry.mjs").Diagnosis|undefined>}
 */
export async function lateProbe(ctx) {
  const ActorClass = ctx.platform.classes.actor;
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
