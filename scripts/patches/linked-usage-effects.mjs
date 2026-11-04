/**
 * Linked usage effects (tormenta20 1.6.5).
 *
 * Bug: an "efeito" usage change only finds its target among the rolled item's effects; the fallback reads
 * `ef.parent.items` (the parent is an Item in v14) and matches by name, while Arte Mágica/Esgrima Mágica keep the
 * linked text in the target's description. addToChange also dumps "efeito"/"condicao" changes into the main effect.
 *
 * Fix: the single matching effect of the usage effect's own item is injected (as an isolated, disabled clone named
 * after the change value) into the rolled item's clone, and "efeito"/"condicao" are not appended to own effects.
 */
import { plainText } from "../lib/text.mjs";

const LINK_KEY = "efeito";
const DROPPED_KEYS = new Set(["efeito", "condicao"]);
/**
 * Candidates for a linked effect named `value` among `effects`, excluding the usage effect itself.
 * @param {Iterable<{id: string, name?: string, description?: string}>} effects
 * @param {string} value
 * @param {string} [excludeId]
 * @returns {object[]}
 */
export function findLinkedCandidates(effects, value, excludeId) {
  const wanted = String(value ?? "").trim();
  if (!wanted) return [];
  return [...(effects ?? [])].filter(
    (e) => e?.id !== excludeId && (e?.name === wanted || plainText(e?.description) === wanted)
  );
}

/**
 * Values of the "efeito" changes of a usage effect.
 * @param {{key?: string, value?: unknown}[]} changes
 * @returns {string[]}
 */
export function linkedValues(changes) {
  return [...(changes ?? [])]
    .filter((c) => c?.key === LINK_KEY && c.value != null)
    .map((c) => String(c.value).trim())
    .filter(Boolean);
}

/** Array whose push drops "efeito"/"condicao" changes; derived arrays (map, filter, deepClone) are plain arrays. */
export class OwnChangeList extends Array {
  static get [Symbol.species]() {
    return Array;
  }
  push(...items) {
    return super.push(...items.filter((c) => !DROPPED_KEYS.has(c?.key)));
  }
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const warned = new Set();

/** Every read of `system.changes` returns a fresh copy of the target's changes, and writes are ignored. */
function isolateChanges(effect, utils) {
  const snapshot = utils.deepClone(effect._source?.system?.changes ?? []);
  Object.defineProperty(effect.system, "changes", {
    configurable: true,
    enumerable: true,
    get: () => utils.deepClone(snapshot),
    set: () => {}
  });
}

/**
 * @param {import("../kernel/feature.mjs").FeatureContext} ctx
 * @param {object} rolled       The rolled item's clone.
 * @param {object} usageEffect  One of its applicable usage effects.
 */
function injectLinked(ctx, rolled, usageEffect) {
  const source = usageEffect?.parent?.documentName === "Item" ? usageEffect.parent : null;
  if (!source) return;
  const { utils } = ctx.platform;
  for (const value of linkedValues(usageEffect.system?.changes)) {
    if (rolled.effects.some((e) => e.name === value)) continue;
    const candidates = findLinkedCandidates(source.effects, value, usageEffect.id);
    if (candidates.length !== 1) {
      const key = `${source.uuid}|${value}`;
      if (candidates.length > 1 && !warned.has(key)) {
        warned.add(key);
        ctx.log.warn(`"${value}" is ambiguous in ${source.name}`);
      }
      continue;
    }
    const linked = candidates[0].clone(
      { name: value, disabled: true, _id: utils.randomID() },
      { keepId: true, parent: rolled }
    );
    isolateChanges(linked, utils);
    rolled.effects.set(linked.id, linked, { modifySource: false });
  }
}

/** @param {import("../kernel/feature.mjs").FeatureContext} ctx */
function install(ctx) {
  const ItemClass = ctx.platform.classes.item;
  if (typeof ItemClass?.prototype?._allApplicableOnUseEffects !== "function") {
    throw new Error("Tormenta20 usage effect API not found");
  }

  // `this` is the rolled item's clone (ItemT20#roll); the live document is never touched.
  ctx.wrap(ItemClass.prototype, "_allApplicableOnUseEffects", function (original, ...args) {
    const effects = original.apply(this, args);
    if (!Array.isArray(effects) || !this.effects || this.actor?.items?.get(this.id) === this) return effects;
    try {
      for (const own of this.effects) {
        if (!own.system?.onuse && Array.isArray(own.system?.changes) && !(own.system.changes instanceof OwnChangeList)) {
          own.system.changes = OwnChangeList.from(own.system.changes);
        }
      }
      for (const effect of effects) injectLinked(ctx, this, effect);
    } catch (err) {
      ctx.log.warn(err);
    }
    return effects;
  });
}

/** applyEffectChanges is module-local in the system bundle, so the bug cannot be probed. */
function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "applyEffectChanges is module-local" };
}

export default {
  id: "linked-usage-effects",
  group: "usage-effects",
  issue: 24,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  sources: ["#local:applyEffectChanges", "#local:applyOnUseEffects"],
  isNeeded,
  install
};
