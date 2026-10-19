/**
 * Item effects on the actor sheet (tormenta20 1.6.5, GitLab #101 part 1).
 *
 * Bug: ActorSheetT20#getData lists only `actor.effects`. Since Foundry v11 transferred item effects are applied
 * from the item and are no longer copied to the actor, so they never appear on the actor sheet, and the effect
 * controls/drag resolve the effect on the actor only.
 *
 * Fix: the effects tab lists `actor.allApplicableEffects()` (actor effects + item effects with transfer, the
 * same set Foundry v10 showed). Rows of item effects show the item as source; Toggle/Edit/Delete (with
 * confirmation) and drag act on the effect inside the item.
 */
import { MODULE_ID, markWrapper, stripComments, unwrap } from "../utils.mjs";
import { resolveEffectFromRow } from "../effect-rows.mjs";

/**
 * Groups the categorized effects by id, in render order (category key order, then insertion order).
 * @param {Record<string, {effects: object[]}>} categories
 * @returns {Map<string, object[]>}
 */
export function buildRowQueue(categories) {
  const queue = new Map();
  for (const category of Object.values(categories ?? {})) {
    for (const effect of category?.effects ?? []) {
      if (!queue.has(effect.id)) queue.set(effect.id, []);
      queue.get(effect.id).push(effect);
    }
  }
  return queue;
}

/**
 * Whether the effect is held by an item of the actor (not by the actor itself).
 * @param {{parent?: object}} effect
 * @param {object} actor
 * @returns {boolean}
 */
export function isItemHeldEffect(effect, actor) {
  return Boolean(effect?.parent) && effect.parent !== actor && effect.parent.documentName === "Item";
}

