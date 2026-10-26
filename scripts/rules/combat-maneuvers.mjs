/**
 * Optional rule "Manobras de combate" (#48).
 *
 * Book rule (Tormenta20 Jogo do Ano, cap. 5, "Manobras de Combate", p. 234; "Atropelar", p. 233; size, p. 106): a
 * maneuver is a melee attack resolved as an opposed maneuver test, with the size modifier on both sides and its own
 * tie rule. The system has no maneuver at all (T20.tableSize.maneuver, T20:4082, is never read).
 *
 * Flow, without sockets and without writing other users' documents:
 * - the use dialog of a melee attack gets "Manobra": with a maneuver declared, the attack roll is the maneuver test,
 *   damage is not rolled and the maneuver card (B) replaces the system's attack card, with the target frozen when
 *   ItemT20#roll started;
 * - optionally (setting), A (the system's melee attack card) records the frozen targets and gets "Manobra", which
 *   creates B from its attack roll;
 * - B is created by the attacker and never updated; it has "Resistir" (and "Dar passagem");
 * - C (the result) is created by whoever resists, in a single ChatMessage.create. The state of B is derived from the
 *   results the current user can read, so a late or duplicate C converges on the next render.
 * With the concealment rule (#49) on, a failed miss chance d10 against the target (recorded in the attack roll) makes
 * the maneuver fail: B is born resolved, with no resistance test and no C.
 * B and C show a summary; clicking the title shows the details (per client, like the system's item cards).
 * The module never applies conditions: the card says which one applies and the GM uses the token HUD.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";
import { FORM_FIELD as NONLETHAL_FIELD } from "./nonlethal-attack.mjs";
import { CONCEALMENT_SETTING, concealmentChecksOf } from "./concealment-miss-chance.mjs";
import {
  canSeeTokenName,
  inItemUse,
  installUseTargets,
  registerTargetConsumer,
  USE_PURPOSES,
  usePurposeOf,
  useTargetRecords,
  withUsePurpose
} from "./shared/targets.mjs";

export const COMBAT_MANEUVERS_SETTING = "combatManeuversRule";
export const COMBAT_MANEUVERS_BUTTON_SETTING = "combatManeuversChatButton";
/** Fields of the use dialog (they reach rollAttack, rollDamage and displayCard in `options`). */
export const FORM_KIND = "t20cpManeuver";
export const FORM_VERSATILE = "t20cpManeuverVersatile";
export const MANEUVERS = ["agarrar", "derrubar", "desarmar", "empurrar", "quebrar", "atropelar"];
export const TARGETS_FLAG = "maneuverTargets";
export const MANEUVER_FLAG = "maneuver";
export const RESULT_FLAG = "maneuverResult";
const CONDITIONS = { agarrar: "agarrado", derrubar: "caido", atropelar: "caido" };
const VERSATILE_DEFAULT = new Set(["derrubar", "desarmar"]);
const DATA_VERSION = 1;
const LUTA = "luta";

/* -------------------------------------------- */
/*  Pure functions                              */
/* -------------------------------------------- */

/** Maneuver modifier for a size: the opposite of the Stealth one (book, p. 106). */
export function maneuverSizeModifier(size, sizeModifiers) {
  const v = Number(sizeModifiers?.[size]);
  return Number.isFinite(v) && v !== 0 ? -v : 0;
}

/** The item (or the itemData of a card) has a melee attack: the attack uses Luta. */
export function isMeleeAttackCard(itemData) {
  const attack = itemData?.rolls?.find?.((r) => r?.type === "ataque");
  return attack?.parts?.[1]?.[0] === LUTA;
}

/** Weapons of the defender that can make the maneuver test: Luta attack, wielded first. */
export function maneuverWeapons(items) {
  return [...(items ?? [])]
    .filter((i) => i?.type === "arma" && isMeleeAttackCard(i.system))
    .sort((a, b) => Number(!!b.system?.equipado) - Number(!!a.system?.equipado));
}

/** The first d20 roll that is not damage (the weapon's main attack, or a skill test). */
function pickTestRoll(rolls) {
  if (!Array.isArray(rolls)) return null;
  return rolls.find((r) => r?.dice?.[0]?.faces === 20 && r?.options?.type !== "damage") ?? null;
}

/** Total, kept d20 and bonus of the first d20 test of a list of rolls; null when there is none. */
export function attackFromRolls(rolls) {
  const roll = pickTestRoll(rolls);
  if (!roll || !Number.isFinite(roll.total)) return null;
  const d20 = Number(roll.dice[0].total);
  if (!Number.isFinite(d20)) return null;
  return { roll: roll.total, d20, bonus: roll.total - d20 };
}

/** Adds the module's modifiers to a test. */
export function maneuverTest({ roll, d20 }, { sizeMod = 0, versatile = false, other = 0 } = {}) {
  const extra = sizeMod + (versatile ? 2 : 0) + (Number(other) || 0);
  return { total: roll + extra, bonus: roll - d20 + extra };
}

/** Opposed test (book, p. 234): higher total wins; on a tie, the higher bonus; equal bonuses, test again. */
export function resolveOpposed(attacker, defender) {
  if (attacker.total !== defender.total) {
    const winner = attacker.total > defender.total ? "attacker" : "defender";
    return { winner, margin: Math.abs(attacker.total - defender.total), tieBreak: false };
  }
  if (attacker.bonus !== defender.bonus) {
    return { winner: attacker.bonus > defender.bonus ? "attacker" : "defender", margin: 0, tieBreak: true };
  }
  return { winner: "reroll", margin: 0, tieBreak: true };
}

