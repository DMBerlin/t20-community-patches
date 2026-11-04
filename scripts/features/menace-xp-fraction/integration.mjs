import { unwrap } from "../../lib/source.mjs";
import { applyMenaceXp, diagnoseMethod } from "./domain.mjs";

const npcPrototype = (ctx) => ctx.platform.config.document("Actor")?.dataModels?.npc?.prototype;

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  return diagnoseMethod(unwrap(npcPrototype(ctx)?.prepareBaseData));
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const proto = npcPrototype(ctx);
  if (typeof proto?.prepareBaseData !== "function") {
    ctx.log.warn("npc data model not found; nothing patched.");
    return;
  }
  ctx.wrap(proto, "prepareBaseData", function (prepareBaseData, ...args) {
    const result = prepareBaseData.apply(this, args);
    try {
      applyMenaceXp(this.attributes);
    } catch (err) {
      ctx.log.warn("could not correct the XP.", err);
    }
    return result;
  });
}
