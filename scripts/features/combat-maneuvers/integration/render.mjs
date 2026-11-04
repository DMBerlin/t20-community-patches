/** Chat rendering of "Manobras de combate" (#48): names, buttons, states and the collapsible details. */
import { MANEUVER_FLAG, RESULT_FLAG, findCanonicalResult, maneuverState, targetNameFor } from "../domain/index.mjs";
import { DETAILS_CLASS, TITLE_CLASS } from "../ui/classes.mjs";
import { button, el, t } from "../ui/cards.mjs";
import { onPassageClick, onResistClick } from "./actions.mjs";
import { allMessages, canResist, flagsOf, fromUuid, isEnabled, visibleResults } from "./runtime.mjs";

function fillNames(rt, html, record) {
  const isGM = !!rt.ctx.platform.user.isGM();
  const name = targetNameFor(record, { isGM, token: fromUuid(rt, record?.uuid) }) ?? t(rt.ctx, "Card.Target");
  for (const node of html.querySelectorAll(".t20cp-target-name")) node.textContent = name;
}

function host(html) {
  return html.querySelector(".t20cp-maneuver") ?? html.querySelector(".message-content");
}

function renderManeuverCard(rt, message, html, data) {
  const { ctx } = rt;
  fillNames(rt, html, data.target);
  const results = visibleResults(rt, message.id);
  const canonical = findCanonicalResult(results);
  const state = maneuverState({
    kind: data.kind,
    resultIds: results.map((m) => m.id),
    canonicalId: canonical?.id ?? null,
    concealed: !!data.concealment
  });
  // Failed by concealment: the content already says so, and there is nothing to resist.
  if (state === "concealed") return;
  const footer = el("div", "t20cp-maneuver-actions");
  if (state === "resolved") {
    footer.append(el("span", "t20cp-maneuver-state", t(ctx, "Card.Resolved")));
  } else {
    const actor = fromUuid(rt, data.target?.uuid)?.actor ?? null;
    if (!actor || !canResist(rt, actor)) return;
    footer.append(button(ctx, t(ctx, "Button.Resist"), (event) => onResistClick(rt, message, event)));
    if (state === "resist+passage") footer.append(button(ctx, t(ctx, "Button.Passage"), () => onPassageClick(rt, message)));
  }
  host(html)?.append(footer);
}

function renderResult(rt, message, html, result) {
  fillNames(rt, html, result.target);
  const results = visibleResults(rt, result.of);
  const canonical = findCanonicalResult(results);
  const state = maneuverState({ kind: result.kind, resultIds: results.map((m) => m.id), canonicalId: canonical?.id ?? null, selfId: message.id });
  if (state !== "superseded") return;
  const target = host(html);
  target?.classList?.add?.("t20cp-maneuver-superseded");
  target?.append(el("p", "t20cp-maneuver-state", t(rt.ctx, "Card.Superseded")));
}

/**
 * Details closed by default; the title opens and closes them on this client only, like the name of the system's item
 * cards (_onChatCardToggleContent). The state survives the re-renders of the card.
 */
function collapse(rt, message, html) {
  const box = html.querySelector(`.${DETAILS_CLASS}`);
  const title = html.querySelector(`.${TITLE_CLASS}`);
  if (!box || !title) return;
  const show = (open) => {
    box.style.display = open ? "" : "none";
    title.classList?.toggle?.("t20cp-maneuver-open", open);
  };
  show(rt.expanded.has(message.id));
  title.addEventListener("click", (event) => {
    event?.preventDefault?.();
    const open = !rt.expanded.has(message.id);
    if (open) rt.expanded.add(message.id);
    else rt.expanded.delete(message.id);
    show(open);
  });
}

/** renderChatMessageHTML. */
export function onRender(rt, message, html) {
  try {
    if (!isEnabled(rt) || !message?.isContentVisible || !html?.querySelector) return;
    const flags = flagsOf(message);
    if (flags?.[MANEUVER_FLAG]) {
      collapse(rt, message, html);
      renderManeuverCard(rt, message, html, flags[MANEUVER_FLAG]);
    } else if (flags?.[RESULT_FLAG]) {
      collapse(rt, message, html);
      renderResult(rt, message, html, flags[RESULT_FLAG]);
    }
  } catch (err) {
    rt.ctx.log.error("failed to render", err);
  }
}

// ChatLog#updateMessage redraws the log and its popout, but not a card opened in its own window.
function redrawMessage(rt, message) {
  rt.ctx.platform.chat.updateMessage(message);
  message.render?.(false);
}

/** A result was created, changed or deleted: redraw its maneuver card and the other results of it. */
export function onResultChanged(rt, message) {
  const result = flagsOf(message)?.[RESULT_FLAG];
  if (!result?.of) return;
  try {
    const card = rt.ctx.platform.documents.messages()?.get?.(result.of);
    if (card) redrawMessage(rt, card);
    for (const other of allMessages(rt)) {
      if (other.id !== message.id && flagsOf(other)?.[RESULT_FLAG]?.of === result.of) redrawMessage(rt, other);
    }
  } catch (err) {
    rt.ctx.log.error("failed to redraw the maneuver", err);
  }
}

export function redrawAll(rt) {
  for (const message of allMessages(rt)) {
    const flags = flagsOf(message);
    if (flags?.[MANEUVER_FLAG] || flags?.[RESULT_FLAG]) redrawMessage(rt, message);
  }
}
