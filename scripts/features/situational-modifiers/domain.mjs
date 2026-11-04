/** Pure logic of the "Modificadores situacionais" rule (#59): Table 5-3 choices, roll parts and Defense adjustments. */
import { MODULE_ID } from "../../lib/module.mjs";
import { USE_PURPOSES } from "../../lib/targets.mjs";
import { sanitizeFlavor } from "../../lib/text.mjs";

export const SITUATIONAL_SETTING = "situationalModifiersRule";
export const FORM_ATTACK = "t20cpSituationalAttack";
export const FORM_DEFENSE = "t20cpSituationalDefense";
export const ANY_TARGET = "*";
export const DATA_KEY = "situational";
export const CHARGE_FLAG = "charge";
export const DATA_VERSION = 1;
export const INVISIBLE_STATUS = "invisivel";
export const SECTION_CLASS = "t20cp-situational";
export const NOTE_CLASS = "t20cp-situational-note";

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
