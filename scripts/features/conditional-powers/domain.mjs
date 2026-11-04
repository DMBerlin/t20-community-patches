import { stripComments } from "../../lib/source.mjs";

const POWERS = "Compendium.tormenta20.poderes.Item.";
const DEFENSE = "system.attributes.defesa.bonus";

/**
 * Known conditional passive effects. `source`/`effectId` identify the compendium effect; `item`/`effect` are the
 * item and effect names, used only for official copies whose effect id changed and for items without origin. `keys` are the change keys the
 * effect may have: an effect with any other key was customized and is left alone.
 */
export const CONDITIONAL_POWERS = [
  { item: "Estilo de Duas Mãos", source: `${POWERS}aeXR1kOB1PZt2sUL`, effectId: "BBiO7aceLqeW90k2",
    effect: "Estilo de Duas Mãos", keys: ["system.modificadores.dano.cac"], condition: "two-handed-melee" },
  { item: "Estilo de Uma Arma", source: `${POWERS}1exB4BFKdPWFOZwV`, effectId: "B4V2txyvBXZ3Goeh",
    effect: "Estilo de Uma Arma", keys: [DEFENSE], condition: "single-melee" },
  { item: "Estilo de Arma e Escudo", source: `${POWERS}jnejEG7oaQrHKlCG`, effectId: "dUOu223E4E9DnIvd",
    effect: "Estilo de Arma e Escudo", keys: [DEFENSE], condition: "shield" },
  { item: "Encouraçado", source: `${POWERS}VQMc6Kc7AwsT2ab7`, effectId: "GXVs0iml2rfBR3UV",
    effect: "Encouraçado", keys: [DEFENSE], condition: "heavy-armor" },
  { item: "Fanático", source: `${POWERS}lno7NNNEUJJhhMZO`, effectId: "L2MdRZH3u7EMow0O",
    effect: "Encouraçado +2", keys: [DEFENSE], condition: "heavy-armor" },
  { item: "Inexpugnável", source: `${POWERS}5Ti6oLK8wRgjLWcM`, effectId: "oIYXRlRRgP8hH5ZD",
    effect: "Inexpugnável", keys: ["system.modificadores.pericias.resistencia", DEFENSE], condition: "heavy-armor" }
];

export const UNARMED = { item: "Ataque desarmado", source: "Compendium.tormenta20.equipamentos.Item.NFepeG0ojjq3Xggs" };
export const FANATIC = { item: "Fanático", source: `${POWERS}lno7NNNEUJJhhMZO` };
export const IGNORE_ARMOR_TAG = "ignora-armadura";

/** Compendium origin of an item (current and legacy field). */
export function itemSource(item) {
  return item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? "";
}

/**
 * Rule of a power's passive effect, or null. Only passive transferred effects of "poder" items whose change keys
 * all belong to the rule are recognized.
 * - Official origin: matched by effect id, or by effect name (copies whose effect id was regenerated).
 * - Any other origin (homebrew compendium, world item): never recognized, even with the same names.
 * - No origin: matched by item name and effect name.
 * @param {object} info
 * @param {string} info.itemType
 * @param {string} [info.source]
 * @param {string} [info.itemName]
 * @param {string} [info.effectId]
 * @param {string} [info.effectName]
 * @param {boolean} [info.onuse]
 * @param {boolean} [info.transfer]
 * @param {string[]} [info.changeKeys]
 * @param {typeof CONDITIONAL_POWERS} [rules]
 */
export function findRule(info, rules = CONDITIONAL_POWERS) {
  if (info?.itemType !== "poder" || info.onuse || !info.transfer) return null;
  const keys = info.changeKeys ?? [];
  if (!keys.length) return null;
  const rule = ruleByIdentity(info, rules);
  if (!rule) return null;
  return keys.every((key) => rule.keys.includes(key)) ? rule : null;
}

