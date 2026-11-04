import { I18N, TEMPLATE, attributeBreakdown, attributeTarget, breakdownHTML, diagnoseTemplate, recordChange } from "./domain.mjs";

function snapshot(actor) {
  const start = {};
  for (const [key, abl] of Object.entries(actor.system?.atributos ?? {})) {
    start[key] = { base: abl?.base, racial: abl?.racial, bonus: abl?.bonus };
  }
  return start;
}

/**
 * Adds the breakdown tooltip to every attribute value of a rendered actor sheet that has none.
 * @param {{localize: (key: string) => string, logs: WeakMap<object, object>, warn: Function}} env
 */
function decorate(env, app, html) {
  const actor = app?.actor;
  const root = typeof html?.querySelectorAll === "function" ? html : html?.[0];
  if (!actor?.system?.atributos || !root?.querySelectorAll) return;
  const log = env.logs.get(actor);
  for (const li of root.querySelectorAll("li.ability[data-item-id]")) decorateAbility(env, actor, log, li);
}

/** The element of an attribute row that gets the tooltip, or null when it already has one. */
function tooltipTarget(li) {
  const value = li.querySelector(".atributo-value");
  const target = value?.closest("span") ?? value;
  if (!target || target.dataset.tooltip !== undefined || target.dataset.tooltipHtml !== undefined) return null;
  return target;
}

function breakdownInput(actor, log, key, prepared) {
  return {
    prepared,
    start: log?.start?.[key],
    sourceBonus: actor._source?.system?.atributos?.[key]?.bonus ?? 0,
    entries: log?.entries?.[key] ?? []
  };
}

function decorateAbility(env, actor, log, li) {
  const key = li.dataset.itemId;
  const target = tooltipTarget(li);
  const prepared = actor.system.atributos[key];
  if (!target || !prepared) return;
  try {
    const breakdown = attributeBreakdown(breakdownInput(actor, log, key, prepared));
    target.dataset.tooltipHtml = breakdownHTML(breakdown, env.localize);
    target.dataset.tooltipDirection ??= "LEFT";
  } catch (err) {
    env.warn("could not build the breakdown", actor.uuid, key, err);
  }
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const { platform } = ctx;
  const EffectClass = platform.classes.activeEffect;
  const actorProto = platform.classes.actor?.prototype;
  if (typeof EffectClass?.applyChangeField !== "function") throw new Error("ActiveEffect.applyChangeField not found");
  if (typeof actorProto?.applyActiveEffects !== "function") throw new Error("Actor#applyActiveEffects not found");

  let warned = false;
  const warn = (...args) => {
    if (!warned) ctx.log.warn(...args);
    warned = true;
  };
  /** Actor → {phase, start, entries}; rebuilt on every "initial" phase, in memory only. */
  const logs = new WeakMap();
  const getProperty = (object, key) => platform.utils.getProperty(object, key);

  ctx.wrap(actorProto, "applyActiveEffects", function (applyActiveEffects, phase, ...args) {
    let log;
    try {
      if (phase === "initial") logs.set(this, { phase: null, start: snapshot(this), entries: {} });
      log = logs.get(this);
    } catch (err) {
      warn("could not start the log", err);
    }
    const previous = log?.phase;
    if (log) log.phase = phase;
    try {
      return applyActiveEffects.call(this, phase, ...args);
    } finally {
      if (log) log.phase = previous;
    }
  });

  ctx.wrap(EffectClass, "applyChangeField", function (applyChangeField, ...args) {
    const [targetDoc, change, options] = args;
    const log = targetDoc ? logs.get(targetDoc) : undefined;
    if (!log?.phase || !attributeTarget(change?.key)) return applyChangeField.apply(this, args);
    let before;
    try {
      before = getProperty(targetDoc, change.key);
    } catch (err) {
      warn("could not read the attribute", err);
    }
    const result = applyChangeField.apply(this, args);
    try {
      const after = options?.modifyTarget === false ? result : getProperty(targetDoc, change.key);
      recordChange(log, { key: change.key, phase: log.phase, label: change.effect?.name, type: change.type, before, after });
    } catch (err) {
      warn("could not record the change", err);
    }
    return result;
  });

  const env = { localize: (key) => platform.i18n.localize(`${I18N}.${key}`), logs, warn };
  ctx.hooks.on("renderActorSheet", (app, html) => decorate(env, app, html));
}

export function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "the sheet template is only readable after ready" };
}

/**
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 * @returns {Promise<import("../../registry.mjs").Diagnosis|undefined>}
 */
export async function lateProbe(ctx) {
  try {
    const response = await fetch(ctx.platform.utils.getRoute(TEMPLATE));
    return response.ok ? diagnoseTemplate(await response.text()) : undefined;
  } catch {
    return undefined;
  }
}
