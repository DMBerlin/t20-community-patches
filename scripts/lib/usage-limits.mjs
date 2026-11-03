/**
 * Maximum applications of usage effects (usage-effect-max, #57): defaults, resolution of the formula of an effect and
 * whether the rule limits it. Also read by item-effective-stats, which leaves limited effects unfolded.
 */
import { MODULE_ID } from "./module.mjs";

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

export const FLAG_PATH = `flags.${MODULE_ID}.${USAGE_EFFECT_MAX_FLAG}`;

export const DEFAULTS = buildDefaults();

/** Mode of the rule from a reader of its setting: unknown values count as "warn", a missing setting as "off". */
export function usageLimitMode(read) {
  try {
    const mode = read();
    return USAGE_EFFECT_MAX_MODES.includes(mode) ? mode : "warn";
  } catch {
    return "off";
  }
}

/** Compendium origin of the item that owns the effect (current and legacy field). */
export function ownerSource(effect, getProperty) {
  const owner = effect?.parent;
  if (owner?.documentName !== "Item") return "";
  return owner._stats?.compendiumSource ?? getProperty(owner, "flags.core.sourceId") ?? "";
}

/**
 * @param {object} effect
 * @param {(obj: object, path: string) => unknown} getProperty  foundry.utils.getProperty.
 * @returns {ReturnType<typeof resolveMaxFormula>}
 */
export function resolveEffect(effect, getProperty) {
  const owner = effect?.parent;
  return resolveMaxFormula({
    flag: getProperty(effect, FLAG_PATH),
    defaults: DEFAULTS,
    sourceKey: sourceKey(ownerSource(effect, getProperty), effect?.id),
    nameKey: owner?.documentName === "Item" ? nameKey(owner.name, effect?.name) : ""
  });
}

/** Whether usage-effect-max, in `mode`, limits this usage effect (rule on and a maximum resolved for it). */
export function hasUsageLimit(effect, mode, getProperty) {
  try {
    return mode !== "off" && resolveEffect(effect, getProperty).kind === "formula";
  } catch {
    return false;
  }
}
