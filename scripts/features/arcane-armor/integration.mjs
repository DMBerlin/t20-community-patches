/**
 * Foundry side of the "Magia arcana de armadura" rule (#46): the ItemT20#displayCard wrapper that rolls the Misticismo
 * test, the grant payment in the mana queue, the test messages and the render hooks. Everything goes through ctx.
 */
import { MODULE_ID } from "../../lib/module.mjs";
import { markCastFailed, isCastUse } from "../../lib/cast-outcome.mjs";
import { automaticApplied } from "../../lib/mana.mjs";
import { isTrainedFor, plainUseEffect, skillUseEffects, trainingGrants } from "../../lib/skill-training.mjs";
import {
  ARCANE_ARMOR_MODES,
  ARCANE_ARMOR_SETTING,
  SKILL_KEY,
  SPELL_FLAG,
  WAIVER_FLAG,
  appliedEffectIds,
  armorTestDC,
  armorTestFormula,
  armorTestRequirement,
  armorTestTraining,
  canPayGrant,
  defaultSlugify,
  grantUsedKey,
  resolveArmorTest,
  strongestWaiver,
  usesDiscreetCasting,
  withGrantPayment,
  wornArmor
} from "./domain.mjs";
import { failureLine, flagOf, grantList, header, reference, renderDialogLine, renderItemField, t } from "./ui.mjs";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

/** @param {FeatureContext} ctx */
const dropSuppressed = (ctx) => !!ctx.features.isActive("suppressed-usage-effects");

/** @param {FeatureContext} ctx */
function getMode(ctx) {
  try {
    const mode = ctx.setting(ARCANE_ARMOR_SETTING);
    return ARCANE_ARMOR_MODES.includes(mode) ? mode : "off";
  } catch {
    return "off";
  }
}

/** @param {FeatureContext} ctx */
function systemSetting(ctx, key, fallback) {
  try {
    return ctx.platform.settingsOf("tormenta20").get(key);
  } catch {
    return fallback;
  }
}

/** @param {FeatureContext} ctx */
const autoSpendOn = (ctx) => !!systemSetting(ctx, "automaticManaSpend", true);

/**
 * Requirement for this item and actor, read without changing anything.
 * @param {FeatureContext} ctx
 * @param {object} item     The rolled clone (or the dialog's item).
 * @param {{discreet?: boolean}} [extra]
 */
function requirementFor(ctx, item, { discreet = false } = {}) {
  const actor = item?.actor;
  if (!actor || item.type !== "magia") return null;
  const items = [...(actor.items ?? [])];
  const classSlugs = items.filter((i) => i.type === "classe").map((i) => defaultSlugify(i.name));
  const armor = wornArmor(items, { equipmentSlots: !!systemSetting(ctx, "equipmentSlots", false) });
  const requirement = armorTestRequirement({
    actorType: actor.type,
    spellType: item.system?.tipo,
    classSlugs,
    armor,
    waiver: strongestWaiver(items.map((i) => flagOf(ctx, i, WAIVER_FLAG))),
    spellFlag: flagOf(ctx, item, SPELL_FLAG),
    discreet
  });
  return { actor, armor, requirement };
}

/** The test to roll for this cast, or null. Warns when the source is ambiguous. */
function describeCheck(ctx, item, options) {
  const effects = item.applicableOnUseEffects ?? [];
  const discreet = usesDiscreetCasting(effects, appliedEffectIds(options, effects));
  const info = requirementFor(ctx, item, { discreet });
  if (!info) return null;
  const { actor, armor, requirement } = info;
  if (requirement.ambiguous) {
    ctx.platform.notify.warn(t(ctx, "Ambiguous", { spell: ctx.platform.utils.escapeHTML(item.name ?? "") }));
    return null;
  }
  if (!requirement.required) return null;
  const cost = Math.max(0, Number(options?.manaCost) || 0);
  return {
    actor,
    armor,
    cost,
    dc: armorTestDC(options?.manaCost),
    penalty: Number(actor.system?.attributes?.defesa?.pda) || 0,
    skill: actor.system?.pericias?.[SKILL_KEY] ?? {}
  };
}

/** Training for the test, through the shared contract of #62 (independent of that rule's mode). */
function trainingFor(ctx, actor) {
  const grants = trainingGrants(skillUseEffects(actor, SKILL_KEY, dropSuppressed(ctx)).map(plainUseEffect));
  const training = isTrainedFor({
    key: SKILL_KEY,
    skill: actor.system?.pericias?.[SKILL_KEY],
    config: ctx.platform.t20Config()?.pericias,
    grants,
    applied: automaticApplied(grants)
  });
  return armorTestTraining(training, {
    treino: actor.system?.attributes?.treino,
    autoSpend: autoSpendOn(ctx),
    pendingGrants: grants.filter((g) => !g.automatic)
  });
}

/** Charges the grant in the actor's turn of the mana queue, after the spell's own spend (T20:8669). */
async function payGrant(ctx, actor, cost) {
  return ctx.services["mana-queue"].withManaTurn(actor, async ({ spend }) => {
    const pm = actor.system?.attributes?.pm ?? {};
    if (!canPayGrant({ value: pm.value, temp: pm.temp, cost })) return false;
    await spend(cost, 0, false);
    return true;
  });
}

