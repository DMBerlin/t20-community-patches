/** Foundry integration of the "Teste de resistência pelo card" rule (#58), only through ctx. */
import { MODULE_ID } from "../../lib/module.mjs";
import { targetRecord, USE_PURPOSES } from "../../lib/targets.mjs";
import { SAVE_BUTTON_SETTING, SAVE_FLAG, SAVE_RESULT_FLAG, buildSaveData, naturalD20, pendingKey, saveOutcome } from "./domain.mjs";
import { renderCard, renderResult } from "./ui.mjs";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

/** @param {FeatureContext} ctx */
function createRuntime(ctx) {
  const { platform } = ctx;
  const { i18n } = platform;
  return {
    ctx,
    platform,
    uses: ctx.services["use-targets"],
    /** @type {Map<string, Map<string, {id: string, timestamp: number, result: object, message: object}>> | null} */
    resultIndex: null,
    /** Rolls started on this client and not finished yet (dialog open, message being created). */
    pendingSaves: new Set(),
    isEnabled: () => ctx.setting(SAVE_BUTTON_SETTING) === "on",
    t: (key, data) => (data ? i18n.format(`T20CP.SaveButton.${key}`, data) : i18n.localize(`T20CP.SaveButton.${key}`)),
    skillLabel: (skill) => i18n.localize(platform.t20Config()?.resistencias?.[skill] ?? skill)
  };
}

function ensureIndex(rt) {
  if (rt.resultIndex) return rt.resultIndex;
  rt.resultIndex = new Map();
  for (const message of rt.platform.documents.messages() ?? []) track(rt, message);
  return rt.resultIndex;
}

/** @returns {string|null} The card id of the result, if the message is one. */
function track(rt, message) {
  const result = message.getFlag?.(MODULE_ID, SAVE_RESULT_FLAG);
  if (!result?.cardId) return null;
  let entries = rt.resultIndex.get(result.cardId);
  if (!entries) rt.resultIndex.set(result.cardId, (entries = new Map()));
  entries.set(message.id, { id: message.id, timestamp: message.timestamp ?? 0, result, message });
  return result.cardId;
}

function untrack(rt, message) {
  for (const [cardId, entries] of rt.resultIndex) if (entries.delete(message.id)) return cardId;
  return null;
}

// ChatLog#updateMessage redraws the log and its popout, but not a card opened in its own window.
function redrawMessage(rt, message) {
  rt.platform.chat.updateMessage(message);
  message.render?.(false);
}

function redrawCard(rt, cardId) {
  const card = cardId ? rt.platform.documents.messages().get(cardId) : null;
  if (card) redrawMessage(rt, card);
}

function onResultChanged(rt, message) {
  ensureIndex(rt);
  const before = untrack(rt, message);
  const after = track(rt, message);
  for (const cardId of new Set([before, after])) redrawCard(rt, cardId);
}

function onResultDeleted(rt, message) {
  ensureIndex(rt);
  rt.resultIndex.delete(message.id);
  redrawCard(rt, untrack(rt, message));
}

async function rollSaveFor(rt, { card, tokenUuid, save, event }) {
  if (!rt.isEnabled()) return;
  const key = pendingKey(card.id, tokenUuid, save.skill);
  if (rt.pendingSaves.has(key)) return;
  const data = card.getFlag(MODULE_ID, SAVE_FLAG);
  const token = rt.platform.documents.fromUuidSync(tokenUuid);
  const actor = token?.actor;
  if (!data || !actor?.isOwner || !actor.system?.pericias?.[save.skill]) return;
  const target = data.targets?.find((record) => record.uuid === tokenUuid) ?? targetRecord(token);
  rt.pendingSaves.add(key);
  redrawCard(rt, card.id);
  try {
    const message = await actor.rollPericia(save.skill, { event });
    if (message?.documentName !== "ChatMessage" || !message.isOwner) return;
    const roll = message.rolls?.[0];
    const natural = naturalD20(roll);
    const outcome = saveOutcome({ total: roll?.total, natural, dc: data.dc });
    if (!outcome) return;
    await message.setFlag(MODULE_ID, SAVE_RESULT_FLAG, {
      cardId: card.id,
      itemName: data.itemName,
      casterType: data.casterType,
      tokenUuid,
      target,
      skill: save.skill,
      effect: save.effect,
      dc: data.dc,
      total: roll.total,
      natural,
      success: outcome.success
    });
  } finally {
    rt.pendingSaves.delete(key);
    redrawCard(rt, card.id);
  }
}

