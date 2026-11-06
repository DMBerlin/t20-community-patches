import { diagnose } from "../domain.mjs";
import { createRepairClass } from "../ui.mjs";
import { scan } from "./scan.mjs";
import { canWrite, repairAll, undoAll } from "./write.mjs";

// migrateEffectsV2 drops the status; migration_1_6_0 never migrates unlinked tokens (T20:20640, token loop at 20667-20682).
export const SOURCES = ["#local:migrateEffectsV2", "#local:migration_1_6_0"];
const MENU_KEY = "legacyConditionStatus";

/** @param {import("../../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const { platform } = ctx;
  if (typeof platform.documents.items !== "function") throw new Error("documents.items port missing");
  if (typeof platform.core.ApplicationV2 !== "function") throw new Error("ApplicationV2 not available");
  const lock = { busy: false };
  platform.settings.registerMenu(MENU_KEY, {
    name: "T20CP.LegacyConditionStatus.Name",
    label: "T20CP.LegacyConditionStatus.Button",
    hint: "T20CP.LegacyConditionStatus.Hint",
    icon: "fa-solid fa-screwdriver-wrench",
    type: createRepairClass(ctx, {
      scan: () => scan(platform),
      canWrite: () => canWrite(platform),
      isBusy: () => lock.busy,
      repair: (groups) => repairAll(ctx, lock, groups),
      undo: (groups) => undoAll(ctx, lock, groups)
    }),
    restricted: true
  });
}

/** Only reads source code; `#local:` labels are null in Foundry and resolved by the static audit. */
export function isNeeded(ctx) {
  return diagnose(ctx.platform.sourceOfMethod(SOURCES[0]) ?? undefined);
}

/** After ready, GMs only: affected data on this world is the evidence the source probe cannot give. */
export async function lateProbe(ctx) {
  if (!ctx.platform.user.isGM()) return undefined;
  const { repair } = scan(ctx.platform);
  const count = repair.reduce((n, group) => n + group.candidates.length, 0);
  if (!count) return undefined;
  return { bug: "present", confidence: "high", evidence: `${count} conditions without system.status in ${repair.length} documents` };
}
