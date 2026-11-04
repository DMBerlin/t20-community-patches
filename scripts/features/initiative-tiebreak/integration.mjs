import { MODULE_ID } from "../../lib/module.mjs";
import { sourceFingerprint, unwrap } from "../../lib/source.mjs";
import { ABILITY_FLAG, FLAG, compareInitiativeTie, diagnose, tiebreakValues } from "./domain.mjs";

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
function readFacts(ctx) {
  const { platform } = ctx;
  const coreSort = unwrap(platform.core.Combat?.prototype?._sortCombatants);
  const sort = platform.classes.combat?.prototype?._sortCombatants;
  return {
    sortFingerprint: sourceFingerprint(coreSource(platform, coreSort)),
    sortOverridden: typeof sort !== "function" || unwrap(sort) !== coreSort,
    formula: String(platform.config.document("Combat")?.initiative?.formula ?? ""),
    formulaOverridden: formulaOverridden(platform)
  };
}

function coreSource(platform, coreSort) {
  try {
    return typeof coreSort === "function" ? platform.sourceOf(coreSort) : null;
  } catch {
    return null;
  }
}

function formulaOverridden(platform) {
  const formulaOf = (cls) => cls?.prototype?._getInitiativeFormula;
  return formulaOf(platform.classes.combatant) !== formulaOf(platform.core.Combatant);
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  return diagnose(readFacts(ctx));
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  // Only on the verified code: a different sort or formula may already break ties in its own way.
  const diagnosis = diagnose(readFacts(ctx));
  if (diagnosis.bug !== "present") {
    ctx.log.warn(`unrecognized initiative code, not changing it (${diagnosis.evidence})`);
    return;
  }
  const skillPath = `flags.${MODULE_ID}.${FLAG}`;
  const abilityPath = `flags.${MODULE_ID}.${ABILITY_FLAG}`;
  ctx.hooks.on("preCreateCombatant", (combatant, data) => {
    try {
      const values = tiebreakValues(data, combatant.actor);
      if (values) combatant.updateSource({ [skillPath]: values.skill, [abilityPath]: values.ability });
    } catch (err) {
      ctx.log.warn(err);
    }
  });
  ctx.hooks.on("preUpdateCombatant", (combatant, changed) => {
    try {
      const values = tiebreakValues(changed, combatant.actor);
      if (values) {
        // Changes made to `changed` in a pre-update hook are saved with the same update.
        ctx.platform.utils.setProperty(changed, skillPath, values.skill);
        ctx.platform.utils.setProperty(changed, abilityPath, values.ability);
      }
    } catch (err) {
      ctx.log.warn(err);
    }
  });

  const prototype = ctx.platform.classes.combat.prototype;
  // setupTurns passes this method unbound to Array#sort (combat.mjs:496), so the wrapper never relies on `this`.
  ctx.wrap(prototype, "_sortCombatants", function (original, a, b) {
    let tie = 0;
    try {
      tie = compareInitiativeTie(a, b);
    } catch {
      tie = 0;
    }
    return tie || original.call(this, a, b);
  });
}
