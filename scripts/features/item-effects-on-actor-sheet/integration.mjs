import { resolveEffectFromRow } from "../../lib/effect-rows.mjs";
import { buildRowQueue, diagnoseItemEffectsSheet, isItemHeldEffect } from "./domain.mjs";

const ROWS = "_t20cpEffectRows";

export const SOURCES = ["ActorSheetT20#getData", "ActiveEffectT20.onManageActiveEffect"];

function findActorSheetBase(platform) {
  const ActorSheet = platform.core.ActorSheetV1;
  if (!ActorSheet) return null;
  let cls = platform.t20()?.applications?.ActorSheetT20Character;
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

async function confirmItemEffectDeletion(platform, effect) {
  const { i18n, utils } = platform;
  return platform.dice.DialogV2.confirm({
    window: { title: i18n.localize("T20CP.ItemEffects.DeleteTitle") },
    content: `<p>${i18n.format("T20CP.ItemEffects.DeleteContent", {
      effect: utils.escapeHTML(effect.name),
      item: utils.escapeHTML(effect.parent.name)
    })}</p>`,
    rejectClose: false,
    modal: true
  });
}

/**
 * The effect an Edit/Toggle/Delete control acts on, when it is held by another document than the sheet's owner.
 * @returns {{effect: object, action: string}|null}
 */
function itemEffectOfControl(event, owner, fromUuidSync) {
  const anchor = event?.currentTarget;
  const li = anchor?.closest?.("li");
  const action = anchor?.dataset?.action;
  if (!li || !owner || !["edit", "toggle", "delete"].includes(action)) return null;
  const effect = resolveEffectFromRow(li, owner, fromUuidSync);
  return effect?.parent && effect.parent !== owner ? { effect, action } : null;
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  return diagnoseItemEffectsSheet(...SOURCES.map((label) => ctx.platform.sourceOfMethod(label) ?? undefined));
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const { platform } = ctx;
  const fromUuidSync = (uuid, options) => platform.documents.fromUuidSync(uuid, options);
  const Legacy = platform.classes.sheetEffect;
  const ActorSheetBase = findActorSheetBase(platform);
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
  ctx.wrap(ActorSheetBase.prototype, "getData", async function (getData, ...args) {
    const data = await getData.apply(this, args);
    if (!data?.effects || typeof this.actor?.allApplicableEffects !== "function") return data;
    try {
      const effects = await Legacy.prepareActiveEffectCategories(Array.from(this.actor.allApplicableEffects()));
      data.effects = effects;
      this[ROWS] = buildRowQueue(effects);
    } catch (err) {
      this[ROWS] = undefined;
      ctx.log.error("failed to list item effects", err);
    }
    return data;
  });

  // 2) DOM: runs after activateListeners for every T20 actor sheet (including non-editable NPC sheets).
  ctx.hooks.on(`render${ActorSheetBase.name}`, annotateRows);

  // 3) Controls: act on the effect's real parent.
  ctx.wrap(Legacy, "onManageActiveEffect", async function (manage, event, owner) {
    const target = itemEffectOfControl(event, owner, fromUuidSync);
    if (!target) return manage.call(this, event, owner);
    if (target.action === "delete") {
      event.preventDefault();
      if (!(await confirmItemEffectDeletion(platform, target.effect))) return;
    }
    return manage.call(this, event, target.effect.parent);
  });

  // 4) Drag: core ActorSheet#_onDragStart only looks at actor.effects.
  ctx.wrap(ActorSheetBase.prototype, "_onDragStart", function (onDragStart, event) {
    const li = event?.currentTarget;
    if (li?.dataset?.effectUuid) {
      const effect = resolveEffectFromRow(li, this.actor, fromUuidSync);
      if (effect && effect.parent !== this.actor) {
        event.dataTransfer.setData("text/plain", JSON.stringify(effect.toDragData()));
        return;
      }
    }
    return onDragStart.call(this, event);
  });
}
