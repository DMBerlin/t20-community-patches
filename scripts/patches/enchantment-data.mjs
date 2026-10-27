/**
 * Upgrade and magic item data (tormenta20 1.6.5).
 *
 * Bug: several upgrades of the "tormenta20.efeitos" compendium do not follow the book. Guardião, Protetor,
 * Relampejante, Sombrio, Mitral (armor) and Incandescente are not transferred to the actor (and Incandescente has
 * no change); Gelo Eterno (weapon) uses the key "daon"; Gelo Eterno (armor) gives cold resistance 15 instead of
 * fire 5/10; Adamante (armor) gives DR 7 instead of 2/5; Invulnerável gives Defense instead of DR. The magic item
 * Manto da Resistência comes with its passive effect disabled. Rules that change the upgraded item itself are missing:
 * heavy armor of Mitral (up to 2) or Delicada (up to 1, instead of a flat +1 Defense) lets the wearer apply points of
 * the Defense attribute, and Mitral or Discreto items take –1 space (minimum 1).
 *
 * Fix: while an item effect is prepared, when its compendium source and every relevant field of its source data
 * match the known defect exactly, the prepared copy is corrected in memory (persisted data is never changed).
 * The item rules are applied in memory to the prepared item (`system.armadura.maxAtr`, `system.espacos`); an update
 * that only echoes those prepared values back (the item sheet submits every field) does not persist them.
 * A Manto da Resistência created straight from the compendium data is created with its effect enabled.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";
import { isPatchApplied } from "../registry.mjs";

const DEFENSE = "system.attributes.defesa.bonus";
const PENALTY = "system.attributes.defesa.pda";
const SAVES = "system.modificadores.pericias.resistencia";
const DR = "system.tracos.resistencias.dano.bonus";
const FIRE = "system.tracos.resistencias.fogo.bonus";
const COLD = "system.tracos.resistencias.frio.bonus";
const ELECTRICITY = "system.tracos.resistencias.eletricidade.bonus";
const STEALTH = "system.pericias.furt.bonus";
const ARMOR_TIPOS = new Set(["leve", "pesada", "escudo"]);
const ARMOR_SHIELD = ["armor", "shield"];

/** Change as stored by the compendium (phase "initial", no priority). */
const add = (key, value) => ({ key, type: "add", value, phase: "initial", priority: null });
const passive = { onuse: false, abilityUse: { automatic: false, aumenta: false, types: [] } };
const byArmor = (key, lightOrShield, heavy) => ({ tipo }) =>
  ARMOR_TIPOS.has(tipo) ? [add(key, tipo === "pesada" ? heavy : lightOrShield)] : null;
const invulnerable = ({ tipo }) => (ARMOR_TIPOS.has(tipo) ? [add(DR, tipo === "escudo" ? 2 : 5)] : null);

/**
 * FNV-1a (32 bits) of a string, used to recognize the exact compendium description without embedding it.
 * @param {string} text
 * @returns {string}
 */
export function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Known defects, by id in "tormenta20.efeitos" (kept by "world.item-upgrades").
 * `defect`: every relevant field of the exact source data. `transfer`: corrected transfer. `changes(context)`:
 * corrected changes (null keeps the source changes; a function returning null leaves the effect untouched).
 * `item`: book rules for the upgraded item itself (see correctItem). `itemOnly`: the effect itself is left as is.
 */
