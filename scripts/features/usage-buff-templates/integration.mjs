import { MODULE_ID } from "../../lib/module.mjs";
import {
  PENDING,
  WEAPON_FLAG,
  buffFamily,
  increaseMarkers,
  isBuffTemplate,
  isForOtherWeapon,
  isZeroPlaceholder,
  linkedTemplateValues,
  mergeDiceChange,
  needsAttackType,
  planWeaponChoice,
  skillAttributeKey,
  templateLabels,
  weaponBinding
} from "./domain.mjs";
import { askWeapon } from "./ui.mjs";

const prepared = new WeakSet();

const sourceChanges = (effect) => effect?._source?.system?.changes ?? effect?.system?.changes ?? [];

/** Enables the eligible templates of the rolled clone; the live item is never touched. */
function prepareClone(item) {
  if (prepared.has(item)) return;
  prepared.add(item);
  const live = item.actor.items.get(item.id);
  const effects = [...item.effects].filter((e) => live.effects.has(e.id));
  const templates = findTemplates(item, effects);
  if (!templates.length) return;
  const names = new Set(templates.map((t) => t.name));
  for (const effect of effects) {
    const data = { onuse: effect.system?.onuse, disabled: effect.disabled, name: effect.name, changes: sourceChanges(effect) };
    if (isZeroPlaceholder(data, names)) effect.updateSource({ disabled: true });
  }
  const increases = effects
    .filter((e) => e.system?.onuse && e.system?.abilityUse?.aumenta && !templates.includes(e))
    .flatMap((e) => sourceChanges(e));
  const labels = templateLabels(templates.map((t) => ({ id: t.id, name: t.name, description: t.description })));
  for (const template of templates) {
    template.updateSource(templateUpdate(template, labels.get(template.id) ?? template.name, increases));
    mergeAppendedDice(template.system?.changes);
  }
}

/** The buff templates among the rolled clone's own effects. */
function findTemplates(item, effects) {
  const linked = linkedTemplateValues(effects);
  return effects.filter((e) =>
    isBuffTemplate(
      {
        onuse: e.system?.onuse,
        temporary: e.isTemporary,
        disabled: e.disabled,
        name: e.name,
        description: e.description,
        names: e.system?.abilityUse?.names
      },
      { itemName: item.name, linked }
    )
  );
}

/** Source update that enables one template on the rolled clone. */
function templateUpdate(template, name, increases) {
  const family = buffFamily(sourceChanges(template));
  const update = { disabled: false, name };
  if (family === "passive") update["system.onuse"] = false;
  else update["system.abilityUse.automatic"] = true;
  if (family === "weapon") update[`flags.${MODULE_ID}.${WEAPON_FLAG}`] = PENDING;
  const changes = sourceChanges(template);
  if (family === "passive" && changes.some((c) => skillAttributeKey(c?.key) !== c?.key)) {
    update["system.changes"] = changes.map((c) => ({ ...c, key: skillAttributeKey(c?.key) }));
  }
  const markers = family === "passive" ? [] : increaseMarkers(changes, increases);
  if (markers.length) update["system.changes"] = [...changes.map((c) => ({ ...c })), ...markers];
  const abilityUse = template.system?.abilityUse;
  if (family === "usage" && needsAttackType({ types: abilityUse?.types, names: abilityUse?.names, changes })) {
    update["system.abilityUse.types"] = ["attack"];
  }
  return update;
}

/** Enhancements append to the template's changes array (addToChange); dice are merged instead of summed to NaN. */
function mergeAppendedDice(changes) {
  if (!Array.isArray(changes)) return;
  Object.defineProperty(changes, "push", {
    configurable: true,
    writable: true,
    value(...items) {
      for (const item of items) if (!mergeDiceChange(this, item)) Array.prototype.push.call(this, item);
      return this.length;
    }
  });
}

function actorWeapons(actor) {
  return (actor.itemTypes?.arma ?? actor.items.filter((i) => i.type === "arma")).map((w) => ({
    id: w.id,
    name: w.name,
    wielded: !w.areEffectsSuppressed
  }));
}

