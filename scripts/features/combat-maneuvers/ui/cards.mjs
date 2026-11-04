/** Chat card content of "Manobras de combate" (#48): the maneuver card (B), the result (C) and their buttons. */
import { DETAILS_CLASS, TITLE_CLASS } from "./classes.mjs";

/** @typedef {import("../../../kernel/feature.mjs").FeatureContext} FeatureContext */

/** @param {FeatureContext} ctx */
export const t = (ctx, key, data) =>
  data
    ? ctx.platform.i18n.format(`T20CP.CombatManeuvers.${key}`, data)
    : ctx.platform.i18n.localize(`T20CP.CombatManeuvers.${key}`);

export const escapeHTML = (text) =>
  String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
const meters = (ctx, n) => {
  try {
    return new Intl.NumberFormat(ctx.platform.i18n.lang() || undefined).format(n);
  } catch {
    return String(n);
  }
};

const targetMarker = (ctx) => `<span class="t20cp-target-name" data-index="0">${escapeHTML(t(ctx, "Card.Target"))}</span>`;

/** "teste 24 (ataque 19, tamanho +2, versátil +2, outros +1)". */
function testBreakdown(ctx, test, sourceKey) {
  const parts = [t(ctx, `Card.Part.${sourceKey}`, { value: test.roll })];
  if (test.sizeMod) parts.push(t(ctx, "Card.Part.size", { value: signed(test.sizeMod) }));
  if (test.versatile) parts.push(t(ctx, "Card.Part.versatile", { value: signed(2) }));
  if (test.other) parts.push(t(ctx, "Card.Part.other", { value: signed(test.other) }));
  return `<strong>${test.total}</strong> (${parts.map(escapeHTML).join(", ")})`;
}

function testLine(ctx, who, test, sourceKey, weaponName) {
  const weapon = weaponName ? ` ${escapeHTML(t(ctx, "Card.With", { weapon: weaponName }))}` : "";
  return `<li>${t(ctx, "Card.Test", { who })}${weapon}: ${testBreakdown(ctx, test, sourceKey)}</li>`;
}

/** Card opening: the system's chat-card header (the title toggles the details) and the attempt line. */
function header(ctx, data, extraClass = "") {
  const kind = escapeHTML(t(ctx, `Kind.${data.kind}`));
  return [
    `<div class="tormenta20 chat-card t20cp-maneuver${extraClass}" data-maneuver="${escapeHTML(data.kind)}">`,
    `<header class="card-header flexrow"><h3 class="${TITLE_CLASS}">${escapeHTML(t(ctx, "Card.Title", { kind: t(ctx, `Kind.${data.kind}`) }))}</h3></header>`,
    `<p>${t(ctx, "Card.Attempt", { attacker: escapeHTML(data.attacker?.name), kind, target: targetMarker(ctx) })}</p>`
  ];
}

const reference = (ctx) => `<p class="t20cp-maneuver-hint">${escapeHTML(t(ctx, "Reference"))}</p>`;
const details = (lines) => [`<div class="${DETAILS_CLASS}">`, ...lines, "</div>"];

function concealedLine(ctx, concealment) {
  // inCard: the card carries the annotated roll, so #49's block already shows the d10.
  const text = concealment.inCard
    ? t(ctx, "Card.ConcealedShort")
    : t(ctx, "Card.Concealed", {
        formula: concealment.formula,
        total: concealment.total,
        threshold: concealment.threshold,
        chance: concealment.chance
      });
  return `<p class="t20cp-maneuver-concealed"><strong>${escapeHTML(text)}</strong></p>`;
}

/**
 * Content of the maneuver card B. It never contains the target's name, only a marker.
 * @param {FeatureContext} ctx
 */
export function buildManeuverContent(ctx, data) {
  return [
    ...header(ctx, data),
    `<p class="t20cp-maneuver-summary">${t(ctx, "Card.Summary", { total: `<strong>${Number(data.attack?.total)}</strong>` })}</p>`,
    ...(data.concealment ? [concealedLine(ctx, data.concealment)] : []),
    ...details([
      `<ul class="t20cp-maneuver-tests">${testLine(ctx, escapeHTML(data.attacker?.name), data.attack, "attack")}</ul>`,
      `<p class="t20cp-maneuver-hint">${escapeHTML(t(ctx, "Card.NoDamage"))}</p>`,
      reference(ctx)
    ]),
    "</div>"
  ].join("");
}

function outcomeText(ctx, result) {
  const { outcome } = result;
  const target = targetMarker(ctx);
  if (result.passage) return t(ctx, "Outcome.passage", { target });
  if (outcome.winner === "reroll") return t(ctx, "Outcome.reroll");
  return t(ctx, `Outcome.${outcome.noteKey}`, { target, meters: escapeHTML(meters(ctx, outcome.pushMeters)) });
}

/** Summary line and details of an opposed (not passage) result. */
function opposedLines(ctx, result, lines, more) {
  const { defender, outcome } = result;
  lines.push(
    `<p class="t20cp-maneuver-summary">${t(ctx, "Card.Versus", {
      attacker: escapeHTML(result.attacker?.name),
      attack: `<strong>${Number(result.attack?.total)}</strong>`,
      target: targetMarker(ctx),
      defense: `<strong>${Number(defender?.total)}</strong>`
    })}</p>`
  );
  more.push(
    '<ul class="t20cp-maneuver-tests">',
    testLine(ctx, escapeHTML(result.attacker?.name), result.attack, "attack"),
    testLine(ctx, targetMarker(ctx), defender, defender.weaponId ? "attack" : "luta", defender.weaponName),
    "</ul>"
  );
  if (outcome.winner !== "reroll") {
    const winner = outcome.winner === "attacker" ? escapeHTML(result.attacker?.name) : targetMarker(ctx);
    const key = outcome.tieBreak ? "Card.WinnerTie" : "Card.Winner";
    more.push(`<p class="t20cp-maneuver-winner">${t(ctx, key, { winner, margin: outcome.margin })}</p>`);
  }
}

/**
 * Content of the result message C. It never contains the target's name, only markers.
 * @param {FeatureContext} ctx
 */
export function buildResultContent(ctx, result) {
  const lines = [...header(ctx, result, " t20cp-maneuver-result")];
  const more = [];
  const { outcome } = result;
  if (!result.passage) opposedLines(ctx, result, lines, more);
  lines.push(`<p class="t20cp-maneuver-outcome"><strong>${outcomeText(ctx, result)}</strong></p>`);
  if (outcome.pushMeters && (result.kind === "derrubar" || result.kind === "desarmar")) {
    more.push(`<p>${escapeHTML(t(ctx, result.kind === "derrubar" ? "Card.Margin5" : "Card.Margin5Item"))}</p>`);
  }
  if (outcome.condition) more.push(`<p class="t20cp-maneuver-hint">${escapeHTML(t(ctx, "Card.ApplyByHud"))}</p>`);
  more.push(reference(ctx));
  lines.push(...details(more), "</div>");
  return lines.join("");
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * A card button: disabled while its action runs; a failure is logged and reported.
 * @param {FeatureContext} ctx
 */
export function button(ctx, label, onClick) {
  const node = el("button", "t20cp-maneuver-button", label);
  node.type = "button";
  node.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    node.disabled = true;
    try {
      await onClick(event);
    } catch (err) {
      ctx.log.error("action failed", err);
      ctx.platform.notify.error(t(ctx, "Warn.Failed"));
    } finally {
      if (node.isConnected) node.disabled = false;
    }
  });
  return node;
}
