import { unwrap } from "../../lib/source.mjs";
import {
  KNOWN_PREPARE_FINAL_ATTRIBUTES,
  PROBE,
  arcaneEmpowermentBonus,
  casterProgress,
  diagnoseSaveDC,
  findArcaneEmpowerments,
  fixSaveDC,
  normalizeSource,
  runKnown,
  withoutEmpowermentEffects
} from "./domain.mjs";

function itemDataPrototype(ctx) {
  let proto = ctx.platform.config.document("Item")?.dataModels?.magia?.prototype;
  while (proto && !Object.hasOwn(proto, "prepareFinalAttributes")) proto = Object.getPrototypeOf(proto);
  return proto ?? null;
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const itemData = itemDataPrototype(ctx);
  const characterData = ctx.platform.config.document("Actor")?.dataModels?.character?.prototype;
  const ItemClass = ctx.platform.classes.item;
  if (!itemData || typeof characterData?.prepareBaseData !== "function" || typeof ItemClass?.prototype?._allApplicableOnUseEffects !== "function") {
    throw new Error("Tormenta20 save DC API not found");
  }
  const { getProperty } = ctx.platform.utils;

  ctx.wrap(itemData, "prepareFinalAttributes", function (prepareFinalAttributes, ...args) {
    const result = prepareFinalAttributes.apply(this, args);
    try {
      fixSaveDC(this, getProperty);
    } catch (err) {
      ctx.log.warn("could not fix the save DC", this.parent?.uuid, err);
    }
    return result;
  });

  ctx.wrap(characterData, "prepareBaseData", function (prepareBaseData, ...args) {
    const result = prepareBaseData.apply(this, args);
    try {
      const items = this.parent?.items;
      if (Number.isFinite(this.attributes?.cd) && findArcaneEmpowerments(items).length) {
        this.attributes.cd += arcaneEmpowermentBonus(casterProgress(items));
      }
    } catch (err) {
      ctx.log.warn("could not apply Fortalecimento Arcano", this.parent?.uuid, err);
    }
    return result;
  });

  ctx.wrap(ItemClass.prototype, "_allApplicableOnUseEffects", function (allApplicable, ...args) {
    const effects = allApplicable.apply(this, args);
    if (!Array.isArray(effects) || this.actor?.type !== "character") return effects;
    const empowerments = findArcaneEmpowerments(this.actor.items);
    return empowerments.length ? withoutEmpowermentEffects(effects, empowerments) : effects;
  });
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const original = unwrap(itemDataPrototype(ctx)?.prepareFinalAttributes);
  if (typeof original !== "function") return { bug: "unknown", confidence: "low", evidence: "prepareFinalAttributes not found" };
  const source = normalizeSource(ctx.platform.sourceOf(original));
  if (source !== KNOWN_PREPARE_FINAL_ATTRIBUTES) {
    return { bug: "unknown", confidence: "low", evidence: "prepareFinalAttributes not recognized; not executed" };
  }
  const results = {};
  for (const [key, probe] of Object.entries(PROBE)) results[key] = runKnown(original, probe);
  return diagnoseSaveDC(results);
}
