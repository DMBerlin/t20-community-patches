import { GET_ATTACK_TO_HIT, diagnose, stripMissingBonus, withoutZeroParts } from "./domain.mjs";

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const d20Roll = ctx.platform.t20()?.dice?.d20Roll;
  return diagnose(d20Roll ? ctx.platform.sourceOf(d20Roll) : null, ctx.platform.sourceOfMethod(GET_ATTACK_TO_HIT));
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const Roll = ctx.platform.dice.Roll;
  const ItemClass = ctx.platform.classes.item;
  if (typeof Roll?.parse !== "function") throw new Error("Roll.parse not found");
  if (typeof ItemClass?.prototype?.getAttackToHit !== "function") throw new Error("ItemT20#getAttackToHit not found");

  // d20Roll is a local function called by name, so the only shared point is the Roll it builds (core roll.mjs:39).
  ctx.wrap(Roll, "parse", function (parse, formula, data, ...rest) {
    let next = formula;
    try {
      next = stripMissingBonus(formula, ctx.platform.utils.getProperty(data ?? {}, "bonus"));
    } catch (err) {
      ctx.log.warn(err);
    }
    return parse.call(this, next, data, ...rest);
  });

  ctx.wrap(ItemClass.prototype, "getAttackToHit", function (getAttackToHit, ...args) {
    const result = getAttackToHit.apply(this, args);
    try {
      return withoutZeroParts(result);
    } catch (err) {
      ctx.log.warn(err);
      return result;
    }
  });
}
