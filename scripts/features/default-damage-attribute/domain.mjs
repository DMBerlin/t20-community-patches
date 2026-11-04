import { sourceFingerprint } from "../../lib/source.mjs";

/** sourceFingerprint of ItemT20#rollDamage in tormenta20 1.6.6. */
export const REFERENCE = "b6191939:3049";

const SKIPPED_TYPES = new Set(["curatpv", "curapm", "curatpm", "perda"]);

/**
 * Whether tormenta20 1.6.6 resolves `padrao` at this part itself (T20:7966-7969).
 * @param {{type?: string, system?: object}} item
 * @param {number} index
 * @returns {boolean}
 */
export function systemResolvesDefault(item, index) {
  if (item?.type !== "arma" || index !== 1) return false;
  const system = item.system ?? {};
  return system.empunhadura === "leve" || !!system.propriedades?.agi;
}

/**
 * The attribute 1.6.5 used for `padrao` (T20:9133-9152 of 1.6.5).
 * @param {{proposito?: string, empunhadura?: string, finesse: boolean, shootingStyle?: unknown}} args
 * @returns {string}
 */
export function legacyDefaultAttribute({ proposito, empunhadura, finesse, shootingStyle }) {
  switch (proposito) {
    case "disparo":
      return shootingStyle ? "@des" : "";
    case "arremesso":
      return finesse ? "@des" : "@for";
    default:
      return finesse && empunhadura === "leve" ? "@des" : "@for";
  }
}

/**
 * Damage parts with every `padrao` the system will not resolve replaced, or null when nothing changes.
 * @param {Array<Array<string>>} parts
 * @param {{type?: string, system?: object}} item
 * @param {{finesse: boolean, shootingStyle?: unknown}} ctx
 * @returns {Array<Array<string>>|null}
 */
export function partsWithDefaultAttribute(parts, item, ctx) {
  if (!Array.isArray(parts)) return null;
  let changed = false;
  const next = parts.map((part, index) => {
    if (!Array.isArray(part) || part[0] !== "padrao" || SKIPPED_TYPES.has(part[1])) return part;
    if (systemResolvesDefault(item, index)) return part;
    changed = true;
    const { proposito, empunhadura } = item?.system ?? {};
    return [legacyDefaultAttribute({ proposito, empunhadura, ...ctx }), ...part.slice(1)];
  });
  return changed ? next : null;
}

/**
 * A new `rolls` array where each damage roll that changes is a view of the original with the new parts. Null when
 * no roll changes.
 * @param {Array<object>} rolls
 * @param {{type?: string, system?: object}} item
 * @param {{finesse: boolean, shootingStyle?: unknown}} ctx
 * @returns {Array<object>|null}
 */
export function rollsWithDefaultAttribute(rolls, item, ctx) {
  if (!Array.isArray(rolls)) return null;
  let changed = false;
  const next = rolls.map((roll) => {
    if (roll?.type !== "dano") return roll;
    const parts = partsWithDefaultAttribute(roll.parts, item, ctx);
    if (!parts) return roll;
    changed = true;
    return Object.create(roll, { parts: { value: parts, writable: true, enumerable: true, configurable: true } });
  });
  return changed ? next : null;
}

/**
 * The rolls a rollDamage call must see (same contract as finesse-agile-weapons' rollsForCall).
 * @param {Array<object>} current
 * @param {{base: Array<object>, installed: Array<object>}|undefined} outer
 * @param {(base: Array<object>) => Array<object>|null} transform
 * @returns {{base: Array<object>, rolls: Array<object>}}
 */
export function rollsForCall(current, outer, transform) {
  const base = outer && outer.installed === current ? outer.base : current;
  return { base, rolls: transform(base) || base };
}

export const ROLL_DAMAGE = "ItemT20#rollDamage";

/**
 * Present/high only for the exact 1.6.6 code; anything else (a fixed system, another module's wrapper) is unknown.
 * @param {string|undefined} source
 * @returns {import("../../registry.mjs").Diagnosis}
 */
export function diagnoseDamageSource(source) {
  const fp = sourceFingerprint(source);
  if (fp === REFERENCE) return { bug: "present", confidence: "high", evidence: `rollDamage ${fp}` };
  return { bug: "unknown", confidence: "low", evidence: `rollDamage ${fp ?? "not found"}` };
}