/** What each maneuver does with the result. */
export function maneuverOutcome(kind, result) {
  const won = result.winner === "attacker";
  const out = { ...result, condition: null, pushMeters: 0, noteKey: `${kind}.${result.winner}` };
  if (!won) return out;
  if (CONDITIONS[kind]) out.condition = CONDITIONS[kind];
  if (kind === "empurrar") out.pushMeters = 1.5 * (1 + Math.floor(result.margin / 5));
  if ((kind === "derrubar" || kind === "desarmar") && result.margin >= 5) out.pushMeters = 1.5;
  return out;
}

/** State to draw, derived only from the visible results: for B (selfId null) or for one C (selfId = its id). */
export function maneuverState({ kind, resultIds = [], canonicalId = null, selfId = null, concealed = false }) {
  if (selfId !== null) return selfId === canonicalId ? "result" : "superseded";
  if (concealed) return "concealed";
  if (resultIds.length) return "resolved";
  return kind === "atropelar" ? "resist+passage" : "resist";
}

/**
 * The miss chance check (concealment-miss-chance, #49) of the maneuver's attack roll that failed against its target:
 * the maneuver fails, with no resistance test. Checks of other targets do not count. Null when it did not fail.
 */
export function maneuverConcealment(roll, targetUuid) {
  if (!targetUuid) return null;
  const check = concealmentChecksOf(roll).find((c) => c?.targetUuid === targetUuid && c.missed === true);
  if (!check) return null;
  return { formula: String(check.formula ?? ""), total: Number(check.total), threshold: Number(check.threshold), chance: Number(check.chance) };
}

/** "Arma versátil (+2)" starts checked for Derrubar and Desarmar. */
export function versatileDefault(kind, propriedades) {
  return !!(propriedades?.ver || propriedades?.versatil) && VERSATILE_DEFAULT.has(kind);
}

/** Results of one maneuver whose content the current user can read (the only selection used anywhere). */
export function selectVisibleResults(messages, bId) {
  return [...(messages ?? [])].filter(
    (c) => c?.flags?.[MODULE_ID]?.[RESULT_FLAG]?.of === bId && c.isContentVisible === true
  );
}

