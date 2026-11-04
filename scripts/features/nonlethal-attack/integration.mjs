/** Foundry integration of the lethal or nonlethal attack choice (#74), only through ctx. */
import { sanitizeFlavor } from "../../lib/text.mjs";
import { USE_PURPOSES } from "../../lib/targets.mjs";
import { NONLETHAL_FIELD, NONLETHAL_SETTING, readsOn } from "../../lib/nonlethal.mjs";
import { LINE_CLASS, decide, parseChoice, recordDamage, weaponContext } from "./domain.mjs";
import { addNaturalField, buildLine, t } from "./ui.mjs";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

/**
 * Whether the nonlethal damage rule is on.
 * @param {FeatureContext} ctx
 */
function ruleEnabled(ctx) {
  return readsOn(() => ctx.features.setting("nonlethal-damage", NONLETHAL_SETTING));
}

function hasRoll(item, type) {
  return !!item?.system?.rolls?.some?.((r) => r?.type === type && r.parts?.[0]?.[0]);
}

/**
 * A weapon with attack and damage, outside a maneuver resistance test, while the rule is on.
 * @param {FeatureContext} ctx
 */
export function applies(ctx, item) {
  return (
    ruleEnabled(ctx)
    && item?.type === "arma"
    && hasRoll(item, "ataque")
    && hasRoll(item, "dano")
    && ctx.services["use-targets"].usePurposeOf(item) !== USE_PURPOSES.MANEUVER_RESISTANCE
  );
}

/**
 * renderAbilityUseDialog: one line right after "Melhor/Pior de 2d20", before the situational section (#59) when it is
 * already there (its hook is registered first, FEATURES order).
 * @param {FeatureContext} ctx
 */
export function onRenderDialog(ctx, app, html) {
  const item = app?.item;
  const ItemClass = ctx.platform.classes.item;
  if (!ItemClass || !(item instanceof ItemClass) || !applies(ctx, item)) return;
  const root = html?.[0] ?? html;
  const form = root?.querySelector?.("form#ability-use-form") ?? root?.querySelector?.("form");
  if (!form || form.querySelector(`.${LINE_CLASS}`)) return;
  const line = buildLine(ctx, item);
  const anchor = form.querySelector("[name=rollKeep]")?.closest?.(".form-group");
  const situational = form.querySelector(".t20cp-situational");
  if (situational?.before) situational.before(line);
  else if (anchor) anchor.after(line);
  else form.append(line);
  app.setPosition?.({ height: "auto" });
}

/**
 * renderItemSheet: the "Dano natural" field of weapons, after "Empunhadura".
 * @param {FeatureContext} ctx
 */
export function onRenderItemSheet(ctx, app, html) {
  if (!ruleEnabled(ctx)) return;
  const item = app?.document ?? app?.item;
  if (item?.type !== "arma") return;
  addNaturalField(ctx, app, item, html?.[0] ?? html);
}

/**
 * The use's choice: the dialog's, or the natural type (shortcut). Only for the per-use clone of ItemT20#roll, whose
 * attack and damage run once and in sequence; a direct call on a document (a macro) keeps the official behavior.
 * @param {FeatureContext} ctx
 * @returns {{choice: string, natural: string, waivers: string[], penalty: number} | null}
 */
export function resolveChoice(ctx, item, options) {
  if (!options || typeof options !== "object" || !ctx.services["use-targets"].inItemUse(item) || !applies(ctx, item)) {
    return null;
  }
  const context = weaponContext(item);
  return decide({ choice: parseChoice(options[NONLETHAL_FIELD]) ?? context.natural, ...context });
}

/**
 * Pushes the penalty into the first attack roll (read by getAttackToHit, T20:8148) and returns the function that
 * removes it, so a direct call on a document (a macro) leaves nothing behind.
 * @param {FeatureContext} ctx
 * @returns {() => void}
 */
export function pushPenalty(ctx, item, decision) {
  if (!decision?.penalty) return () => {};
  const first = item?.system?.rolls?.find?.((r) => r?.type === "ataque");
  if (!Array.isArray(first?.parts)) return () => {};
  const label = sanitizeFlavor(t(ctx, `FormulaLabel.${decision.choice}`));
  const part = [label ? `${decision.penalty}[${label}]` : String(decision.penalty), ""];
  first.parts.push(part);
  return () => {
    const index = first.parts.indexOf(part);
    if (index >= 0) first.parts.splice(index, 1);
  };
}

/** Logs instead of throwing: a hook must never break the system's render. */
function guarded(ctx, message, fn) {
  return (...args) => {
    try {
      fn(...args);
    } catch (err) {
      ctx.log.error(message, err);
    }
  };
}

/**
 * Installs the wrappers and hooks. The setting is read on every use, so a change applies without reloading.
 * @param {FeatureContext} ctx
 */
export function install(ctx) {
  const uses = ctx.services["use-targets"];
  const proto = ctx.platform.classes.item?.prototype;
  if (typeof proto?.rollAttack !== "function" || typeof proto?.rollDamage !== "function") {
    throw new Error("ItemT20#rollAttack or #rollDamage not found");
  }
  // The use's clone (inItemUse) is only tracked while some consumer is on.
  uses.registerTargetConsumer(() => ruleEnabled(ctx));

  ctx.wrap(proto, "rollAttack", async function (rollAttack, ...args) {
    let undo = () => {};
    try {
      undo = pushPenalty(ctx, this, resolveChoice(ctx, this, args[0]?.options));
    } catch (err) {
      ctx.log.error("failed to apply the choice to the attack", err);
    }
    try {
      return await rollAttack.apply(this, args);
    } finally {
      try {
        undo();
      } catch (err) {
        ctx.log.error("failed to remove the attack penalty", err);
      }
    }
  });

  ctx.wrap(proto, "rollDamage", async function (rollDamage, ...args) {
    const result = await rollDamage.apply(this, args);
    try {
      // Without dialog fields (shortcut) the choice is the natural type.
      const options = args[0]?.options && typeof args[0].options === "object" ? args[0].options : {};
      recordDamage(this, resolveChoice(ctx, this, options));
    } catch (err) {
      ctx.log.error("failed to record the choice in the damage", err);
    }
    return result;
  });

  ctx.hooks.on(
    "renderAbilityUseDialog",
    guarded(ctx, "failed to render the dialog line", (app, html) => onRenderDialog(ctx, app, html))
  );
  ctx.hooks.on(
    "renderItemSheet",
    guarded(ctx, "failed to render the weapon field", (app, html) => onRenderItemSheet(ctx, app, html))
  );
}
