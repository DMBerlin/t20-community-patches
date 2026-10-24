/**
 * Optional rule "Modificadores situacionais" (#59).
 *
 * Book rule (Tormenta20 Jogo do Ano, cap. 5): Table 5-3 (p. 239), "Investida" (p. 235) and "Ataque à distância"
 * (p. 233). The system applies none of these modifiers. With the rule on, the use dialog of items with an attack roll
 * gets a "Situação de combate" section:
 * - attack modifiers go into the formula of the per-use clone, with a label, like the dialog's own bonus (T20:8592);
 * - Defense adjustments are per target and never touch the formula: they are registered in the shared use context
 *   (defenseAdjustmentsFor, read by attack-vs-defense) and recorded in the roll, so the card can show them as a note;
 * - a charge gives the attacker a -2 Defense effect, which the table removes by hand.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";
import {
  addDefenseAdjustments,
  canSeeTokenName,
  installUseTargets,
  registerTargetConsumer,
  USE_PURPOSES,
  usePurposeOf,
  useTargetRecords
} from "./shared/targets.mjs";
import { castCompleted } from "./cast-outcome.mjs";

export const SITUATIONAL_SETTING = "situationalModifiersRule";
export const FORM_ATTACK = "t20cpSituationalAttack";
export const FORM_DEFENSE = "t20cpSituationalDefense";
export const ANY_TARGET = "*";
export const DATA_KEY = "situational";
export const CHARGE_FLAG = "charge";
const DATA_VERSION = 1;
const INVISIBLE_STATUS = "invisivel";
const SECTION_CLASS = "t20cp-situational";
const NOTE_CLASS = "t20cp-situational-note";
const LOG = `${MODULE_ID} | situational-modifiers:`;

export const ATTACK_MODIFIERS = Object.freeze([
  Object.freeze({ id: "flank", value: 2, scope: "melee" }),
  Object.freeze({ id: "charge", value: 2, scope: "melee" }),
  Object.freeze({ id: "elevated", value: 2, scope: "any" }),
  Object.freeze({ id: "firingIntoMelee", value: -5, scope: "ranged" }),
  Object.freeze({ id: "longRange", value: -5, scope: "ranged" })
]);

export const DEFENSE_ADJUSTMENTS = Object.freeze([
  Object.freeze({ id: "cover", delta: 5 }),
  Object.freeze({ id: "invisible", delta: -5 })
]);

/** In the defender's test of a maneuver (#48) only the defender's own higher ground counts. */
export const MANEUVER_ATTACK_IDS = Object.freeze(["elevated"]);

/** @returns {{attack: readonly string[], defense: boolean}} What the use's purpose allows. */
export function allowedModifiers(purpose) {
  return purpose === USE_PURPOSES.MANEUVER_RESISTANCE
    ? { attack: MANEUVER_ATTACK_IDS, defense: false }
    : { attack: ATTACK_MODIFIERS.map((m) => m.id), defense: true };
}

/** FormDataExtended gives a string, null, an array with nulls (several boxes with one name) or undefined. */
export function normalizeValues(raw) {
  return [...new Set((Array.isArray(raw) ? raw : [raw]).filter((v) => typeof v === "string" && v))];
}

export function attackSelection(raw) {
  const known = new Set(ATTACK_MODIFIERS.map((m) => m.id));
  return normalizeValues(raw).filter((id) => known.has(id));
}

/** Roll flavor cannot hold brackets (core:client/dice/grammar.pegjs). */
export const sanitizeFlavor = (text) => String(text ?? "").replace(/[[\]]/g, "").trim();

/** Roll parts in table order; each label becomes the core roll flavor. */
export function attackParts(selection, labels = {}) {
  const chosen = new Set(selection);
  return ATTACK_MODIFIERS.filter((m) => chosen.has(m.id)).map((m) => {
    const label = sanitizeFlavor(labels[m.id] ?? m.id);
    return [label ? `${m.value}[${label}]` : String(m.value), ""];
  });
}

/** Values "<tokenUuid>|<id>" or "*|<id>". The separator is the last "|" (UUIDs have none). */
export function parseDefenseSelection(raw) {
  const known = new Set(DEFENSE_ADJUSTMENTS.map((a) => a.id));
  return normalizeValues(raw).flatMap((value) => {
    const i = value.lastIndexOf("|");
    const target = value.slice(0, i);
    const id = value.slice(i + 1);
    return i > 0 && known.has(id) ? [{ target, id }] : [];
  });
}

/** Adjustments in table order, without repeating an id. @returns {{id: string, delta: number}[]} */
function adjustmentsFor(entries, target) {
  const ids = new Set(entries.filter((e) => e.target === ANY_TARGET || e.target === target).map((e) => e.id));
  return DEFENSE_ADJUSTMENTS.filter((a) => ids.has(a.id)).map(({ id, delta }) => ({ id, delta }));
}