/** Untrained (or unpaid grant): a message without a roll. */
async function postUntrained(ctx, { item, check, training, messageMode }) {
  const { chat, utils } = ctx.platform;
  const escape = utils.escapeHTML;
  const parts = [`<p><strong>${header(ctx, item, check)}</strong></p>`];
  parts.push(`<p>${t(ctx, "Untrained", { actor: escape(check.actor.name ?? "") })}</p>`);
  if (training.unpaid) parts.push(`<p>${t(ctx, "GrantNoMana", { grant: escape(training.grantName ?? "") })}</p>`);
  else if (training.hint?.length) parts.push(`<p>${t(ctx, "UntrainedHint", { grants: grantList(ctx, training.hint) })}</p>`);
  parts.push(`<p>${failureLine(ctx, item, check, autoSpendOn(ctx))}</p>`, reference(ctx));
  const data = {
    content: `<div class="t20cp-arcane-armor">${parts.join("")}</div>`,
    speaker: chat.speaker({ actor: check.actor }),
    flags: { [MODULE_ID]: { arcaneArmor: { itemId: item.id, dc: check.dc, passed: false, reason: "untrained" } } }
  };
  chat.applyMode(data, messageMode);
  return chat.create(data);
}

/**
 * Rolls the test and posts its message.
 * @returns {Promise<{passed: boolean, reason: null|"failed"|"untrained", messageId: string|null}>}
 */
async function rollArmorTest(ctx, item, check, rollMode) {
  const { chat, dice, utils } = ctx.platform;
  const messageMode = rollMode || ctx.platform.settingsOf("core").get("messageMode");
  let training = trainingFor(ctx, check.actor);
  if (training.canRoll && training.grantCost > 0) {
    training = withGrantPayment(training, await payGrant(ctx, check.actor, training.grantCost));
  }
  if (!training.canRoll) {
    const message = await postUntrained(ctx, { item, check, training, messageMode });
    return { passed: false, reason: "untrained", messageId: message?.id ?? null };
  }

  const formula = armorTestFormula({
    skillValue: check.skill.value,
    armorPenalty: check.penalty,
    trainingBonus: training.trainingBonus
  });
  const roll = new dice.Roll(formula);
  // Evaluated before the message (an unevaluated total is 0), with the same interactive policy as toMessage.
  await roll.evaluate({ allowInteractive: messageMode !== "blind" });
  const natural = roll.dice?.[0]?.total;
  const passed = resolveArmorTest({ natural, total: roll.total, dc: check.dc });

  const escape = utils.escapeHTML;
  const autoSpend = autoSpendOn(ctx);
  const lines = [`<strong>${header(ctx, item, check)}</strong>`];
  if (training.grantName) {
    const key = grantUsedKey({ autoSpend, grantPrice: training.grantPrice });
    lines.push(t(ctx, key, { grant: escape(training.grantName), cost: training.grantPrice }));
  }
  lines.push(passed ? t(ctx, "Success") : failureLine(ctx, item, check, autoSpend), `<em>${escape(t(ctx, "Reference"))}</em>`);
  // The verdict goes in the flavor: an HTML content would replace the rendered dice (ChatMessage#renderRollContent).
  const message = await roll.toMessage(
    {
      speaker: chat.speaker({ actor: check.actor }),
      flavor: `<div class="t20cp-arcane-armor ${passed ? "success" : "failure"}">${lines.join("<br>")}</div>`,
      flags: { [MODULE_ID]: { arcaneArmor: { itemId: item.id, dc: check.dc, passed } } }
    },
    { messageMode }
  );
  return { passed, reason: passed ? null : "failed", messageId: message?.id ?? null };
}

/**
 * Installs the rule. Must run before casting-restrictions, so this displayCard wrapper sits inside that one
 * (which only counts a cast through castCompleted). The mode is read on every use.
 * @param {FeatureContext} ctx  The grant is charged in the actor's turn of the mana-queue service.
 */
export function install(ctx) {
  const itemProto = ctx.platform.classes.item?.prototype;
  const original = itemProto?.displayCard;
  if (typeof original !== "function") throw new Error("ItemT20#displayCard not found");

  ctx.wrap(itemProto, "displayCard", async function (original, ...args) {
    const [{ options, rollMode, createMessage = true } = {}] = args;
    let check = null;
    try {
      if (getMode(ctx) === "roll" && createMessage && this.type === "magia" && isCastUse(options)) {
        check = describeCheck(ctx, this, options);
      }
    } catch (err) {
      ctx.log.error("failed to evaluate the armor test", err);
    }
    if (!check) return original.apply(this, args);
    let outcome;
    try {
      outcome = await rollArmorTest(ctx, this, check, rollMode);
    } catch (err) {
      ctx.log.error("failed to roll the armor test, the card goes on", err);
      return original.apply(this, args);
    }
    if (outcome.passed) return original.apply(this, args);
    markCastFailed(options, { rule: "arcane-armor-casting", reason: outcome.reason, messageId: outcome.messageId });
    return null;
  });

  ctx.hooks.on("renderAbilityUseDialog", (app, html) => {
    try {
      if (getMode(ctx) !== "off") renderDialogLine(ctx, app, html, (item) => requirementFor(ctx, item));
    } catch (err) {
      ctx.log.error("failed to show the dialog line", err);
    }
  });
  ctx.hooks.on("renderItemSheet", (app, html) => {
    try {
      if (getMode(ctx) !== "off") renderItemField(ctx, app, html);
    } catch (err) {
      ctx.log.error("failed to add the item field", err);
    }
  });
}
