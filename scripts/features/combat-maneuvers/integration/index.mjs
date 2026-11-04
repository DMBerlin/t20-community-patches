/** Install of "Manobras de combate" (#48): the use wrappers (rollAttack, rollDamage, displayCard) and the hooks. */
import { COMBAT_MANEUVERS_SETTING, attackFromRolls } from "../domain/index.mjs";
import { declaredCard, onPassageClick, onResistClick } from "./actions.mjs";
import { onRenderDialog, resolveDeclaration } from "./declaration.mjs";
import { onRender, onResultChanged, redrawAll } from "./render.mjs";
import { createRuntime, isEnabled } from "./runtime.mjs";

export { createRuntime, onPassageClick, onRender, onRenderDialog, onResistClick, resolveDeclaration };

/** @typedef {import("../../../kernel/feature.mjs").FeatureContext} FeatureContext */

function wrapRollAttack(rt) {
  return async function (rollAttack, ...args) {
    try {
      rt.declarations.delete(this);
      const declaration = resolveDeclaration(rt, this, args[0]?.options);
      if (declaration) rt.declarations.set(this, declaration);
    } catch (err) {
      rt.ctx.log.error(`failed to read the declared maneuver of ${this?.name}`, err);
    }
    return rollAttack.apply(this, args);
  };
}

// A declared maneuver deals no damage: the damage is not rolled (the attack roll is the maneuver test).
function wrapRollDamage(rt) {
  return async function (rollDamage, ...args) {
    let skip = false;
    try {
      skip = rt.declarations.has(this) && !!attackFromRolls(Object.values(this.system?.rolled ?? {}));
    } catch (err) {
      rt.ctx.log.error(`failed to check the declared maneuver of ${this?.name}`, err);
    }
    if (skip) return undefined;
    return rollDamage.apply(this, args);
  };
}

function wrapDisplayCard(rt) {
  return async function (displayCard, params = {}, ...rest) {
    let card = null;
    try {
      const declaration = rt.declarations.get(this);
      rt.declarations.delete(this);
      if (declaration) card = declaredCard(rt, this, declaration, params?.rollMode);
    } catch (err) {
      rt.ctx.log.error(`failed to prepare the card of ${this?.name}`, err);
    }
    if (!card) return displayCard.call(this, params, ...rest);
    // The maneuver card replaces the system's attack card, but the inner wrappers still run (without a message),
    // so their side effects that belong to the use (e.g. the charge effect of #59) are kept.
    const createMessage = params?.createMessage ?? true;
    const inner = await displayCard.call(this, { ...params, createMessage: false }, ...rest);
    if (!inner || typeof inner !== "object") return inner;
    return createMessage ? rt.ctx.platform.chat.create(card) : card;
  };
}

/**
 * Installs the rule. The settings are read on every use, render and click, so a change applies without reloading.
 * @param {FeatureContext} ctx
 * @param {ReturnType<typeof createRuntime>} [rt]  The state of this install (tests pass their own to drive it).
 */
export function install(ctx, rt = createRuntime(ctx)) {
  rt.uses.registerTargetConsumer(() => isEnabled(rt));
  const proto = ctx.platform.classes.item?.prototype;
  const { displayCard, rollAttack, rollDamage } = proto ?? {};
  if (typeof displayCard !== "function" || typeof rollAttack !== "function" || typeof rollDamage !== "function") {
    throw new Error("ItemT20#rollAttack, #rollDamage or #displayCard not found");
  }
  ctx.wrap(proto, "rollAttack", wrapRollAttack(rt));
  ctx.wrap(proto, "rollDamage", wrapRollDamage(rt));
  ctx.wrap(proto, "displayCard", wrapDisplayCard(rt));

  ctx.onSettingChange(COMBAT_MANEUVERS_SETTING, () => redrawAll(rt));
  ctx.hooks.on("renderAbilityUseDialog", (app, html) => onRenderDialog(rt, app, html));
  ctx.hooks.on("renderChatMessageHTML", (message, html) => onRender(rt, message, html));
  ctx.hooks.on("createChatMessage", (message) => onResultChanged(rt, message));
  ctx.hooks.on("updateChatMessage", (message) => onResultChanged(rt, message));
  ctx.hooks.on("deleteChatMessage", (message) => onResultChanged(rt, message));
}
