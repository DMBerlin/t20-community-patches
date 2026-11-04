/**
 * Foundry side of the casting conditions and the concentration test (#37): the check before ItemT20#roll, the use
 * dialog validator and the concentration message after a published cast.
 */
import {
  CASTING_CONDITION_MODES,
  CASTING_CONDITION_SETTING,
  CONCENTRATION_MODES,
  CONCENTRATION_SETTING,
  SUBTLE_SPELL_NAME,
  SUBTLE_SPELL_SOURCE,
  castingConditionVerdict,
  concentrationCheck,
  dialogConditionBlock,
  isSpell,
  isSpellCast,
  preUseConditionVerdict
} from "../domain/index.mjs";
import { concentrationContent, conditionsText, t } from "../ui.mjs";
import { getMode, hasPower } from "./common.mjs";

/** @typedef {import("../../../kernel/feature.mjs").FeatureContext} FeatureContext */

/** @param {FeatureContext} ctx */
const reactionLabels = (ctx) => {
  const label = ctx.platform.t20Config()?.abilityActivationTypes?.reaction;
  return typeof label === "string" ? [label, ctx.platform.i18n.localize(label)] : [];
};

function readUseEffects(effects) {
  return [...(effects ?? [])].map((ef) => ({ id: ef.id, automatic: !!ef.system?.abilityUse?.automatic, changes: ef.system?.changes ?? [] }));
}

/**
 * The usage effects the roll will offer, through the current wrapper chain (patches filter or adjust them), read on a
 * prepared clone as ItemT20#roll does, so the wrappers never run on the live item.
 */
function rollUseEffects(item) {
  if (typeof item?.clone !== "function") return [];
  const clone = item.clone({}, { keepId: true });
  if (clone.parent) clone.prepareFinalAttributes?.();
  return typeof clone._allApplicableOnUseEffects === "function" ? readUseEffects(clone._allApplicableOnUseEffects()) : [];
}

/**
 * Whether ItemT20#roll opens the use dialog (T20 "UsageConfig": Shift inverts it). Only asked when there are effects.
 * @param {FeatureContext} ctx
 */
function opensDialog(ctx, rollArgs) {
  let usageDefault = true;
  try {
    usageDefault = ctx.platform.settingsOf("tormenta20").get("UsageConfig") === "default";
  } catch {
    // An unregistered setting keeps the system default.
  }
  const shift = !!rollArgs?.[0]?.event?.shiftKey;
  return usageDefault ? !shift : shift;
}

/**
 * Before ItemT20#roll: conditions that prevent casting. Returns false to stop the use.
 * @param {FeatureContext} ctx
 */
export function conditionsBeforeRoll(ctx, item, rollArgs) {
  const actor = item.actor;
  const conditionMode = getMode(ctx, CASTING_CONDITION_SETTING, CASTING_CONDITION_MODES);
  if (conditionMode === "off" || !isSpellCast(item)) return true;
  const any = castingConditionVerdict({ statuses: actor.statuses, activation: "action" });
  const verdict = any.block.length + any.warn.length === 0 ? { block: [], warn: [] } : preUseConditionVerdict({
    statuses: actor.statuses,
    subtleSpell: hasPower(ctx, actor, { source: SUBTLE_SPELL_SOURCE, name: SUBTLE_SPELL_NAME }),
    base: item.system?.ativacao?.execucao,
    effects: rollUseEffects(item),
    labels: reactionLabels(ctx),
    dialog: opensDialog(ctx, rollArgs)
  });
  const ids = [...verdict.block, ...verdict.warn];
  if (!ids.length) return true;
  const block = conditionMode === "block" && verdict.block.length > 0;
  const parts = [conditionsText(ctx, actor, item, ids)];
  if (verdict.warn.length) parts.push(t(ctx, "Conditions.Subtle", { actor: actor.name }));
  if (block) parts.push(ctx.platform.i18n.localize("T20CP.CastingRestrictions.Conditions.Blocked"));
  ctx.platform.notify[block ? "error" : "warn"](parts.join(" "));
  return !block;
}

/**
 * Use dialog submit: conditions that depend on the execution chosen through the enhancements.
 * @param {FeatureContext} ctx
 */
export function validateCastingDialog(ctx, { item, formData }) {
  const mode = getMode(ctx, CASTING_CONDITION_SETTING, CASTING_CONDITION_MODES);
  const actor = item?.actor;
  if (mode === "off" || !actor || !isSpellCast(item)) return null;
  const { i18n, utils } = ctx.platform;
  const ids = dialogConditionBlock({
    statuses: actor.statuses,
    base: item.system?.ativacao?.execucao,
    effects: readUseEffects(item.applicableOnUseEffects),
    applied: utils.expandObject(formData ?? {}).aprs ?? {},
    labels: reactionLabels(ctx)
  });
  if (!ids.length) return null;
  const block = mode === "block";
  const parts = [conditionsText(ctx, actor, item, ids), i18n.localize("T20CP.CastingRestrictions.Conditions.Reaction")];
  if (block) parts.push(i18n.localize("T20CP.CastingRestrictions.Conditions.Blocked"));
  return { message: parts.join(" "), block };
}

/**
 * The concentration test of a published cast in a bad condition.
 * @param {FeatureContext} ctx
 */
export async function postConcentration(ctx, item, { options, rollMode }) {
  if (getMode(ctx, CONCENTRATION_SETTING, CONCENTRATION_MODES) !== "warn" || !isSpell(item)) return;
  const actor = item.actor;
  const check = concentrationCheck({ statuses: actor?.statuses, manaCost: options?.manaCost });
  if (!check) return;
  const { chat } = ctx.platform;
  const data = { content: concentrationContent(ctx, { actor, item, check }), speaker: chat.speaker({ actor }) };
  chat.applyMode(data, rollMode || undefined);
  await chat.create(data);
}