/**
 * Adjustments per target of the use. "*" applies to every target; a UUID only counts when it is one of the frozen
 * targets.
 * @returns {Map<string, {id: string, delta: number}[]>}
 */
export function defenseAdjustmentsByTarget(entries, targetUuids) {
  const byTarget = new Map();
  for (const uuid of targetUuids) {
    const list = adjustmentsFor(entries, uuid);
    if (list.length) byTarget.set(uuid, list);
  }
  return byTarget;
}

/**
 * What the roll records about the Defense: one entry per frozen target with adjustments, in target order, or, when
 * the use had no targets, a single "any target" entry (uuid null) built from the "*" boxes.
 * @param {readonly {uuid: string, name: string, displayName: number}[]} records
 * @param {{target: string, id: string}[]} entries
 */
export function defenseRecord(records, entries) {
  if (!records.length) {
    const adjustments = adjustmentsFor(entries.filter((e) => e.target === ANY_TARGET), ANY_TARGET);
    return adjustments.length ? [{ uuid: null, index: 0, name: "", displayName: 0, adjustments }] : [];
  }
  const byTarget = defenseAdjustmentsByTarget(entries, records.map((r) => r.uuid));
  // index: position among the use's targets, so a hidden name is "Alvo N" in the card as in the dialog.
  return records.flatMap((r, index) =>
    byTarget.has(r.uuid)
      ? [{ uuid: r.uuid, index, name: String(r.name ?? ""), displayName: Number(r.displayName) || 0, adjustments: byTarget.get(r.uuid) }]
      : []
  );
}

export const isChargeEffect = (effect) =>
  effect?.flags?.[MODULE_ID]?.situational === CHARGE_FLAG || effect?.getFlag?.(MODULE_ID, "situational") === CHARGE_FLAG;

/** Only when the actor has no charge effect yet: the -2 does not stack, and the module never deletes or updates it. */
export const shouldCreateCharge = (effects) => ![...(effects ?? [])].some(isChargeEffect);

/**
 * No origin (never suppressed as an unequipped item, never stamped by source-stacking), no statuses and no duration:
 * removal is manual, so the icon is always shown (CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS).
 */