export const UPGRADE_FIXES = {
  "87bEYYpPzWdzX3zT": {
    defect: { name: "Guardião", description: ["ea00da39", 150], transfer: false, ...passive,
      identifier: "guardian", upgrade: ["enchantment", ARMOR_SHIELD], changes: [add(DEFENSE, 2)] },
    transfer: true
  },
  "S4FlovY4Qj03y6KB": {
    defect: { name: "Protetor", description: ["fab5c054", 74], transfer: false, ...passive,
      identifier: "protector", upgrade: ["enchantment", ARMOR_SHIELD], changes: [add(SAVES, 2)] },
    transfer: true
  },
  "n39Gxf7O7DPC0R5V": {
    defect: { name: "Relampejante", description: ["b8f1ef9d", 323], transfer: false, ...passive,
      identifier: "lightning", upgrade: ["enchantment", ARMOR_SHIELD], changes: [add(ELECTRICITY, 10)] },
    transfer: true
  },
  "nG4DzcxM7auuQKxw": {
    defect: { name: "Sombrio", description: ["7d893b42", 207], transfer: false, ...passive,
      identifier: "shadow", upgrade: ["enchantment", ARMOR_SHIELD],
      changes: [add(STEALTH, 5), add(STEALTH, "@item.pda")] },
    transfer: true,
    // "@item.pda" cannot be resolved by the actor (the core drops it with a warning); the +5 is kept.
    changes: ({ source }) => [source[0]]
  },
  "K9RtA8a5aPdqyRUR": {
    defect: { name: "Mitral", description: ["eba917f1", 348], transfer: false, ...passive,
      identifier: "mithril", upgrade: ["material", ARMOR_SHIELD], changes: [add(PENALTY, -2)] },
    transfer: true,
    requiresPenaltyFix: true,
    item: { heavyAbility: 2, slots: -1 }
  },
  "7apVrQDXAOmTvcQW": {
    defect: { name: "Mitral", description: ["0ee4d3fc", 294], transfer: false, onuse: true,
      abilityUse: { automatic: true, aumenta: false, types: ["self"] },
      identifier: "mithril", upgrade: ["material", ["weapon"]], changes: [add("criticoM", -1)] },
    itemOnly: true,
    item: { slots: -1 }
  },
  "QL2A7Lhlh9tVDqcB": {
    defect: { name: "Mitral", description: ["469d0f56", 276], transfer: false, onuse: true,
      abilityUse: { automatic: false, aumenta: false, types: ["spell"] },
      identifier: "mithril", upgrade: ["material", ["esoteric"]], changes: [add("cd", 2)] },
    itemOnly: true,
    item: { slots: -1 }
  },
  "0oBNqjSt3Ax3aO3a": {
    defect: { name: "Delicada", description: ["71bf297b", 399], transfer: true, ...passive,
      identifier: "delicate", upgrade: ["improvement", ["armor"]], changes: [add(DEFENSE, 1)] },
    // The flat +1 Defense becomes "apply up to 1 point of the Defense attribute" (correctItem).
    changes: () => [],
    item: { heavyAbility: 1 }
  },
  "SXtfjuLdQwXZUU1t": {
    defect: { name: "Discreto", description: ["f6b617ae", 301], transfer: false, onuse: true,
      abilityUse: { automatic: false, aumenta: false, types: ["skill"] }, identifier: "discreet",
      upgrade: ["improvement", ["weapon", "armor", "shield", "esoteric", "tool", "clothing", "accessory"]],
      changes: [add("roll", 5)] },
    itemOnly: true,
    item: { slots: -1 }
  },
  "UWWimfZsadIwa18F": {
    defect: { name: "Incandescente", description: ["4772333e", 339], transfer: false, ...passive,
      identifier: "incandescent", upgrade: ["enchantment", ARMOR_SHIELD], changes: [] },
    transfer: true,
    changes: () => [add(FIRE, 10)]
  },
  "RKOYBmM5NVeVkAC5": {
    defect: { name: "Gelo Eterno", description: ["440ec913", 268], transfer: false, onuse: true,
      abilityUse: { automatic: true, aumenta: false, types: ["self"] },
      identifier: "everlasting-ice", upgrade: ["material", ["weapon"]], changes: [add("daon", "2[frio]")] },
    // The system appends the weapon damage type to non-dice values (T20 applyRollChanges), so "2[frio]" would roll as "2[frio][corte]".
    changes: ({ source }) => [{ ...source[0], key: "dano", value: "2" }]
  },
  "tdrbB9k7sDcQbhPr": {
    defect: { name: "Gelo Eterno", description: ["089226ba", 318], transfer: true, ...passive,
      identifier: "everlasting-ice", upgrade: ["material", ARMOR_SHIELD], changes: [add(COLD, 5), add(COLD, 10)] },
    changes: byArmor(FIRE, 5, 10)
  },
  "LdQuKLoY9UexlLFJ": {
    defect: { name: "Adamante", description: ["bd3ef4f2", 291], transfer: true, ...passive,
      identifier: "adamant", upgrade: ["material", ARMOR_SHIELD], changes: [add(DR, 2), add(DR, 5)] },
    changes: byArmor(DR, 2, 5)
  },
  "9qtyaxELLc4xqkMk": {
    defect: { name: "Invulnerável (Armadura)", description: ["28fe07b6", 101], transfer: true, ...passive,
      identifier: "invulnerable", upgrade: ["enchantment", ARMOR_SHIELD], changes: [add(DEFENSE, 5)] },
    changes: invulnerable
  },
  "hlCxCLAj9zaurVbw": {
    defect: { name: "Invulnerável (Escudo)", description: ["28fe07b6", 101], transfer: true, ...passive,
      identifier: "invulnerable", upgrade: ["enchantment", ARMOR_SHIELD], changes: [add(DEFENSE, 2)] },
    changes: invulnerable
  }
};

