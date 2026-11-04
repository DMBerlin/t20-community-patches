/**
 * Sheet and chat hooks: item sheet, actor inventory, chat card snapshot (preCreateChatMessage) and its drawing.
 */
import { MODULE_ID } from "../../../lib/module.mjs";
import { FLAG, I18N, detailedStats, parseItemCard } from "../domain/index.mjs";
import { drawActorSheet, drawChatCard, drawItemSheet, rootOf } from "../ui.mjs";

/**
 * @param {import("../../../kernel/feature.mjs").FeatureContext} ctx
 * @param {ReturnType<typeof import("./engine.mjs").createEngine>} engine
 */
export function createSheetHandlers(ctx, engine) {
  const { platform } = ctx;
  const t = {
    i18n: (key, data) => {
      const full = `${I18N}.${key}`;
      return data ? platform.i18n.format(full, data) : platform.i18n.localize(full);
    },
    escape: (text) => platform.utils.escapeHTML(String(text ?? ""))
  };

  /** Item sheet (AppV1, jQuery html). */
  function renderItemSheet(app, html) {
    const mode = engine.mode();
    if (mode === "ends") return;
    const item = app?.item ?? app?.document;
    const root = rootOf(html);
    if (!item || !root?.querySelectorAll || !["arma", "equipamento"].includes(item.type)) return;
    drawItemSheet(item, root, mode, { statsOf: (doc) => engine.statsFor(doc, mode), t });
  }

  /** Actor sheet inventory rows. */
  function renderActorSheet(app, html) {
    const mode = engine.mode();
    if (mode === "ends") return;
    const actor = app?.actor ?? app?.document;
    const root = rootOf(html);
    if (!actor?.items || !root?.querySelectorAll) return;
    drawActorSheet(actor, root, (item) => engine.statsFor(item, mode), t);
  }

  /** preCreateChatMessage: snapshot of the item's effective stats in the card's flags. */
  function onPreCreateChatMessage(message, data) {
    if (engine.mode() === "ends") return;
    const content = data?.content ?? message?.content;
    if (typeof content !== "string" || !content.includes("item-card")) return;
    const card = parseItemCard(content);
    if (!card) return;
    const ChatMessageClass = platform.classes.chatMessage ?? platform.dice.ChatMessage;
    const actor = ChatMessageClass?.getSpeakerActor?.(message.speaker ?? data?.speaker);
    const item = actor?.items?.get?.(card.itemId);
    if (!item || !["arma", "equipamento"].includes(item.type)) return;
    const snapshot = detailedStats(engine.statsFor(item));
    if (!Object.keys(snapshot).length) return;
    message.updateSource({ [`flags.${MODULE_ID}.${FLAG}`]: snapshot });
  }

  /** renderChatMessageHTML (HTMLElement): draws the snapshot below the card header. */
  function renderChatMessage(message, html) {
    if (engine.mode() === "ends") return;
    const stats = message?.flags?.[MODULE_ID]?.[FLAG];
    const root = rootOf(html);
    if (!stats || typeof stats !== "object" || !root?.querySelector) return;
    drawChatCard(stats, root, t);
  }

  return { renderItemSheet, renderActorSheet, onPreCreateChatMessage, renderChatMessage };
}

/**
 * Registers the sheet and chat hooks; an error is logged and never reaches the system.
 * @param {import("../../../kernel/feature.mjs").FeatureContext} ctx
 * @param {ReturnType<typeof import("./engine.mjs").createEngine>} engine
 */
export function installSheets(ctx, engine) {
  const handlers = createSheetHandlers(ctx, engine);
  const guarded = (label, fn) => (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      ctx.log.error(label, err);
    }
    return undefined;
  };
  ctx.hooks.on("renderItemSheetT20", guarded("failed to draw the item sheet", handlers.renderItemSheet));
  ctx.hooks.on("renderActorSheetT20", guarded("failed to draw the inventory", handlers.renderActorSheet));
  ctx.hooks.on("preCreateChatMessage", guarded("failed to snapshot the chat card", handlers.onPreCreateChatMessage));
  ctx.hooks.on("renderChatMessageHTML", guarded("failed to draw the chat card", handlers.renderChatMessage));
}
