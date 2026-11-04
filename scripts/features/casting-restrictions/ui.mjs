/**
 * Texts of the casting restrictions (#37): warnings, the conditions list and the concentration message. Everything
 * comes in through parameters (ctx for i18n, CONFIG.statusEffects and utils).
 */

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

/** T20CP.CastingRestrictions.<key>, formatted. */
export const t = (ctx, key, data) => ctx.platform.i18n.format(`T20CP.CastingRestrictions.${key}`, data);
export const list = (ctx, items) => ctx.platform.i18n.listFormat(items);
export const sustainedReference = (ctx) => ctx.platform.i18n.localize("T20CP.CastingRestrictions.Sustained.Reference");

/** @param {FeatureContext} ctx */
export function statusName(ctx, id) {
  const status = ctx.platform.statusEffects()?.find?.((s) => s.id === id);
  return status ? ctx.platform.i18n.localize(status.name) : id;
}

/** "sustenta Velocidade e tem marcadores que podem ser de uma magia (conferir na ficha): Sustentando (Oração)". */
export function heldText(ctx, casts, uncertain) {
  const parts = [];
  if (casts.length) parts.push(t(ctx, "Sustained.Held", { spells: list(ctx, casts.map((c) => c.spell)) }));
  if (uncertain.length) parts.push(t(ctx, "Sustained.Uncertain", { markers: list(ctx, uncertain.map((u) => u.name)) }));
  return list(ctx, parts);
}

/** @param {FeatureContext} ctx */
export function conditionsText(ctx, actor, item, ids) {
  const reference = ctx.platform.i18n.localize("T20CP.CastingRestrictions.Conditions.Reference");
  return t(ctx, "Conditions.Warning", {
    actor: actor.name,
    item: item.name,
    conditions: list(ctx, ids.map((id) => statusName(ctx, id))),
    reference
  });
}

/**
 * Content of the concentration message, with the user-defined names escaped.
 * @param {FeatureContext} ctx
 * @param {{actor: object, item: object, check: {dc: number, reasons: string[]}}} params
 */
export function concentrationContent(ctx, { actor, item, check }) {
  const { i18n, utils } = ctx.platform;
  const escape = utils.escapeHTML;
  return `<p>${t(ctx, "Concentration.Message", {
    actor: escape(actor.name),
    item: escape(item.name),
    conditions: escape(list(ctx, check.reasons.map((id) => statusName(ctx, id)))),
    dc: check.dc,
    reference: escape(i18n.localize("T20CP.CastingRestrictions.Concentration.Reference"))
  })}</p>`;
}