/** Manto da Resistência as shipped by "tormenta20.equipamentos-magicos" in 1.6.5. */
export const CLOAK = {
  pack: "tormenta20.equipamentos-magicos",
  itemId: "zPxlM4MNoKihGsDn",
  effectId: "p3l6lvXx7HMjVtS0",
  source: "Compendium.tormenta20.equipamentos-magicos.Item.zPxlM4MNoKihGsDn",
  name: "Manto da Resistência",
  description: ["4df0d1d4", 132],
  stats: { createdTime: 1788042454304, modifiedTime: 1788042454304, lastModifiedBy: "4fJviA1Q4qcjwsna" },
  effect: {
    name: "Manto da Resistência", description: ["811c9dc5", 0], transfer: true, disabled: true, ...passive,
    stats: { createdTime: 1788042454305, modifiedTime: 1788042454305, lastModifiedBy: "4fJviA1Q4qcjwsna" },
    changes: [add(SAVES, 2)]
  }
};

/**
 * Id of the compendium ActiveEffect a document was copied from, or null.
 * @param {unknown} compendiumSource  e.g. "Compendium.world.item-upgrades.ActiveEffect.87bEYYpPzWdzX3zT"
 * @returns {string|null}
 */
export function sourceEffectId(compendiumSource) {
  if (typeof compendiumSource !== "string") return null;
  const parts = compendiumSource.split(".");
  return parts.length >= 3 && parts.at(-2) === "ActiveEffect" ? parts.at(-1) : null;
}

const sameList = (a, b) => Array.isArray(a) && a.length === b.length && b.every((v, i) => a[i] === v);
const sameText = (text, [hash, length]) => typeof (text ?? "") === "string" &&
  (text ?? "").length === length && hashText(text ?? "") === hash;
const sameStats = (stats, expected) => Object.entries(expected).every(([k, v]) => stats?.[k] === v);

/**
 * Whether two change lists are identical (key, type, value, phase and priority, in order).
 * @param {object[]} actual
 * @param {object[]} expected
 * @returns {boolean}
 */
export function sameChanges(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return expected.every((e, i) => {
    const a = actual[i];
    return a?.key === e.key && a?.type === e.type && a?.value === e.value &&
      (a?.phase ?? "initial") === e.phase && (a?.priority ?? null) === e.priority;
  });
}

/**
 * Whether an effect source carries exactly the known defect (any edit to a relevant field breaks the match).
 * @param {object} source  Effect `_source`.
 * @param {object} defect  Entry `defect` of UPGRADE_FIXES, or CLOAK.effect.
 * @returns {boolean}
 */