export function chargeEffectData({ name, description }) {
  return {
    name,
    description,
    img: "icons/svg/downgrade.svg",
    type: "base",
    showIcon: 2,
    system: { changes: [{ key: "system.attributes.defesa.bonus", type: "add", value: "-2", phase: "initial" }] },
    flags: { [MODULE_ID]: { situational: CHARGE_FLAG } }
  };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function ruleOn() {
  try {
    return game.settings.get(MODULE_ID, SITUATIONAL_SETTING) === "on";
  } catch {
    return false;
  }
}

const t = (key) => game.i18n.localize(`T20CP.SituationalModifiers.${key}`);

function adjustmentLabel(id) {
  const key = `T20CP.DefenseAdjustment.${id}`;
  return game.i18n.has(key) ? game.i18n.localize(key) : String(id);
}

function hasAttackRoll(item) {
  return !!item?.system?.rolls?.some?.((r) => r?.type === "ataque" && r.parts?.[0]?.[0]);
}

/** Name of a target for the current user: the recorded name, or "Alvo N" (same policy as attack-vs-defense). */
export function targetLabel(record, index) {
  if (!record?.uuid) return t("AnyTarget");
  let live = null;
  try {
    live = foundry.utils.fromUuidSync(record.uuid);
  } catch {}
  const visible = canSeeTokenName({
    isGM: !!game.user?.isGM,
    isOwner: !!live?.isOwner,
    displayName: live ? live.displayName : record.displayName
  });
  return visible ? String(record.name ?? "") : game.i18n.format("T20CP.SituationalModifiers.TargetN", { n: index + 1 });
}

function checkbox(name, value, text, tooltip, checked = false) {
  const label = document.createElement("label");
  label.className = "checkbox";
  label.style.cssText = "display:flex; align-items:center; gap:4px; flex:none; margin-right:8px;";
  if (tooltip) label.dataset.tooltip = tooltip;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = name;
  input.value = value;
  input.checked = !!checked;
  label.append(input, document.createTextNode(text));
  return label;
}

function row(title, boxes) {
  const div = document.createElement("div");
  div.className = "form-group";
  const label = document.createElement("label");
  label.textContent = title;
  const fields = document.createElement("div");
  fields.className = "form-fields";
  fields.style.cssText = "flex-wrap:wrap; justify-content:flex-start;";
  fields.append(...boxes);
  div.append(label, fields);
  return div;
}

/** The dialog section. Exported for tests. */
export function buildSection(item, records, allowed) {
  const section = document.createElement("fieldset");
  section.className = SECTION_CLASS;
  section.dataset.tooltip = t("Reference");
  const legend = document.createElement("legend");
  legend.textContent = t("Section");
  section.append(legend);

  const attack = ATTACK_MODIFIERS.filter((m) => allowed.attack.includes(m.id)).map((m) =>
    checkbox(FORM_ATTACK, m.id, t(`Attack.${m.id}`), t(`Tooltip.${m.id}`))
  );
  section.append(row(t("AttackLegend"), attack));

  if (allowed.defense) {
    const invisible = !!item?.actor?.statuses?.has?.(INVISIBLE_STATUS);
    const targets = records.length ? records : [{ uuid: null }];
    const subtitle = document.createElement("p");
    subtitle.className = "hint";
    subtitle.style.margin = "4px 0 0";
    subtitle.textContent = t("DefenseLegend");
    section.append(subtitle);
    targets.forEach((record, index) => {
      const key = record.uuid ?? ANY_TARGET;
      const boxes = DEFENSE_ADJUSTMENTS.map((a) =>
        checkbox(FORM_DEFENSE, `${key}|${a.id}`, t(`Defense.${a.id}`), t(`Tooltip.${a.id}`), a.id === "invisible" && invisible)
      );
      section.append(row(targetLabel(record, index), boxes));
    });
  }
  return section;
}

/** renderAbilityUseDialog: adds the section once, after "Melhor/Pior de 2d20". Exported for tests. */
export function onRenderDialog(app, html) {
  if (!ruleOn()) return;
  const item = app?.item;
  const ItemClass = CONFIG.Item?.documentClass;
  if (!ItemClass || !(item instanceof ItemClass) || !hasAttackRoll(item)) return;
  const root = html?.[0] ?? html;
  const form = root?.querySelector?.("form#ability-use-form") ?? root?.querySelector?.("form");
  if (!form || form.querySelector(`.${SECTION_CLASS}`)) return;
  const allowed = allowedModifiers(usePurposeOf(item));
  // The records frozen when ItemT20#roll started; changing targets with the dialog open changes nothing.
  const section = buildSection(item, allowed.defense ? useTargetRecords(item) : [], allowed);
  const anchor = form.querySelector("[name=rollKeep]")?.closest?.(".form-group");
  if (anchor) anchor.after(section);
  else form.append(section);
  app.setPosition?.({ height: "auto" });
}

/** options objects already handled; there is one per use (ItemT20#roll). */
const prepared = new WeakSet();

/**
 * Filters the dialog choices by the use's purpose, adds the attack parts to the first attack roll of the clone (the
 * one getAttackToHit reads, T20:8151) and registers the Defense adjustments. Exported for tests.
 * @returns {{attack: string[], defense: object[]} | null}  What to record in the rolls.
 */
export function prepareUse(item, options) {
  if (!options || typeof options !== "object" || prepared.has(options) || !ruleOn()) return null;
  if (!(FORM_ATTACK in options) && !(FORM_DEFENSE in options)) return null;
  prepared.add(options);
  const allowed = allowedModifiers(usePurposeOf(item));
  const attack = attackSelection(options[FORM_ATTACK]).filter((id) => allowed.attack.includes(id));
  const entries = allowed.defense ? parseDefenseSelection(options[FORM_DEFENSE]) : [];
  options[FORM_ATTACK] = attack;
  options[FORM_DEFENSE] = entries.map((e) => `${e.target}|${e.id}`);

  if (attack.length) {
    const first = item?.system?.rolls?.find?.((r) => r?.type === "ataque");
    const labels = Object.fromEntries(attack.map((id) => [id, t(`Label.${id}`)]));
    if (Array.isArray(first?.parts)) first.parts.push(...attackParts(attack, labels));
  }

  const records = allowed.defense ? useTargetRecords(item) : [];
  const byTarget = defenseAdjustmentsByTarget(entries, records.map((r) => r.uuid));
  if (byTarget.size) addDefenseAdjustments(item, byTarget);
  const defense = defenseRecord(records, entries);
  return attack.length || defense.length ? { attack, defense } : null;
}

/** Records the choices in every attack roll of the clone, next to the other rules' keys. Exported for tests. */
export function writeRecord(item, record) {
  const rolled = item?.system?.rolled;
  if (!rolled) return;
  for (const r of item.system.rolls ?? []) {
    if (r?.type !== "ataque") continue;
    const roll = rolled[r.name];
    if (!roll?.options) continue;
    (roll.options[MODULE_ID] ??= {})[DATA_KEY] = { v: DATA_VERSION, attack: [...record.attack], defense: record.defense };
  }
}

/** Actors whose charge effect is being created by this client: two quick uses do not create two. */
const pendingCharges = new Set();

/** Creates the charge effect unless the actor already has one. Exported for tests. */
export async function applyCharge(actor) {
  if (!actor?.isOwner) return;
  const key = actor.uuid ?? actor;
  if (pendingCharges.has(key) || !shouldCreateCharge(actor.effects)) return;
  pendingCharges.add(key);
  try {
    await actor.createEmbeddedDocuments("ActiveEffect", [
      chargeEffectData({ name: t("ChargeEffect.Name"), description: t("ChargeEffect.Description") })
    ]);
  } finally {
    pendingCharges.delete(key);
  }
}

/** Adds the "Defesa do alvo" note under each attack roll that has adjustments and no attack-vs-defense result. */
export function decorate(message, html) {
  if (!message?.isContentVisible || !html?.querySelectorAll) return;
  const containers = [...html.querySelectorAll(".roll[data-roll-title]")];
  for (const roll of message.rolls ?? []) {
    const own = roll?.options?.[MODULE_ID];
    const data = own?.[DATA_KEY];
    if (data?.v !== DATA_VERSION || !Array.isArray(data.defense) || !data.defense.length) continue;
    // attack-vs-defense already lists the adjustments of every compared target.
    if (own.attackVsDefense?.targets?.length) continue;
    const container = containers.find((el) => el.dataset.rollTitle === roll.options.title);
    if (!container || container.querySelector(`.${NOTE_CLASS}`)) continue;
    const box = document.createElement("div");
    box.className = NOTE_CLASS;
    box.style.cssText = "margin:2px 0 4px; font-size:var(--font-size-12, 12px);";
    box.dataset.tooltip = t("Reference");
    const title = document.createElement("p");
    title.style.margin = "0";
    title.textContent = `${t("NoteTitle")}:`;
    const list = document.createElement("ul");
    list.style.cssText = "margin:0; padding-left:1em;";
    data.defense.forEach((target, index) => {
      const li = document.createElement("li");
      const strong = document.createElement("strong");
      strong.textContent = `${targetLabel(target, Number.isInteger(target.index) ? target.index : index)}: `;
      const text = (target.adjustments ?? []).map((a) => adjustmentLabel(a.id)).join(" · ");
      li.append(strong, document.createTextNode(text));
      list.append(li);
    });
    box.append(title, list);
    container.append(box);
  }
}

/** Registers the world setting. Runs on "init" for every system, so the setting always exists. */
export function registerSituationalModifiersSetting() {
  game.settings.register(MODULE_ID, SITUATIONAL_SETTING, {
    name: "T20CP.SituationalModifiers.Setting.Name",
    hint: "T20CP.SituationalModifiers.Setting.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: { off: "T20CP.SituationalModifiers.Setting.off", on: "T20CP.SituationalModifiers.Setting.on" },
    default: "off"
  });
}

/** Installs the rule. The setting is read on every use, so a change applies without reloading. */
export function installSituationalModifiersRule() {
  const proto = CONFIG.Item?.documentClass?.prototype;
  const rollAttack = proto?.rollAttack;
  const displayCard = proto?.displayCard;
  if (typeof rollAttack !== "function" || typeof displayCard !== "function") {
    throw new Error("ItemT20#rollAttack or #displayCard not found");
  }
  registerTargetConsumer(ruleOn);
  installUseTargets();

  proto.rollAttack = markWrapper(async function (...args) {
    let record = null;
    try {
      record = prepareUse(this, args[0]?.options);
    } catch (err) {
      console.error(`${LOG} failed to apply the modifiers`, err);
    }
    const result = await rollAttack.apply(this, args);
    if (record) {
      try {
        writeRecord(this, record);
      } catch (err) {
        console.error(`${LOG} failed to record the modifiers`, err);
      }
    }
    return result;
  }, rollAttack);

  proto.displayCard = markWrapper(async function (...args) {
    let charge = false;
    const options = args[0]?.options;
    try {
      // prepareUse ran on this options object (an attack was rolled) and already filtered it by the use's purpose.
      charge =
        ruleOn() &&
        prepared.has(options) &&
        usePurposeOf(this) !== USE_PURPOSES.MANEUVER_RESISTANCE &&
        Array.isArray(options[FORM_ATTACK]) &&
        options[FORM_ATTACK].includes("charge");
    } catch (err) {
      console.error(`${LOG} failed to read the charge`, err);
    }
    const result = await displayCard.apply(this, args);
    if (charge && castCompleted(result, options)) {
      try {
        await applyCharge(this.actor);
      } catch (err) {
        console.error(`${LOG} failed to create the charge effect`, err);
      }
    }
    return result;
  }, displayCard);

  Hooks.on("renderAbilityUseDialog", (app, html) => {
    try {
      onRenderDialog(app, html);
    } catch (err) {
      console.error(`${LOG} failed to render the dialog section`, err);
    }
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    try {
      decorate(message, html);
    } catch (err) {
      console.error(`${LOG} failed to show the Defense note`, err);
    }
  });
}
