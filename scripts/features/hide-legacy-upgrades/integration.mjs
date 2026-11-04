import { onRenderItemSheet } from "./ui.mjs";

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  ctx.hooks.on("renderItemSheetT20", onRenderItemSheet);
}

export function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "the item sheet template is only read when rendered" };
}
