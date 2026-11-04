import { unwrap } from "../../lib/source.mjs";
import { buggySaves, DEFAULT_SAVES, diagnoseProbe, numericSemataque, PROBE, PROBE_SKILLS, skipsSemataque } from "./domain.mjs";

function creaturePrototype(ctx) {
  let proto = ctx.platform.config.document("Actor")?.dataModels?.character?.prototype;
  while (proto && !Object.hasOwn(proto, "prepareSkill")) proto = Object.getPrototypeOf(proto);
  return proto ?? null;
}

function saveKeys(ctx) {
  const saves = ctx.platform.t20Config()?.resistencias;
  return saves && typeof saves === "object" ? Object.keys(saves) : DEFAULT_SAVES;
}

/** Runs the original prepareSkill on synthetic data; it only reads `this` and the arguments it receives. */
function runProbe(ctx, fn, skillId, atributo) {
  const skillData = { atributo, label: skillId, treinado: false, bonus: [], pda: false, size: false, outros: 0, condi: 0 };
  const data = { pericias: {}, modificadores: { pericias: ctx.platform.utils.deepClone(PROBE.bonuses) } };
  return fn.call(data, skillId, { skillData, rollData: { ...PROBE.rollData } })?.value;
}

function probeSaves(ctx, fn, keys) {
  return Object.fromEntries(keys.map((k) => [k, runProbe(ctx, fn, k, PROBE_SKILLS[k] ?? "con")]));
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const proto = creaturePrototype(ctx);
  if (typeof proto?.prepareSkill !== "function") throw new Error("CreatureData#prepareSkill not found");
  let targets;
  try {
    targets = buggySaves(probeSaves(ctx, unwrap(proto.prepareSkill), saveKeys(ctx)));
  } catch {
    targets = new Set();
  }
  if (!targets.size) ctx.log.warn("no save shows the bug; nothing to fix");
  let warned = false;
  ctx.wrap(proto, "prepareSkill", function (original, skillId, options = {}) {
    let extended = null;
    try {
      extended = targets.has(skillId) ? withSemataque(ctx, this, skillId, options) : null;
    } catch (err) {
      if (!warned) ctx.log.warn("could not add the bonus", this.parent?.uuid, err);
      warned = true;
      extended = null;
    }
    try {
      return original.call(this, skillId, extended?.args ?? options);
    } finally {
      if (extended) extended.skillData.bonus = extended.bonus;
    }
  });
}

/**
 * Arguments for the original with "@semataque" appended to the save's own bonus list, or null to keep the call.
 * `bonus` is the list to restore after the call.
 */
function withSemataque(ctx, data, skillId, options) {
  const { utils } = ctx.platform;
  const bonuses = utils.getProperty(data, "modificadores.pericias");
  if (!skipsSemataque({ skillId, saves: saveKeys(ctx), bonuses })) return null;
  const rollData = options?.rollData ?? data.parent?.getRollData?.();
  const skillData = options?.skillData ?? utils.deepClone(data.pericias?.[skillId]);
  if (!numericSemataque(rollData) || !Array.isArray(skillData?.bonus)) return null;
  const bonus = skillData.bonus;
  skillData.bonus = [...bonus, "@semataque"];
  return { args: { ...options, skillData, rollData }, skillData, bonus };
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const original = creaturePrototype(ctx)?.prepareSkill;
  if (typeof original !== "function") return { bug: "unknown", confidence: "low", evidence: "prepareSkill not found" };
  const fn = unwrap(original);
  try {
    return diagnoseProbe({ saves: probeSaves(ctx, fn, Object.keys(PROBE_SKILLS)), skill: runProbe(ctx, fn, "atle", "for") });
  } catch (err) {
    return { bug: "unknown", confidence: "low", evidence: `prepareSkill probe failed: ${err.message}` };
  }
}
