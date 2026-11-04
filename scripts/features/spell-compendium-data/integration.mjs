import { PACK_ID, SPELL_FIXES, applySpellFix, findSpellFix } from "./domain.mjs";

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const Model = ctx.platform.config.document("ActiveEffect")?.dataModels?.base;
  const original = Model?.prototype?.prepareBaseData;
  if (typeof original !== "function") throw new Error("Tormenta20 effect data model not found");

  ctx.wrap(Model.prototype, "prepareBaseData", function (original, ...args) {
    let effect;
    try {
      effect = this.parent;
      const entry = findSpellFix({ itemType: effect?.parent?.type, effectId: effect?.id, source: effect?._source });
      if (entry) applySpellFix(this, entry);
    } catch (err) {
      ctx.log.warn("could not fix", effect?.id, err);
    }
    return original.apply(this, args);
  });
}

/** The bug lives in compendium data, which is only readable after "ready". */
export function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "compendium data is only readable after ready" };
}

/**
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 * @returns {Promise<import("../../registry.mjs").Diagnosis|undefined>}
 */
export async function lateProbe(ctx) {
  const pack = ctx.platform.documents.packs()?.get(PACK_ID);
  if (!pack) return undefined;
  const found = [];
  for (const itemId of new Set(SPELL_FIXES.map((entry) => entry.item))) {
    const item = await pack.getDocument(itemId);
    for (const effect of item?.effects ?? []) {
      const entry = findSpellFix({ itemType: item.type, effectId: effect.id, source: effect._source });
      if (entry) found.push(`${entry.spell}/${entry.effect}`);
    }
  }
  if (found.length) return { bug: "present", confidence: "high", evidence: `${PACK_ID}: ${found.join(", ")}` };
  return { bug: "fixed", confidence: "low", evidence: `${PACK_ID}: no buggy effect found; world copies may still be buggy` };
}
