import { unwrap } from "../../lib/source.mjs";
import { fromFactory } from "../../kernel/wrap.mjs";
import { keepStoredEngePda, prepareSkillOwners, prepareSkillRecognized, wrapPrepareSkill } from "./domain.mjs";

const actorModels = (ctx) => ctx.platform.config.document("Actor")?.dataModels;

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const enge = ctx.platform.t20Config()?.pericias?.enge;
  if (!enge) return { bug: "unknown", confidence: "low", evidence: "CONFIG.T20.pericias.enge not found" };
  const owners = prepareSkillOwners(actorModels(ctx));
  if (!owners.length || !owners.every((o) => prepareSkillRecognized(String(unwrap(o.prepareSkill))))) {
    return { bug: "unknown", confidence: "low", evidence: "CreatureData#prepareSkill not recognized" };
  }
  if (enge.armorPenalty === true) {
    return { bug: "present", confidence: "high", evidence: "CONFIG.T20.pericias.enge.armorPenalty is true" };
  }
  return {
    bug: "fixed",
    confidence: "low",
    evidence: "armorPenalty is off in CONFIG, but actors created before may still store pericias.enge.pda"
  };
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  let wrapped = false;
  for (const owner of prepareSkillOwners(actorModels(ctx))) {
    if (!prepareSkillRecognized(String(unwrap(owner.prepareSkill)))) {
      ctx.log.warn("prepareSkill not recognized; correction inactive");
      continue;
    }
    ctx.wrap(owner, "prepareSkill", fromFactory(wrapPrepareSkill));
    wrapped = true;
  }
  if (!wrapped) return;
  const onPreUpdate = (document, changes) => {
    try {
      const source = (document.syntheticActor ?? document)._source;
      keepStoredEngePda(changes, source?.system?.pericias?.enge?.pda, ctx.platform.core.operators?.DataFieldOperator);
    } catch (error) {
      ctx.log.warn("could not keep the stored pda", error);
    }
  };
  // Unlinked token actors are updated through their ActorDelta, which fires preUpdateActorDelta instead.
  ctx.hooks.on("preUpdateActor", onPreUpdate);
  ctx.hooks.on("preUpdateActorDelta", onPreUpdate);
}
