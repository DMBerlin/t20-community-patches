/**
 * Spell DC bonuses (tormenta20 1.6.5).
 *
 * Bug: Tormenta20ItemData#prepareFinalAttributes computes a character's save DC as 10 + half level + ability +
 * item bonus and ignores system.attributes.cd, the "CD de Magias" key shown in the sheet header. For NPCs it uses
 * system.attributes.cd and drops resistencia.bonus (item bonus and "cd" usage effects). Fortalecimento Arcano, a
 * passive +1 (+2 with 4th-circle spells) in the book, ships as a manual, repeatable usage effect.
 *
 * Fix: owned spells of characters use attributes.cd + ability + bonus; NPC items use attributes.cd + bonus.
 * Copies of Fortalecimento Arcano that still have the shipped usage effect become a single passive bonus on
 * attributes.cd, and their usage effects are no longer offered.
 */
import { markWrapper, stripComments, unwrap } from "../utils.mjs";

export const ARCANE_EMPOWERMENT = { id: "KhQoVoaIZ8huXnPY", names: new Set(["fortalecimento arcano"]) };
/** Basic-book classes whose spell progression reaches the 4th circle, and the class level that grants it. */
export const FOURTH_CIRCLE_CLASSES = [
  { id: "TH7OIKaDqtLLQUrs", names: new Set(["arcanista"]), level: 13 },
  { id: "EnHy1teosvZmcp4D", names: new Set(["clérigo", "clerigo"]), level: 13 },
  { id: "u3fr3IOtTXmsk2BT", names: new Set(["bardo"]), level: 14 },
  { id: "ROLLbOHDe9gWNazQ", names: new Set(["druida"]), level: 14 }
];
const DC_KEYS = new Set(["cd", "CD"]);

/** Tormenta20 1.6.5 Tormenta20ItemData#prepareFinalAttributes, without comments and whitespace. */
export const KNOWN_PREPARE_FINAL_ATTRIBUTES = normalizeSource(`prepareFinalAttributes() {
  const item = this.parent;
  const actor = item.parent ?? {};
  if (!item.isOwned) return;
  if ((this.resistencia?.atributo || actor.type === "npc") && this.resistencia?.txt) {
    const atr = foundry.utils.getProperty(actor.system, \`atributos.\${this.resistencia.atributo}.value\`);
    const nvl = Math.floor(foundry.utils.getProperty(actor.system, "attributes.nivel.value") / 2);
    if (actor.type === "npc") this.resistencia.cd = actor.system.attributes.cd;
    else this.resistencia.cd = 10 + nvl + atr + this.resistencia.bonus;
  }
}`);

/** Probe cases. buggy/fixed are the DCs the system's code gives with and without the bug. */
export const PROBE = {
  character: { actorType: "character", itemType: "magia", actorDC: 13, nivel: 4, ability: 3, bonus: 0, buggy: 15, fixed: 16 },
  npcSpell: { actorType: "npc", itemType: "magia", actorDC: 20, nivel: 20, ability: 0, bonus: 2, buggy: 20, fixed: 22 },
  npcPower: { actorType: "npc", itemType: "poder", actorDC: 20, nivel: 20, ability: 0, bonus: 2, buggy: 20, fixed: 22 }
};

/**
 * Source text without comments and whitespace, for exact comparison.
 * @param {string} source
 * @returns {string}
 */
export function normalizeSource(source) {
  return typeof source === "string" ? stripComments(source).replace(/\s+/g, "") : "";
}

/**
 * Whether a document is a copy of a compendium entry, by source id or by name.
 * @param {{name?: string, _stats?: {compendiumSource?: string}, flags?: object}} doc
 * @param {{id: string, names: Set<string>}} ref
 * @returns {boolean}
 */
export function matchesSource(doc, { id, names }) {
  if (sourceId(doc) === id) return true;
  return names.has(String(doc?.name ?? "").trim().toLowerCase());
}

/**
 * Last segment of the document's compendium source, or "".
 * @param {{_stats?: {compendiumSource?: string}, flags?: object}} doc
 * @returns {string}
 */
export function sourceId(doc) {
  const source = String(doc?._stats?.compendiumSource ?? doc?.flags?.core?.sourceId ?? "");
  return source ? source.split(".").pop() : "";
}

/**
 * Source ids of the 14 official classes of tormenta20.classes (1.6.5) that have no spell progression.
 * Arcanista, Bardo, Clérigo and Druida are in FOURTH_CIRCLE_CLASSES.
 */
export const NON_CASTER_CLASS_IDS = new Set([
  "FiMbJLurhpstUxu1", // Bárbaro
  "uvMolF7vcMs0KbQl", // Bucaneiro
  "xwI9ItqovNe5RMdF", // Caçador
  "fzTv6gS1qu4lpstx", // Cavaleiro
  "DPhWNP689FygcOSZ", // Guerreiro
  "WAyBowpFRVKRr0mq", // Inventor
  "hBx9rVg3XGQ5wsd1", // Ladino
  "pBABExUf8ATkRnHM", // Lutador
  "kg8tLXlPNJSlwWcc", // Nobre
  "VnjstNLqk1lgxsEn" // Paladino
]);

