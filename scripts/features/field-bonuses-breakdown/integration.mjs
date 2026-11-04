import { resolveDataRefs } from "../../lib/data-refs.mjs";
import { fieldTerms } from "../../lib/tooltip.mjs";
import { fieldsFromChanges } from "../../lib/applied-breakdown.mjs";
import {
  INPUT_PARTS,
  NOT_STACKING_KEY,
  REASON_KEYS,
  diagnoseHelperSource,
  helperParts,
  manualEntries,
  normalizeModifiedFields
} from "./domain/index.mjs";
import {
  defenseItemsHTML,
  defenseSourcesHTML,
  heavyArmorHTML,
  manualOverrideHTML,
  preparedValue,
  residualHTML,
  resourceHTML,
  skillHTML
} from "./ui.mjs";

export const HELPER = "#helper:fieldBonuses";
const HELPER_TYPES = new Set(["pv", "pm", "pericias", "defesa"]);

/**
 * What the wrapper reads from the platform, the other features and the applied-changes service.
 * @returns {import("./ui.mjs").BreakdownEnv & {platform: object}}
 */
function createEnv(ctx) {
  const { platform } = ctx;
  const features = ctx.features;
  const applied = ctx.services["applied-changes"];
  const localize = (key) => platform.i18n.localize(key);
  /** Data references of a formula, resolved as core does. */
  const dataRefs = (raw, data) => resolveDataRefs(raw, data, platform.dice.Roll.defaultImplementation);
  let warned = false;
  const warnOnce = (message, err) => {
    if (!warned) ctx.log.warn(message, err);
    warned = true;
  };
  /** The changes of the last published preparation of the actor, or null (not prepared since the install). */
  const recordedChanges = (actor) => {
    try {
      return applied?.changes(actor) ?? null;
    } catch (err) {
      warnOnce("could not read the applied changes", err);
      return null;
    }
  };
  return {
    platform,
    localize,
    dataRefs,
    warnOnce,
    recordedChanges,
    isActive: (id) => !!features?.isActive(id),
    recordedSuppressed: (actor) => (recordedChanges(actor) ? (applied.suppressed(actor) ?? []) : []),
    contributions: (actor, path) => applied.contributions(actor, path),
    equipmentSlots: () => platform.settingsOf("tormenta20").get("equipmentSlots"),
    attributeLabel: (key) => localize(platform.t20Config().atributos[key] ?? key),
    evaluate: (formula, data) => platform.dice.Roll.create(dataRefs(formula, data)).evaluateSync().total,
    noteOf: (reason) => localize(REASON_KEYS[reason] ?? NOT_STACKING_KEY),
    reported: new WeakMap()
  };
}

/** The `actor` the helper reads (T20:3083), from the root it receives. */
function helperActor(env, root) {
  const { documents } = env.platform;
  return documents.actors?.()?.get(root?.actor?._id) || documents.fromUuidSync(root?.uuid) || null;
}

function effectChanges(actor) {
  const changes = [];
  for (const effect of actor.appliedEffects ?? []) {
    if (!effect?.modifiesActor) continue;
    for (const ch of effect.changes ?? []) {
      changes.push({ key: ch.key, label: effect.name, value: ch.value, type: ch.type, priority: ch.priority, phase: ch.phase });
    }
  }
  return changes;
}

function proxyKeys(env, actor, path) {
  const property = env.platform.utils.getProperty(actor, path);
  if (!property || typeof property !== "object") return [];
  const keys = Object.keys(property);
  return path === "system.attributes.movement" ? keys.filter((k) => env.platform.t20Config()?.movementTypes?.[k]) : keys;
}

/** The manual PV/PM elements of the source, listed one by one. */
function manualSeeds(env, actor, { parts, type, resource }) {
  if (!parts.manual || !resource) return {};
  return manualEntries(type, actor._source?.system?.attributes?.[type]?.bonus, env.localize);
}

/** Shadows the actor's modifiedFields with the normalized copy the helper should read; records it in `call`. */
function shadowFields(env, actor, call) {
  const { parts, resource } = call;
  const rollData = actor.getRollData();
  call.rollData = rollData;
  const seeds = manualSeeds(env, actor, call);
  // The changes really applied in the last preparation; their keys are concrete (wildcards already expanded).
  const recorded = env.recordedChanges(actor);
  const fields = normalizeModifiedFields(recorded ? fieldsFromChanges(recorded) : (actor.modifiedFields ?? {}), {
    parts: recorded ? { ...parts, wildcard: false } : parts,
    changes: recorded ?? effectChanges(actor),
    keysOf: (p) => proxyKeys(env, actor, p),
    evaluate: (formula) => env.evaluate(formula, rollData),
    resolve: (value) => env.dataRefs(value, rollData),
    seeds,
    level: Number(actor.system?.attributes?.nivel?.value) || 0,
    ordered: Boolean(recorded)
  });
  Object.defineProperty(actor, "modifiedFields", { value: fields, configurable: true, writable: true });
  call.seeded = parts.manual && resource;
}