/**
 * Reads the sources of ActorSheetT20#getData (listing) and ActiveEffectT20.onManageActiveEffect (controls).
 * The patch fixes both, so a fix of the listing alone is not a fix. Comments are ignored, and unrecognized code
 * (for example another module's wrapper) gives "unknown". Only reading code, a fix is never high-confidence.
 * @param {string|undefined} getData
 * @param {string|undefined} manage
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseItemEffectsSheet(getData, manage) {
  if (typeof getData !== "string") return { bug: "unknown", confidence: "low", evidence: "getData source unavailable" };
  const listing = stripComments(getData);
  if (/prepareActiveEffectCategories\(\s*this\.actor\.effects\s*\)/.test(listing)) {
    return { bug: "present", confidence: "high", evidence: "getData lists only actor.effects" };
  }
  if (!/allApplicableEffects\s*\(/.test(listing)) {
    return { bug: "unknown", confidence: "low", evidence: "getData source not recognized" };
  }
  const actions = typeof manage === "string" ? stripComments(manage) : "";
  if (/owner\.effects\.get\s*\(/.test(actions)) {
    return {
      bug: "present",
      confidence: "low",
      evidence: "getData uses allApplicableEffects, but effect controls still resolve through owner.effects"
    };
  }
  if (!/dataset\.action/.test(actions)) {
    return { bug: "unknown", confidence: "low", evidence: "onManageActiveEffect source not recognized" };
  }
  return {
    bug: "fixed",
    confidence: "low",
    evidence: "getData uses allApplicableEffects and effect controls no longer use owner.effects"
  };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const ROWS = "_t20cpEffectRows";

function findActorSheetBase() {
  const ActorSheet = globalThis.foundry?.appv1?.sheets?.ActorSheet;
  if (!ActorSheet) return null;
  let cls = globalThis.tormenta20?.applications?.ActorSheetT20Character;
  while (cls && Object.getPrototypeOf(cls) !== ActorSheet) cls = Object.getPrototypeOf(cls);
  return cls ?? null;
}

function annotateRows(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const actor = app.actor;
  if (!root || !actor) return;
  const queue = new Map([...(app[ROWS] ?? new Map())].map(([id, list]) => [id, [...list]]));
  for (const li of root.querySelectorAll("li.effect[data-effect-id]")) {
    const effect = queue.get(li.dataset.effectId)?.shift() ?? actor.effects.get(li.dataset.effectId);
    if (!effect) continue;
    li.dataset.effectUuid = effect.uuid;
    if (!isItemHeldEffect(effect, actor)) continue;
    li.classList.add("t20cp-item-effect");
    const source = li.querySelector(".effect-source");
    if (source) source.textContent = effect.parent.name;
    else li.dataset.tooltip = effect.parent.name; // usage rows have no source column
  }
}

async function confirmItemEffectDeletion(effect) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("T20CP.ItemEffects.DeleteTitle") },
    content: `<p>${game.i18n.format("T20CP.ItemEffects.DeleteContent", {
      effect: foundry.utils.escapeHTML(effect.name),
      item: foundry.utils.escapeHTML(effect.parent.name)
    })}</p>`,
    rejectClose: false,
    modal: true
  });
}

function isNeeded() {
  const source = (fn) => (typeof fn === "function" ? Function.prototype.toString.call(unwrap(fn)) : undefined);
  return diagnoseItemEffectsSheet(
    source(findActorSheetBase()?.prototype?.getData),
    source(globalThis.tormenta20?.entities?.ActiveEffectT20?.onManageActiveEffect)
  );
}

function apply() {
  const Legacy = globalThis.tormenta20?.entities?.ActiveEffectT20;
  const ActorSheetBase = findActorSheetBase();
  if (
    !ActorSheetBase ||
    !Object.hasOwn(ActorSheetBase.prototype, "getData") ||
    !Object.hasOwn(ActorSheetBase.prototype, "_onDragStart") ||
    typeof Legacy?.prepareActiveEffectCategories !== "function" ||
    typeof Legacy?.onManageActiveEffect !== "function"
  ) {
    throw new Error("Tormenta20 actor sheet or ActiveEffectT20 API not found");
  }

  // 1) Data: list actor effects + transferred item effects.
  const getData = ActorSheetBase.prototype.getData;
  ActorSheetBase.prototype.getData = markWrapper(async function (...args) {
    const data = await getData.apply(this, args);
    if (!data?.effects || typeof this.actor?.allApplicableEffects !== "function") return data;
    try {
      const effects = await Legacy.prepareActiveEffectCategories(Array.from(this.actor.allApplicableEffects()));
      data.effects = effects;
      this[ROWS] = buildRowQueue(effects);
    } catch (err) {
      this[ROWS] = undefined;
      console.error(`${MODULE_ID} | item-effects-on-actor-sheet: failed to list item effects`, err);
    }
    return data;
  }, getData);

  // 2) DOM: runs after activateListeners for every T20 actor sheet (including non-editable NPC sheets).
  Hooks.on(`render${ActorSheetBase.name}`, annotateRows);

  // 3) Controls: act on the effect's real parent.
  const manage = Legacy.onManageActiveEffect;
  Legacy.onManageActiveEffect = markWrapper(async function (event, owner) {
    const anchor = event?.currentTarget;
    const li = anchor?.closest?.("li");
    const action = anchor?.dataset?.action;
    if (li && owner && ["edit", "toggle", "delete"].includes(action)) {
      const effect = resolveEffectFromRow(li, owner);
      if (effect?.parent && effect.parent !== owner) {
        if (action === "delete") {
          event.preventDefault();
          if (!(await confirmItemEffectDeletion(effect))) return;
        }
        return manage.call(this, event, effect.parent);
      }
    }
    return manage.call(this, event, owner);
  }, manage);

  // 4) Drag: core ActorSheet#_onDragStart only looks at actor.effects.
  const onDragStart = ActorSheetBase.prototype._onDragStart;
  ActorSheetBase.prototype._onDragStart = function (event) {
    const li = event?.currentTarget;
    if (li?.dataset?.effectUuid) {
      const effect = resolveEffectFromRow(li, this.actor);
      if (effect && effect.parent !== this.actor) {
        event.dataTransfer.setData("text/plain", JSON.stringify(effect.toDragData()));
        return;
      }
    }
    return onDragStart.call(this, event);
  };
}

export default {
  id: "item-effects-on-actor-sheet",
  group: "sheet-effects",
  issue: 2,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  apply
};
