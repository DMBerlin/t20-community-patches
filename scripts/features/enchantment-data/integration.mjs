import { CLOAK, UPGRADE_FIXES, correctItem, correctUpgrade, diagnoseSources, dropOverrides, enableCloakEffects } from "./domain/index.mjs";

function correct(effect, penaltyFix) {
  const item = effect.parent;
  if (item?.documentName !== "Item") return;
  const tipo = item._source?.system?.tipo ?? item.system?.tipo;
  const fixed = correctUpgrade(effect._source, { tipo, penaltyFix });
  if (!fixed) return;
  effect.system.changes = fixed.changes;
  effect.constructor._shimChanges?.(effect.system.changes);
  effect.transfer = fixed.transfer;
}

const ITEM_FIELDS = { maxAtr: "system.armadura.maxAtr", espacos: "system.espacos" };
/** Values this patch set in memory on each prepared item, by path. */
const itemOverrides = new WeakMap();

function correctItemData(item, utils) {
  const system = item._source?.system;
  if (!system || !item.system) return;
  const fixed = correctItem({
    tipo: system.tipo,
    maxAtr: system.armadura?.maxAtr,
    espacos: system.espacos,
    effects: item.effects?.map((e) => e._source) ?? []
  });
  const current = setItemFields(item, fixed, itemOverrides.get(item) ?? {}, utils);
  if (Object.keys(current).length) itemOverrides.set(item, current);
  else itemOverrides.delete(item);
}

/**
 * Sets the corrected fields on the prepared item and restores the source value of those this patch set before and
 * no longer corrects. Returns the values set, by path.
 */
function setItemFields(item, fixed, previous, { getProperty, setProperty }) {
  const current = {};
  for (const [field, path] of Object.entries(ITEM_FIELDS)) {
    if (fixed?.[field] !== undefined) {
      setProperty(item, path, fixed[field]);
      current[path] = fixed[field];
    } else if (path in previous && getProperty(item, path) === previous[path]) {
      setProperty(item, path, getProperty(item._source, path));
    }
  }
  return current;
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const penaltyFixApplied = () => !!ctx.features?.isActive("armor-penalty-reduction");
  const EffectClass = ctx.platform.classes.activeEffect;
  const original = EffectClass.prototype.prepareBaseData;
  if (typeof original !== "function") throw new Error("ActiveEffect#prepareBaseData not found");

  ctx.wrap(EffectClass.prototype, "prepareBaseData", function (original, ...args) {
    try {
      correct(this, penaltyFixApplied);
    } catch (err) {
      ctx.log.warn("could not correct", this?.uuid, err);
    }
    return original.apply(this, args);
  });

  const ItemClass = ctx.platform.classes.item;
  const originalItem = ItemClass.prototype.prepareBaseData;
  if (typeof originalItem !== "function") throw new Error("Item#prepareBaseData not found");
  ctx.wrap(ItemClass.prototype, "prepareBaseData", function (originalItem, ...args) {
    try {
      correctItemData(this, ctx.platform.utils);
    } catch (err) {
      ctx.log.warn("could not correct the item", this?.uuid, err);
    }
    return originalItem.apply(this, args);
  });

  ctx.hooks.on("preCreateItem", (doc) => {
    try {
      const effects = enableCloakEffects(doc._source);
      if (effects) doc.updateSource({ effects });
    } catch (err) {
      ctx.log.warn("could not enable Manto da Resistência", err);
    }
  });
  ctx.hooks.on("preUpdateItem", (doc, changes) => {
    try {
      const overrides = itemOverrides.get(doc);
      if (overrides) dropOverrides(changes, overrides, doc._source);
    } catch (err) {
      ctx.log.warn("could not check the item update", doc?.uuid, err);
    }
  });
}

export function isNeeded() {
  return undefined;
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export async function lateProbe(ctx) {
  const packs = ctx.platform.documents.packs();
  const upgradesPack = packs.get("tormenta20.efeitos");
  const itemsPack = packs.get(CLOAK.pack);
  const upgrades = {};
  for (const id of Object.keys(UPGRADE_FIXES)) {
    upgrades[id] = (await upgradesPack?.getDocument(id))?._source ?? null;
  }
  const cloak = await itemsPack?.getDocument(CLOAK.itemId);
  const cloakEffect = cloak?.effects.get(CLOAK.effectId)?._source ?? null;
  if (!cloakEffect && Object.values(upgrades).every((s) => !s)) return undefined;
  return diagnoseSources(upgrades, cloakEffect);
}
