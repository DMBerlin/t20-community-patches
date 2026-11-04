import { addTooltipLine } from "../../lib/tooltip.mjs";
import {
  CONDITION_KEY,
  diagnoseHelperSource,
  hasConditionLines,
  helperBugs,
  missingDefenseCondition,
  rootForHelper
} from "./domain.mjs";

export const HELPER = "#helper:fieldBonuses";

function sheetActor(documents, root) {
  if (root?.actor?.system) return root.actor;
  return (root?.uuid && documents.fromUuidSync(root.uuid)) || documents.actors()?.get(root?.actor?._id) || null;
}

/** The helper's options with the root of a token sheet replaced (rootForHelper), or the same options. */
function helperOptions(options, root) {
  try {
    const fixed = rootForHelper(root);
    return fixed === root ? options : { ...options, data: { ...options.data, root: fixed } };
  } catch {
    return options;
  }
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const { platform } = ctx;
  const helpers = platform.handlebars.helpers();
  const original = helpers?.fieldBonuses;
  if (typeof original !== "function") throw new Error("Handlebars helper fieldBonuses not found");
  const bugs = helperBugs(platform.sourceOf(original) ?? undefined);
  if (!bugs.lookup && !bugs.noCondition) ctx.log.warn("fieldBonuses not recognized; nothing to fix");
  let warned = false;
  ctx.wrap(
    helpers,
    "fieldBonuses",
    function (original, path, options) {
      const root = options?.data?.root;
      const html = original.call(this, path, bugs.lookup ? helperOptions(options, root) : options);
      // field-bonuses-breakdown already listed the conditions by name.
      if (!bugs.noCondition || hasConditionLines(html)) return html;
      try {
        const condi = missingDefenseCondition(path, sheetActor(platform.documents, root)?.system?.attributes?.defesa);
        return condi ? addTooltipLine(html, platform.i18n.localize(CONDITION_KEY), condi) : html;
      } catch (err) {
        if (!warned) ctx.log.warn("could not add the Defesa condition", err);
        warned = true;
        return html;
      }
    },
    { label: "Handlebars.helpers.fieldBonuses" }
  );
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  return diagnoseHelperSource(ctx.platform.sourceOfMethod(HELPER) ?? undefined);
}