/** The canonical result among result messages of one maneuver: oldest timestamp, then smallest id. */
export function findCanonicalResult(results) {
  return [...(results ?? [])].sort((a, b) => (a.timestamp - b.timestamp) || String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

/**
 * The recorded name of a target if the user may see it, else null. Ownership and display mode are read from the
 * live TokenDocument; a deleted token is not owned and keeps the recorded display mode.
 * @param {{name?: string, displayName?: number} | null} record
 * @param {{isGM: boolean, token?: {isOwner?: boolean, displayName?: number} | null}} viewer
 */
export function targetNameFor(record, { isGM, token = null }) {
  if (!record?.name) return null;
  const visible = canSeeTokenName({
    isGM,
    isOwner: Boolean(token?.isOwner),
    displayName: token ? token.displayName : record.displayName
  });
  return visible ? String(record.name) : null;
}

/**
 * Normalizes the choices of a maneuver dialog.
 * @param {{kind?: unknown, versatile?: unknown, other?: unknown}} raw
 * @param {{versatileAllowed?: boolean}} [options]
 * @returns {{kind: string|null, versatile: boolean, other: number}}
 */
export function parseManeuverChoice(raw, { versatileAllowed = true } = {}) {
  const kind = MANEUVERS.includes(raw?.kind) ? raw.kind : null;
  const other = Number(raw?.other);
  return { kind, versatile: versatileAllowed && !!raw?.versatile, other: Number.isFinite(other) ? Math.trunc(other) : 0 };
}

/**
 * The maneuver declared in the use dialog, or null (none chosen, or the shortcut without dialog).
 * @param {object} options  The use options (FormDataExtended object of the dialog).
 * @returns {{kind: string, versatile: boolean} | null}
 */
export function parseDeclaration(options, { versatileAllowed = true } = {}) {
  const kind = MANEUVERS.includes(options?.[FORM_KIND]) ? options[FORM_KIND] : null;
  return kind ? { kind, versatile: versatileAllowed && !!options?.[FORM_VERSATILE] } : null;
}

/**
 * Why a list of frozen targets cannot take a maneuver: "NoTarget", "ManyTargets", "SelfTarget" or null (valid).
 * @param {object[]} records
 * @param {(record: object) => boolean} [isSelf]
 */
export function targetProblem(records, isSelf = () => false) {
  if (!records?.length) return "NoTarget";
  if (records.length > 1) return "ManyTargets";
  return isSelf(records[0]) ? "SelfTarget" : null;
}

/**
 * Data a result message (C) copies from the visibility of the maneuver card (B): a whispered B keeps its readers;
 * otherwise the resister's message mode applies (null = apply the mode).
 * @returns {{whisper: string[], blind: boolean} | null}
 */
export function inheritedVisibility(card) {
  const whisper = Array.isArray(card?.whisper) ? card.whisper : [];
  return whisper.length ? { whisper: [...whisper], blind: !!card.blind } : null;
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const LOG = `${MODULE_ID} | combat-maneuvers:`;
/** Maneuver cards (B ids) with a resistance in progress on this client (Resistir and Dar passagem share it). */
const locks = new Set();

function isEnabled() {
  try {
    return game.settings.get(MODULE_ID, COMBAT_MANEUVERS_SETTING) === "on";
  } catch {
    return false;
  }
}

/** The declared card carries its attack roll, whose miss chance block (#49) shows the d10. */
const withInCard = (concealment) => (concealment ? { ...concealment, inCard: true } : null);

/** The miss chance only counts while the concealment rule is on (its checks are recorded only then). */
function concealmentOf(roll, targetUuid) {
  try {
    if (game.settings.get(MODULE_ID, CONCEALMENT_SETTING) !== "on") return null;
  } catch {
    return null;
  }
  return maneuverConcealment(roll, targetUuid);
}

function isButtonEnabled() {
  try {
    return game.settings.get(MODULE_ID, COMBAT_MANEUVERS_BUTTON_SETTING) !== "off";
  } catch {
    return true;
  }
}

/** Maneuvers declared in the use dialog, by the per-use clone of ItemT20#roll (rollAttack → rollDamage → displayCard). */
let declarations = new WeakMap();
/** Maneuver and result cards whose details are open on this client (kept across re-renders). */
const expanded = new Set();

const t = (key, data) =>
  data ? game.i18n.format(`T20CP.CombatManeuvers.${key}`, data) : game.i18n.localize(`T20CP.CombatManeuvers.${key}`);

const escapeHTML = (text) =>
  String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
const meters = (n) => {
  try {
    return new Intl.NumberFormat(game.i18n.lang || undefined).format(n);
  } catch {
    return String(n);
  }
};

function fromUuid(uuid) {
  try {
    return uuid ? foundry.utils.fromUuidSync(uuid) : null;
  } catch {
    return null;
  }
}

function allMessages() {
  const messages = game.messages;
  return messages?.contents ?? [...(messages ?? [])];
}

/** The single selection of results used by every render and both checks of a resistance. */
function visibleResults(bId) {
  return selectVisibleResults(allMessages(), bId);
}

const targetMarker = () => `<span class="t20cp-target-name" data-index="0">${escapeHTML(t("Card.Target"))}</span>`;

/** "teste 24 (ataque 19, tamanho +2, versátil +2, outros +1)". */
function testBreakdown(test, sourceKey) {
  const parts = [t(`Card.Part.${sourceKey}`, { value: test.roll })];
  if (test.sizeMod) parts.push(t("Card.Part.size", { value: signed(test.sizeMod) }));
  if (test.versatile) parts.push(t("Card.Part.versatile", { value: signed(2) }));
  if (test.other) parts.push(t("Card.Part.other", { value: signed(test.other) }));
  return `<strong>${test.total}</strong> (${parts.map(escapeHTML).join(", ")})`;
}

function testLine(who, test, sourceKey, weaponName) {
  const weapon = weaponName ? ` ${escapeHTML(t("Card.With", { weapon: weaponName }))}` : "";
  return `<li>${t("Card.Test", { who })}${weapon}: ${testBreakdown(test, sourceKey)}</li>`;
}

const TITLE_CLASS = "t20cp-maneuver-title";
const FIELD_CLASS = "t20cp-maneuver-use";
const DETAILS_CLASS = "t20cp-maneuver-details";

/** Card opening: the system's chat-card header (the title toggles the details) and the attempt line. */
function header(data, extraClass = "") {
  const kind = escapeHTML(t(`Kind.${data.kind}`));
  return [
    `<div class="tormenta20 chat-card t20cp-maneuver${extraClass}" data-maneuver="${escapeHTML(data.kind)}">`,
    `<header class="card-header flexrow"><h3 class="${TITLE_CLASS}">${escapeHTML(t("Card.Title", { kind: t(`Kind.${data.kind}`) }))}</h3></header>`,
    `<p>${t("Card.Attempt", { attacker: escapeHTML(data.attacker?.name), kind, target: targetMarker() })}</p>`
  ];
}

const reference = () => `<p class="t20cp-maneuver-hint">${escapeHTML(t("Reference"))}</p>`;
const details = (lines) => [`<div class="${DETAILS_CLASS}">`, ...lines, "</div>"];

/** Content of the maneuver card B. It never contains the target's name, only a marker. */
export function buildManeuverContent(data) {
  return [
    ...header(data),
    `<p class="t20cp-maneuver-summary">${t("Card.Summary", { total: `<strong>${Number(data.attack?.total)}</strong>` })}</p>`,
    ...(data.concealment
      ? [
          // inCard: the card carries the annotated roll, so #49's block already shows the d10.
          `<p class="t20cp-maneuver-concealed"><strong>${escapeHTML(
            data.concealment.inCard
              ? t("Card.ConcealedShort")
              : t("Card.Concealed", {
                  formula: data.concealment.formula,
                  total: data.concealment.total,
                  threshold: data.concealment.threshold,
                  chance: data.concealment.chance
                })
          )}</strong></p>`
        ]
      : []),
    ...details([
      `<ul class="t20cp-maneuver-tests">${testLine(escapeHTML(data.attacker?.name), data.attack, "attack")}</ul>`,
      `<p class="t20cp-maneuver-hint">${escapeHTML(t("Card.NoDamage"))}</p>`,
      reference()
    ]),
    "</div>"
  ].join("");
}

function outcomeText(result) {
  const { outcome } = result;
  const target = targetMarker();
  if (result.passage) return t("Outcome.passage", { target });
  if (outcome.winner === "reroll") return t("Outcome.reroll");
  return t(`Outcome.${outcome.noteKey}`, { target, meters: escapeHTML(meters(outcome.pushMeters)) });
}

/** Content of the result message C. It never contains the target's name, only markers. */
export function buildResultContent(result) {
  const lines = [...header(result, " t20cp-maneuver-result")];
  const more = [];
  const { outcome } = result;
  if (!result.passage) {
    const { defender } = result;
    lines.push(
      `<p class="t20cp-maneuver-summary">${t("Card.Versus", {
        attacker: escapeHTML(result.attacker?.name),
        attack: `<strong>${Number(result.attack?.total)}</strong>`,
        target: targetMarker(),
        defense: `<strong>${Number(defender?.total)}</strong>`
      })}</p>`
    );
    more.push(
      '<ul class="t20cp-maneuver-tests">',
      testLine(escapeHTML(result.attacker?.name), result.attack, "attack"),
      testLine(targetMarker(), defender, defender.weaponId ? "attack" : "luta", defender.weaponName),
      "</ul>"
    );
    if (outcome.winner !== "reroll") {
      const winner = outcome.winner === "attacker" ? escapeHTML(result.attacker?.name) : targetMarker();
      const key = outcome.tieBreak ? "Card.WinnerTie" : "Card.Winner";
      more.push(`<p class="t20cp-maneuver-winner">${t(key, { winner, margin: outcome.margin })}</p>`);
    }
  }
  lines.push(`<p class="t20cp-maneuver-outcome"><strong>${outcomeText(result)}</strong></p>`);
  if (outcome.pushMeters && (result.kind === "derrubar" || result.kind === "desarmar")) {
    more.push(`<p>${escapeHTML(t(result.kind === "derrubar" ? "Card.Margin5" : "Card.Margin5Item"))}</p>`);
  }
  if (outcome.condition) more.push(`<p class="t20cp-maneuver-hint">${escapeHTML(t("Card.ApplyByHud"))}</p>`);
  more.push(reference());
  lines.push(...details(more), "</div>");
  return lines.join("");
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, onClick) {
  const node = el("button", "t20cp-maneuver-button", label);
  node.type = "button";
  node.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    node.disabled = true;
    try {
      await onClick(event);
    } catch (err) {
      console.error(`${LOG} action failed`, err);
      ui.notifications.error(t("Warn.Failed"));
    } finally {
      if (node.isConnected) node.disabled = false;
    }
  });
  return node;
}

/** Shows a warning; returns null so a check can `return warn(...)`. */
const warn = (key) => {
  ui.notifications.warn(t(`Warn.${key}`));
  return null;
};

function canResist(actor) {
  return Boolean(game.user.isGM || actor?.testUserPermission?.(game.user, "OWNER"));
}

/* ----------------- Dialogs ----------------- */

const DialogV2 = () => foundry.applications.api.DialogV2;

function formValues(form) {
  const get = (name) => form?.elements?.namedItem?.(name) ?? form?.elements?.[name] ?? null;
  return {
    kind: get("kind")?.value,
    weapon: get("weapon")?.value,
    versatile: !!get("versatile")?.checked,
    other: get("other")?.value
  };
}

function numberRow() {
  return [
    '<div class="form-group">',
    `<label>${escapeHTML(t("Dialog.Other"))}</label>`,
    '<input type="number" name="other" value="0" step="1">',
    "</div>",
    `<p class="hint">${escapeHTML(t("Dialog.OtherHint"))}</p>`
  ].join("");
}

function versatileRow(checked, hidden) {
  return [
    `<div class="form-group t20cp-maneuver-versatile"${hidden ? " hidden" : ""}>`,
    `<label>${escapeHTML(t("Dialog.Versatile"))}</label>`,
    `<input type="checkbox" name="versatile"${checked ? " checked" : ""}>`,
    "</div>"
  ].join("");
}

/** Attacker's dialog: maneuver, Versátil and other modifiers. Resolves null when dismissed. */
async function promptManeuver(propriedades) {
  const versatileAllowed = !!(propriedades?.ver || propriedades?.versatil);
  const first = MANEUVERS[0];
  const options = MANEUVERS.map((kind) => `<option value="${kind}">${escapeHTML(t(`Kind.${kind}`))}</option>`).join("");
  const content = [
    '<div class="t20cp-maneuver-dialog">',
    `<div class="form-group"><label>${escapeHTML(t("Dialog.Kind"))}</label><select name="kind">${options}</select></div>`,
    versatileRow(versatileDefault(first, propriedades), !versatileAllowed),
    numberRow(),
    `<p class="hint">${escapeHTML(t("Reference"))}</p>`,
    "</div>"
  ].join("");
  const result = await DialogV2().wait({
    window: { title: t("Dialog.Title") },
    content,
    buttons: [
      {
        action: "ok",
        label: t("Button.Maneuver"),
        default: true,
        callback: (_event, btn) => parseManeuverChoice(formValues(btn.form), { versatileAllowed })
      }
    ],
    render: (_event, dialog) => {
      const form = dialog.element?.querySelector?.("form") ?? dialog.form;
      const kind = form?.elements?.namedItem?.("kind");
      const versatile = form?.elements?.namedItem?.("versatile");
      kind?.addEventListener("change", () => {
        if (versatile) versatile.checked = versatileDefault(kind.value, propriedades);
      });
    }
  });
  return result && typeof result === "object" && result.kind ? result : null;
}

/** Defender's dialog: melee weapon or Luta, Versátil and other modifiers. Resolves null when dismissed. */
async function promptResist(actor, kind, weapons) {
  const hasLuta = !!actor.system?.pericias?.[LUTA];
  const rows = weapons.map((w) => {
    const versatile = !!(w.system?.propriedades?.ver || w.system?.propriedades?.versatil);
    return `<option value="${escapeHTML(w.id)}" data-versatile="${versatile ? 1 : 0}">${escapeHTML(w.name)}</option>`;
  });
  if (hasLuta) rows.push(`<option value="${LUTA}" data-versatile="0">${escapeHTML(t("Dialog.NoWeapon"))}</option>`);
  const first = weapons[0] ?? null;
  const firstVersatile = !!(first?.system?.propriedades?.ver || first?.system?.propriedades?.versatil);
  const content = [
    '<div class="t20cp-maneuver-dialog">',
    `<p>${escapeHTML(t("Dialog.ResistPrompt", { kind: t(`Kind.${kind}`) }))}</p>`,
    `<div class="form-group"><label>${escapeHTML(t("Dialog.Weapon"))}</label><select name="weapon">${rows.join("")}</select></div>`,
    `<p class="hint t20cp-maneuver-luta-hint"${first ? " hidden" : ""}>${escapeHTML(t("Dialog.NoWeaponHint"))}</p>`,
    versatileRow(firstVersatile && versatileDefault(kind, first.system.propriedades), !firstVersatile),
    numberRow(),
    `<p class="hint">${escapeHTML(t("Reference"))}</p>`,
    "</div>"
  ].join("");
  const result = await DialogV2().wait({
    window: { title: t("Dialog.ResistTitle") },
    content,
    buttons: [
      {
        action: "ok",
        label: t("Button.Resist"),
        default: true,
        callback: (_event, btn) => {
          const values = formValues(btn.form);
          const weapon = weapons.find((w) => w.id === values.weapon) ?? null;
          if (!weapon && values.weapon !== LUTA) return null;
          const versatileAllowed = !!(weapon?.system?.propriedades?.ver || weapon?.system?.propriedades?.versatil);
          const choice = parseManeuverChoice({ ...values, kind }, { versatileAllowed });
          return { weapon, versatile: choice.versatile, other: choice.other };
        }
      }
    ],
    render: (_event, dialog) => {
      const form = dialog.element?.querySelector?.("form") ?? dialog.form;
      const select = form?.elements?.namedItem?.("weapon");
      const versatile = form?.elements?.namedItem?.("versatile");
      select?.addEventListener("change", () => {
        const option = select.selectedOptions?.[0];
        const weapon = weapons.find((w) => w.id === select.value);
        const allowed = option?.dataset?.versatile === "1";
        versatile?.closest?.(".form-group")?.toggleAttribute?.("hidden", !allowed);
        if (versatile) versatile.checked = allowed && versatileDefault(kind, weapon?.system?.propriedades);
        form.querySelector?.(".t20cp-maneuver-luta-hint")?.toggleAttribute?.("hidden", select.value !== LUTA);
      });
    }
  });
  return result && typeof result === "object" ? result : null;
}

/* ----------------- Actions ----------------- */

function attackerTokenUuid(speaker, actor) {
  if (actor?.token?.uuid) return actor.token.uuid;
  const { scene, token } = speaker ?? {};
  return scene && token ? `Scene.${scene}.Token.${token}` : null;
}

/** Whether a frozen target record is the attacker itself. */
function isSelfTarget(record, actor, speakerToken) {
  const token = fromUuid(record?.uuid);
  if (!token?.actor) return false;
  return token.actor === actor || token.actor.uuid === actor?.uuid || (!!speakerToken && speakerToken === token.id);
}

/** Flag data of a maneuver card B. */
function maneuverData({ kind, versatile, other = 0, source, actor, speaker, alias, record, attack, concealment = null }) {
  const size = actor.system?.tracos?.tamanho ?? null;
  const sizeMod = maneuverSizeModifier(size, CONFIG.T20?.sizeModifiers);
  const test = maneuverTest(attack, { sizeMod, versatile, other });
  return {
    v: DATA_VERSION,
    kind,
    source,
    attacker: { actorUuid: actor.uuid ?? null, tokenUuid: attackerTokenUuid(speaker, actor), size, name: alias ?? actor.name },
    target: { uuid: record.uuid, name: String(record.name ?? ""), displayName: Number(record.displayName ?? 0) },
    attack: { d20: attack.d20, roll: attack.roll, sizeMod, versatile, other, ...test },
    concealment
  };
}

/**
 * Copies of the rolls for a new message: ChatMessage.create serializes the array it receives in place, so a live
 * message's or item's Roll objects (and their array) are never handed to it.
 */
function rollData(rolls) {
  return (rolls ?? []).map((r) => (typeof r?.toJSON === "function" ? r.toJSON() : r));
}

/** Only the dialog path passes `rolls` (its own attack roll); the chat button's B carries none of A's rolls. */
function maneuverChatData(data, { speaker, whisper, blind, rolls = [] }) {
  return {
    user: game.user.id,
    speaker: { ...(speaker ?? {}) },
    whisper: [...(whisper ?? [])],
    blind: !!blind,
    content: buildManeuverContent(data),
    rolls: rollData(rolls),
    flags: { "core.canPopout": true, [MODULE_ID]: { [MANEUVER_FLAG]: data } }
  };
}

/** "Manobra" on the attack card A: creates the maneuver card B. Exported for tests. */
export async function onManeuverClick(message, event) {
  if (!isEnabled()) return null;
  if (!(message.isAuthor || game.user.isGM)) return warn("NotOwner");
  const records = message.getFlag?.(MODULE_ID, TARGETS_FLAG) ?? [];
  const attacker = message.speakerActor ?? null;
  const speakerToken = message.speaker?.token;
  const problem = targetProblem(records, (record) => isSelfTarget(record, attacker, speakerToken));
  if (problem && problem !== "SelfTarget") return warn(problem);
  const record = records[0];
  if (!attacker || !fromUuid(record.uuid)?.actor) return warn("Missing");
  if (problem) return warn(problem);
  const attack = attackFromRolls(message.rolls);
  if (!attack) return null;
  const choice = await promptManeuver(message.getFlag?.("tormenta20", "itemData")?.propriedades);
  if (!choice || !isEnabled()) return null;
  const data = maneuverData({
    ...choice,
    source: message.id,
    actor: attacker,
    speaker: message.speaker,
    alias: message.alias,
    record,
    attack,
    concealment: concealmentOf(pickTestRoll(message.rolls), record.uuid)
  });
  return ChatMessage.create(maneuverChatData(data, { speaker: message.speaker, whisper: message.whisper, blind: message.blind }));
}

/* ----------------- Declared in the use dialog ----------------- */

/** The use of a melee attack may declare a maneuver (not the defender's own test). */
function eligibleUse(item) {
  return isEnabled() && !!item?.actor && usePurposeOf(item) !== USE_PURPOSES.MANEUVER_RESISTANCE && isMeleeAttackCard(item.system);
}

const isVersatile = (item) => !!(item?.system?.propriedades?.ver || item?.system?.propriedades?.versatil);

/** Frozen targets of the use and why they cannot take a maneuver (null when valid). */
function useTargetCheck(item) {
  const records = useTargetRecords(item);
  const speakerToken = item.actor?.token?.id ?? null;
  const problem = targetProblem(records, (record) => isSelfTarget(record, item.actor, speakerToken));
  if (problem) return { records, problem };
  return { records, problem: fromUuid(records[0].uuid)?.actor ? null : "Missing" };
}

/**
 * The maneuver declared for this use, after the target checks; a declaration that cannot stand is reported and the
 * use goes on as a normal attack. Only for the per-use clone of ItemT20#roll. Exported for tests.
 * @returns {{kind: string, versatile: boolean, record: object} | null}
 */
export function resolveDeclaration(item, options) {
  if (!options || typeof options !== "object" || !inItemUse(item) || !eligibleUse(item)) return null;
  const declared = parseDeclaration(options, { versatileAllowed: isVersatile(item) });
  if (!declared) return null;
  const { records, problem } = useTargetCheck(item);
  if (problem) {
    ui.notifications.warn(t("Warn.Fallback", { reason: t(`Warn.${problem}`) }));
    return null;
  }
  return { ...declared, record: records[0] };
}

/** The maneuver card B that replaces the attack card of a use with a declared maneuver; null without an attack. */
function declaredCard(item, declaration, rollMode) {
  const rolls = Object.values(item.system?.rolled ?? {});
  const roll = pickTestRoll(rolls);
  const attack = attackFromRolls(rolls);
  if (!roll || !attack) return null;
  const speaker = ChatMessage.getSpeaker({ actor: item.actor });
  const data = maneuverData({
    kind: declaration.kind,
    versatile: declaration.versatile,
    source: null,
    actor: item.actor,
    speaker,
    alias: speaker?.alias,
    record: declaration.record,
    attack,
    concealment: withInCard(concealmentOf(roll, declaration.record?.uuid))
  });
  const chatData = maneuverChatData(data, { speaker, rolls: [roll] });
  ChatMessage.applyMode(chatData, rollMode || game.settings.get("core", "messageMode"));
  return chatData;
}

function buildUseField(item, problem) {
  const box = el("div", FIELD_CLASS);
  const row = el("div", "form-group");
  row.dataset.tooltip = t("Reference");
  const label = el("label", "", t("Dialog.Kind"));
  const fields = el("div", "form-fields");
  const select = el("select");
  select.name = FORM_KIND;
  const none = el("option", "", t("Dialog.None"));
  none.value = "";
  select.append(none);
  for (const kind of MANEUVERS) {
    const option = el("option", "", t(`Kind.${kind}`));
    option.value = kind;
    select.append(option);
  }
  select.value = "";
  fields.append(select);
  let versatile = null;
  if (isVersatile(item)) {
    const check = el("label", "checkbox");
    versatile = el("input");
    versatile.type = "checkbox";
    versatile.name = FORM_VERSATILE;
    versatile.checked = false;
    check.append(versatile, document.createTextNode(t("Dialog.Versatile")));
    fields.append(check);
  }
  row.append(label, fields);
  box.append(row);
  if (problem) {
    select.disabled = true;
    if (versatile) versatile.disabled = true;
    box.append(el("p", "hint t20cp-maneuver-use-hint", t(`Warn.${problem}`)));
  }
  return { box, select, versatile };
}

/**
 * renderAbilityUseDialog: "Manobra" (and "Arma versátil") after the other attack fields of the module (situational
 * modifiers, nonlethal choice), on eligible melee attacks only. Exported for tests.
 */
export function onRenderDialog(app, html) {
  try {
    const item = app?.item;
    const ItemClass = CONFIG.Item?.documentClass;
    if (!ItemClass || !(item instanceof ItemClass) || !eligibleUse(item)) return;
    const root = html?.[0] ?? html;
    const form = root?.querySelector?.("form#ability-use-form") ?? root?.querySelector?.("form");
    if (!form || form.querySelector(`.${FIELD_CLASS}`)) return;
    const { box, select, versatile } = buildUseField(item, useTargetCheck(item).problem);
    const anchor = form.querySelector(".t20cp-situational") ?? form.querySelector("[name=rollKeep]")?.closest?.(".form-group");
    if (anchor?.after) anchor.after(box);
    else form.append(box);
    select.addEventListener("change", () => {
      if (versatile) versatile.checked = versatileDefault(select.value, item.system?.propriedades);
      // A maneuver deals no damage: the lethal/nonlethal choice (and its -5) does not apply.
      for (const input of form.querySelectorAll(`[name="${NONLETHAL_FIELD}"]`)) input.disabled = !!select.value;
    });
    app.setPosition?.({ height: "auto" });
  } catch (err) {
    console.error(`${LOG} failed to add the maneuver to the use dialog`, err);
  }
}

/** Checks shared by Resistir and Dar passagem; returns the target actor or null (after a warning). */
function checkResistance(card, data) {
  if (data.concealment) return warn("Concealed");
  if (visibleResults(card.id).length) return warn("Resolved");
  const actor = fromUuid(data.target?.uuid)?.actor ?? null;
  if (!actor || (data.attacker?.actorUuid && !fromUuid(data.attacker.actorUuid))) return warn("Missing");
  if (!canResist(actor)) return warn("NotOwner");
  return actor;
}

async function createResult(card, data, { passage, defender, rolls }) {
  const outcome = passage
    ? { winner: "passage", margin: 0, tieBreak: false, condition: null, pushMeters: 0, noteKey: "passage" }
    : maneuverOutcome(data.kind, resolveOpposed(data.attack, defender));
  const result = {
    v: DATA_VERSION,
    of: card.id,
    kind: data.kind,
    passage,
    attacker: data.attacker,
    target: data.target,
    attack: data.attack,
    defender: passage ? null : defender,
    outcome
  };
  const chatData = {
    user: game.user.id,
    speaker: { scene: null, actor: null, token: null, alias: t("Card.Speaker") },
    content: buildResultContent(result),
    rolls: rollData(rolls),
    flags: { [MODULE_ID]: { [RESULT_FLAG]: result } }
  };
  const inherited = inheritedVisibility(card);
  if (inherited) Object.assign(chatData, inherited);
  else ChatMessage.applyMode(chatData, game.settings.get("core", "messageMode"));
  return ChatMessage.create(chatData);
}

/** "Resistir" on the maneuver card B: the defender's maneuver test, then the result C. Exported for tests. */
export async function onResistClick(card, event) {
  if (!isEnabled()) return null;
  const data = card.getFlag?.(MODULE_ID, MANEUVER_FLAG);
  if (!data || locks.has(card.id)) return null;
  locks.add(card.id);
  try {
    const actor = checkResistance(card, data);
    if (!actor) return null;
    const weapons = maneuverWeapons(actor.items);
    if (!weapons.length && !actor.system?.pericias?.[LUTA]) return warn("NoTest");
    const choice = await promptResist(actor, data.kind, weapons);
    if (!choice) return null;

    let roll = null;
    if (choice.weapon) {
      const weapon = choice.weapon;
      const chatData = await withUsePurpose(USE_PURPOSES.MANEUVER_RESISTANCE, () => weapon.roll({ createMessage: false, event }));
      roll = pickTestRoll(chatData?.rolls);
    } else {
      const skillRoll = await actor.rollPericia(LUTA, { message: false, event });
      roll = pickTestRoll(skillRoll ? [skillRoll] : []);
    }
    const test = attackFromRolls(roll ? [roll] : []);
    if (!test) return null;
    // A result may have arrived while the dialogs were open.
    if (visibleResults(card.id).length) return warn("Resolved");
    if (!isEnabled()) return null;

    const size = actor.system?.tracos?.tamanho ?? null;
    const sizeMod = maneuverSizeModifier(size, CONFIG.T20?.sizeModifiers);
    const totals = maneuverTest(test, { sizeMod, versatile: choice.versatile, other: choice.other });
    const defender = {
      weaponId: choice.weapon?.id ?? null,
      weaponName: choice.weapon?.name ?? null,
      d20: test.d20,
      roll: test.roll,
      sizeMod,
      versatile: choice.versatile,
      other: choice.other,
      ...totals
    };
    return await createResult(card, data, { passage: false, defender, rolls: [roll] });
  } finally {
    locks.delete(card.id);
  }
}

/** "Dar passagem" on an Atropelar card: the advance goes on without a test. Exported for tests. */
export async function onPassageClick(card) {
  if (!isEnabled()) return null;
  const data = card.getFlag?.(MODULE_ID, MANEUVER_FLAG);
  if (!data || data.kind !== "atropelar" || locks.has(card.id)) return null;
  locks.add(card.id);
  try {
    if (!checkResistance(card, data)) return null;
    return await createResult(card, data, { passage: true, defender: null, rolls: [] });
  } finally {
    locks.delete(card.id);
  }
}

/* ----------------- Rendering ----------------- */

function fillNames(html, record) {
  const name = targetNameFor(record, { isGM: !!game.user.isGM, token: fromUuid(record?.uuid) }) ?? t("Card.Target");
  for (const node of html.querySelectorAll(".t20cp-target-name")) node.textContent = name;
}

function host(html) {
  return html.querySelector(".t20cp-maneuver") ?? html.querySelector(".message-content");
}

function renderAttackCard(message, html) {
  if (!isButtonEnabled() || !(message.isAuthor || game.user.isGM)) return;
  if (!isMeleeAttackCard(message.getFlag?.("tormenta20", "itemData")) || !attackFromRolls(message.rolls)) return;
  const content = html.querySelector(".message-content");
  if (!content || content.querySelector(".t20cp-maneuver-actions")) return;
  const footer = el("div", "t20cp-maneuver-actions");
  footer.append(button(t("Button.Maneuver"), (event) => onManeuverClick(message, event)));
  content.append(footer);
}

function renderManeuverCard(message, html, data) {
  fillNames(html, data.target);
  const results = visibleResults(message.id);
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
    footer.append(el("span", "t20cp-maneuver-state", t("Card.Resolved")));
  } else {
    const actor = fromUuid(data.target?.uuid)?.actor ?? null;
    if (!actor || !canResist(actor)) return;
    footer.append(button(t("Button.Resist"), (event) => onResistClick(message, event)));
    if (state === "resist+passage") footer.append(button(t("Button.Passage"), (event) => onPassageClick(message, event)));
  }
  host(html)?.append(footer);
}