/** Binds a pending weapon buff before creation. Returns false when nothing can or should be created. */
async function bindWeapon(platform, effect, data) {
  if (platform.utils.getProperty(data ?? {}, `flags.${MODULE_ID}.${WEAPON_FLAG}`) !== PENDING) return;
  const actor = effect.parent;
  if (actor?.documentName !== "Actor") return;
  const plan = planWeaponChoice(actorWeapons(actor));
  if (plan.none) {
    platform.notify?.warn(platform.i18n.format("T20CP.UsageBuffTemplates.NoWeapon", { effect: effect.name, actor: actor.name }));
    return false;
  }
  const weapon = await chooseWeapon(platform, effect, actor, plan);
  if (!weapon) return false;
  effect.updateSource(weaponBinding({ name: effect.name, changes: effect._source?.system?.changes ?? [] }, weapon));
}

async function chooseWeapon(platform, effect, actor, plan) {
  const id = plan.auto ?? (await askWeapon(platform, effect.name, actor, plan.choices));
  return id ? actor.items.get(id) : null;
}

function isRolledClone(item) {
  const live = item.isEmbedded ? item.actor?.items?.get(item.id) : null;
  return Boolean(live && live !== item && item.effects);
}

/** Drops the buffs bound to other weapons and adds the actor's buffs bound to this one. */
function withWeaponBuffs(item, effects) {
  const kept = effects.filter((e) => !isForOtherWeapon(e?.flags?.[MODULE_ID]?.[WEAPON_FLAG], item.id));
  // The name binding is lost when the weapon is renamed; the id binding still reaches it.
  for (const effect of item.actor.effects ?? []) {
    if (!effect?.system?.onuse || effect.flags?.[MODULE_ID]?.[WEAPON_FLAG] !== item.id) continue;
    if (kept.some((e) => e?.id === effect.id && e.parent?.id === effect.parent?.id)) continue;
    // A copy, as the system mutates the changes of the effects it applies.
    kept.push(effect.clone({}, { keepId: true }));
  }
  return kept;
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const ItemClass = ctx.platform.classes.item;
  const original = ItemClass?.prototype?._allApplicableOnUseEffects;
  if (typeof original !== "function") throw new Error("Tormenta20 usage effect API not found");
  const effectProto = ctx.platform.classes.activeEffect?.prototype;
  const preCreate = effectProto?._preCreate;
  if (typeof preCreate !== "function") throw new Error("ActiveEffect#_preCreate not found");

  // `this` is the rolled item's clone (ItemT20#roll) when the actor's item with the same id is another object.
  ctx.wrap(ItemClass.prototype, "_allApplicableOnUseEffects", function (original, ...args) {
    if (isRolledClone(this)) {
      try {
        prepareClone(this);
      } catch (err) {
        ctx.log.warn("failed to prepare the buff templates", err);
      }
    }
    const effects = original.apply(this, args);
    if (!Array.isArray(effects) || !this.actor?.items) return effects;
    try {
      return withWeaponBuffs(this, effects);
    } catch (err) {
      ctx.log.warn("failed to filter weapon buffs", err);
      return effects;
    }
  });

  ctx.wrap(effectProto, "_preCreate", async function (preCreate, ...args) {
    const [data, , user] = args;
    if (!user || user.id === ctx.platform.user.id()) {
      let allowed;
      try {
        allowed = await bindWeapon(ctx.platform, this, data);
      } catch (err) {
        ctx.log.warn("failed to bind the weapon", err);
      }
      if (allowed === false) return false;
    }
    return preCreate.apply(this, args);
  });
}

/** applyOnUseEffects is module-local in the system bundle, so the card filter cannot be probed during init. */
export function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "applyOnUseEffects is module-local" };
}

/** Arma Mágica's template in the spell compendium: still disabled means the data side of the bug is present. */
/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export async function lateProbe(ctx) {
  const pack = ctx.platform.documents.packs().get("tormenta20.magias");
  const item = await pack?.getDocument("YDxLaaDhfXOkSfnF");
  const template = item?.effects?.get("Mz54PvtVdDzg7kl3");
  if (!template?.system?.onuse || !template.isTemporary) return undefined;
  if (template.disabled) {
    return { bug: "present", confidence: "low", evidence: "tormenta20.magias: Arma Mágica template is disabled" };
  }
  return { bug: "fixed", confidence: "low", evidence: "tormenta20.magias: Arma Mágica template is enabled" };
}
