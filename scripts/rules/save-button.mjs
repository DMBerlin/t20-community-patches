/**
 * Optional rule "Teste de resistência pelo card" (#58).
 *
 * The system prints "Reflexos reduz à metade (CD 21)" on the card of items with a saving throw, but nobody can roll
 * against it from the chat. When the rule is on, the item card records the save (skills, effects, DC) and the
 * tokens the user targeted. The card lists the targets with a roll button per skill; the owner of each target (the
 * GM for NPCs) rolls the system's skill test, the roll message stores the outcome and every client redraws the card.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";
import {
  canSeeTokenName,
  installUseTargets,
  registerTargetConsumer,
  targetRecord,
  useTargetRecords,
  usePurposeOf,
  USE_PURPOSES
} from "./shared/targets.mjs";

export const SAVE_BUTTON_SETTING = "saveButtonRule";
export const SAVE_FLAG = "save";
export const SAVE_RESULT_FLAG = "saveResult";

const SKILL_PATTERNS = [
  ["fort", "\\bfort(?:itude)?\\b"],
  // "Relfexos" is a typo in the compendium data (Erupção Glacial).
  ["refl", "\\bre(?:fl|lf)exos?\\b|\\brefl\\b"],
  ["vont", "\\bvont(?:ade)?\\b"]
];
const EFFECT_PATTERNS = [
  ["metade", /\bmetade\b/],
  // "anual" is a typo in the compendium data (Possessão).
  ["anula", /\banula\b|\banual\b/],
  ["parcial", /\bparcial\b/],
  ["desacredita", /\bdesacredita\b/],
  ["evita", /\bevita\b/]
];
const HEALING_FLAVORS = new Set(["curapv", "curatpv", "curapm", "curatpm"]);

/** @param {unknown} text */
export function normalizeSaveText(text) {
  return String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Skills and effects written in the free-text save of an item ("Vontade anula, Fortitude parcial").
 * @param {unknown} text
 * @returns {{skill: "fort"|"refl"|"vont", effect: "metade"|"anula"|"parcial"|"desacredita"|"evita"|null}[]}
 */
export function parseSaveText(text) {
  const norm = normalizeSaveText(text);
  const hits = [];
  for (const [skill, source] of SKILL_PATTERNS) {
    for (const match of norm.matchAll(new RegExp(source, "g"))) {
      hits.push({ skill, start: match.index, end: match.index + match[0].length });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const saves = [];
  hits.forEach((hit, i) => {
    if (saves.some((save) => save.skill === hit.skill)) return;
    const segment = norm.slice(hit.end, hits[i + 1]?.start ?? norm.length);
    const effect = EFFECT_PATTERNS.find(([, re]) => re.test(segment))?.[0] ?? null;
    saves.push({ skill: hit.skill, effect });
  });
  return saves;
}

/**
 * Data stored on the item card, or null when there is nothing to roll.
 * @param {{txt?: unknown, dc?: unknown, itemName?: string, casterType?: string,
 *   targets?: ({uuid: string, name: string, displayName: number} | null)[]}} params
 */
export function buildSaveData({ txt, dc, itemName = "", casterType = "", targets = [] }) {
  const saves = parseSaveText(txt);
  const value = Number(dc);
  if (!saves.length || !Number.isFinite(value) || value <= 0) return null;
  const unique = new Map();
  for (const target of targets ?? []) if (target?.uuid && !unique.has(target.uuid)) unique.set(target.uuid, target);
  return { text: String(txt), dc: value, itemName: String(itemName ?? ""), casterType: String(casterType ?? ""), saves, targets: [...unique.values()] };
}

/**
 * The natural d20 of a test, or null when the first die is not a single kept d20.
 * @param {{dice?: {faces?: number, results?: {result: number, active?: boolean, discarded?: boolean}[]}[]}} roll
 */
export function naturalD20(roll) {
  const die = roll?.dice?.[0];
  if (die?.faces !== 20) return null;
  const kept = (die.results ?? []).filter((r) => r.active !== false && !r.discarded);
  return kept.length === 1 ? Number(kept[0].result) : null;
}

/**
 * Book p. 220-221: pass with total >= DC; a natural 20 always passes and a natural 1 always fails.
 * @param {{total: unknown, natural: number|null, dc: unknown}} params
 * @returns {{success: boolean, auto: boolean} | null}
 */
export function saveOutcome({ total, natural, dc }) {
  const value = Number(dc);
  const sum = Number(total);
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(sum)) return null;
  if (natural === 20) return { success: true, auto: true };
  if (natural === 1) return { success: false, auto: true };
  return { success: sum >= value, auto: false };
}

/** Same rule as ChatMessageT20#_hideDC. */
export function shouldHideDc({ showFoeDc, isGM, casterType }) {
  return !showFoeDc && !isGM && Boolean(casterType) && casterType !== "character";
}

export function resultKey(tokenUuid, skill) {
  return `${tokenUuid}|${skill}`;
}

export function pendingKey(cardId, tokenUuid, skill) {
  return `${cardId}|${tokenUuid}|${skill}`;
}

/**
 * Latest result per target and skill; ties go to the greater message id, so every client agrees.
 * @template {{id: string, timestamp: number, result: {tokenUuid?: string, skill?: string}}} T
 * @param {Iterable<T>} entries
 * @returns {Map<string, T>}
 */
export function latestResults(entries) {
  const latest = new Map();
  for (const entry of entries ?? []) {
    const { tokenUuid, skill } = entry?.result ?? {};
    if (!tokenUuid || !skill) continue;
    const key = resultKey(tokenUuid, skill);
    const previous = latest.get(key);
    const newer = !previous
      || entry.timestamp > previous.timestamp
      || (entry.timestamp === previous.timestamp && entry.id > previous.id);
    if (newer) latest.set(key, entry);
  }
  return latest;
}

/** @returns {number|null}  Damage multiplier for a "reduz à metade" save, null for any other effect. */
export function damageMultiplier({ effect, success }) {
  if (effect !== "metade") return null;
  return success ? 0.5 : 1;
}

/**
 * The single damage roll of a card, or null (none, several, or healing).
 * @param {{options?: {type?: string}, terms?: {options?: {flavor?: string}}[]}[]} rolls
 */
export function pickDamageRoll(rolls) {
  const damage = (rolls ?? []).filter((roll) => roll?.options?.type === "damage");
  if (damage.length !== 1) return null;
  const healing = (damage[0].terms ?? []).some((term) => HEALING_FLAVORS.has(term?.options?.flavor));
  return healing ? null : damage[0];
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const isEnabled = () => game.settings.get(MODULE_ID, SAVE_BUTTON_SETTING) === "on";
const t = (key, data) => (data ? game.i18n.format(`T20CP.SaveButton.${key}`, data) : game.i18n.localize(`T20CP.SaveButton.${key}`));
const skillLabel = (skill) => game.i18n.localize(CONFIG.T20?.resistencias?.[skill] ?? skill);

/** @type {Map<string, Map<string, {id: string, timestamp: number, result: object, message: ChatMessage}>> | null} */
let resultIndex = null;
/** Rolls started on this client and not finished yet (dialog open, message being created). */
const pendingSaves = new Set();

function ensureIndex() {
  if (resultIndex) return resultIndex;
  resultIndex = new Map();
  for (const message of game.messages ?? []) track(message);
  return resultIndex;
}

/** @returns {string|null} The card id of the result, if the message is one. */
function track(message) {
  const result = message.getFlag?.(MODULE_ID, SAVE_RESULT_FLAG);
  if (!result?.cardId) return null;
  let entries = resultIndex.get(result.cardId);
  if (!entries) resultIndex.set(result.cardId, (entries = new Map()));
  entries.set(message.id, { id: message.id, timestamp: message.timestamp ?? 0, result, message });
  return result.cardId;
}

function untrack(message) {
  for (const [cardId, entries] of resultIndex) if (entries.delete(message.id)) return cardId;
  return null;
}

// ChatLog#updateMessage redraws the log and its popout, but not a card opened in its own window.
function redrawMessage(message) {
  ui.chat?.updateMessage(message);
  message.render?.(false);
}

function redrawCard(cardId) {
  const card = cardId ? game.messages.get(cardId) : null;
  if (card) redrawMessage(card);
}

function onResultChanged(message) {
  ensureIndex();
  const before = untrack(message);
  const after = track(message);
  for (const cardId of new Set([before, after])) redrawCard(cardId);
}

function onResultDeleted(message) {
  ensureIndex();
  resultIndex.delete(message.id);
  redrawCard(untrack(message));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, onClick, { disabled = false, tooltip } = {}) {
  const node = el("button", "t20cp-save-button", label);
  node.type = "button";
  node.disabled = disabled;
  if (tooltip) node.dataset.tooltip = tooltip;
  node.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    node.disabled = true;
    try {
      await onClick(event);
    } catch (err) {
      console.error(`${MODULE_ID} | Save button failed`, err);
      ui.notifications.error(t("RollFailed"));
    } finally {
      if (node.isConnected) node.disabled = false;
    }
  });
  return node;
}

function dcLabel(save) {
  const hide = shouldHideDc({
    showFoeDc: game.settings.get("tormenta20", "showFoeDc"),
    isGM: game.user.isGM,
    casterType: save.casterType
  });
  return hide ? "??" : String(save.dc);
}

async function rollSaveFor(card, tokenUuid, save, event) {
  if (!isEnabled()) return;
  const key = pendingKey(card.id, tokenUuid, save.skill);
  if (pendingSaves.has(key)) return;
  const data = card.getFlag(MODULE_ID, SAVE_FLAG);
  const token = foundry.utils.fromUuidSync(tokenUuid);
  const actor = token?.actor;
  if (!data || !actor?.isOwner || !actor.system?.pericias?.[save.skill]) return;
  const target = data.targets?.find((record) => record.uuid === tokenUuid) ?? targetRecord(token);
  pendingSaves.add(key);
  redrawCard(card.id);
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
    pendingSaves.delete(key);
    redrawCard(card.id);
  }
}

