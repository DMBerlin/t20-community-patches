import { CLOAK, UPGRADE_FIXES, hashText } from "./fixes.mjs";

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
  if (!sameUse(system, defect) || !sameUpgrade(system, defect)) return false;
  if (defect.stats && !sameStats(source._stats, defect.stats)) return false;
  return sameChanges(system.changes, defect.changes);
}

/** Whether the usage settings (onuse, automatic, aumenta, types) are the defect's. */
function sameUse(system, defect) {
  const use = system.abilityUse ?? {};
  if (!!system.onuse !== defect.onuse || !!use.automatic !== defect.abilityUse.automatic) return false;
  return !!use.aumenta === defect.abilityUse.aumenta && sameList(use.types ?? [], defect.abilityUse.types);
}

/** Whether the upgrade identifier, type and item types are the defect's (when the defect has them). */
function sameUpgrade(system, defect) {
  if (defect.identifier === undefined) return true;
  const [type, itemType] = defect.upgrade;
  if (system.identifier !== defect.identifier || system.upgrade?.type !== type) return false;
  return sameList(system.upgrade?.itemType, itemType);
}

/** The compendium effect id of an effect source and its known fix (null when unknown). */
function knownFix(source, fixes) {
  const id = sourceEffectId(source?._stats?.compendiumSource);
  return { id, fix: id && Object.hasOwn(fixes, id) ? fixes[id] : null };
}

const resolveFlag = (flag) => (typeof flag === "function" ? flag() : flag);

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
  const { id, fix } = knownFix(source, fixes);
  if (!fix || fix.itemOnly || !matchesDefect(source, fix.defect)) return null;
  if (fix.requiresPenaltyFix && !resolveFlag(penaltyFix)) return null;
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
  const rules = itemRules(effects, fixes);
  const result = {};
  const cap = Math.max(0, ...rules.map((rule) => rule.heavyAbility ?? 0));
  if (tipo === "pesada" && Number.isFinite(maxAtr) && cap > maxAtr) result.maxAtr = cap;
  const slots = rules.reduce((sum, rule) => sum + (rule.slots ?? 0), 0);
  if (slots && Number.isFinite(espacos) && espacos > 1) result.espacos = Math.max(1, espacos + slots);
  return Object.keys(result).length ? result : null;
}

/** Item rules of the recognized upgrades, one per identifier. */
function itemRules(effects, fixes) {
  const rules = new Map();
  for (const source of effects) {
    const { fix } = knownFix(source, fixes);
    if (fix?.item && matchesDefect(source, fix.defect)) rules.set(fix.defect.identifier, fix.item);
  }
  return [...rules.values()];
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
  if (!isCloakSource(itemSource, cloak)) return null;
  const effects = itemSource.effects;
  if (!Array.isArray(effects) || effects.length !== 1 || !matchesDefect(effects[0], cloak.effect)) return null;
  return [{ ...structuredClone(effects[0]), disabled: false }];
}

/** Whether an item source is the compendium Manto da Resistência itself (not a world or actor copy, not edited). */
function isCloakSource(itemSource, cloak) {
  const stats = itemSource?._stats ?? {};
  if (itemSource?.name !== cloak.name || !sameText(itemSource.system?.description?.value, cloak.description)) return false;
  if (![null, undefined, cloak.source].includes(stats.compendiumSource) || stats.duplicateSource) return false;
  return sameStats(stats, cloak.stats);
}

/**
 * Diagnosis from the compendium sources.
 * @param {Record<string, object|null>} upgrades  Effect `_source` by id ("tormenta20.efeitos").
 * @param {object|null} cloakEffect              `_source` of the Manto da Resistência effect.
 * @param {Record<string, object>} [fixes]
 * @param {typeof CLOAK} [cloak]
 * @returns {import("../../../registry.mjs").Diagnosis}
 */
export function diagnoseSources(upgrades, cloakEffect, fixes = UPGRADE_FIXES, cloak = CLOAK) {
  const present = Object.entries(fixes)
    .filter(([id, fix]) => matchesDefect(upgrades?.[id], fix.defect))
    .map(([id, fix]) => `${fix.defect.name} (${id})`);
  if (matchesDefect(cloakEffect, cloak.effect)) present.push(cloak.name);
  if (present.length) return { bug: "present", confidence: "high", evidence: present.join(", ") };
  return { bug: "fixed", confidence: "low", evidence: "compendium data no longer matches the known defects" };
}