function renderResult(message, html, result) {
  fillNames(html, result.target);
  const results = visibleResults(result.of);
  const canonical = findCanonicalResult(results);
  const state = maneuverState({ kind: result.kind, resultIds: results.map((m) => m.id), canonicalId: canonical?.id ?? null, selfId: message.id });
  if (state !== "superseded") return;
  const target = host(html);
  target?.classList?.add?.("t20cp-maneuver-superseded");
  target?.append(el("p", "t20cp-maneuver-state", t("Card.Superseded")));
}

/**
 * Details closed by default; the title opens and closes them on this client only, like the name of the system's item
 * cards (_onChatCardToggleContent). The state survives the re-renders of the card.
 */
function collapse(message, html) {
  const box = html.querySelector(`.${DETAILS_CLASS}`);
  const title = html.querySelector(`.${TITLE_CLASS}`);
  if (!box || !title) return;
  const show = (open) => {
    box.style.display = open ? "" : "none";
    title.classList?.toggle?.("t20cp-maneuver-open", open);
  };
  show(expanded.has(message.id));
  title.addEventListener("click", (event) => {
    event?.preventDefault?.();
    const open = !expanded.has(message.id);
    if (open) expanded.add(message.id);
    else expanded.delete(message.id);
    show(open);
  });
}