function onRender(rt, message, html) {
  try {
    if (!rt.isEnabled() || !message.isContentVisible) return;
    const save = message.getFlag(MODULE_ID, SAVE_FLAG);
    if (save) {
      const entries = ensureIndex(rt).get(message.id)?.values() ?? [];
      const rollSave = (card, tokenUuid, entrySave, event) => rollSaveFor(rt, { card, tokenUuid, save: entrySave, event });
      renderCard(rt, { card: message, html, save, entries, rollSave });
    }
    const result = message.getFlag(MODULE_ID, SAVE_RESULT_FLAG);
    if (result) renderResult(rt, html, result);
  } catch (err) {
    rt.ctx.log.error("Failed to render the save buttons", err);
  }
}

function redrawAll(rt) {
  for (const message of rt.platform.documents.messages() ?? []) {
    const flags = message.flags?.[MODULE_ID];
    if (flags?.[SAVE_FLAG] || flags?.[SAVE_RESULT_FLAG]) redrawMessage(rt, message);
  }
}

/** @param {object} rt  The runtime of this install. */
function displayCardWrapper(rt) {
  const { ctx, uses } = rt;
  return async function (original, params = {}, ...rest) {
    let save = null;
    try {
      if (rt.isEnabled() && uses.usePurposeOf(this) !== USE_PURPOSES.MANEUVER_RESISTANCE) {
        save = buildSaveData({
          txt: this.system?.resistencia?.txt,
          dc: this.system?.resistencia?.cd,
          itemName: this.name,
          casterType: this.actor?.type,
          // Records frozen when ItemT20#roll started (shared use context), before any dialog, attack or damage roll.
          targets: uses.useTargetRecords(this)
        });
      }
    } catch (err) {
      ctx.log.error(`Failed to read the save of ${this.name}`, err);
    }
    if (!save) return original.call(this, params, ...rest);
    const createMessage = params?.createMessage ?? true;
    const chatData = await original.call(this, { ...params, createMessage: false }, ...rest);
    if (!chatData || typeof chatData !== "object") return chatData;
    ctx.platform.utils.setProperty(chatData, `flags.${MODULE_ID}.${SAVE_FLAG}`, save);
    return createMessage ? ctx.platform.chat.create(chatData) : chatData;
  };
}

/**
 * Installs the rule. The setting is read on every use, so a change applies without reloading.
 * @param {FeatureContext} ctx
 */
export function install(ctx) {
  const rt = createRuntime(ctx);
  rt.uses.registerTargetConsumer(rt.isEnabled);
  const proto = ctx.platform.classes.item?.prototype;
  if (typeof proto?.displayCard !== "function") throw new Error("ItemT20#displayCard not found");
  ctx.wrap(proto, "displayCard", displayCardWrapper(rt));

  ctx.onSettingChange(SAVE_BUTTON_SETTING, () => redrawAll(rt));
  ctx.hooks.on("renderChatMessageHTML", (message, html) => onRender(rt, message, html));
  ctx.hooks.on("createChatMessage", (message) => onResultChanged(rt, message));
  ctx.hooks.on("updateChatMessage", (message) => onResultChanged(rt, message));
  ctx.hooks.on("deleteChatMessage", (message) => onResultDeleted(rt, message));
}
