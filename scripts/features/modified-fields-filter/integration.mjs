import { markWrapper, unwrap } from "../../lib/source.mjs";
import { PROBE_EFFECTS, collectModifiedFields, diagnoseFields } from "./domain.mjs";

function getterOwner(platform) {
  let proto = platform.classes.actor?.prototype;
  while (proto && !Object.getOwnPropertyDescriptor(proto, "modifiedFields")?.get) proto = Object.getPrototypeOf(proto);
  return proto ?? null;
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const owner = getterOwner(ctx.platform);
  const descriptor = owner && Object.getOwnPropertyDescriptor(owner, "modifiedFields");
  if (typeof descriptor?.get !== "function") throw new Error("ActorT20#modifiedFields not found");
  Object.defineProperty(owner, "modifiedFields", {
    ...descriptor,
    get: markWrapper(function () {
      return collectModifiedFields(this.appliedEffects);
    }, descriptor.get)
  });
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const owner = getterOwner(ctx.platform);
  const get = unwrap(owner && Object.getOwnPropertyDescriptor(owner, "modifiedFields")?.get);
  if (typeof get !== "function") return { bug: "unknown", confidence: "low", evidence: "modifiedFields not found" };
  try {
    return diagnoseFields(get.call({ appliedEffects: PROBE_EFFECTS }));
  } catch (err) {
    return { bug: "unknown", confidence: "low", evidence: `modifiedFields probe failed: ${err.message}` };
  }
}
