/**
 * Optional rule "Chance de falha por camuflagem" (#49).
 *
 * Book rule (Tormenta20 Jogo do Ano, cap. 5, "Situações Especiais", p. 238-239): light concealment gives a 20% miss
 * chance and total concealment 50%, rolled on 1d10 with the attack's d20 (1-2 or 1-5 miss, whatever the attack test).
 * Blind gives total concealment to every target of the character's attacks (p. 394) and an Invisible character has
 * total concealment (p. 195). The system rolls no miss chance at all. This rule adds a dialog field, rolls the d10 for
 * each target marked when the use started, records it in the attack roll, cancels the critical when every target was
 * missed, and shows the result on the chat card.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";
import {
  canSeeTokenName,
  installUseTargets,
  registerTargetConsumer,
  USE_PURPOSES,
  usePurposeOf,
  useTargetRecords,
  useTargets
} from "./shared/targets.mjs";
import {
  finalOutcome,
  invalidateConcealmentChecks,
  keepCritical,
  missedByConcealment,
  setConcealmentChecks
} from "./shared/attack-outcome.mjs";

export const CONCEALMENT_SETTING = "concealmentMissChance";
export const CONCEALMENT_FIELD = "t20cpConcealment";
export const CONCEALMENT_CHOICES = ["auto", "light", "total", "scent", "none"];
export const CHANCE = { light: 20, total: 50 };
export const SCENT_CHANCE = 20; // Faro, p. 229
export const MAX_MISS_CHANCE = 75; // p. 226
export const BLIND = "cego";
export const INVISIBLE = "invisivel";
export const DATA_KEY = "concealment";
const DATA_VERSION = 1;
const FIELD_CLASS = "t20cp-concealment";
const BLOCK_CLASS = "t20cp-miss-chance";
const LOG = `${MODULE_ID} | concealment-miss-chance:`;

/** Automatic concealment sources against one target. */
export function autoSources({ attackerStatuses = [], targetStatuses = [] } = {}) {
  const sources = [];
  if (new Set(attackerStatuses).has(BLIND)) sources.push({ reason: "blind", chance: CHANCE.total });
  if (new Set(targetStatuses).has(INVISIBLE)) sources.push({ reason: "invisible", chance: CHANCE.total });
  return sources;
}

/**
 * Final chance against one target. Concealment does not stack with itself: the highest wins.
 * "none" ignores everything; "scent" replaces any detected concealment with 20%. Unknown choice = "auto".
 * @returns {{chance: number, reasons: string[]}}
 */
export function resolveMissChance({ sources = [], choice = "auto" } = {}) {
  if (choice === "none") return { chance: 0, reasons: [] };
  const all = [...sources];
  if (choice === "light" || choice === "total") all.push({ reason: choice, chance: CHANCE[choice] });
  const chance = Math.min(MAX_MISS_CHANCE, Math.max(0, ...all.map((s) => s.chance)));
  const reasons = all.filter((s) => s.chance === chance && chance > 0).map((s) => s.reason);
  if (choice === "scent" && chance > 0) return { chance: SCENT_CHANCE, reasons: [...reasons, "scent"] };
  return { chance, reasons };
}

/** The book's die: 1d10 for multiples of 10 (1-2 at 20%, 1-5 at 50%); 1d100 otherwise. */
export function missDie(chance) {
  if (!(chance > 0)) return null;
  return chance % 10 === 0 ? { formula: "1d10", threshold: chance / 10 } : { formula: "1d100", threshold: chance };
}

export function isMiss(total, threshold) {
  return Number.isFinite(total) && total >= 1 && total <= threshold;
}

/**
 * One check per (attack roll × target with chance > 0). No targets: a single null target.
 * Attack names are deduplicated: the system keeps only the last roll of each name in `rolled` (T20:9096), so a
 * shadowed duplicate gets no d10.
 * @param {{attackNames: string[], attackerStatuses: Iterable<string>, targets: {uuid: string, name: string,
 *   displayName: number, statuses: Iterable<string>}[], choice: string}} p
 */