/** renderChatMessageHTML. Exported for tests. */
export function onRender(message, html) {
  try {
    if (!isEnabled() || !message?.isContentVisible || !html?.querySelector) return;
    const flags = message.flags?.[MODULE_ID];
    if (flags?.[MANEUVER_FLAG]) {
      collapse(message, html);
      renderManeuverCard(message, html, flags[MANEUVER_FLAG]);
    } else if (flags?.[RESULT_FLAG]) {
      collapse(message, html);
      renderResult(message, html, flags[RESULT_FLAG]);
    } else renderAttackCard(message, html);
  } catch (err) {
    console.error(`${LOG} failed to render`, err);
  }
}

// ChatLog#updateMessage redraws the log and its popout, but not a card opened in its own window.
function redrawMessage(message) {
  ui.chat?.updateMessage?.(message);
  message.render?.(false);
}

/** A result was created, changed or deleted: redraw its maneuver card and the other results of it. */
function onResultChanged(message) {
  const result = message?.flags?.[MODULE_ID]?.[RESULT_FLAG];
  if (!result?.of) return;
  try {
    const card = game.messages?.get?.(result.of);
    if (card) redrawMessage(card);
    for (const other of allMessages()) {
      if (other.id !== message.id && other.flags?.[MODULE_ID]?.[RESULT_FLAG]?.of === result.of) redrawMessage(other);
    }
  } catch (err) {
    console.error(`${LOG} failed to redraw the maneuver`, err);
  }
}

