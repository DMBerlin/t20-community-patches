export const ALCHEMICAL_PART = "@danoALQ";
const NOT_DAMAGE = new Set(["curatpv", "curapm", "curatpm", "curapv", "perda"]);

/**
 * Whether a list of bonus formulas has at least one entry, as the system checks it (`filter(Boolean).length`).
 * @param {unknown} list
 * @returns {boolean}
 */
export function hasBonus(list) {
  return Array.isArray(list) && list.some(Boolean);
}

/**
 * Whether the item is an alchemical consumable, as rollDamage defines it.
 * @param {{type?: string, system?: {tipo?: string}}} item
 * @returns {boolean}
 */
export function isAlchemical(item) {
  return item?.type === "consumivel" && item?.system?.tipo === "alchemy";
}

/**
 * Whether a roll gets damage bonuses in rollDamage: a "dano" roll without healing, recovery or loss parts.
 * @param {{type?: string, parts?: unknown[]}} roll
 * @returns {boolean}
 */
export function isPlainDamageRoll(roll) {
  if (roll?.type !== "dano" || !Array.isArray(roll.parts)) return false;
  return !roll.parts.some((part) => Array.isArray(part) && NOT_DAMAGE.has(part[1]));
}

/**
 * The damage rolls that miss the alchemical bonus: only when the actor has "alq" bonuses and no "mag" bonus (with a
 * "mag" bonus, the system already adds @danoALQ).
 * @param {object} item
 * @param {{alq?: unknown, mag?: unknown}} [dano]   actor.system.modificadores.dano
 * @returns {object[]}
 */
export function rollsMissingAlchemicalBonus(item, dano) {
  if (!isAlchemical(item) || !hasBonus(dano?.alq) || hasBonus(dano?.mag)) return [];
  const rolls = item.system?.rolls;
  return Array.isArray(rolls) ? rolls.filter(isPlainDamageRoll) : [];
}

/**
 * Interprets what the system's original rollDamage added for the probe cases.
 * @param {{alqOnly?: string[], both?: string[]}} pushed   Parts pushed by the original code in each case.
 * @returns {import("../../registry.mjs").Diagnosis}
 */
export function diagnoseAlchemicalBonus(pushed) {
  const count = (list) => (Array.isArray(list) ? list.filter((p) => p === ALCHEMICAL_PART).length : -1);
  const alqOnly = count(pushed?.alqOnly);
  const both = count(pushed?.both);
  const evidence = `alq only: ${alqOnly}, alq + mag: ${both}`;
  if (both !== 1) return { bug: "unknown", confidence: "low", evidence: `@danoALQ not recognized (${evidence})` };
  if (alqOnly === 0) return { bug: "present", confidence: "high", evidence: `alchemical bonus needs a spell bonus (${evidence})` };
  if (alqOnly === 1) return { bug: "fixed", confidence: "high", evidence: `alchemical bonus added alone (${evidence})` };
  return { bug: "unknown", confidence: "low", evidence };
}

/**
 * Temporary "@danoALQ" parts shared by overlapping calls: each roll keeps one extra part while any call that needs it
 * is running, so two concurrent rolls of the same item never add the bonus twice.
 * @returns {{acquire: (rolls: object[]) => object[], release: (rolls: object[]) => void}}
 */
export function createPartLedger() {
  const held = new WeakMap();
  return {
    acquire(rolls) {
      const taken = [];
      for (const roll of rolls) {
        let entry = held.get(roll);
        if (!entry || !roll.parts.includes(entry.part)) {
          entry = { part: [ALCHEMICAL_PART, "", ""], count: 0 };
          roll.parts.push(entry.part);
          held.set(roll, entry);
        }
        entry.count++;
        taken.push(roll);
      }
      return taken;
    },
    release(rolls) {
      for (const roll of rolls) {
        const entry = held.get(roll);
        if (!entry || --entry.count > 0) continue;
        held.delete(roll);
        const index = roll.parts.indexOf(entry.part);
        if (index >= 0) roll.parts.splice(index, 1);
      }
    }
  };
}

const STOP = Symbol("probe stop");

/**
 * Runs the original rollDamage on a fake alchemical item until the parts are built (getRollData is read right after
 * them), and records which parts it pushed. Nothing is rolled, written or rendered.
 * @returns {string[]|undefined}   undefined when the code never reached getRollData.
 */
export function runProbe(fn, dano) {
  const pushed = [];
  class Recorder extends Array {
    push(...items) {
      for (const item of items) pushed.push(Array.isArray(item) ? item[0] : item);
      return super.push(...items);
    }
  }
  let reached = false;
  const fake = {
    type: "consumivel",
    name: "probe",
    effects: [],
    system: { tipo: "alchemy", rolled: {}, criticoX: 2, rolls: [{ type: "dano", name: "Dano", rd: 0, parts: Recorder.from([["1d6", "fogo", ""]]) }] },
    // 1.6.6 reads the actor flags through getFlag before building the parts.
    actor: { flags: {}, getFlag: () => undefined, system: { atributos: {}, modificadores: { dano, cura: {} } } },
    getRollData() {
      reached = true;
      throw STOP;
    }
  };
  try {
    fn.call(fake, {})?.catch?.(() => {});
  } catch (err) {
    if (err !== STOP) return undefined;
  }
  return reached ? pushed : undefined;
}