export function planChecks({ attackNames = [], attackerStatuses = [], targets = [], choice = "auto" } = {}) {
  const list = targets.length ? targets : [null];
  const checks = [];
  for (const rollName of new Set(attackNames)) {
    list.forEach((target, i) => {
      const sources = autoSources({ attackerStatuses, targetStatuses: target?.statuses ?? [] });
      const { chance, reasons } = resolveMissChance({ sources, choice });
      const die = missDie(chance);
      if (!die) return;
      checks.push({
        rollName,
        targetUuid: target?.uuid ?? null,
        index: i + 1,
        name: target?.name ?? null,
        displayName: target?.displayName ?? null,
        chance,
        reasons,
        ...die
      });
    });
  }
  return checks;
}

/** Final outcomes of one attack roll when only this rule knows anything (Defense unknown). */
export function concealmentOutcomes(checks, rollName, targetUuids) {
  const uuids = targetUuids.length ? targetUuids : [null];
  return uuids.map((uuid) => finalOutcome(undefined, missedByConcealment(checks, rollName, uuid)));
}

/** The checks recorded in an attack roll by this rule (annotate), or [] when there are none. */
export function concealmentChecksOf(roll) {
  const data = roll?.options?.[MODULE_ID]?.[DATA_KEY];
  return data?.v === DATA_VERSION && Array.isArray(data.checks) ? data.checks : [];
}

/**
 * Card label of a target, decided by each client at render time.
 * @returns {{name: string|null, index: number}}  name null → "Alvo {index}"
 */