function outcomeText(result) {
  const parts = [t(result.success ? "Success" : "Failure")];
  if (result.natural === 20) parts.push(t("Natural20"));
  else if (result.natural === 1) parts.push(t("Natural1"));
  return parts.join(" ");
}

function renderOutcome(card, entry, actor, save) {
  const node = el("span", "t20cp-save-outcome");
  if (!entry.message.isContentVisible) {
    node.textContent = t("Hidden");
    return node;
  }
  const { result } = entry;
  node.classList.add(result.success ? "success" : "failure");
  node.append(el("strong", "", `${result.total} · ${outcomeText(result)}`));
  if (result.success && save.effect) node.append(el("span", "t20cp-save-effect", t(`Effect.${save.effect}`)));
  const multiplier = damageMultiplier({ effect: save.effect, success: result.success });
  const roll = multiplier === null ? null : pickDamageRoll(card.rolls);
  if (roll && actor?.isOwner) {
    node.append(button(t(multiplier === 1 ? "ApplyDamage" : "ApplyHalfDamage"), () => actor.applyDamageV2(roll, multiplier)));
  }
  return node;
}

/** Always the recorded name; ownership and display mode are read live to decide whether to show it. */
function tokenName(token, record, index) {
  if (!record) return t("Unavailable");
  const visible = canSeeTokenName({
    isGM: game.user.isGM,
    isOwner: Boolean(token?.isOwner),
    displayName: token ? token.displayName : record.displayName
  });
  const name = visible ? record.name : t("Target", { n: index + 1 });
  return token ? name : `${name} ${t("UnavailableSuffix")}`;
}

