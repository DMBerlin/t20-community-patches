import { unwrap } from "../../lib/source.mjs";
import {
  combineDiagnosis,
  diagnoseProbe,
  hasTemporaryBonus,
  keepAttributeRefs,
  MODIFIER_KEYS,
  probeInput,
  refreshModifiers
} from "./domain.mjs";

const actorModels = (ctx) => ctx.platform.config.document("Actor")?.dataModels;

function creaturePrototype(ctx) {
  let proto = actorModels(ctx)?.character?.prototype;
  while (proto && !Object.hasOwn(proto, "prepareAtributos")) proto = Object.getPrototypeOf(proto);
  return proto ?? null;
}

function modifierElementFields(ctx) {
  const fields = new Set();
  for (const model of Object.values(actorModels(ctx) ?? {})) {
    let schema;
    try {
      schema = model?.schema;
    } catch {
      continue;
    }
    for (const [, group, field] of MODIFIER_KEYS) {
      const element = schema?.getField?.(`modificadores.${group}.${field}`)?.element;
      if (typeof element?._replaceDataRefs === "function") fields.add(element);
    }
  }
  return fields;
}

function systemSimplify(ctx) {
  const fn = ctx.platform.t20()?.dice?.simplifyRollFormula;
  return typeof fn === "function" ? fn : null;
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const proto = creaturePrototype(ctx);
  if (typeof proto?.prepareAtributos !== "function") throw new Error("CreatureData#prepareAtributos not found");
  const simplify = systemSimplify(ctx);
  if (!simplify) throw new Error("tormenta20.dice.simplifyRollFormula not found");
  const fields = modifierElementFields(ctx);
  if (!fields.size) throw new Error("modificadores list fields not found");
  for (const field of fields) {
    ctx.wrap(field, "_replaceDataRefs", function (replaceRefs, raw, data, options = {}) {
      return keepAttributeRefs(raw, data, (r, d, o) => replaceRefs.call(this, r, d, o), options ?? {});
    });
  }
  let warned = false;
  ctx.wrap(proto, "prepareAtributos", function (original, options, ...rest) {
    const result = original.call(this, options, ...rest);
    try {
      if (hasTemporaryBonus(this.atributos)) refreshModifiers(this, options?.rollData, simplify);
    } catch (err) {
      if (!warned) ctx.log.warn("could not refresh the modifiers", this.parent?.uuid, err);
      warned = true;
    }
    return result;
  });
}

function probeApplication(ctx) {
  const fields = [...modifierElementFields(ctx)];
  if (!fields.length) return "unknown";
  const results = new Set(fields.map((field) => {
    try {
      return unwrap(field._replaceDataRefs).call(field, "@des", { des: 3, atributos: { des: { value: 3 } } });
    } catch {
      return "error";
    }
  }));
  if (results.size !== 1) return "unknown";
  const [result] = results;
  if (result === "3") return "resolves";
  if (result === "@des") return "keeps";
  return "unknown";
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const original = creaturePrototype(ctx)?.prepareAtributos;
  if (typeof original !== "function") return { bug: "unknown", confidence: "low", evidence: "prepareAtributos not found" };
  let prepare;
  try {
    const { system, rollData } = probeInput();
    unwrap(original).call(system, { rollData });
    prepare = diagnoseProbe(rollData);
  } catch (err) {
    prepare = { bug: "unknown", confidence: "low", evidence: `prepareAtributos probe failed: ${err.message}` };
  }
  return combineDiagnosis(probeApplication(ctx), prepare);
}
