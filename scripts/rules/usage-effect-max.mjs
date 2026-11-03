/**
 * Optional rule "Máximo de aplicações de efeitos de uso" (#26).
 *
 * The system lets an "Aumenta" usage effect be applied any number of times, but many abilities grow with the
 * level (the Bard's Inspiration: +1 every four levels). Each usage effect may have a maximum number of
 * applications, given by a dice-free formula: the effect's flag wins, then a built-in default for known
 * effects. The use dialog shows the maximum and the submit is checked; the GM picks warn, block or off.
 * A misconfigured formula never blocks: it means "no limit", with a single console warning.
 */
import { MODULE_ID } from "../lib/module.mjs";
import { evaluateManaLimit } from "../lib/mana.mjs";
import { wraps } from "../kernel/wrap.mjs";
import { pseudoItemEffects, skipsDialog } from "../lib/usage-effects.mjs";
import {
  DEFAULTS,
  FLAG_PATH,
  USAGE_EFFECT_MAX_SETTING,
  nameKey,
  ownerSource,
  resolveEffect,
  resolveMaxFormula,
  sourceKey,
  usageLimitMode
} from "../lib/usage-limits.mjs";

/**
 * Evaluates a maximum. Only an integer ≥ 0 is valid.
 * @param {string} formula
 * @param {object} rollData
 * @param {(formula: string, rollData: object) => number|null} evaluate  Dice-free evaluator (never eval).
 * @returns {number|null}  null when the formula is invalid.
 */