export function targetLabel({ name, index, isGM, isOwner, displayName }) {
  return { name: name && canSeeTokenName({ isGM, isOwner, displayName }) ? name : null, index };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function isEnabled() {
  try {
    return game.settings.get(MODULE_ID, CONCEALMENT_SETTING) === "on";
  } catch {
    return false;
  }
}

function t(key, data) {
  const path = `T20CP.Concealment.${key}`;
  return data ? game.i18n.format(path, data) : game.i18n.localize(path);
}

function attackNames(item) {
  return (item?.system?.rolls ?? []).filter((r) => r?.type === "ataque" && r.parts?.[0]?.[0]).map((r) => r.name);
}

function hasAttackRoll(item) {
  return !!item?.system?.rolls?.some?.((r) => r?.type === "ataque");
}

const statusesOf = (actor) => [...(actor?.statuses ?? [])];

/**
 * The use's frozen records, without the attacker's own token, plus the live statuses of the matching token.
 * Name, uuid and name mode always come from the record.
 */
export function useTargetsWithStatuses(item) {
  const tokens = useTargets(item);
  const byUuid = new Map(tokens.map((token) => [(token?.document ?? token)?.uuid, token]));
  const attacker = item?.actor ?? null;
  const targets = [];
  for (const record of useTargetRecords(item)) {
    if (!record?.uuid) continue;
    const token = byUuid.get(record.uuid);
    const actor = token?.actor ?? null;
    if (attacker && actor === attacker) continue;
    targets.push({ ...record, statuses: statusesOf(actor), document: token?.document ?? null });
  }
  return targets;
}

/** Plans and rolls every d10 of this call. Throws on any failure (the caller then records nothing). */
async function rollChecks(item, targets, options) {
  const choice = CONCEALMENT_CHOICES.includes(options?.[CONCEALMENT_FIELD]) ? options[CONCEALMENT_FIELD] : "auto";
  const checks = planChecks({
    attackNames: attackNames(item),
    attackerStatuses: statusesOf(item?.actor),
    targets: targets.map(({ uuid, name, displayName, statuses }) => ({ uuid, name, displayName, statuses })),
    choice
  });
  for (const check of checks) {
    const roll = await new foundry.dice.Roll(check.formula).evaluate();
    check.total = Number(roll.total);
    check.missed = isMiss(check.total, check.threshold);
  }
  return checks;
}

/**
 * Records the checks in each new attack roll and cancels the critical when every target was missed.
 * `before` holds the rolled entries seen before the original ran: an entry that did not change (attack cancelled,
 * T20:9092) is left alone. Exported for tests.
 */
export function annotate(item, targets, checks, before = {}) {
  const rolled = item?.system?.rolled;
  if (!rolled) return;
  const uuids = targets.map((target) => target.uuid);
  for (const rollName of new Set(checks.map((c) => c.rollName))) {
    const roll = rolled[rollName];
    if (!roll?.options || roll.options.type !== "attack" || roll === before[rollName]) continue;
    const own = checks.filter((c) => c.rollName === rollName).map((c) => ({ ...c, reasons: [...c.reasons] }));
    let criticalCancelled = false;
    // Only cancels, never restores: another rule may have decided already.
    if (roll._critical === true && !keepCritical(concealmentOutcomes(checks, rollName, uuids))) {
      roll._critical = false;
      criticalCancelled = true;
    }
    (roll.options[MODULE_ID] ??= {})[DATA_KEY] = { v: DATA_VERSION, checks: own, criticalCancelled };
  }
}

function reasonsText(reasons) {
  return (reasons ?? []).map((r) => t(`Reason.${r}`)).join(", ");
}

/**
 * The name shown for a check on this client. `live` is the TokenDocument (null when deleted: the recorded name mode
 * is used and the user is not its owner).
 */
function displayLabel(check, live) {
  if (!check.targetUuid) return t("Card.NoTarget");
  const { name, index } = targetLabel({
    name: check.name,
    index: check.index,
    isGM: !!game.user?.isGM,
    isOwner: !!live?.isOwner,
    displayName: live ? live.displayName : check.displayName
  });
  return name ?? t("Card.Target", { n: index });
}

function liveToken(uuid) {
  try {
    return uuid ? foundry.utils.fromUuidSync(uuid) : null;
  } catch {
    return null;
  }
}

/**
 * Lines of the dialog preview: what Automatic detects for the use's targets, with names for the local user.
 * Exported for tests.
 * @returns {string[]}
 */
export function previewLines(item) {
  const targets = useTargetsWithStatuses(item);
  const checks = planChecks({ attackNames: ["preview"], attackerStatuses: statusesOf(item?.actor), targets, choice: "auto" });
  return checks.map((check) =>
    t("Dialog.Preview", {
      target: displayLabel(check, targets[check.index - 1]?.document ?? null),
      chance: check.chance,
      reasons: reasonsText(check.reasons)
    })
  );
}

/** The dialog field. Exported for tests. */
export function buildField(item) {
  const group = document.createElement("div");
  group.className = `form-group ${FIELD_CLASS}`;
  group.dataset.tooltip = t("Card.Reference");
  const label = document.createElement("label");
  label.textContent = t("Dialog.Label");
  const fields = document.createElement("div");
  fields.className = "form-fields";
  const select = document.createElement("select");
  select.name = CONCEALMENT_FIELD;
  for (const choice of CONCEALMENT_CHOICES) {
    const option = document.createElement("option");
    option.value = choice;
    option.textContent = t(`Dialog.${choice}`);
    if (choice === "auto") option.selected = true;
    select.append(option);
  }
  fields.append(select);
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = t("Dialog.Hint");
  const preview = document.createElement("p");
  preview.className = "hint t20cp-concealment-preview";
  const lines = previewLines(item);
  preview.textContent = lines.length ? lines.join(" · ") : t("Dialog.PreviewNone");
  group.append(label, fields, hint, preview);
  return group;
}

/** renderAbilityUseDialog: adds the field once, after "Melhor/Pior de 2d20". Exported for tests. */
export function onRenderDialog(app, html) {
  if (!isEnabled()) return;
  const item = app?.item;
  if (!hasAttackRoll(item) || usePurposeOf(item) === USE_PURPOSES.MANEUVER_RESISTANCE) return;
  const root = html?.[0] ?? html;
  const form = root?.querySelector?.("form#ability-use-form") ?? root?.querySelector?.("form");
  if (!form || form.querySelector(`.${FIELD_CLASS}`)) return;
  const field = buildField(item);
  const anchor = form.querySelector("[name=rollKeep]")?.closest?.(".form-group");
  if (anchor) {
    anchor.after(field);
    // Other rules' hooks (nonlethal-attack, situational-modifiers) also insert right after "Melhor/Pior", and may run
    // after this one: once every render hook ran, put the field back right after it.
    queueMicrotask(() => {
      if (anchor.parentNode && field.parentNode === anchor.parentNode) anchor.after(field);
    });
  } else {
    const situational = form.querySelector(".t20cp-situational");
    if (situational?.before) situational.before(field);
    else form.append(field);
  }
  app.setPosition?.({ height: "auto" });
}

/** Whether attack-vs-defense (#42) already shows the cancelled critical notice for this roll. */
function defenseShowsCancel(roll) {
  const avd = roll?.options?.[MODULE_ID]?.attackVsDefense;
  return avd?.v === 1 && Array.isArray(avd.targets) && avd.targets.length > 0 && !!avd.threat && !avd.critical;
}

function buildBlock(roll, data) {
  const box = document.createElement("div");
  box.className = BLOCK_CLASS;
  box.dataset.rollTitle = roll.options.title ?? "";
  box.dataset.tooltip = t("Card.Reference");
  const title = document.createElement("p");
  title.className = "t20cp-miss-chance-title";
  title.textContent = t("Card.Title");
  box.append(title);
  if (data.criticalCancelled && !defenseShowsCancel(roll)) {
    const note = document.createElement("p");
    note.className = "t20cp-miss-chance-note";
    note.textContent = t("Card.CriticalCancelled");
    box.append(note);
  }
  const list = document.createElement("ul");
  for (const check of data.checks) {
    const li = document.createElement("li");
    const strong = document.createElement("strong");
    strong.textContent = `${displayLabel(check, liveToken(check.targetUuid))}: `;
    const range = Number(check.threshold) > 1 ? `1-${check.threshold}` : "1";
    const line = document.createTextNode(
      `${t("Card.Line", { chance: check.chance, reasons: reasonsText(check.reasons), formula: check.formula, total: check.total, range })} · `
    );
    const verdict = document.createElement("span");
    verdict.className = check.missed ? "t20cp-miss" : "t20cp-hit";
    verdict.textContent = t(check.missed ? "Card.Miss" : "Card.Hit");
    li.append(strong, line, verdict);
    list.append(li);
  }
  box.append(list);
  return box;
}

/** Adds the miss chance block after each annotated attack roll of the card. Idempotent. Exported for tests. */
export function decorate(message, html) {
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
    const block = buildBlock(roll, data);
    if (container) container.after(block);
    else (html.querySelector(".chat-card") ?? html).append(block);
  }
}