export function matchesDefect(source, defect) {
  if (!source || source.name !== defect.name || !sameText(source.description, defect.description)) return false;
  if (!!source.transfer !== defect.transfer || !!source.disabled !== !!defect.disabled) return false;
  const system = source.system ?? {};
  const use = system.abilityUse ?? {};
  if (!!system.onuse !== defect.onuse || !!use.automatic !== defect.abilityUse.automatic) return false;
  if (!!use.aumenta !== defect.abilityUse.aumenta || !sameList(use.types ?? [], defect.abilityUse.types)) return false;
  if (defect.identifier !== undefined) {
    const [type, itemType] = defect.upgrade;
    if (system.identifier !== defect.identifier || system.upgrade?.type !== type) return false;
    if (!sameList(system.upgrade?.itemType, itemType)) return false;
  }
  if (defect.stats && !sameStats(source._stats, defect.stats)) return false;
  return sameChanges(system.changes, defect.changes);
}

/**
 * Corrected data for an item effect, or null when it must be left as is.
 * Kept changes keep every field of the source; new changes are explicit "initial" changes.
 * @param {object} source                Effect `_source`.
 * @param {object} context
 * @param {string} [context.tipo]        `system.tipo` of the parent item.
 * @param {boolean|(() => boolean)} [context.penaltyFix] Whether #19 (armor-penalty-reduction) is applied.
 * @param {Record<string, object>} [fixes]  Known defects (UPGRADE_FIXES).
 * @returns {{id: string, transfer: boolean, changes: object[]}|null}
 */
export function correctUpgrade(source, { tipo, penaltyFix = false } = {}, fixes = UPGRADE_FIXES) {
  const id = sourceEffectId(source?._stats?.compendiumSource);
  const fix = id && Object.hasOwn(fixes, id) ? fixes[id] : null;
  if (!fix || fix.itemOnly || !matchesDefect(source, fix.defect)) return null;
  if (fix.requiresPenaltyFix && !(typeof penaltyFix === "function" ? penaltyFix() : penaltyFix)) return null;
  const original = source.system.changes;
  const changes = fix.changes ? fix.changes({ tipo, source: original }) : original;
  if (!changes) return null;
  return {
    id,
    transfer: fix.transfer ?? !!source.transfer,
    changes: changes.map((c) => ({ phase: "initial", priority: null, ...structuredClone(c) }))
  };
}

/**
 * Item data the book derives from the recognized upgrades of an item, or null when nothing changes.
 * - Heavy armor lets the wearer apply up to `heavyAbility` points of the Defense attribute (Mitral 2, Delicada 1).
 *   Limits from item effects do not stack (JdA p. 226): the highest counts, and a higher value set on the item stays.
 * - The item takes `slots` (–1) space, minimum 1; different upgrades add up (Mitral + Discreto: –2, JdA p. 333).
 * Each upgrade (by identifier) counts once; edited or disabled upgrade effects are ignored.
 * @param {{tipo?: string, maxAtr?: number, espacos?: number, effects?: object[]}} item  Source data of the item
 *   (`system.tipo`, `system.armadura.maxAtr`, `system.espacos`) and the `_source` of its effects.
 * @param {Record<string, object>} [fixes]
 * @returns {{maxAtr?: number, espacos?: number}|null}
 */
export function correctItem({ tipo, maxAtr, espacos, effects = [] } = {}, fixes = UPGRADE_FIXES) {
  const rules = new Map();
  for (const source of effects) {
    const id = sourceEffectId(source?._stats?.compendiumSource);
    const fix = id && Object.hasOwn(fixes, id) ? fixes[id] : null;
    if (fix?.item && matchesDefect(source, fix.defect)) rules.set(fix.defect.identifier, fix.item);
  }
  const result = {};
  const cap = Math.max(0, ...[...rules.values()].map((rule) => rule.heavyAbility ?? 0));
  if (tipo === "pesada" && Number.isFinite(maxAtr) && cap > maxAtr) result.maxAtr = cap;
  const slots = [...rules.values()].reduce((sum, rule) => sum + (rule.slots ?? 0), 0);
  if (slots && Number.isFinite(espacos) && espacos > 1) result.espacos = Math.max(1, espacos + slots);
  return Object.keys(result).length ? result : null;
}