export function evaluateMax(formula, rollData, evaluate) {
  let value;
  try {
    value = evaluate(String(formula), rollData);
  } catch {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * How many times the system applies an effect for a form value, as applyOnUseEffects: a falsy value is not
 * applied, otherwise `Number(aplica) || 1` (a checked checkbox, or the array of repeated field names, is 1).
 * @param {unknown} aplica
 */
export function requestedApplications(aplica) {
  if (!aplica) return 0;
  const value = Number(aplica) || 1;
  return value > 0 ? value : 0;
}

/**
 * Merges the maximums of effects that share an id (ids are only unique per parent document; the system keys the
 * form by id, so they get the same quantity): the lowest maximum wins.
 * @param {{id: string, max: number, name: string}[]} entries
 * @returns {Record<string, {max: number, name: string}>}
 */
export function mergeLimits(entries) {
  const limits = {};
  for (const { id, max, name } of entries) {
    if (!(id in limits) || max < limits[id].max) limits[id] = { max, name };
  }
  return limits;
}

/**
 * @param {Record<string, {aplica?: unknown}>} applied  Expanded `aprs` of the form.
 * @param {Record<string, {max: number|null, name?: string}>} limits  Maximum of each effect, null = no limit.
 * @returns {{id: string, name: string, requested: number, max: number}[]}
 */
export function findViolations(applied = {}, limits = {}) {
  const violations = [];
  for (const [id, limit] of Object.entries(limits)) {
    if (!Number.isInteger(limit?.max)) continue;
    const requested = requestedApplications(applied?.[id]?.aplica);
    if (requested > limit.max) violations.push({ id, name: limit.name ?? id, requested, max: limit.max });
  }
  return violations;
}

const warnedFormulas = new Set();

const getMode = () => usageLimitMode(() => game.settings.get(MODULE_ID, USAGE_EFFECT_MAX_SETTING));

function toElement(html) {
  if (html instanceof HTMLElement) return html;
  return html?.[0] instanceof HTMLElement ? html[0] : null;
}

const evaluate = (formula, rollData) => evaluateManaLimit(formula, rollData, foundry.dice.Roll);

/**
 * Maximum of each applicable usage effect of the item, for its actor. Effects without a limit are left out.
 * @returns {Record<string, {max: number, name: string}>}
 */
function effectLimits(item) {
  const entries = [];
  const actor = item?.actor;
  const effects = item?.applicableOnUseEffects ?? [];
  if (!actor || !effects.length) return {};
  let rollData;
  for (const effect of effects) {
    const resolved = resolveEffect(effect, foundry.utils.getProperty);
    if (resolved.kind !== "formula") continue;
    rollData ??= actor.getRollData();
    const max = evaluateMax(resolved.formula, rollData, evaluate);
    if (max === null) {
      const key = `${effect.uuid ?? effect.id}|${resolved.formula}`;
      if (!warnedFormulas.has(key)) {
        warnedFormulas.add(key);
        console.warn(
          `${MODULE_ID} | usage-effect-max: invalid maximum "${resolved.formula}" for "${effect.name}" (${actor.name}); no limit applied`
        );
      }
      continue;
    }
    entries.push({ id: effect.id, max, name: effect.name });
  }
  return mergeLimits(entries);
}

function validate({ item, formData }) {
  const mode = getMode();
  if (mode === "off") return null;
  const limits = effectLimits(item);
  if (!Object.keys(limits).length) return null;
  const applied = foundry.utils.expandObject(formData ?? {}).aprs ?? {};
  const block = mode === "block";
  return findViolations(applied, limits).map((v) => {
    const data = { item: item.name, effect: v.name, requested: v.requested, max: v.max };
    const parts = [game.i18n.format("T20CP.UsageEffectMax.Exceeded", data)];
    if (block) parts.push(game.i18n.localize("T20CP.UsageEffectMax.Blocked"));
    return { message: parts.join(" "), block };
  });
}

function renderDialogLimits(app, html) {
  if (getMode() === "off") return;
  const root = toElement(html);
  if (!root) return;
  const limits = effectLimits(app.item);
  let changed = false;
  for (const [id, { max }] of Object.entries(limits)) {
    for (const input of root.querySelectorAll(`input[name="aprs.${id}.aplica"]`)) {
      if (input.type === "number") input.max = String(max);
      const container = input.closest(".item-cost") ?? input.parentElement;
      if (!container || container.querySelector(".t20cp-usage-effect-max")) continue;
      const hint = document.createElement("span");
      hint.className = "t20cp-usage-effect-max";
      hint.textContent = game.i18n.format("T20CP.UsageEffectMax.DialogHint", { max });
      container.append(hint);
      changed = true;
    }
  }
  if (changed) app.setPosition?.({ height: "auto" });
}

function renderEffectField(app, html) {
  if (getMode() === "off") return;
  const root = toElement(html) ?? toElement(app.element);
  const tab = root?.querySelector("section.tab.onuse, section.tab[data-tab='onuse']");
  if (!tab || tab.querySelector(`input[name="${FLAG_PATH}"]`)) return;
  const effect = app.document;
  const row = document.createElement("div");
  row.className = "form-group t20cp-usage-effect-max-field";
  const label = document.createElement("label");
  label.textContent = game.i18n.localize("T20CP.UsageEffectMax.FieldLabel");
  const fields = document.createElement("div");
  fields.className = "form-fields";
  const input = document.createElement("input");
  input.type = "text";
  input.name = FLAG_PATH;
  input.value = String(foundry.utils.getProperty(effect ?? {}, FLAG_PATH) ?? "");
  const inherited = resolveMaxFormula({ ...resolveKeys(effect), defaults: DEFAULTS });
  input.placeholder =
    inherited.kind === "formula"
      ? game.i18n.format("T20CP.UsageEffectMax.FieldPlaceholderDefault", { formula: inherited.formula })
      : game.i18n.localize("T20CP.UsageEffectMax.FieldPlaceholder");
  input.disabled = app.isEditable === false;
  fields.append(input);
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = game.i18n.localize("T20CP.UsageEffectMax.FieldHint");
  row.append(label, fields, hint);
  tab.append(row);
}

/** Lookup keys of an effect, without its flag (used for the inherited placeholder). */
function resolveKeys(effect) {
  const owner = effect?.parent;
  return {
    sourceKey: sourceKey(ownerSource(effect, foundry.utils.getProperty), effect?.id),
    nameKey: owner?.documentName === "Item" ? nameKey(owner.name, effect?.name) : ""
  };
}

const usageDefault = () => game.settings.get("tormenta20", "UsageConfig") === "default";

/**
 * Uses without the dialog select the ids of the "Aplicar Sempre" effects, once: never blocked, only warned at
 * maximum 0. Every applicable effect sharing a selected id is applied too, so all of them are checked.
 */
function warnAutomatic(actor, name, effects) {
  const automatic = effects.filter((ef) => ef.system?.abilityUse?.automatic);
  if (!automatic.length) return;
  const limits = effectLimits({ actor, applicableOnUseEffects: effects });
  const applied = Object.fromEntries(automatic.map((ef) => [ef.id, { aplica: 1 }]));
  for (const v of findViolations(applied, limits)) {
    ui.notifications.warn(
      game.i18n.format("T20CP.UsageEffectMax.Exceeded", { item: name, effect: v.name, requested: v.requested, max: v.max })
    );
  }
}

/** ItemT20#roll without the dialog. */
function warnItemRoll(item, options) {
  if (getMode() === "off" || !item?.actor || typeof item._allApplicableOnUseEffects !== "function") return;
  const effects = item._allApplicableOnUseEffects() ?? [];
  const hasEffectsOrRolls = !!effects.length || !!item.system?.rolls?.length;
  if (!skipsDialog({ usageDefault: usageDefault(), shiftKey: !!options?.event?.shiftKey, hasEffectsOrRolls })) return;
  warnAutomatic(item.actor, item.name, effects);
}

/**
 * Entries of actor.traverseEmbeddedDocuments() seen while a dialog-less skill/attribute roll collects its usage
 * effects, by actor. Observing the system's own traversal keeps every filter other wrappers apply to it (such as
 * suppressed-usage-effects) instead of collecting a list of our own.
 * @type {WeakMap<object, [string, object][]>}
 */
const observed = new WeakMap();

function installTraversalObserver(proto) {
  const traverse = proto?.traverseEmbeddedDocuments;
  if (typeof traverse !== "function") return false;
  wraps.wrap(proto, "traverseEmbeddedDocuments", "usage-effect-max", function (traverse, ...args) {
    const iterator = traverse.apply(this, args);
    const seen = observed.get(this);
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

/**
 * Wraps ActorT20#rollPericia/rollAtributo: without the dialog, observes the collection, which runs synchronously
 * before the first await, and warns after it. The call itself is never changed.
 */
function wrapActorRoll(proto, method, type, nameOf) {
  const original = proto?.[method];
  if (typeof original !== "function") return;
  wraps.wrap(proto, method, "usage-effect-max", function (original, ...args) {
    let entries = null;
    const previous = observed.get(this);
    try {
      const shiftKey = !!args[1]?.event?.shiftKey;
      if (getMode() !== "off" && skipsDialog({ usageDefault: usageDefault(), shiftKey, hasEffectsOrRolls: true })) {
        entries = [];
        observed.set(this, entries);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | usage-effect-max: failed to check an automatic use`, err);
    }
    try {
      return original.apply(this, args);
    } finally {
      if (entries) {
        if (previous) observed.set(this, previous);
        else observed.delete(this);
        try {
          const name = nameOf(this, args[0]);
          const effects = [...new Set(pseudoItemEffects(entries, { type, name }))];
          warnAutomatic(this, name, effects);
        } catch (err) {
          console.error(`${MODULE_ID} | usage-effect-max: failed to check an automatic use`, err);
        }
      }
    }
  });
}

/** Wraps a method to run a check first; the check never changes the call. */
function wrapBefore(proto, method, check) {
  const original = proto?.[method];
  if (typeof original !== "function") return;
  wraps.wrap(proto, method, "usage-effect-max", function (original, ...args) {
    try {
      check(this, ...args);
    } catch (err) {
      console.error(`${MODULE_ID} | usage-effect-max: failed to check an automatic use`, err);
    }
    return original.apply(this, args);
  });
}

/**
 * World setting. The lifecycle registers it on "init" for every system, so it always exists.
 * @type {import("../kernel/feature.mjs").SettingSpec}
 */
const SETTING_SPEC = {
  key: USAGE_EFFECT_MAX_SETTING,
  name: "T20CP.UsageEffectMax.Setting.Name",
  hint: "T20CP.UsageEffectMax.Setting.Hint",
  scope: "world",
  type: String,
  choices: {
    off: "T20CP.UsageEffectMax.Setting.off",
    warn: "T20CP.UsageEffectMax.Setting.warn",
    block: "T20CP.UsageEffectMax.Setting.block"
  },
  default: "warn"
};

/**
 * Installs the rule. The mode is read on every use, so a change applies without reloading.
 * @param {{register: (validator: Function) => void}} useDialogGuard  The use-dialog-guard service.
 */
export function installUsageEffectMaxRule(useDialogGuard) {
  useDialogGuard.register(validate);
  Hooks.on("renderAbilityUseDialog", (app, html) => {
    try {
      renderDialogLimits(app, html);
    } catch (err) {
      console.error(`${MODULE_ID} | usage-effect-max: failed to show the maximums`, err);
    }
  });
  Hooks.on("renderActiveEffectConfig", (app, html) => {
    try {
      renderEffectField(app, html);
    } catch (err) {
      console.error(`${MODULE_ID} | usage-effect-max: failed to add the effect field`, err);
    }
  });
  wrapBefore(CONFIG.Item?.documentClass?.prototype, "roll", (item, options) => warnItemRoll(item, options));
  const actorProto = CONFIG.Actor?.documentClass?.prototype;
  if (installTraversalObserver(actorProto)) {
    wrapActorRoll(actorProto, "rollPericia", "skill", (actor, key) => actor.system?.pericias?.[key]?.label);
    wrapActorRoll(actorProto, "rollAtributo", "ability", (actor, key) => actor.system?.atributos?.[key]?.name);
  }
}

/** @type {import("../kernel/feature.mjs").Feature} */
export default {
  id: "usage-effect-max",
  kind: "rule",
  group: "usage-effects",
  system: { id: "tormenta20" },
  settings: [SETTING_SPEC],
  services: ["use-dialog-guard"],
  install: (ctx) => installUsageEffectMaxRule(ctx.services["use-dialog-guard"])
};
