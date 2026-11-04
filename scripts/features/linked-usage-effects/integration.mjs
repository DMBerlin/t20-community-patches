import { OwnChangeList, findLinkedCandidates, linkedValues } from "./domain.mjs";

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
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
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

/** The rolled clone's own (non-usage) effects drop the "efeito"/"condicao" changes addToChange appends. */
function guardOwnChanges(own) {
  if (!own.system?.onuse && Array.isArray(own.system?.changes) && !(own.system.changes instanceof OwnChangeList)) {
    own.system.changes = OwnChangeList.from(own.system.changes);
  }
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const ItemClass = ctx.platform.classes.item;
  if (typeof ItemClass?.prototype?._allApplicableOnUseEffects !== "function") {
    throw new Error("Tormenta20 usage effect API not found");
  }

  // `this` is the rolled item's clone (ItemT20#roll); the live document is never touched.
  ctx.wrap(ItemClass.prototype, "_allApplicableOnUseEffects", function (original, ...args) {
    const effects = original.apply(this, args);
    if (!Array.isArray(effects) || !this.effects || this.actor?.items?.get(this.id) === this) return effects;
    try {
      for (const own of this.effects) guardOwnChanges(own);
      for (const effect of effects) injectLinked(ctx, this, effect);
    } catch (err) {
      ctx.log.warn(err);
    }
    return effects;
  });
}

/** applyEffectChanges is module-local in the system bundle, so the bug cannot be probed. */
export function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "applyEffectChanges is module-local" };
}