const readPath = (object, path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), object);

/**
 * Removes from an update the fields that only echo a value this patch set in memory (the item sheet submits every
 * field, prepared values included). A different value, or one the source already has, is kept.
 * @param {object} changes                    Update data (nested or with dotted keys); changed in place.
 * @param {Record<string, number>} overrides  Values set in memory, by path ("system.espacos").
 * @param {object} source                     `_source` of the item.
 * @returns {string[]} The paths removed.
 */
export function dropOverrides(changes, overrides, source) {
  const dropped = [];
  for (const [path, value] of Object.entries(overrides ?? {})) {
    if (readPath(source, path) === value) continue;
    const keys = path.split(".");
    const last = keys.pop();
    const holder = Object.hasOwn(changes ?? {}, path) ? changes : readPath(changes, keys.join("."));
    const key = holder === changes ? path : last;
    if (holder && typeof holder === "object" && Object.hasOwn(holder, key) && Number(holder[key]) === value) {
      delete holder[key];
      dropped.push(path);
    }
  }
  return dropped;
}

/**
 * Effects for a Manto da Resistência created straight from the 1.6.5 compendium data, with its effect enabled,
 * or null. Copies of world or actor items (managed stats rewritten by the server, or a duplicateSource) and any
 * edited item or effect are left untouched.
 * @param {object} itemSource  `_source` of the item being created.
 * @param {typeof CLOAK} [cloak]
 * @returns {object[]|null}
 */
export function enableCloakEffects(itemSource, cloak = CLOAK) {
  const stats = itemSource?._stats ?? {};
  if (itemSource?.name !== cloak.name || !sameText(itemSource.system?.description?.value, cloak.description)) return null;
  if (![null, undefined, cloak.source].includes(stats.compendiumSource) || stats.duplicateSource) return null;
  if (!sameStats(stats, cloak.stats)) return null;
  const effects = itemSource.effects;
  if (!Array.isArray(effects) || effects.length !== 1 || !matchesDefect(effects[0], cloak.effect)) return null;
  return [{ ...structuredClone(effects[0]), disabled: false }];
}

/**
 * Diagnosis from the compendium sources.
 * @param {Record<string, object|null>} upgrades  Effect `_source` by id ("tormenta20.efeitos").
 * @param {object|null} cloakEffect              `_source` of the Manto da Resistência effect.
 * @param {Record<string, object>} [fixes]
 * @param {typeof CLOAK} [cloak]
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseSources(upgrades, cloakEffect, fixes = UPGRADE_FIXES, cloak = CLOAK) {
  const present = Object.entries(fixes)
    .filter(([id, fix]) => matchesDefect(upgrades?.[id], fix.defect))
    .map(([id, fix]) => `${fix.defect.name} (${id})`);
  if (matchesDefect(cloakEffect, cloak.effect)) present.push(cloak.name);
  if (present.length) return { bug: "present", confidence: "high", evidence: present.join(", ") };
  return { bug: "fixed", confidence: "low", evidence: "compendium data no longer matches the known defects" };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const penaltyFixApplied = () => isPatchApplied(game.modules.get(MODULE_ID)?.api?.status, "armor-penalty-reduction");

function correct(effect) {
  const item = effect.parent;
  if (item?.documentName !== "Item") return;
  const tipo = item._source?.system?.tipo ?? item.system?.tipo;
  const fixed = correctUpgrade(effect._source, { tipo, penaltyFix: penaltyFixApplied });
  if (!fixed) return;
  effect.system.changes = fixed.changes;
  effect.constructor._shimChanges?.(effect.system.changes);
  effect.transfer = fixed.transfer;
}

const ITEM_FIELDS = { maxAtr: "system.armadura.maxAtr", espacos: "system.espacos" };
/** Values this patch set in memory on each prepared item, by path. */
const itemOverrides = new WeakMap();