/** The rule matched by origin and ids or, without origin, by item and effect names (change keys not checked). */
function ruleByIdentity(info, rules) {
  const source = String(info.source ?? "");
  const itemName = String(info.itemName ?? "").trim();
  const effectName = String(info.effectName ?? "").trim();
  if (source) {
    const official = rules.filter((r) => r.source === source);
    return official.find((r) => r.effectId === info.effectId) ?? official.find((r) => r.effect === effectName);
  }
  return rules.find((r) => itemName === r.item && effectName === r.effect);
}

/** Same test as the system (prepareDefense's `equipado2.slot` filter, T20:18728-18730, and `areEffectsSuppressed`, T20:6914-6920). */
export function isEquipped(item, slots) {
  return Boolean(slots ? Number(item?.system?.equipado2?.slot) : item?.system?.equipado);
}

const isHandSlot = (slot) => Math.round((Number(slot) % 1) * 10) === 1;

/** The unarmed attack does not occupy a hand ("nada na outra"). */
export function isUnarmed(weapon) {
  return itemSource(weapon) === UNARMED.source || String(weapon?.name ?? "").trim() === UNARMED.item;
}

export function isMeleeWeapon(weapon) {
  const attack = (weapon?.system?.rolls ?? []).find((roll) => roll?.type === "ataque");
  const skill = attack?.parts?.[1]?.[0];
  if (skill) return skill === "luta";
  return !weapon?.system?.propriedades?.ataqueDistancia;
}

export function isLightWeapon(weapon) {
  return weapon?.system?.empunhadura === "leve" || Boolean(weapon?.system?.propriedades?.leve);
}

/** A two-handed weapon always uses both hands; otherwise it is the "Equipar em Duas Mãos" state (`equipado2.slot`, T20:7384). */
export function usesTwoHands(weapon, slots) {
  if (weapon?.system?.empunhadura === "duas") return true;
  return slots ? Math.floor(Number(weapon?.system?.equipado2?.slot)) === 12 : weapon?.system?.equipado === 2;
}

/**
 * What the actor has equipped, as far as the powers care.
 * @param {Iterable<object>} items
 * @param {boolean} slots  "Controlar Itens Equipáveis" (tormenta20.equipmentSlots)
 */
export function summarizeLoadout(items, slots) {
  const loadout = { heavyArmor: false, shield: false, weapons: [], otherHands: 0 };
  for (const item of items ?? []) {
    if (!isEquipped(item, slots)) continue;
    if (item.type === "equipamento") addEquipment(loadout, item, slots);
    else if (item.type === "arma" && item.system?.proficiencia !== "natural" && !isUnarmed(item)) {
      loadout.weapons.push({ melee: isMeleeWeapon(item), light: isLightWeapon(item), twoHands: usesTwoHands(item, slots) });
    }
  }
  return loadout;
}

/** Armor, shield or another hand item of the loadout. */
function addEquipment(loadout, item, slots) {
  const tipo = item.system?.tipo;
  if (tipo === "pesada") loadout.heavyArmor = true;
  if (tipo === "escudo") {
    loadout.shield = true;
    loadout.otherHands++;
  } else if (slots && isHandSlot(item.system?.equipado2?.slot)) loadout.otherHands++;
}

/**
 * @param {string} condition
 * @param {ReturnType<typeof summarizeLoadout>} loadout
 * @param {string} actorType
 * @returns {"met"|"unmet"|"unknown"}
 */
export function evaluateCondition(condition, loadout, actorType) {
  const evaluate = Object.hasOwn(CONDITIONS, condition) ? CONDITIONS[condition] : null;
  if (!evaluate) return "unknown";
  return evaluate(loadout, actorType);
}

const outcome = (met) => (met ? "met" : "unmet");

