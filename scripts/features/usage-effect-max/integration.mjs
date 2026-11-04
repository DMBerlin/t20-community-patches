/**
 * Foundry integration of the usage-effect-max rule: the use-dialog-guard validator, the render hooks, and the
 * warnings of dialog-less item, skill and attribute uses. Reads the platform only through `ctx`; the state lives in
 * the install.
 */
import { evaluateManaLimit } from "../../lib/mana.mjs";
import { pseudoItemEffects, skipsDialog } from "../../lib/usage-effects.mjs";
import { USAGE_EFFECT_MAX_SETTING, resolveEffect, usageLimitMode } from "../../lib/usage-limits.mjs";
import { evaluateMax, findViolations, mergeLimits } from "./domain.mjs";
import { renderDialogLimits, renderEffectField } from "./ui.mjs";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

/** Runtime of one installation: the context and its state, shared by the functions below. */
function createRuntime(ctx) {
  return {
    ctx,
    platform: ctx.platform,
    /** Invalid formulas already warned in the console. */
    warnedFormulas: new Set(),
    /**
     * Entries of actor.traverseEmbeddedDocuments() seen while a dialog-less skill/attribute roll collects its usage
     * effects, by actor. Observing the system's own traversal keeps every filter other wrappers apply to it (such as
     * suppressed-usage-effects) instead of collecting a list of our own.
     * @type {WeakMap<object, [string, object][]>}
     */
    observed: new WeakMap(),
    mode: () => usageLimitMode(() => ctx.setting(USAGE_EFFECT_MAX_SETTING)),
    usageDefault: () => ctx.platform.settingsOf("tormenta20").get("UsageConfig") === "default"
  };
}

/**
 * Maximum of each applicable usage effect of the item, for its actor. Effects without a limit are left out.
 * @returns {Record<string, {max: number, name: string}>}
 */
function effectLimits(rt, item) {
  const entries = [];
  const actor = item?.actor;
  const effects = item?.applicableOnUseEffects ?? [];
  if (!actor || !effects.length) return {};
  const evaluate = (formula, rollData) => evaluateManaLimit(formula, rollData, rt.platform.dice.Roll);
  let rollData;
  for (const effect of effects) {
    const resolved = resolveEffect(effect, rt.platform.utils.getProperty);
    if (resolved.kind !== "formula") continue;
    rollData ??= actor.getRollData();
    const max = evaluateMax(resolved.formula, rollData, evaluate);
    if (max === null) {
      const key = `${effect.uuid ?? effect.id}|${resolved.formula}`;
      if (!rt.warnedFormulas.has(key)) {
        rt.warnedFormulas.add(key);
        rt.ctx.log.warn(`invalid maximum "${resolved.formula}" for "${effect.name}" (${actor.name}); no limit applied`);
      }
      continue;
    }
    entries.push({ id: effect.id, max, name: effect.name });
  }
  return mergeLimits(entries);
}

function validate(rt, { item, formData }) {
  const mode = rt.mode();
  if (mode === "off") return null;
  const limits = effectLimits(rt, item);
  if (!Object.keys(limits).length) return null;
  const { i18n, utils } = rt.platform;
  const applied = utils.expandObject(formData ?? {}).aprs ?? {};
  const block = mode === "block";
  return findViolations(applied, limits).map((v) => {
    const data = { item: item.name, effect: v.name, requested: v.requested, max: v.max };
    const parts = [i18n.format("T20CP.UsageEffectMax.Exceeded", data)];
    if (block) parts.push(i18n.localize("T20CP.UsageEffectMax.Blocked"));
    return { message: parts.join(" "), block };
  });
}

/**
 * Uses without the dialog select the ids of the "Aplicar Sempre" effects, once: never blocked, only warned at
 * maximum 0. Every applicable effect sharing a selected id is applied too, so all of them are checked.
 */
function warnAutomatic(rt, actor, name, effects) {
  const automatic = effects.filter((ef) => ef.system?.abilityUse?.automatic);
  if (!automatic.length) return;
  const limits = effectLimits(rt, { actor, applicableOnUseEffects: effects });
  const applied = Object.fromEntries(automatic.map((ef) => [ef.id, { aplica: 1 }]));
  for (const v of findViolations(applied, limits)) {
    const data = { item: name, effect: v.name, requested: v.requested, max: v.max };
    rt.platform.notify.warn(rt.platform.i18n.format("T20CP.UsageEffectMax.Exceeded", data));
  }
}

