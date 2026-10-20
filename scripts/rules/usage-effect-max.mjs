/**
 * Optional rule "Máximo de aplicações de efeitos de uso" (#26).
 *
 * The system lets an "Aumenta" usage effect be applied any number of times, but many abilities grow with the
 * level (the Bard's Inspiration: +1 every four levels). Each usage effect may have a maximum number of
 * applications, given by a dice-free formula: the effect's flag wins, then a built-in default for known
 * effects. The use dialog shows the maximum and the submit is checked; the GM picks warn, block or off.
 * A misconfigured formula never blocks: it means "no limit", with a single console warning.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";
import { evaluateManaLimit } from "./mana-limit.mjs";
import { installUseDialogGuard, registerUseValidator } from "./use-dialog-guard.mjs";

export const USAGE_EFFECT_MAX_SETTING = "usageEffectMaxRule";
export const USAGE_EFFECT_MAX_FLAG = "maxApplications";
export const USAGE_EFFECT_MAX_MODES = ["off", "warn", "block"];

/**
 * Built-in maximums. `source` is the compendium UUID of the item that owns the effect and `effect` the effect id;
 * `item`/`name` are the item and effect names, used when the source does not match (items without origin).
 */
export const DEFAULT_MAXIMUMS = [
  {
    source: "Compendium.tormenta20.poderes.Item.Uv6GW8R54wUtv3sm",
    effect: "gpuEqXYdlZr1nrNK",
    item: "Inspiração",
    name: "Inspiração",
    formula: "floor((@nvl.bardo - 1) / 4)"
  }
];

/** @param {string} source @param {string} effectId */
export const sourceKey = (source, effectId) => (source && effectId ? `${source}#${effectId}` : "");
/** @param {string} itemName @param {string} effectName */
export const nameKey = (itemName, effectName) =>
  itemName && effectName ? `name:${String(itemName).trim()}#${String(effectName).trim()}` : "";

/**
 * Lookup table of the built-in maximums, by source key and by name key.
 * @param {typeof DEFAULT_MAXIMUMS} entries
 * @returns {Map<string, string>}
 */
export function buildDefaults(entries = DEFAULT_MAXIMUMS) {
  const map = new Map();
  for (const entry of entries) {
    const bySource = sourceKey(entry.source, entry.effect);
    const byName = nameKey(entry.item, entry.name);
    if (bySource) map.set(bySource, entry.formula);
    if (byName && !map.has(byName)) map.set(byName, entry.formula);
  }
  return map;
}

/**
 * Formula of an effect's maximum: the effect flag (empty = inherit, "none" = no limit), then the built-in default
 * by source, then by names, then no limit.
 * @param {{flag?: unknown, defaults?: Map<string, string>, sourceKey?: string, nameKey?: string}} params
 * @returns {{kind: "none", origin: "effect"|"none"} | {kind: "formula", formula: string, origin: "effect"|"default"}}
 */
export function resolveMaxFormula({ flag, defaults = new Map(), sourceKey: bySource, nameKey: byName }) {
  const text = flag === undefined || flag === null ? "" : String(flag).trim();
  if (text.toLowerCase() === "none") return { kind: "none", origin: "effect" };
  if (text) return { kind: "formula", formula: text, origin: "effect" };
  for (const key of [bySource, byName]) {
    if (key && defaults.has(key)) return { kind: "formula", formula: defaults.get(key), origin: "default" };
  }
  return { kind: "none", origin: "none" };
}

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
 * Usage effects of a skill or attribute roll, filtered as ActorT20#rollPericia/rollAtributo do.
 * @param {Iterable<[string, object]>} entries  actor.traverseEmbeddedDocuments().
 * @param {{type: "skill"|"ability", name?: string}} params
 */
