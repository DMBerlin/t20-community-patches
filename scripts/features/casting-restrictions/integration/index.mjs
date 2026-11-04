/**
 * Installs the casting restrictions (#37). Must run after the patches and the other rules, arcane-armor included (it
 * stays inside this displayCard wrapper). The cast stamp is always applied (it is inert).
 */
import { castCompleted, isCastUse } from "../../../lib/cast-outcome.mjs";
import { isSustainedSpell, stampSustainedCast } from "../domain/index.mjs";
import { conditionsBeforeRoll, postConcentration, validateCastingDialog } from "./conditions.mjs";
import { createSustainedState, onPreCreateEffect, registerInvalidation, sustainedBeforeRoll } from "./sustained.mjs";

/** @typedef {import("../../../kernel/feature.mjs").FeatureContext} FeatureContext */

/**
 * Before ItemT20#roll. Returns false to stop the use.
 * @param {FeatureContext} ctx
 */
function beforeRoll(ctx, item, rollArgs) {
  const actor = item?.actor;
  if (!actor) return true;
  if (!conditionsBeforeRoll(ctx, item, rollArgs)) return false;
  sustainedBeforeRoll(ctx, item, actor);
  return true;
}

/** @param {FeatureContext} ctx */
function wrapItem(ctx, itemProto) {
  ctx.wrap(itemProto, "roll", function (roll, ...args) {
    let allowed = true;
    try {
      allowed = beforeRoll(ctx, this, args);
    } catch (err) {
      ctx.log.error("failed to check the use", err);
    }
    if (allowed === false) return Promise.resolve();
    return roll.apply(this, args);
  });

  ctx.wrap(itemProto, "displayCard", async function (displayCard, config, ...rest) {
    const options = config?.options;
    const casting = isCastUse(options);
    try {
      if (casting && isSustainedSpell(this) && this.actor) {
        stampSustainedCast(options.effects, { castId: ctx.platform.utils.randomID(), casterUuid: this.actor.uuid, spell: this.name });
      }
    } catch (err) {
      ctx.log.error("failed to stamp the sustained cast", err);
    }
    const result = await displayCard.call(this, config, ...rest);
    if (!casting || !castCompleted(result, options) || result?.documentName !== "ChatMessage") return result;
    try {
      await postConcentration(ctx, this, { options, rollMode: config?.rollMode });
    } catch (err) {
      ctx.log.error("failed to post the concentration test", err);
    }
    return result;
  });
}

/** @param {FeatureContext} ctx */
export function install(ctx) {
  const itemProto = ctx.platform.classes.item?.prototype;
  if (typeof itemProto?.roll !== "function" || typeof itemProto?.displayCard !== "function") {
    throw new Error("ItemT20 roll/displayCard not found");
  }
  wrapItem(ctx, itemProto);
  try {
    ctx.services["use-dialog-guard"].register((context) => validateCastingDialog(ctx, context));
  } catch (err) {
    ctx.log.error("failed to install the use dialog check", err);
  }
  const state = createSustainedState(ctx);
  registerInvalidation(state);
  ctx.hooks.on("preCreateActiveEffect", (effect, data) => {
    try {
      onPreCreateEffect(state, effect, data);
    } catch (err) {
      ctx.log.error("failed to check the sustained spell limit", err);
    }
  });
}
