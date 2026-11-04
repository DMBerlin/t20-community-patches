import {
  outdatedMarker,
  readEntries,
  summarize,
  wrapActorPreCreate,
  wrapPreCreate
} from "../../lib/compendium-copy/index.mjs";
import { fromFactory } from "../../kernel/wrap.mjs";
import { ENTRIES, PATCH_ID } from "./domain.mjs";

export function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "compendium data can only be read after ready" };
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export async function lateProbe(ctx) {
  try {
    return summarize(await readEntries(ENTRIES, ctx.platform.documents.packs()));
  } catch (error) {
    ctx.log.warn("probe failed", error);
    return undefined;
  }
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const item = ctx.platform.classes.item?.prototype;
  if (typeof item?._preCreate === "function") {
    ctx.wrap(item, "_preCreate", fromFactory((original) => wrapPreCreate(original, "Item", ENTRIES, PATCH_ID)));
  }
  const actor = ctx.platform.classes.actor?.prototype;
  if (typeof actor?._preCreate === "function") {
    ctx.wrap(actor, "_preCreate", fromFactory((original) => wrapActorPreCreate(original, ENTRIES, PATCH_ID)));
  }
  ctx.hooks.on(
    "renderActorSheetT20",
    outdatedMarker(ENTRIES, () => ctx.platform.i18n.localize("T20CP.PartnerCombatant.Outdated"), PATCH_ID)
  );
}