export function pseudoItemEffects(entries, { type, name }) {
  const effects = [];
  for (const [path, doc] of entries) {
    if (doc?.documentName !== "ActiveEffect") continue;
    if (doc.isTemporary && path !== "effects") continue;
    if (!doc.system?.onuse) continue;
    const { types, names } = doc.system.abilityUse ?? {};
    if (!types?.has?.(type)) continue;
    if (names?.size && !names.has(name)) continue;
    effects.push(doc);
  }
  return effects;
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

/**
 * Whether ItemT20#roll will skip the dialog and apply only the "Aplicar Sempre" effects, as the system decides.
 * @param {{usageDefault: boolean, shiftKey: boolean, hasEffectsOrRolls: boolean}} params
 */
export function skipsDialog({ usageDefault, shiftKey, hasEffectsOrRolls }) {
  return !(hasEffectsOrRolls && (usageDefault ? !shiftKey : shiftKey));
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const FLAG_PATH = `flags.${MODULE_ID}.${USAGE_EFFECT_MAX_FLAG}`;
const DEFAULTS = buildDefaults();
const warnedFormulas = new Set();

function getMode() {
  try {
    const mode = game.settings.get(MODULE_ID, USAGE_EFFECT_MAX_SETTING);
    return USAGE_EFFECT_MAX_MODES.includes(mode) ? mode : "warn";
  } catch {
    return "off";
  }
}

function toElement(html) {
  if (html instanceof HTMLElement) return html;
  return html?.[0] instanceof HTMLElement ? html[0] : null;
}

/** Compendium origin of the item that owns the effect (current and legacy field). */
function ownerSource(effect) {
  const owner = effect?.parent;
  if (owner?.documentName !== "Item") return "";
  return owner._stats?.compendiumSource ?? foundry.utils.getProperty(owner, "flags.core.sourceId") ?? "";
}

/** @returns {ReturnType<typeof resolveMaxFormula>} */
function resolveEffect(effect) {
  const owner = effect?.parent;
  return resolveMaxFormula({
    flag: foundry.utils.getProperty(effect, FLAG_PATH),
    defaults: DEFAULTS,
    sourceKey: sourceKey(ownerSource(effect), effect?.id),
    nameKey: owner?.documentName === "Item" ? nameKey(owner.name, effect?.name) : ""
  });
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
    const resolved = resolveEffect(effect);
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
    sourceKey: sourceKey(ownerSource(effect), effect?.id),
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
  proto.traverseEmbeddedDocuments = markWrapper(function (...args) {
    const iterator = traverse.apply(this, args);
    const seen = observed.get(this);
    if (!seen || typeof iterator?.[Symbol.iterator] !== "function") return iterator;
    return (function* () {
      for (const entry of iterator) {
        seen.push(entry);
        yield entry;
      }
    })();
  }, traverse);
  return true;
}

/**
 * Wraps ActorT20#rollPericia/rollAtributo: without the dialog, observes the collection, which runs synchronously
 * before the first await, and warns after it. The call itself is never changed.
 */
function wrapActorRoll(proto, method, type, nameOf) {
  const original = proto?.[method];
  if (typeof original !== "function") return;
  proto[method] = markWrapper(function (...args) {
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
  }, original);
}

/** Wraps a method to run a check first; the check never changes the call. */
function wrapBefore(proto, method, check) {
  const original = proto?.[method];
  if (typeof original !== "function") return;
  proto[method] = markWrapper(function (...args) {
    try {
      check(this, ...args);
    } catch (err) {
      console.error(`${MODULE_ID} | usage-effect-max: failed to check an automatic use`, err);
    }
    return original.apply(this, args);
  }, original);
}

/** Registers the world setting. Runs on "init" for every system, so the setting always exists. */
export function registerUsageEffectMaxSetting() {
  game.settings.register(MODULE_ID, USAGE_EFFECT_MAX_SETTING, {
    name: "T20CP.UsageEffectMax.Setting.Name",
    hint: "T20CP.UsageEffectMax.Setting.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      off: "T20CP.UsageEffectMax.Setting.off",
      warn: "T20CP.UsageEffectMax.Setting.warn",
      block: "T20CP.UsageEffectMax.Setting.block"
    },
    default: "warn"
  });
}

/** Installs the rule. The mode is read on every use, so a change applies without reloading. */
export function installUsageEffectMaxRule() {
  installUseDialogGuard();
  registerUseValidator(validate);
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
