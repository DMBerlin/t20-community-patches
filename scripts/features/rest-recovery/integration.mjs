import { unwrap } from "../../lib/source.mjs";
import { correctRestArgs, diagnoseCareSamples, isKnownDescanso, measureCareRecovery, PROBE_CASES } from "./domain.mjs";

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const descanso = unwrap(ctx.platform.classes.actor?.prototype?.descanso);
  if (typeof descanso !== "function") {
    return { bug: "unknown", confidence: "low", evidence: "Actor#descanso not found" };
  }
  if (!isKnownDescanso(descanso)) {
    return { bug: "unknown", confidence: "low", evidence: "Actor#descanso differs from tormenta20 1.6.5; not executed" };
  }
  return diagnoseCareSamples(PROBE_CASES.map((s) => ({ ...s, observed: measureCareRecovery(descanso, s) })));
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const proto = ctx.platform.classes.actor?.prototype;
  if (typeof proto?.descanso !== "function") {
    ctx.log.warn("Actor#descanso not found; nothing patched.");
    return;
  }
  ctx.wrap(proto, "descanso", function (original, ...args) {
    return original.apply(this, correctRestArgs(args));
  });
}