/**
 * The 4th-circle progression of a class item. An official source id wins over any name: a caster class gets its
 * progression and a non-caster class gets none. The name is only a fallback when the source is missing or is not
 * an official class.
 * @param {object} item
 * @returns {{id: string, names: Set<string>, level: number}|undefined}
 */
export function classProgression(item) {
  const id = sourceId(item);
  const bySource = FOURTH_CIRCLE_CLASSES.find((ref) => ref.id === id);
  if (bySource) return bySource;
  if (NON_CASTER_CLASS_IDS.has(id)) return undefined;
  const name = String(item?.name ?? "").trim().toLowerCase();
  return FOURTH_CIRCLE_CLASSES.find((ref) => ref.names.has(name));
}

/**
 * Corrected save DC of an owned item, or undefined to keep the system's value.
 * @param {object} args
 * @param {string} args.actorType   Actor type ("character", "npc", ...)
 * @param {string} args.itemType    Item type ("magia", "poder", ...)
 * @param {number} args.actorDC     actor.system.attributes.cd, after active effects
 * @param {number} [args.ability]   Value of the item's DC ability (characters)
 * @param {number} [args.bonus]     resistencia.bonus (item field plus "cd" usage effects)
 * @returns {number|undefined}
 */
export function correctedSaveDC({ actorType, itemType, actorDC, ability, bonus }) {
  const base = Number(actorDC);
  if (!Number.isFinite(base)) return undefined;
  const extra = Number(bonus) || 0;
  if (actorType === "npc") return base + extra;
  if (actorType !== "character" || itemType !== "magia") return undefined;
  const value = Number(ability);
  return Number.isFinite(value) ? base + value + extra : undefined;
}

/**
 * Fortalecimento Arcano bonus: +2 when the character can cast 4th-circle spells, otherwise +1.
 * @param {{maxCircle?: number, fourthCircleClass?: boolean}} progress
 * @returns {1|2}
 */
export function arcaneEmpowermentBonus({ maxCircle = 0, fourthCircleClass = false } = {}) {
  return maxCircle >= 4 || fourthCircleClass ? 2 : 1;
}

/**
 * Highest circle among the actor's spells (the same measure as the system's @circulo), and whether any single
 * class has the level that grants 4th-circle spells. Class levels are not added across classes (book, p. 35).
 * @param {Iterable<object>} items
 * @returns {{maxCircle: number, fourthCircleClass: boolean}}
 */
export function casterProgress(items) {
  let maxCircle = 0;
  const levels = new Map();
  for (const item of items ?? []) {
    if (item?.type === "magia") {
      maxCircle = Math.max(maxCircle, Number(item.system?.circulo) || 0);
      continue;
    }
    if (item?.type !== "classe") continue;
    const progression = classProgression(item);
    if (progression) levels.set(progression, (levels.get(progression) ?? 0) + (Number(item.system?.niveis) || 0));
  }
  const fourthCircleClass = [...levels].some(([progression, level]) => level >= progression.level);
  return { maxCircle, fourthCircleClass };
}

const asArray = (value) => (value instanceof Set ? [...value] : Array.isArray(value) ? value : []);

/**
 * Whether an effect is the usage effect shipped with Fortalecimento Arcano: one "CD"/"cd" add 1 change,
 * repeatable, no cost, spells only, not temporary (the system never offers temporary item effects, T20:8070).
 * "Aplicar Sempre" (automatic) may be on or off.
 * @param {object} effect
 * @returns {boolean}
 */
export function isShippedEmpowermentEffect(effect) {
  const system = effect?.system;
  const changes = system?.changes;
  if (system?.onuse !== true || effect.isTemporary === true || !Array.isArray(changes) || changes.length !== 1) return false;
  const [change] = changes;
  if (!DC_KEYS.has(change?.key) || change?.type !== "add" || Number(change?.value) !== 1) return false;
  const use = system.abilityUse ?? {};
  if (use.aumenta !== true || ![null, undefined, 0].includes(use.custo)) return false;
  const types = asArray(use.types);
  return types.length === 1 && types[0] === "spell" && asArray(use.names).length === 0;
}

/**
 * Every Fortalecimento Arcano of the actor that still has exactly the shipped usage effect.
 * @param {Iterable<object>} items
 * @returns {object[]}
 */
export function findArcaneEmpowerments(items) {
  const found = [];
  for (const item of items ?? []) {
    if (item?.type !== "poder" || !matchesSource(item, ARCANE_EMPOWERMENT)) continue;
    const effects = Array.from(item.effects ?? []);
    if (effects.length === 1 && isShippedEmpowermentEffect(effects[0])) found.push(item);
  }
  return found;
}

/**
 * Removes the usage effects of the converted Fortalecimento Arcano copies.
 * @param {object[]} effects
 * @param {object[]} empowerments
 * @returns {object[]}
 */
export function withoutEmpowermentEffects(effects, empowerments) {
  const ids = new Set(empowerments.map((item) => item.id));
  return effects.filter((effect) => !ids.has(effect?.parent?.id) || !isShippedEmpowermentEffect(effect));
}

