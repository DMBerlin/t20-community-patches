import { prefersDexterity } from "../../lib/weapons.mjs";
import { ROLL_DAMAGE, diagnoseDamageSource, rollsForCall, rollsWithDefaultAttribute } from "./domain.mjs";

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const source = ctx.platform.sourceOfMethod(ROLL_DAMAGE);
  if (source == null) return undefined;
  return diagnoseDamageSource(source);
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const ItemClass = ctx.platform.classes.item;
  if (typeof ItemClass?.prototype?.rollDamage !== "function") throw new Error("Tormenta20 ItemT20#rollDamage not found");

  const context = (item) => {
    const actor = item?.actor;
    if (!actor) return null;
    return {
      finesse: prefersDexterity({
        optionalRule: ctx.platform.settingsOf("tormenta20").get("lightFinesseWeapons"),
        acuidade: actor.getFlag("tormenta20", "acuidade"),
        atributos: actor.system?.atributos
      }),
      shootingStyle: actor.getFlag("tormenta20", "estiloDisparo")
    };
  };

  /** @type {WeakMap<object, {base: Array<object>, installed: Array<object>}>} */
  const frames = new WeakMap();

  // rollDamage reads `this.system.rolls` (the for…of iterator) before its first `await`, so the view is installed
  // only for the synchronous start and restored before the promise is returned (see finesse-agile-weapons).
  ctx.wrap(ItemClass.prototype, "rollDamage", function (rollDamage, ...args) {
    const outer = frames.get(this);
    let before;
    let installed = null;
    try {
      before = this.system.rolls;
      const damage = context(this);
      const transform = (base) => (damage ? rollsWithDefaultAttribute(base, this, damage) : null);
      const { base, rolls } = rollsForCall(before, outer, transform);
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
