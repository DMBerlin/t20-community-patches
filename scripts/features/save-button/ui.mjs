/** Card footer and result line of the "Teste de resistência pelo card" rule (#58). */
import { canSeeTokenName } from "../../lib/targets.mjs";
import { damageMultiplier, latestResults, pendingKey, pickDamageRoll, resultKey, shouldHideDc } from "./domain.mjs";

/**
 * @typedef {object} SaveRuntime  State and helpers created by install(ctx).
 * @property {import("../../kernel/feature.mjs").FeatureContext} ctx
 * @property {object} platform
 * @property {Set<string>} pendingSaves
 * @property {(key: string, data?: object) => string} t
 * @property {(skill: string) => string} skillLabel
 */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {SaveRuntime} rt */
function button(rt, label, onClick, { disabled = false, tooltip } = {}) {
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
      rt.ctx.log.error("Save button failed", err);
      rt.platform.notify.error(rt.t("RollFailed"));
    } finally {
      if (node.isConnected) node.disabled = false;
    }
  });
  return node;
}

/** @param {SaveRuntime} rt */
function dcLabel(rt, save) {
  const hide = shouldHideDc({
    showFoeDc: rt.platform.settingsOf("tormenta20").get("showFoeDc"),
    isGM: rt.platform.user.isGM(),
    casterType: save.casterType
  });
  return hide ? "??" : String(save.dc);
}

function outcomeText(rt, result) {
  const parts = [rt.t(result.success ? "Success" : "Failure")];
  if (result.natural === 20) parts.push(rt.t("Natural20"));
  else if (result.natural === 1) parts.push(rt.t("Natural1"));
  return parts.join(" ");
}

function renderOutcome(rt, { card, entry, actor, save }) {
  const { t } = rt;
  const node = el("span", "t20cp-save-outcome");
  if (!entry.message.isContentVisible) {
    node.textContent = t("Hidden");
    return node;
  }
  const { result } = entry;
  node.classList.add(result.success ? "success" : "failure");
  node.append(el("strong", "", `${result.total} · ${outcomeText(rt, result)}`));
  if (result.success && save.effect) node.append(el("span", "t20cp-save-effect", t(`Effect.${save.effect}`)));
  const multiplier = damageMultiplier({ effect: save.effect, success: result.success });
  const roll = multiplier === null ? null : pickDamageRoll(card.rolls);
  if (roll && actor?.isOwner) {
    node.append(button(rt, t(multiplier === 1 ? "ApplyDamage" : "ApplyHalfDamage"), () => actor.applyDamageV2(roll, multiplier)));
  }
  return node;
}

/** Always the recorded name; ownership and display mode are read live to decide whether to show it. */
function tokenName(rt, token, record, index) {
  const { t } = rt;
  if (!record) return t("Unavailable");
  const visible = canSeeTokenName({
    isGM: rt.platform.user.isGM(),
    isOwner: Boolean(token?.isOwner),
    displayName: token ? token.displayName : record.displayName
  });
  const name = visible ? record.name : t("Target", { n: index + 1 });
  return token ? name : `${name} ${t("UnavailableSuffix")}`;
}

/**
 * Appends the footer with one row per target to the item card.
 * @param {SaveRuntime} rt
 * @param {Iterable<object>} entries  The result entries of this card.
 * @param {(card: object, tokenUuid: string, save: object, event: Event) => Promise<void>} rollSave
 */
export function renderCard(rt, { card, html, save, entries, rollSave }) {
  const { t, platform } = rt;
  const host = html.querySelector(".chat-card.item-card") ?? html.querySelector(".message-content");
  if (!host) return;
  const dc = dcLabel(rt, save);
  const results = latestResults(entries);
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
    const token = platform.documents.fromUuidSync(uuid);
    const actor = token?.actor ?? null;
    const row = el("div", "t20cp-save-row flexrow");
    row.append(el("span", "t20cp-save-name", tokenName(rt, token, records.get(uuid), index)));
    for (const entrySave of save.saves) {
      const entry = results.get(resultKey(uuid, entrySave.skill));
      const canRoll = Boolean(actor?.isOwner && actor.system?.pericias?.[entrySave.skill]);
      const pending = rt.pendingSaves.has(pendingKey(card.id, uuid, entrySave.skill));
      const roll = (event) => rollSave(card, uuid, entrySave, event);
      if (entry) {
        row.append(renderOutcome(rt, { card, entry, actor, save: entrySave }));
        if (canRoll) row.append(button(rt, "↻", roll, { tooltip: t("Reroll"), disabled: pending }));
      } else {
        row.append(button(rt, t("Roll", { skill: rt.skillLabel(entrySave.skill), dc }), roll, { disabled: !canRoll || pending }));
      }
    }
    footer.append(row);
  });

  if (!tokens.length) footer.append(el("p", "t20cp-save-hint", t("NoTargets")));
  for (const entrySave of save.saves) {
    footer.append(button(rt, t("RollSelected", { skill: rt.skillLabel(entrySave.skill) }), async (event) => {
      const selected = platform.canvas.controlledTokens().filter((token) => token.actor?.isOwner);
      if (!selected.length) return platform.notify.warn(t("NoSelection"));
      for (const token of selected) await rollSave(card, token.document.uuid, entrySave, event);
    }));
  }
  host.append(footer);
}

/** @param {SaveRuntime} rt */
export function renderResult(rt, html, result) {
  const host = html.querySelector(".message-content");
  if (!host) return;
  const line = el("div", `t20cp-save-result ${result.success ? "success" : "failure"}`);
  line.append(el("strong", "", rt.t("Against", { item: result.itemName, dc: dcLabel(rt, result), outcome: outcomeText(rt, result) })));
  if (result.success && result.effect) line.append(el("span", "t20cp-save-effect", ` ${rt.t(`Effect.${result.effect}`)}`));
  host.append(line);
}