function renderCard(card, html, save) {
  const host = html.querySelector(".chat-card.item-card") ?? html.querySelector(".message-content");
  if (!host) return;
  const dc = dcLabel(save);
  const results = latestResults(ensureIndex().get(card.id)?.values() ?? []);
  const records = new Map((save.targets ?? []).map((target) => [target.uuid, target]));
  for (const entry of results.values()) {
    const record = entry.result.target;
    if (record?.uuid && !records.has(record.uuid)) records.set(record.uuid, record);
  }
  const tokens = [...new Set([...records.keys(), ...[...results.values()].map((e) => e.result.tokenUuid)])];

  const footer = el("footer", "t20cp-save flexcol");
  const title = el("div", "t20cp-save-title", `${t("Title")}: ${t("Header", { text: save.text, dc })}`);
  title.dataset.tooltip = t("Reference");
  footer.append(title);

  tokens.forEach((uuid, index) => {
    const token = foundry.utils.fromUuidSync(uuid);
    const actor = token?.actor ?? null;
    const row = el("div", "t20cp-save-row flexrow");
    row.append(el("span", "t20cp-save-name", tokenName(token, records.get(uuid), index)));
    for (const entrySave of save.saves) {
      const entry = results.get(resultKey(uuid, entrySave.skill));
      const canRoll = Boolean(actor?.isOwner && actor.system?.pericias?.[entrySave.skill]);
      const pending = pendingSaves.has(pendingKey(card.id, uuid, entrySave.skill));
      const roll = (event) => rollSaveFor(card, uuid, entrySave, event);
      if (entry) {
        row.append(renderOutcome(card, entry, actor, entrySave));
        if (canRoll) row.append(button("↻", roll, { tooltip: t("Reroll"), disabled: pending }));
      } else {
        row.append(button(t("Roll", { skill: skillLabel(entrySave.skill), dc }), roll, { disabled: !canRoll || pending }));
      }
    }
    footer.append(row);
  });

  if (!tokens.length) footer.append(el("p", "t20cp-save-hint", t("NoTargets")));
  for (const entrySave of save.saves) {
    footer.append(button(t("RollSelected", { skill: skillLabel(entrySave.skill) }), async (event) => {
      const tokens = (canvas.tokens?.controlled ?? []).filter((token) => token.actor?.isOwner);
      if (!tokens.length) return ui.notifications.warn(t("NoSelection"));
      for (const token of tokens) await rollSaveFor(card, token.document.uuid, entrySave, event);
    }));
  }
  host.append(footer);
}