/** The helper's actor, with modifiedFields shadowed when an input part is fixed; null when it is not found. */
function prepareCall(env, root, call, inputs) {
  let actor = null;
  try {
    actor = helperActor(env, root);
    if (actor && inputs && !Object.hasOwn(actor, "modifiedFields")) {
      shadowFields(env, actor, call);
      call.shadowed = true;
    }
  } catch (err) {
    env.warnOnce("could not normalize the effects of the breakdown", err);
  }
  return actor;
}

const rollDataOf = (actor, call) => call.rollData ?? actor.getRollData();

/** The fixes applied to the helper's HTML, in order; each returns the HTML unchanged when it does not apply. */
const STEPS = [
  (env, html, actor, { seeded, type }) => (seeded ? manualOverrideHTML(env, html, actor, type) : html),
  (env, html, actor, call) => {
    const { parts, resource, type, context } = call;
    if (!parts.manual || !resource || actor.flags?.tormenta20?.lvlconfig?.manual) return html;
    return resourceHTML(env, html, actor, { type, rollData: rollDataOf(actor, call), context });
  },
  (env, html, actor, { parts, type }) => (parts.defenseSources && type === "defesa" ? defenseSourcesHTML(env, html, actor) : html),
  (env, html, actor, call) =>
    call.parts.heavyArmor && call.type === "defesa" ? heavyArmorHTML(env, html, actor, rollDataOf(actor, call)) : html,
  (env, html, actor, { parts, type }) => (type === "defesa" ? defenseItemsHTML(env, html, actor, parts) : html),
  (env, html, actor, { type, key, path }) =>
    type === "pericias" ? skillHTML(env, html, actor, { key, path: typeof path === "object" ? path?.string : path }) : html,
  // Only for a recorded preparation: without it, what other features add (non-proficiency draws its own
  // line outside this wrapper) is unknown and would be counted twice.
  (env, html, actor, { type, key }) => {
    if ((type !== "defesa" && type !== "pericias") || !env.recordedChanges(actor)) return html;
    return residualHTML(env, html, actor, { path: `${type}.${key}`, prepared: preparedValue(env, html, actor, { type, key }) });
  }
];

/** The lines the helper leaves out or gets wrong, after the call; on an error, what was adjusted so far. */
function adjustHTML(env, html, actor, call) {
  try {
    for (const step of STEPS) html = step(env, html, actor, call);
  } catch (err) {
    env.warnOnce("could not adjust the breakdown", err);
  }
  return html;
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const env = createEnv(ctx);
  const helpers = ctx.platform.handlebars.helpers();
  const original = helpers?.fieldBonuses;
  if (typeof original !== "function") throw new Error("Handlebars helper fieldBonuses not found");
  const parts = helperParts(ctx.platform.sourceOf(original) ?? undefined);
  const inputs = INPUT_PARTS.some((p) => parts[p]);
  if (!inputs && !parts.heavyArmor && !parts.defenseSources && !parts.armorSlots) {
    ctx.log.warn("fieldBonuses not recognized; nothing to fix");
    return;
  }
  ctx.wrap(
    helpers,
    "fieldBonuses",
    function (original, path, options) {
      const [type, key] = fieldTerms(path);
      if (!HELPER_TYPES.has(type) || (type === "defesa" && key === "pda")) return original.call(this, path, options);
      const call = { parts, type, key, path, resource: type === "pv" || type === "pm", context: this, rollData: null, seeded: false };
      const actor = prepareCall(env, options?.data?.root, call, inputs);
      let html;
      try {
        html = original.call(this, path, options);
      } finally {
        if (call.shadowed) delete actor.modifiedFields;
      }
      if (!actor || typeof html !== "string") return html;
      return adjustHTML(env, html, actor, call);
    },
    { label: "Handlebars.helpers.fieldBonuses" }
  );
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  return diagnoseHelperSource(ctx.platform.sourceOfMethod(HELPER) ?? undefined);
}
