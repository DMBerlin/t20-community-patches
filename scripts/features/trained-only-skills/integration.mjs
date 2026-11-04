/**
 * Foundry side of the "Perícias somente treinadas" rule (#62): the check before ActorT20#rollPericia, the validator
 * of the use dialog and the card note in ActorT20#displayCard. Everything goes through ctx; nothing is kept between
 * calls.
 */
import { automaticApplied } from "../../lib/mana.mjs";
import { skipsDialog } from "../../lib/usage-effects.mjs";
import { isTrainedFor, plainUseEffect, skillUseEffects, trainingGrants } from "../../lib/skill-training.mjs";
import {
  TRAINED_ONLY_MODES,
  TRAINED_ONLY_SETTING,
  appliesToActor,
  decideDialog,
  decideRoll,
  needsCardNote
} from "./domain.mjs";

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
const dropSuppressed = (ctx) => !!ctx.features.isActive("suppressed-usage-effects");

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
function getMode(ctx) {
  try {
    const mode = ctx.setting(TRAINED_ONLY_SETTING);
    return TRAINED_ONLY_MODES.includes(mode) ? mode : "off";
  } catch {
    return "off";
  }
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
function usageDefault(ctx) {
  try {
    return ctx.platform.settingsOf("tormenta20").get("UsageConfig") === "default";
  } catch {
    return true;
  }
}

const skillConfig = (ctx) => ctx.platform.t20Config()?.pericias;

const reference = (ctx) => ctx.platform.i18n.localize("T20CP.TrainedOnly.Reference");

function grantList(ctx, grants) {
  const { i18n, utils } = ctx.platform;
  const names = [...new Set(grants.map((g) => g.name).filter(Boolean))].map((n) => utils.escapeHTML(n));
  try {
    return new Intl.ListFormat(i18n.lang(), { type: "disjunction" }).format(names);
  } catch {
    return names.join(" / ");
  }
}

/**
 * Notification text. ui.notifications renders HTML, so the user-defined names are escaped.
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 * @param {{actor: object, skill: object, grants: object[]}} subject
 * @param {"blocked"|"openDialog"|"mark"|"warn"} kind
 */
function message(ctx, { actor, skill, grants }, kind) {
  const { i18n, utils } = ctx.platform;
  const escape = utils.escapeHTML;
  const parts = [
    i18n.format("T20CP.TrainedOnly.Untrained", { actor: escape(actor?.name ?? ""), skill: escape(skill?.label ?? "") })
  ];
  if (kind === "warn") parts.push(i18n.format("T20CP.TrainedOnly.Warned", { reference: reference(ctx) }));
  else if (kind === "mark") parts.push(i18n.format("T20CP.TrainedOnly.MarkGrant", { grants: grantList(ctx, grants) }));
  else {
    parts.push(i18n.format("T20CP.TrainedOnly.Blocked", { reference: reference(ctx) }));
    if (kind === "openDialog") parts.push(i18n.format("T20CP.TrainedOnly.OpenDialog", { grants: grantList(ctx, grants) }));
  }
  return parts.join(" ");
}

/**
 * Pre-roll check of rollPericia(key, options).
 * @returns {{action: "roll"|"block", notify?: boolean, message?: string}}
 */
function checkRoll(ctx, actor, key, options) {
  const mode = getMode(ctx);
  if (mode === "off" || !appliesToActor(actor)) return { action: "roll", notify: false };
  const skill = actor.system?.pericias?.[key];
  if (!skill) return { action: "roll", notify: false };
  const grants = trainingGrants(skillUseEffects(actor, key, dropSuppressed(ctx)).map(plainUseEffect));
  const { required, trained } = isTrainedFor({ key, skill, config: skillConfig(ctx), grants, applied: {} });
  const opensDialog = !skipsDialog({
    usageDefault: usageDefault(ctx),
    shiftKey: !!options?.event?.shiftKey,
    hasEffectsOrRolls: true
  });
  const verdict = decideRoll({ mode, required, trained, grants, opensDialog });
  const subject = { actor, skill, grants };
  if (verdict.action === "block") {
    return { ...verdict, message: message(ctx, subject, verdict.reason === "needsDialog" ? "openDialog" : "blocked") };
  }
  return verdict.notify ? { ...verdict, message: message(ctx, subject, "warn") } : verdict;
}

/** Validator of the use dialog of a skill roll (the item is rollPericia's itemData, T20:7597-7606). */
function validate(ctx, { item, formData }) {
  const mode = getMode(ctx);
  if (mode === "off" || item?.type !== "pericia" || !appliesToActor(item.actor)) return null;
  const skill = item.actor.system?.pericias?.[item.id];
  if (!skill) return null;
  const grants = trainingGrants((item.applicableOnUseEffects ?? []).map(plainUseEffect));
  const applied = ctx.platform.utils.expandObject(formData ?? {}).aprs ?? {};
  const { required, trained } = isTrainedFor({ key: item.id, skill, config: skillConfig(ctx) });
  const verdict = decideDialog({ mode, required, trained, grants, applied });
  if (!verdict) return null;
  const text = message(ctx, { actor: item.actor, skill, grants }, verdict === "block" ? "mark" : "warn");
  return { message: text, block: verdict === "block" };
}

/** Adds the note to the card's flavor of an untrained test. Only changes the options of its own call. */
function noteCard(ctx, actor, options) {
  const itemData = options?.itemData;
  if (itemData?.type !== "pericia") return;
  const mode = getMode(ctx);
  if (mode === "off" || !appliesToActor(actor)) return;
  const skill = actor.system?.pericias?.[itemData.id];
  if (!skill) return;
  const grants = trainingGrants((itemData.applicableOnUseEffects ?? []).map(plainUseEffect));
  const applied = options.aprs ?? automaticApplied(grants);
  const { required, trained } = isTrainedFor({ key: itemData.id, skill, config: skillConfig(ctx) });
  if (!needsCardNote({ mode, required, trained, grants, applied })) return;
  const { i18n, utils } = ctx.platform;
  const escape = utils.escapeHTML;
  const note = i18n.format("T20CP.TrainedOnly.CardNote", { reference: escape(reference(ctx)) });
  const title = escape(i18n.format("T20CP.TrainedOnly.Untrained", { actor: actor.name ?? "", skill: skill.label ?? "" }));
  const span = `<span class="t20cp-trained-only" data-tooltip="${title}">${note}</span>`;
  options.chatFlavor = options.chatFlavor ? `${options.chatFlavor} ${span}` : span;
}

/**
 * Installs the rule. The mode is read on every use, so a change applies without reloading.
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 */
export function install(ctx) {
  const proto = ctx.platform.classes.actor?.prototype;
  const roll = proto?.rollPericia;
  const display = proto?.displayCard;
  if (typeof roll !== "function" || typeof display !== "function") throw new Error("ActorT20#rollPericia/displayCard not found");

  ctx.services["use-dialog-guard"].register((context) => validate(ctx, context));

  ctx.wrap(proto, "rollPericia", function (roll, ...args) {
    let verdict = { action: "roll", notify: false };
    try {
      verdict = checkRoll(ctx, this, args[0], args[1]);
    } catch (err) {
      ctx.log.error("check failed, the roll goes on", err);
    }
    if (verdict.action === "block") {
      ctx.platform.notify.warn(verdict.message);
      return Promise.resolve(undefined); // same as the system when the dialog is closed (T20:7627)
    }
    if (verdict.notify) ctx.platform.notify.warn(verdict.message);
    return roll.apply(this, args);
  });

  ctx.wrap(proto, "displayCard", function (display, params, ...rest) {
    try {
      noteCard(ctx, this, params?.options);
    } catch (err) {
      ctx.log.error("failed to add the card note", err);
    }
    return display.call(this, params, ...rest);
  });
}