/**
 * Interprets the system's original DC for the probe cases.
 * @param {Record<keyof PROBE, unknown>} results
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseSaveDC(results) {
  const unchecked = "Fortalecimento Arcano not checked";
  const keys = Object.keys(PROBE);
  const buggy = keys.filter((k) => results?.[k] === PROBE[k].buggy);
  const fixed = keys.filter((k) => results?.[k] === PROBE[k].fixed);
  if (buggy.length) {
    const other = keys.filter((k) => !buggy.includes(k));
    const notConfirmed = other.length ? `; not confirmed in ${other.join(", ")}` : "";
    return { bug: "present", confidence: "low", evidence: `bug in ${buggy.join(", ")}${notConfirmed}; ${unchecked}` };
  }
  if (fixed.length === keys.length) return { bug: "fixed", confidence: "low", evidence: `save DC uses the bonuses; ${unchecked}` };
  return { bug: "unknown", confidence: "low", evidence: keys.map((k) => `${k} ${results?.[k]}`).join(", ") };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function itemDataPrototype() {
  let proto = CONFIG.Item.dataModels?.magia?.prototype;
  while (proto && !Object.hasOwn(proto, "prepareFinalAttributes")) proto = Object.getPrototypeOf(proto);
  return proto ?? null;
}

function fixSaveDC(data) {
  const item = data.parent;
  const actor = item?.parent;
  const save = data.resistencia;
  if (!item?.isOwned || !actor || !save?.txt) return;
  if (!save.atributo && actor.type !== "npc") return;
  const dc = correctedSaveDC({
    actorType: actor.type,
    itemType: item.type,
    actorDC: actor.system?.attributes?.cd,
    ability: foundry.utils.getProperty(actor.system, `atributos.${save.atributo}.value`),
    bonus: save.bonus
  });
  if (dc !== undefined) save.cd = dc;
}

function apply() {
  const itemData = itemDataPrototype();
  const characterData = CONFIG.Actor.dataModels?.character?.prototype;
  const ItemClass = CONFIG.Item.documentClass;
  if (!itemData || typeof characterData?.prepareBaseData !== "function" || typeof ItemClass.prototype._allApplicableOnUseEffects !== "function") {
    throw new Error("Tormenta20 save DC API not found");
  }

  const prepareFinalAttributes = itemData.prepareFinalAttributes;
  itemData.prepareFinalAttributes = markWrapper(function (...args) {
    const result = prepareFinalAttributes.apply(this, args);
    try {
      fixSaveDC(this);
    } catch (err) {
      console.warn("t20-community-patches | spell-dc-bonus: could not fix the save DC", this.parent?.uuid, err);
    }
    return result;
  }, prepareFinalAttributes);

  const prepareBaseData = characterData.prepareBaseData;
  characterData.prepareBaseData = markWrapper(function (...args) {
    const result = prepareBaseData.apply(this, args);
    try {
      const items = this.parent?.items;
      if (Number.isFinite(this.attributes?.cd) && findArcaneEmpowerments(items).length) {
        this.attributes.cd += arcaneEmpowermentBonus(casterProgress(items));
      }
    } catch (err) {
      console.warn("t20-community-patches | spell-dc-bonus: could not apply Fortalecimento Arcano", this.parent?.uuid, err);
    }
    return result;
  }, prepareBaseData);

  const allApplicable = ItemClass.prototype._allApplicableOnUseEffects;
  ItemClass.prototype._allApplicableOnUseEffects = markWrapper(function (...args) {
    const effects = allApplicable.apply(this, args);
    if (!Array.isArray(effects) || this.actor?.type !== "character") return effects;
    const empowerments = findArcaneEmpowerments(this.actor.items);
    return empowerments.length ? withoutEmpowermentEffects(effects, empowerments) : effects;
  }, allApplicable);
}

/** Runs the recognized 1.6.5 implementation on a synthetic item. Never called for unknown code. */
function runKnown(fn, { actorType, itemType, actorDC, nivel, ability, bonus }) {
  const actor = {
    type: actorType,
    system: { atributos: { int: { value: ability } }, attributes: { cd: actorDC, nivel: { value: nivel } } }
  };
  const data = {
    parent: { type: itemType, isOwned: true, parent: actor },
    resistencia: { txt: "Vontade anula", atributo: "int", bonus, cd: 0 }
  };
  fn.call(data);
  return data.resistencia.cd;
}

function isNeeded() {
  const original = unwrap(itemDataPrototype()?.prepareFinalAttributes);
  if (typeof original !== "function") return { bug: "unknown", confidence: "low", evidence: "prepareFinalAttributes not found" };
  const source = normalizeSource(Function.prototype.toString.call(original));
  if (source !== KNOWN_PREPARE_FINAL_ATTRIBUTES) {
    return { bug: "unknown", confidence: "low", evidence: "prepareFinalAttributes not recognized; not executed" };
  }
  const results = {};
  for (const [key, probe] of Object.entries(PROBE)) results[key] = runKnown(original, probe);
  return diagnoseSaveDC(results);
}

export default {
  id: "spell-dc-bonus",
  group: "items",
  issue: 35,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  apply
};