/** ItemT20#roll without the dialog. */
function warnItemRoll(rt, item, options) {
  if (rt.mode() === "off" || !item?.actor || typeof item._allApplicableOnUseEffects !== "function") return;
  const effects = item._allApplicableOnUseEffects() ?? [];
  const hasEffectsOrRolls = !!effects.length || !!item.system?.rolls?.length;
  if (!skipsDialog({ usageDefault: rt.usageDefault(), shiftKey: !!options?.event?.shiftKey, hasEffectsOrRolls })) return;
  warnAutomatic(rt, item.actor, item.name, effects);
}

function installTraversalObserver(rt, proto) {
  if (typeof proto?.traverseEmbeddedDocuments !== "function") return false;
  rt.ctx.wrap(proto, "traverseEmbeddedDocuments", function (traverse, ...args) {
    const iterator = traverse.apply(this, args);
    const seen = rt.observed.get(this);
    if (!seen || typeof iterator?.[Symbol.iterator] !== "function") return iterator;
    return (function* () {
      for (const entry of iterator) {
        seen.push(entry);
        yield entry;
      }
    })();
  });
  return true;
}

/** Starts observing the collection of a dialog-less roll; null when the roll opens the dialog or the rule is off. */
function startObserving(rt, actor, options) {
  const shiftKey = !!options?.event?.shiftKey;
  if (rt.mode() === "off" || !skipsDialog({ usageDefault: rt.usageDefault(), shiftKey, hasEffectsOrRolls: true })) return null;
  const entries = [];
  rt.observed.set(actor, entries);
  return entries;
}

/**
 * Wraps ActorT20#rollPericia/rollAtributo: without the dialog, observes the collection, which runs synchronously
 * before the first await, and warns after it. The call itself is never changed.
 */
function wrapActorRoll(rt, proto, method, { type, nameOf }) {
  if (typeof proto?.[method] !== "function") return;
  rt.ctx.wrap(proto, method, function (original, ...args) {
    let entries = null;
    const previous = rt.observed.get(this);
    try {
      entries = startObserving(rt, this, args[1]);
    } catch (err) {
      rt.ctx.log.error("failed to check an automatic use", err);
    }
    try {
      return original.apply(this, args);
    } finally {
      if (entries) {
        if (previous) rt.observed.set(this, previous);
        else rt.observed.delete(this);
        try {
          const name = nameOf(this, args[0]);
          const effects = [...new Set(pseudoItemEffects(entries, { type, name }))];
          warnAutomatic(rt, this, name, effects);
        } catch (err) {
          rt.ctx.log.error("failed to check an automatic use", err);
        }
      }
    }
  });
}

/** Wraps a method to run a check first; the check never changes the call. */
function wrapBefore(rt, proto, method, check) {
  if (typeof proto?.[method] !== "function") return;
  rt.ctx.wrap(proto, method, function (original, ...args) {
    try {
      check(this, ...args);
    } catch (err) {
      rt.ctx.log.error("failed to check an automatic use", err);
    }
    return original.apply(this, args);
  });
}

/** Runs a render hook handler, logging instead of throwing. */
function onRender(rt, hook, message, render) {
  rt.ctx.hooks.on(hook, (app, html) => {
    try {
      if (rt.mode() !== "off") render(app, html);
    } catch (err) {
      rt.ctx.log.error(message, err);
    }
  });
}

/**
 * Installs the rule. The mode is read on every use, so a change applies without reloading.
 * @param {FeatureContext} ctx
 */
export function install(ctx) {
  const rt = createRuntime(ctx);
  const { platform } = ctx;
  ctx.services["use-dialog-guard"].register((context) => validate(rt, context));
  onRender(rt, "renderAbilityUseDialog", "failed to show the maximums", (app, html) =>
    renderDialogLimits(platform, app, html, (item) => effectLimits(rt, item))
  );
  onRender(rt, "renderActiveEffectConfig", "failed to add the effect field", (app, html) => renderEffectField(platform, app, html));
  wrapBefore(rt, platform.classes.item?.prototype, "roll", (item, options) => warnItemRoll(rt, item, options));
  const actorProto = platform.classes.actor?.prototype;
  if (installTraversalObserver(rt, actorProto)) {
    wrapActorRoll(rt, actorProto, "rollPericia", { type: "skill", nameOf: (actor, key) => actor.system?.pericias?.[key]?.label });
    wrapActorRoll(rt, actorProto, "rollAtributo", { type: "ability", nameOf: (actor, key) => actor.system?.atributos?.[key]?.name });
  }
}