const CONDITIONS = {
  "heavy-armor": (loadout) => outcome(loadout.heavyArmor),
  shield: (loadout) => outcome(loadout.shield),
  "two-handed-melee": (loadout, actorType) => {
    if (actorType !== "character") return "unknown";
    return outcome(loadout.weapons.some((w) => w.melee && !w.light && w.twoHands));
  },
  "single-melee": (loadout, actorType) => {
    if (actorType !== "character") return "unknown";
    const [weapon, ...others] = loadout.weapons;
    return outcome(weapon && !others.length && !loadout.otherHands && weapon.melee && !weapon.twoHands);
  }
};

/**
 * Whether a known conditional effect must be suppressed because its condition is proven unmet.
 * @param {object} effect  ActiveEffect
 * @param {boolean} slots
 */
export function isConditionSuppressed(effect, slots) {
  const item = effect?.parent;
  if (item?.documentName !== "Item") return false;
  const actor = item.parent;
  if (actor?.documentName !== "Actor") return false;
  const rule = findRule({
    itemType: item.type,
    source: itemSource(item),
    itemName: item.name,
    effectId: effect.id,
    effectName: effect.name,
    onuse: Boolean(effect.system?.onuse),
    transfer: Boolean(effect.transfer),
    changeKeys: (effect.system?.changes ?? []).map((change) => change?.key).filter(Boolean)
  });
  if (!rule) return false;
  return evaluateCondition(rule.condition, summarizeLoadout(actor.items, slots), actor.type) === "unmet";
}

/** @param {Iterable<object>} items */
export function ownsFanatic(items) {
  for (const item of items ?? []) {
    if (item?.type !== "poder") continue;
    const source = itemSource(item);
    if (source ? source === FANATIC.source : String(item.name ?? "").trim() === FANATIC.item) return true;
  }
  return false;
}

/** Getters of tormenta20 1.6.5, without comments and whitespace: ActiveEffectT20 (T20:18056) and BaseEffect (T20:17728). */
export const KNOWN_DOCUMENT_GETTER =
  "getisSuppressed(){if(this._suppressed)returnthis._suppressed;this._suppressed=super.isSuppressed;returnthis._suppressed;}";
export const KNOWN_BASE_GETTER =
  "getisSuppressed(){if(!this.parent.isEmbedded)returnfalse;if(!this.parent.target)returnfalse;" +
  "if(this.parent.target.documentName!=\"Actor\")returnfalse;letsuppressed=super.isSuppressed??false;" +
  "if(!suppressed)suppressed=this.isSuppressedByEquipment;if(this.status){" +
  "if(!suppressed)suppressed=this.isSuppressedByInheritance;if(!suppressed)suppressed=this.isSuppressedByDuplicated;" +
  "if(!suppressed)suppressed=this.isSuppressedByUpgrade;if(!suppressed)suppressed=this.isSuppressedByImunity;}" +
  "returnsuppressed;}";

/** Source without comments and whitespace (no string in these getters has spaces). */
export function normalizeSource(source) {
  return typeof source === "string" ? stripComments(source).replace(/\s+/g, "") : "";
}

/**
 * Diagnosis from the source of the two suppression getters. Only the exact 1.6.5 implementations (ignoring
 * comments and whitespace) are "present"; anything else (another version, extra checks, another module's wrapper,
 * delegation) is "unknown". Nothing is executed, and reading source never proves a fix, so it is never fixed/high.
 * @param {string|undefined} documentSource
 * @param {string|undefined} baseSource
 * @returns {import("../../registry.mjs").Diagnosis}
 */
export function diagnose(documentSource, baseSource) {
  if (normalizeSource(documentSource) !== KNOWN_DOCUMENT_GETTER || normalizeSource(baseSource) !== KNOWN_BASE_GETTER) {
    return { bug: "unknown", confidence: "low", evidence: "isSuppressed implementation not recognized" };
  }
  return { bug: "present", confidence: "low", evidence: "isSuppressed ignores armor, shields and wielded weapons" };
}

export function findDescriptor(proto, key) {
  for (let p = proto; p; p = Object.getPrototypeOf(p)) {
    const descriptor = Object.getOwnPropertyDescriptor(p, key);
    if (descriptor) return descriptor;
  }
  return undefined;
}
