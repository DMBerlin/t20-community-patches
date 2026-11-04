/**
 * Drawing of the effective values: item sheet, inventory rows and chat card. Receives the stats and the text helpers
 * (`t.i18n`, relative to T20CP.ItemEffectiveStats, and `t.escape`) by parameter.
 */
import {
  armorChanged,
  chatSummary,
  combinedTooltip,
  finals,
  hasDetails,
  signed,
  statChanged,
  weaponChanged,
  weaponSummary
} from "./domain/index.mjs";

/** @typedef {{i18n: (key: string, data?: object) => string, escape: (text: unknown) => string}} Text */

export function rootOf(html) {
  if (globalThis.HTMLElement && html instanceof HTMLElement) return html;
  return html?.[0] ?? null;
}

function marker(tooltip, info = false) {
  const icon = document.createElement("i");
  icon.className = info ? "fa-solid fa-circle-info t20cp-effective-info" : "fa-solid fa-wand-magic-sparkles t20cp-effective";
  icon.dataset.tooltipHtml = tooltip;
  return icon;
}

function badge(text, tooltip) {
  const span = document.createElement("span");
  span.className = "t20cp-effective-badge t20cp-effective";
  span.dataset.tooltipHtml = tooltip;
  span.append(marker(tooltip), ` → ${text}`);
  return span;
}

function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function setText(el, text, tooltip) {
  el.textContent = `${text} `;
  el.append(marker(tooltip));
}

const INPUTS = {
  "system.armadura.value": ["armadura.value"],
  "system.armadura.penalidade": ["armadura.penalidade"],
  "system.criticoM": ["criticoM", "criticoX"],
  "system.criticoX": ["criticoX", "criticoM"]
};

/** The template reads item.system, which holds the effective value: the editable field keeps the stored base. */
function restoreBaseInputs(root, src) {
  for (const [name, value] of [
    ["system.armadura.value", src.armadura?.value],
    ["system.armadura.penalidade", src.armadura?.penalidade],
    ["system.criticoM", src.criticoM],
    ["system.criticoX", src.criticoX]
  ]) {
    const input = root.querySelector(`input[name="${name}"]`);
    if (!input || value === undefined) continue;
    input.value = String(value);
    input.setAttribute("value", String(value));
  }
}

function drawBadges(root, stats, tip) {
  for (const [name, keys] of Object.entries(INPUTS)) {
    const [key] = keys;
    if (!statChanged(stats[key])) continue;
    const input = root.querySelector(`input[name="${name}"]`);
    if (!input || input.parentElement?.querySelector(`.t20cp-effective-badge[data-field="${name}"]`)) continue;
    const el = badge(stats[key].final, tip(keys.map((k) => stats[k])));
    el.dataset.field = name;
    input.after(el);
  }
}

/** Header summary of an armor; true when something was drawn. */
function drawArmorHeader(header, stats, tip) {
  let drawn = false;
  for (const [icon, key] of [
    ["fa-shield", "armadura.value"],
    ["fa-person-hiking", "armadura.penalidade"]
  ]) {
    const label = header.querySelector(`label:has(> i.${icon})`) ?? header.querySelector(`i.${icon}`)?.parentElement;
    if (!label || !statChanged(stats[key])) continue;
    const i = label.querySelector(`i.${icon}`);
    label.textContent = "";
    if (i) label.append(i);
    label.append(` ${stats[key].final} `, marker(tip([stats[key]])));
    drawn = true;
  }
  return drawn;
}

/** Header summary of a weapon; true when something was drawn. */
function drawWeaponHeader(header, item, stats, all) {
  const f = finals(stats);
  const labels = item.labels ?? {};
  const expected = normalizeText(`${labels.toHit} (${labels.dano ? `${labels.dano}, ` : ""}${labels.critico})`);
  const li = [...header.querySelectorAll("li")].find((el) => normalizeText(el.textContent) === expected);
  if (!li) return false;
  setText(li, `${f.toHit ?? labels.toHit} (${f.dano ? `${f.dano}, ` : ""}${f.critico ?? labels.critico})`, all);
  return true;
}