function renderResult(message, html, result) {
  const host = html.querySelector(".message-content");
  if (!host) return;
  const line = el("div", `t20cp-save-result ${result.success ? "success" : "failure"}`);
  line.append(el("strong", "", t("Against", { item: result.itemName, dc: dcLabel(result), outcome: outcomeText(result) })));
  if (result.success && result.effect) line.append(el("span", "t20cp-save-effect", ` ${t(`Effect.${result.effect}`)}`));
  host.append(line);
}

function onRender(message, html) {
  try {
    if (!isEnabled() || !message.isContentVisible) return;
    const save = message.getFlag(MODULE_ID, SAVE_FLAG);
    if (save) renderCard(message, html, save);
    const result = message.getFlag(MODULE_ID, SAVE_RESULT_FLAG);
    if (result) renderResult(message, html, result);
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to render the save buttons`, err);
  }
}

function redrawAll() {
  for (const message of game.messages ?? []) {
    const flags = message.flags?.[MODULE_ID];
    if (flags?.[SAVE_FLAG] || flags?.[SAVE_RESULT_FLAG]) redrawMessage(message);
  }
}

export function registerSaveButtonSetting() {
  game.settings.register(MODULE_ID, SAVE_BUTTON_SETTING, {
    name: "T20CP.SaveButton.Setting.Name",
    hint: "T20CP.SaveButton.Setting.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: { off: "T20CP.SaveButton.Setting.off", on: "T20CP.SaveButton.Setting.on" },
    default: "on",
    onChange: () => redrawAll()
  });
}

export function installSaveButtonRule() {
  resultIndex = null;
  pendingSaves.clear();
  registerTargetConsumer(isEnabled);
  installUseTargets();
  const proto = CONFIG.Item?.documentClass?.prototype;
  const original = proto?.displayCard;
  if (typeof original !== "function") throw new Error("ItemT20#displayCard not found");
  proto.displayCard = markWrapper(async function (params = {}, ...rest) {
    let save = null;
    try {
      if (isEnabled() && usePurposeOf(this) !== USE_PURPOSES.MANEUVER_RESISTANCE) {
        save = buildSaveData({
          txt: this.system?.resistencia?.txt,
          dc: this.system?.resistencia?.cd,
          itemName: this.name,
          casterType: this.actor?.type,
          // Records frozen when ItemT20#roll started (shared use context), before any dialog, attack or damage roll.
          targets: useTargetRecords(this)
        });
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to read the save of ${this.name}`, err);
    }
    if (!save) return original.call(this, params, ...rest);
    const createMessage = params?.createMessage ?? true;
    const chatData = await original.call(this, { ...params, createMessage: false }, ...rest);
    if (!chatData || typeof chatData !== "object") return chatData;
    foundry.utils.setProperty(chatData, `flags.${MODULE_ID}.${SAVE_FLAG}`, save);
    return createMessage ? ChatMessage.create(chatData) : chatData;
  }, original);

  Hooks.on("renderChatMessageHTML", onRender);
  Hooks.on("createChatMessage", onResultChanged);
  Hooks.on("updateChatMessage", onResultChanged);
  Hooks.on("deleteChatMessage", onResultDeleted);
}
