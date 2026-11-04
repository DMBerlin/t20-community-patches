import { resolveEffectFromRow } from "../../lib/effect-rows.mjs";
import { toggleFlipsDisabled, toggleIconClasses, usesAutomaticToggle } from "./domain.mjs";

export const MANAGE = "ActiveEffectT20.onManageActiveEffect";

function fixToggles(platform, owner, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || !owner) return;
  const fromUuidSync = (uuid, options) => platform.documents.fromUuidSync(uuid, options);
  for (const li of root.querySelectorAll("li.effect[data-effect-id]")) {
    const anchor = li.querySelector('.effect-control[data-action="toggle"]');
    if (!anchor) continue;
    const effect = resolveEffectFromRow(li, owner, fromUuidSync);
    if (effect?.system?.onuse) fixToggle(platform, anchor, effect);
  }
}

function fixToggle(platform, anchor, effect) {
  if (usesAutomaticToggle(effect)) {
    const { add, remove } = toggleIconClasses(Boolean(effect.system.abilityUse?.automatic));
    const icon = anchor.querySelector("i");
    icon?.classList.remove(remove);
    icon?.classList.add(add);
    return;
  }
  // Item-held temporary usage effect: the toggle still flips `disabled`.
  anchor.title = `${platform.i18n.localize("T20.Toggle")} ${platform.i18n.localize("T20.Effect")}`;
}

/**
 * Runs after every synchronous render hook of the sheet, so rows of item effects listed on the actor sheet are
 * already annotated with their uuid by item-effects-on-actor-sheet, whatever the patch order. Effect ids repeat
 * across items created from the same source, so the uuid is the only unambiguous key.
 */
function scheduleFixToggles(ctx, owner, html) {
  queueMicrotask(() => {
    try {
      fixToggles(ctx.platform, owner, html);
    } catch (err) {
      ctx.log.error("failed to update toggles", err);
    }
  });
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const manage = ctx.platform.sourceOfMethod(MANAGE);
  return manage == null ? undefined : toggleFlipsDisabled(manage);
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const Legacy = ctx.platform.classes.sheetEffect;
  if (typeof Legacy?.onManageActiveEffect !== "function") throw new Error("ActiveEffectT20.onManageActiveEffect not found");
  const fromUuidSync = (uuid, options) => ctx.platform.documents.fromUuidSync(uuid, options);

  ctx.wrap(Legacy, "onManageActiveEffect", async function (manage, event, owner) {
    const anchor = event?.currentTarget;
    let effect = null;
    if (anchor?.dataset?.action === "toggle" && owner) {
      try {
        const li = anchor.closest?.("li");
        effect = li ? resolveEffectFromRow(li, owner, fromUuidSync) : null;
      } catch (err) {
        ctx.log.error("failed to resolve effect", err);
      }
    }
    if (usesAutomaticToggle(effect)) {
      event.preventDefault();
      return effect.update({ "system.abilityUse.automatic": !effect.system.abilityUse?.automatic });
    }
    return manage.call(this, event, owner);
  });

  ctx.hooks.on("renderActorSheetT20", (app, html) => scheduleFixToggles(ctx, app.actor, html));
  ctx.hooks.on("renderItemSheetT20", (app, html) => scheduleFixToggles(ctx, app.item, html));
}