/** Description properties (templates/item/parts/item-description.hbs:52-53). */
function drawProperties(root, stats, tip) {
  for (const li of root.querySelectorAll(".properties-list li")) {
    const match = li.textContent.match(/^\s*(Defesa|Penalidade):/);
    if (!match) continue;
    const key = match[1] === "Defesa" ? "armadura.value" : "armadura.penalidade";
    if (!statChanged(stats[key])) continue;
    setText(li, `${match[1]}: ${stats[key].final}`, tip([stats[key]]));
  }
}

/**
 * Item sheet (AppV1). `statsOf` is called after the base inputs are restored.
 * @param {object} item   An "arma" or "equipamento" item.
 * @param {HTMLElement} root
 * @param {string} mode   "display" or "effective".
 * @param {{statsOf: (item: object) => Record<string, object>, t: Text}} view
 */
export function drawItemSheet(item, root, mode, { statsOf, t }) {
  if (mode === "effective") restoreBaseInputs(root, item._source?.system ?? {});

  const stats = statsOf(item);
  if (!hasDetails(stats)) return;
  const tip = (entries) => combinedTooltip(entries, t.i18n, t.escape);
  const all = tip(Object.values(stats));

  drawBadges(root, stats, tip);

  let drawn = false;
  const header = root.querySelector(".sheet-header .summary");
  if (header && item.type === "equipamento" && armorChanged(stats)) drawn = drawArmorHeader(header, stats, tip) || drawn;
  if (header && item.type === "arma" && weaponChanged(stats)) drawn = drawWeaponHeader(header, item, stats, all) || drawn;
  if (item.type === "equipamento") drawProperties(root, stats, tip);

  if (!drawn && header && !header.querySelector(".t20cp-effective-info, .t20cp-effective")) {
    const li = document.createElement("li");
    li.className = "t20cp-effective-summary";
    li.append(marker(all, !(armorChanged(stats) || weaponChanged(stats))));
    header.append(li);
  }
}

/**
 * Actor sheet inventory rows (templates/actor/parts/lists/list-equipment.hbs, list-weapon.hbs).
 * @param {object} actor
 * @param {HTMLElement} root
 * @param {(item: object) => Record<string, object>} statsOf
 * @param {Text} t
 */
export function drawActorSheet(actor, root, statsOf, t) {
  for (const li of root.querySelectorAll("li[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    if (!item || !["arma", "equipamento"].includes(item.type)) continue;
    const cell = li.querySelector(item.type === "arma" ? ".item-rolls" : ".item-def");
    if (!cell || cell.querySelector(".t20cp-effective, .t20cp-effective-info")) continue;
    const stats = statsOf(item);
    if (!hasDetails(stats)) continue;
    const tooltip = combinedTooltip(Object.values(stats), t.i18n, t.escape);
    const f = finals(stats);
    if (item.type === "equipamento" && armorChanged(stats)) {
      setText(cell, `${signed(f.defense)} / ${f.penalty}`, tooltip);
    } else if (item.type === "arma" && weaponChanged(stats)) {
      const labels = item.labels ?? {};
      setText(cell, weaponSummary(f.toHit ?? labels.toHit, f.dano ?? labels.dano, f.critico ?? labels.critico), tooltip);
    } else {
      cell.append(" ", marker(tooltip, true));
    }
  }
}

/**
 * Chat card: draws the snapshot below the card header.
 * @param {Record<string, object>} stats   The snapshot stored in the message flags.
 * @param {HTMLElement} root
 * @param {Text} t
 */
export function drawChatCard(stats, root, t) {
  const card = root.querySelector(".item-card");
  if (!card || card.querySelector(".t20cp-effective-line")) return;
  const tooltip = combinedTooltip(Object.values(stats), t.i18n, t.escape);
  if (!tooltip) return;
  const line = document.createElement("div");
  line.className = "t20cp-effective-line";
  const changed = Object.values(stats).some(statChanged);
  if (changed) {
    line.append(`${chatSummary(stats, t.i18n)} `, marker(tooltip));
  } else {
    line.append(marker(tooltip, true));
  }
  const header = card.querySelector(".card-header");
  if (header) header.after(line);
  else card.prepend(line);
}