function correctItemData(item) {
  const system = item._source?.system;
  if (!system || !item.system) return;
  const fixed = correctItem({
    tipo: system.tipo,
    maxAtr: system.armadura?.maxAtr,
    espacos: system.espacos,
    effects: item.effects?.map((e) => e._source) ?? []
  });
  const previous = itemOverrides.get(item) ?? {};
  const current = {};
  for (const [field, path] of Object.entries(ITEM_FIELDS)) {
    if (fixed?.[field] !== undefined) {
      foundry.utils.setProperty(item, path, fixed[field]);
      current[path] = fixed[field];
    } else if (path in previous && foundry.utils.getProperty(item, path) === previous[path]) {
      foundry.utils.setProperty(item, path, foundry.utils.getProperty(item._source, path));
    }
  }
  if (Object.keys(current).length) itemOverrides.set(item, current);
  else itemOverrides.delete(item);
}

function onPreUpdateItem(doc, changes) {
  try {
    const overrides = itemOverrides.get(doc);
    if (overrides) dropOverrides(changes, overrides, doc._source);
  } catch (err) {
    console.warn(`${MODULE_ID} | enchantment-data: could not check the item update`, doc?.uuid, err);
  }
}

function onPreCreateItem(doc) {
  try {
    const effects = enableCloakEffects(doc._source);
    if (effects) doc.updateSource({ effects });
  } catch (err) {
    console.warn(`${MODULE_ID} | enchantment-data: could not enable Manto da Resistência`, err);
  }
}

function apply() {
  const EffectClass = CONFIG.ActiveEffect.documentClass;
  const original = EffectClass.prototype.prepareBaseData;
  if (typeof original !== "function") throw new Error("ActiveEffect#prepareBaseData not found");

  EffectClass.prototype.prepareBaseData = markWrapper(function (...args) {
    try {
      correct(this);
    } catch (err) {
      console.warn(`${MODULE_ID} | enchantment-data: could not correct`, this?.uuid, err);
    }
    return original.apply(this, args);
  }, original);

  const ItemClass = CONFIG.Item.documentClass;
  const originalItem = ItemClass.prototype.prepareBaseData;
  if (typeof originalItem !== "function") throw new Error("Item#prepareBaseData not found");
  ItemClass.prototype.prepareBaseData = markWrapper(function (...args) {
    try {
      correctItemData(this);
    } catch (err) {
      console.warn(`${MODULE_ID} | enchantment-data: could not correct the item`, this?.uuid, err);
    }
    return originalItem.apply(this, args);
  }, originalItem);

  Hooks.on("preCreateItem", onPreCreateItem);
  Hooks.on("preUpdateItem", onPreUpdateItem);
}

function isNeeded() {
  return undefined;
}

async function lateProbe() {
  const upgradesPack = game.packs.get("tormenta20.efeitos");
  const itemsPack = game.packs.get(CLOAK.pack);
  const upgrades = {};
  for (const id of Object.keys(UPGRADE_FIXES)) {
    upgrades[id] = (await upgradesPack?.getDocument(id))?._source ?? null;
  }
  const cloak = await itemsPack?.getDocument(CLOAK.itemId);
  const cloakEffect = cloak?.effects.get(CLOAK.effectId)?._source ?? null;
  if (!cloakEffect && Object.values(upgrades).every((s) => !s)) return undefined;
  return diagnoseSources(upgrades, cloakEffect);
}

export default {
  id: "enchantment-data",
  group: "items",
  issue: 43,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  guarded: true,
  isNeeded,
  lateProbe,
  apply
};
