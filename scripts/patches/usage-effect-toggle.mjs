/**
 * Usage effect toggle (tormenta20 1.6.5).
 *
 * Bug: on usage effect rows the sheet toggle is titled "Toggle Always Apply" but flips `disabled`, which usage
 * effects ignore (all of them are stored with disabled=true by design); the icon also follows `disabled`.
 * "Always Apply" (system.abilityUse.automatic), the field used to pre-select/auto-apply usage effects, can only
 * be changed in the effect configuration.
 *
 * Fix: the toggle of usage rows flips system.abilityUse.automatic and the icon reflects it. Temporary usage
 * effects held by items keep toggling `disabled` (default vs optional application on the chat card).
 */
import { MODULE_ID, markWrapper, sheetEffectClass, unwrap } from "../utils.mjs";
import { resolveEffectFromRow } from "../effect-rows.mjs";

/**
 * Whether the sheet toggle of this effect should mean "Always Apply".
 * @param {object} effect
 * @returns {boolean}
 */
export function usesAutomaticToggle(effect) {
  if (!effect?.system?.onuse) return false;
  return !(effect.isTemporary && effect.parent?.documentName === "Item");
}

/**
 * Icon classes for a usage toggle.
 * @param {boolean} automatic
 * @returns {{add: string, remove: string}}
 */
export function toggleIconClasses(automatic) {
  return automatic ? { add: "fa-square-check", remove: "fa-square" } : { add: "fa-square", remove: "fa-square-check" };
}

/**
 * Inspects the source of ActiveEffectT20.onManageActiveEffect: true when the toggle still flips `disabled` for
 * every effect, false when it already knows about "Always Apply", undefined otherwise.
 * @param {string} source
 * @returns {boolean|undefined}
 */
export function toggleFlipsDisabled(source) {
  if (typeof source !== "string") return undefined;
  if (source.includes("abilityUse.automatic")) return false;
  if (/case\s*["']toggle["']\s*:\s*return\s+effect\.update\(\s*\{\s*disabled\s*:\s*!\s*effect\.disabled\s*\}\s*\)/.test(source)) {
    return true;
  }
  return undefined;
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function fixToggles(owner, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || !owner) return;
  for (const li of root.querySelectorAll("li.effect[data-effect-id]")) {
    const anchor = li.querySelector('.effect-control[data-action="toggle"]');
    if (!anchor) continue;
    const effect = resolveEffectFromRow(li, owner);
    if (!effect?.system?.onuse) continue;
    if (usesAutomaticToggle(effect)) {
      const { add, remove } = toggleIconClasses(Boolean(effect.system.abilityUse?.automatic));
      const icon = anchor.querySelector("i");
      icon?.classList.remove(remove);
      icon?.classList.add(add);
    } else {
      // Item-held temporary usage effect: the toggle still flips `disabled`.
      anchor.title = `${game.i18n.localize("T20.Toggle")} ${game.i18n.localize("T20.Effect")}`;
    }
  }
}

/**
 * Runs after every synchronous render hook of the sheet, so rows of item effects listed on the actor sheet are
 * already annotated with their uuid by item-effects-on-actor-sheet, whatever the patch order. Effect ids repeat
 * across items created from the same source, so the uuid is the only unambiguous key.
 */
function scheduleFixToggles(owner, html) {
  queueMicrotask(() => {
    try {
      fixToggles(owner, html);
    } catch (err) {
      console.error(`${MODULE_ID} | usage-effect-toggle: failed to update toggles`, err);
    }
  });
}

function isNeeded() {
  const manage = unwrap(sheetEffectClass()?.onManageActiveEffect);
  return typeof manage === "function" ? toggleFlipsDisabled(Function.prototype.toString.call(manage)) : undefined;
}

function apply() {
  const Legacy = sheetEffectClass();
  if (typeof Legacy?.onManageActiveEffect !== "function") throw new Error("ActiveEffectT20.onManageActiveEffect not found");

  const manage = Legacy.onManageActiveEffect;
  Legacy.onManageActiveEffect = markWrapper(async function (event, owner) {
    const anchor = event?.currentTarget;
    let effect = null;
    if (anchor?.dataset?.action === "toggle" && owner) {
      try {
        const li = anchor.closest?.("li");
        effect = li ? resolveEffectFromRow(li, owner) : null;
      } catch (err) {
        console.error(`${MODULE_ID} | usage-effect-toggle: failed to resolve effect`, err);
      }
    }
    if (usesAutomaticToggle(effect)) {
      event.preventDefault();
      return effect.update({ "system.abilityUse.automatic": !effect.system.abilityUse?.automatic });
    }
    return manage.call(this, event, owner);
  }, manage);

  Hooks.on("renderActorSheetT20", (app, html) => scheduleFixToggles(app.actor, html));
  Hooks.on("renderItemSheetT20", (app, html) => scheduleFixToggles(app.item, html));
}

export default {
  id: "usage-effect-toggle",
  group: "sheet-effects",
  issue: 5,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  apply
};