function redrawAll() {
  for (const message of allMessages()) {
    const flags = message.flags?.[MODULE_ID];
    if (flags?.[MANEUVER_FLAG] || flags?.[RESULT_FLAG] || isMeleeAttackCard(message.flags?.tormenta20?.itemData)) {
      redrawMessage(message);
    }
  }
}

export function registerCombatManeuversSetting() {
  game.settings.register(MODULE_ID, COMBAT_MANEUVERS_SETTING, {
    name: "T20CP.CombatManeuvers.Setting.Name",
    hint: "T20CP.CombatManeuvers.Setting.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: { off: "T20CP.CombatManeuvers.Setting.off", on: "T20CP.CombatManeuvers.Setting.on" },
    default: "off",
    onChange: () => redrawAll()
  });
  game.settings.register(MODULE_ID, COMBAT_MANEUVERS_BUTTON_SETTING, {
    name: "T20CP.CombatManeuvers.ButtonSetting.Name",
    hint: "T20CP.CombatManeuvers.ButtonSetting.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: { off: "T20CP.CombatManeuvers.ButtonSetting.off", on: "T20CP.CombatManeuvers.ButtonSetting.on" },
    default: "on",
    onChange: () => redrawAll()
  });
}

/** Installs the rule. The settings are read on every use, render and click, so a change applies without reloading. */
export function installCombatManeuversRule() {
  locks.clear();
  expanded.clear();
  declarations = new WeakMap();
  registerTargetConsumer(isEnabled);
  installUseTargets();
  const proto = CONFIG.Item?.documentClass?.prototype;
  const { displayCard, rollAttack, rollDamage } = proto ?? {};
  if (typeof displayCard !== "function" || typeof rollAttack !== "function" || typeof rollDamage !== "function") {
    throw new Error("ItemT20#rollAttack, #rollDamage or #displayCard not found");
  }

  proto.rollAttack = markWrapper(async function (...args) {
    try {
      declarations.delete(this);
      const declaration = resolveDeclaration(this, args[0]?.options);
      if (declaration) declarations.set(this, declaration);
    } catch (err) {
      console.error(`${LOG} failed to read the declared maneuver of ${this?.name}`, err);
    }
    return rollAttack.apply(this, args);
  }, rollAttack);

  // A declared maneuver deals no damage: the damage is not rolled (the attack roll is the maneuver test).
  proto.rollDamage = markWrapper(async function (...args) {
    let skip = false;
    try {
      skip = declarations.has(this) && !!attackFromRolls(Object.values(this.system?.rolled ?? {}));
    } catch (err) {
      console.error(`${LOG} failed to check the declared maneuver of ${this?.name}`, err);
    }
    if (skip) return undefined;
    return rollDamage.apply(this, args);
  }, rollDamage);

  proto.displayCard = markWrapper(async function (params = {}, ...rest) {
    let card = null;
    let records = null;
    try {
      const declaration = declarations.get(this);
      declarations.delete(this);
      if (declaration) card = declaredCard(this, declaration, params?.rollMode);
      if (!card && isEnabled() && usePurposeOf(this) !== USE_PURPOSES.MANEUVER_RESISTANCE && isMeleeAttackCard(this.system)) {
        // Records frozen when ItemT20#roll started (shared use context), before the use dialog.
        records = useTargetRecords(this).map((r) => ({ uuid: r.uuid, name: r.name, displayName: r.displayName }));
      }
    } catch (err) {
      console.error(`${LOG} failed to prepare the card of ${this?.name}`, err);
    }
    const createMessage = params?.createMessage ?? true;
    if (card) {
      // The maneuver card replaces the system's attack card, but the inner wrappers still run (without a message),
      // so their side effects that belong to the use (e.g. the charge effect of #59) are kept.
      const inner = await displayCard.call(this, { ...params, createMessage: false }, ...rest);
      if (!inner || typeof inner !== "object") return inner;
      return createMessage ? ChatMessage.create(card) : card;
    }
    if (!records) return displayCard.call(this, params, ...rest);
    const chatData = await displayCard.call(this, { ...params, createMessage: false }, ...rest);
    if (!chatData || typeof chatData !== "object") return chatData;
    foundry.utils.setProperty(chatData, `flags.${MODULE_ID}.${TARGETS_FLAG}`, records);
    return createMessage ? ChatMessage.create(chatData) : chatData;
  }, displayCard);

  Hooks.on("renderAbilityUseDialog", onRenderDialog);
  Hooks.on("renderChatMessageHTML", onRender);
  Hooks.on("createChatMessage", onResultChanged);
  Hooks.on("updateChatMessage", onResultChanged);
  Hooks.on("deleteChatMessage", onResultChanged);
}