/** Registers the world setting. Runs on "init" for every system, so the setting always exists. */
export function registerConcealmentSetting() {
  game.settings.register(MODULE_ID, CONCEALMENT_SETTING, {
    name: "T20CP.Concealment.Setting.Name",
    hint: "T20CP.Concealment.Setting.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: { off: "T20CP.Concealment.Setting.off", on: "T20CP.Concealment.Setting.on" },
    default: "off"
  });
}

/** Installs the rule. The setting is read on every use, so a change applies without reloading. */
export function installConcealmentRule() {
  registerTargetConsumer(isEnabled);
  installUseTargets();
  const itemProto = CONFIG.Item.documentClass?.prototype;
  // The current method, not unwrap(): unwrap() follows markWrapper tags down to the system method
  // and would drop any wrapper installed before this one (attack-vs-defense, etc.).
  const rollAttack = itemProto?.rollAttack;
  if (typeof rollAttack !== "function") throw new Error("ItemT20#rollAttack not found");
  itemProto.rollAttack = markWrapper(async function (...args) {
    invalidateConcealmentChecks(this); // on entry, before any await, even when the rule is off
    // Maneuver resistance test (combat-maneuvers): no d10, no checks, nothing recorded.
    if (usePurposeOf(this) === USE_PURPOSES.MANEUVER_RESISTANCE) return rollAttack.apply(this, args);
    let targets = [];
    let checks = [];
    let before = {};
    if (isEnabled()) {
      try {
        targets = useTargetsWithStatuses(this);
        checks = await rollChecks(this, targets, args[0]?.options);
        before = { ...(this.system?.rolled ?? {}) };
        setConcealmentChecks(this, checks); // published only after success; never cleared on the way out
      } catch (err) {
        console.error(`${LOG} failed to roll`, err);
        checks = [];
      }
    }
    const result = await rollAttack.apply(this, args);
    if (checks.length) {
      try {
        annotate(this, targets, checks, before);
      } catch (err) {
        console.error(`${LOG} failed to record the result`, err);
      }
    }
    return result;
  }, rollAttack);

  const messageProto = CONFIG.ChatMessage.documentClass?.prototype;
  const renderHTML = messageProto?.renderHTML;
  if (typeof renderHTML !== "function") throw new Error("ChatMessage#renderHTML not found");
  messageProto.renderHTML = markWrapper(async function (...args) {
    const html = await renderHTML.apply(this, args);
    try {
      decorate(this, html);
    } catch (err) {
      console.error(`${LOG} failed to show the result`, err);
    }
    return html;
  }, renderHTML);

  Hooks.on("renderAbilityUseDialog", (app, html) => {
    try {
      onRenderDialog(app, html);
    } catch (err) {
      console.error(`${LOG} failed to render the dialog field`, err);
    }
  });
}
