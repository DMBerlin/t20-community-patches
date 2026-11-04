import { unwrap } from "../../lib/source.mjs";
import { prefersDexterity } from "../../lib/weapons.mjs";
import {
  attackPartWithDexterity,
  diagnoseFinesseBehavior,
  diagnoseFinesseSource,
  isAgileMeleeWeapon,
  isProbeSafe,
  probeAttack,
  probeDamage,
  probeItem,
  rollsForCall
} from "./domain/index.mjs";

function getItemClass(ctx) {
  const ItemClass = ctx.platform.classes.item;
  if (typeof ItemClass?.prototype?.getAttackToHit !== "function" || typeof ItemClass.prototype.rollDamage !== "function") {
    return null;
  }
  return ItemClass;
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const ItemClass = getItemClass(ctx);
  if (!ItemClass) return undefined;
  const attack = unwrap(ItemClass.prototype.getAttackToHit);
  const damage = unwrap(ItemClass.prototype.rollDamage);
  const attackSource = ctx.platform.sourceOf(attack);
  const damageSource = ctx.platform.sourceOf(damage);
  const fromSource = diagnoseFinesseSource(attackSource, damageSource);
  if (!isProbeSafe(attackSource, "attack") || !isProbeSafe(damageSource, "damage")) return fromSource;
  try {
    const behavior = diagnoseFinesseBehavior({
      attack: probeAttack(attack, probeItem({ light: false })),
      damage: probeDamage(damage, probeItem({ light: false })),
      lightAttack: probeAttack(attack, probeItem({ light: true })),
      lightDamage: probeDamage(damage, probeItem({ light: true }))
    });
    return behavior ?? fromSource;
  } catch (err) {
    ctx.log.warn(err);
    return fromSource;
  }
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const ItemClass = getItemClass(ctx);
  if (!ItemClass) throw new Error("Tormenta20 ItemT20#getAttackToHit/rollDamage not found");

  const usesAgileFinesse = (item) => {
    const actor = item?.actor;
    if (!item?.isOwned || !actor || !isAgileMeleeWeapon(item)) return false;
    return prefersDexterity({
      optionalRule: ctx.platform.settingsOf("tormenta20").get("lightFinesseWeapons"),
      acuidade: actor.flags?.tormenta20?.acuidade,
      atributos: actor.system?.atributos
    });
  };

  /** @type {WeakMap<object, {base: Array<object>, installed: Array<object>}>} */
  const frames = new WeakMap();

  // Synchronous: the attribute is restored before anything else can read the roll.
  ctx.wrap(ItemClass.prototype, "getAttackToHit", function (getAttackToHit, ...args) {
    let roll = null;
    let original;
    try {
      if (usesAgileFinesse(this)) {
        roll = this.system.rolls?.find((r) => r.type === "ataque") ?? null;
        const slot = roll && attackPartWithDexterity(roll.parts);
        if (slot) {
          original = roll.parts[1];
          roll.parts[1] = slot;
        } else roll = null;
      }
    } catch (err) {
      roll = null;
      ctx.log.warn(err);
    }
    try {
      return getAttackToHit.apply(this, args);
    } finally {
      if (roll) roll.parts[1] = original;
    }
  });

  // ItemT20#rollDamage is async, but it reads `this.system.rolls` (the `for…of` iterator and the attack skill)
  // before its first `await` (Roll#evaluate inside `damageRoll`, T20:8004-8016). So each call installs its own `rolls`
  // array only for its synchronous start and restores the previous value before returning the promise; the loop
  // keeps iterating that call's array. The synchronous start can still reach a nested call on the same item
  // (Roll#evaluate starts before the `await`; a hook may roll again): `frames` keeps the item's real rolls while a
  // per-call array is installed, so the nested call builds its own array from them, whatever its eligibility.
  ctx.wrap(ItemClass.prototype, "rollDamage", function (rollDamage, ...args) {
    const outer = frames.get(this);
    let before;
    let installed = null;
    try {
      before = this.system.rolls;
      const { base, rolls } = rollsForCall(before, outer, usesAgileFinesse(this));
      if (rolls !== before) {
        this.system.rolls = rolls;
        installed = rolls;
        frames.set(this, { base, installed: rolls });
      }
    } catch (err) {
      ctx.log.warn(err);
    }
    try {
      return rollDamage.apply(this, args);
    } finally {
      if (installed) {
        if (this.system.rolls === installed) this.system.rolls = before;
        if (outer) frames.set(this, outer);
        else frames.delete(this);
      }
    }
  });
}
