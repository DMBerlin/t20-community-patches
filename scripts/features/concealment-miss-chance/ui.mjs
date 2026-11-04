/** Dialog field and chat card block of the "Chance de falha por camuflagem" rule (#49). */
import { MODULE_ID } from "../../lib/module.mjs";
import { DATA_KEY, concealmentChecksOf } from "../../lib/concealment.mjs";
import { BLOCK_CLASS, CONCEALMENT_CHOICES, CONCEALMENT_FIELD, FIELD_CLASS, targetLabel } from "./domain.mjs";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

/** @param {FeatureContext} ctx */
export function t(ctx, key, data) {
  const path = `T20CP.Concealment.${key}`;
  return data ? ctx.platform.i18n.format(path, data) : ctx.platform.i18n.localize(path);
}

export function reasonsText(ctx, reasons) {
  return (reasons ?? []).map((r) => t(ctx, `Reason.${r}`)).join(", ");
}

/**
 * The name shown for a check on this client. `live` is the TokenDocument (null when deleted: the recorded name mode
 * is used and the user is not its owner).
 */
export function displayLabel(ctx, check, live) {
  if (!check.targetUuid) return t(ctx, "Card.NoTarget");
  const { name, index } = targetLabel({
    name: check.name,
    index: check.index,
    isGM: !!ctx.platform.user.isGM(),
    isOwner: !!live?.isOwner,
    displayName: live ? live.displayName : check.displayName
  });
  return name ?? t(ctx, "Card.Target", { n: index });
}

function liveToken(ctx, uuid) {
  try {
    return uuid ? ctx.platform.documents.fromUuidSync(uuid) : null;
  } catch {
    return null;
  }
}

/**
 * The dialog field.
 * @param {FeatureContext} ctx
 * @param {string[]} lines  The preview of what Automatic detects for the use's targets.
 */
export function buildField(ctx, lines) {
  const group = document.createElement("div");
  group.className = `form-group ${FIELD_CLASS}`;
  group.dataset.tooltip = t(ctx, "Card.Reference");
  const label = document.createElement("label");
  label.textContent = t(ctx, "Dialog.Label");
  const fields = document.createElement("div");
  fields.className = "form-fields";
  const select = document.createElement("select");
  select.name = CONCEALMENT_FIELD;
  for (const choice of CONCEALMENT_CHOICES) {
    const option = document.createElement("option");
    option.value = choice;
    option.textContent = t(ctx, `Dialog.${choice}`);
    if (choice === "auto") option.selected = true;
    select.append(option);
  }
  fields.append(select);
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = t(ctx, "Dialog.Hint");
  const preview = document.createElement("p");
  preview.className = "hint t20cp-concealment-preview";
  preview.textContent = lines.length ? lines.join(" · ") : t(ctx, "Dialog.PreviewNone");
  group.append(label, fields, hint, preview);
  return group;
}

/** Whether attack-vs-defense (#42) already shows the cancelled critical notice for this roll. */
function defenseShowsCancel(roll) {
  const avd = roll?.options?.[MODULE_ID]?.attackVsDefense;
  return avd?.v === 1 && Array.isArray(avd.targets) && avd.targets.length > 0 && !!avd.threat && !avd.critical;
}

function checkLine(ctx, check) {
  const li = document.createElement("li");
  const strong = document.createElement("strong");
  strong.textContent = `${displayLabel(ctx, check, liveToken(ctx, check.targetUuid))}: `;
  const range = Number(check.threshold) > 1 ? `1-${check.threshold}` : "1";
  const line = document.createTextNode(
    `${t(ctx, "Card.Line", { chance: check.chance, reasons: reasonsText(ctx, check.reasons), formula: check.formula, total: check.total, range })} · `
  );
  const verdict = document.createElement("span");
  verdict.className = check.missed ? "t20cp-miss" : "t20cp-hit";
  verdict.textContent = t(ctx, check.missed ? "Card.Miss" : "Card.Hit");
  li.append(strong, line, verdict);
  return li;
}

function buildBlock(ctx, roll, data) {
  const box = document.createElement("div");
  box.className = BLOCK_CLASS;
  box.dataset.rollTitle = roll.options.title ?? "";
  box.dataset.tooltip = t(ctx, "Card.Reference");
  const title = document.createElement("p");
  title.className = "t20cp-miss-chance-title";
  title.textContent = t(ctx, "Card.Title");
  box.append(title);
  if (data.criticalCancelled && !defenseShowsCancel(roll)) {
    const note = document.createElement("p");
    note.className = "t20cp-miss-chance-note";
    note.textContent = t(ctx, "Card.CriticalCancelled");
    box.append(note);
  }
  const list = document.createElement("ul");
  for (const check of data.checks) list.append(checkLine(ctx, check));
  box.append(list);
  return box;
}

/**
 * Adds the miss chance block after each annotated attack roll of the card. Idempotent.
 * @param {FeatureContext} ctx
 */
export function decorate(ctx, message, html) {
  if (!message?.isContentVisible || !html?.querySelectorAll) return;
  const containers = [...html.querySelectorAll(".roll[data-roll-title]")];
  for (const roll of message.rolls ?? []) {
    if (!concealmentChecksOf(roll).length) continue;
    const data = roll.options[MODULE_ID][DATA_KEY];
    const title = roll.options.title ?? "";
    if ([...html.querySelectorAll(`.${BLOCK_CLASS}`)].some((el) => el.dataset.rollTitle === title)) continue;
    const container = containers.find((el) => el.dataset.rollTitle === title);
    if (container && data.criticalCancelled) {
      const total = container.querySelector(".dice-total");
      total?.classList.remove("success", "critical");
      total?.classList.add("failure");
    }
    const block = buildBlock(ctx, roll, data);
    if (container) container.after(block);
    else (html.querySelector(".chat-card") ?? html).append(block);
  }
}
