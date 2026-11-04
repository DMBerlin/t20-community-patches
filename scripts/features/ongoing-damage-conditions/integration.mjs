import {
  ONGOING_CONDITIONS,
  STATUS_PACK,
  createKeyedQueue,
  diagnoseConditionData,
  diagnoseDotSource,
  selectOngoingConditions,
  skipDialogEvent,
  testPassed
} from "./domain.mjs";

const runForActor = createKeyedQueue();

export const MANAGE_DOT = "CombatT20#_manageDOTEffects";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

/** @param {FeatureContext} ctx */
function originalSource(ctx) {
  return ctx.platform.sourceOfMethod(MANAGE_DOT) ?? "";
}

/** @param {FeatureContext} ctx */
function describeEffect(ctx, effect, actor) {
  let fromOtherSource = false;
  const duplicate = effect._stats?.duplicateSource;
  if (duplicate) {
    try {
      fromOtherSource = ctx.platform.documents.fromUuidSync(duplicate) !== actor;
    } catch {
      fromOtherSource = true;
    }
  }
  return {
    id: effect.id,
    active: effect.active === true,
    fromOtherSource,
    statuses: [...(effect.statuses ?? [])],
    changes: effect.system?.changes ?? []
  };
}

/** @param {FeatureContext} ctx */
async function rollDamage(ctx, actor, name, formulas) {
  const { Roll, ChatMessage } = ctx.platform.dice;
  const rollData = actor.getRollData();
  const rolls = [];
  for (const formula of formulas) {
    const roll = Roll.create(formula, rollData, { title: name });
    await roll.evaluate();
    rolls.push(roll);
  }
  if (rolls.length) await ChatMessage.create({ flavor: name, speaker: ChatMessage.getSpeaker({ actor }), rolls });
}

/**
 * @param {FeatureContext} ctx
 * @returns {Promise<boolean|null>} null when the test could not be rolled.
 */
async function rollEndingTest(ctx, actor, name, { ability, dc }) {
  const { platform } = ctx;
  if (!actor.system?.atributos?.[ability]) return null;
  const event = skipDialogEvent(platform.settingsOf("tormenta20").get("UsageConfig"));
  const roll = await actor.rollAtributo(ability, { message: false, event });
  if (!roll) return null;
  const natural = roll.dice?.find((d) => d.faces === 20)?.total;
  const passed = testPassed({ natural, total: roll.total, dc });
  const key = passed ? "T20CP.OngoingDamage.TestPassed" : "T20CP.OngoingDamage.TestFailed";
  const { ChatMessage } = platform.dice;
  await ChatMessage.create({
    flavor: platform.i18n.format(key, { name, dc }),
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: [roll]
  });
  return passed;
}

/**
 * Rolls the test that ends a condition, if it has one; true when it passed and the condition was removed.
 * @param {FeatureContext} ctx
 */
async function endedByTest(ctx, actor, name, condition) {
  const { test } = ONGOING_CONDITIONS[condition.status];
  if (!test) return false;
  let passed = null;
  try {
    passed = await rollEndingTest(ctx, actor, name, test);
  } catch (err) {
    ctx.log.warn(`could not roll the test for ${name}`, err);
  }
  if (passed === null) ctx.log.warn(`no test for ${name} on ${actor.name}; rolling the damage`);
  if (!passed) return false;
  const ids = condition.removeIds.filter((id) => actor.effects.has(id));
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return true;
}

/**
 * Runs inside the actor's queue: the conditions are read only now, after any previous turn start finished.
 * @param {FeatureContext} ctx
 */
async function handleConditions(ctx, actor) {
  if (!actor?.isOwner) return;
  const conditions = selectOngoingConditions(actor.effects.map((e) => describeEffect(ctx, e, actor)));
  for (const condition of conditions) {
    try {
      const name = actor.effects.get(condition.effectId)?.name ?? condition.status;
      if (await endedByTest(ctx, actor, name, condition)) continue;
      await rollDamage(ctx, actor, name, condition.formulas);
    } catch (err) {
      ctx.log.error(`could not handle ${condition.status} on ${actor.name}`, err);
    }
  }
}

/** @param {FeatureContext} ctx */
export function install(ctx) {
  const CombatClass = ctx.platform.classes.combat;
  const original = CombatClass?.prototype?._manageDOTEffects;
  if (typeof original !== "function") throw new Error("Tormenta20 ongoing damage API not found");
  const recognized = diagnoseDotSource(ctx.platform.sourceOf(original)).bug === "present";
  if (!recognized) ctx.log.warn("_manageDOTEffects not recognized; the conditions are left to the system");

  ctx.wrap(CombatClass.prototype, "_manageDOTEffects", async function (original, ...args) {
    const result = await original.apply(this, args);
    const actor = args[0]?.actor;
    if (recognized && actor) {
      try {
        await runForActor(actor.uuid, () => handleConditions(ctx, actor));
      } catch (err) {
        ctx.log.error(`could not handle the conditions of ${actor.name}`, err);
      }
    }
    return result;
  });
}

/** @param {FeatureContext} ctx */
export function isNeeded(ctx) {
  return diagnoseDotSource(originalSource(ctx));
}

/** @param {FeatureContext} ctx */
export async function lateProbe(ctx) {
  const code = diagnoseDotSource(originalSource(ctx));
  if (code.bug !== "present") return undefined;
  const pack = ctx.platform.documents.packs().get(STATUS_PACK);
  if (!pack?.index?.size) return undefined;
  const docs = await pack.getDocuments();
  const changesByStatus = {};
  for (const status of Object.keys(ONGOING_CONDITIONS)) {
    const doc = docs.find((d) => d.statuses?.has(status));
    if (doc) changesByStatus[status] = doc.system?.changes ?? [];
  }
  return diagnoseConditionData(code, changesByStatus);
}
