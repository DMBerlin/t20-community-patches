/**
 * Alchemical damage bonus (tormenta20 1.6.5).
 *
 * Bug: ItemT20#rollDamage (T20:9108-9180) adds "@danoALQ" to the damage of an alchemical item only when the actor
 * has a spell damage bonus (`modificadores.dano.mag`), instead of an alchemical damage bonus
 * (`modificadores.dano.alq`). The value of @danoALQ comes from `modificadores.dano.alq` (T20:7170), so an
 * "alq" bonus alone is never rolled. The healing branch checks `cura.alq` correctly (T20:9157).
 *
 * Fix: while the system rolls the damage of an alchemical item whose actor has "alq" bonuses and no "mag" bonus,
 * each plain damage roll receives the "@danoALQ" part the system would have added. The part is removed afterwards.
 */
import { markWrapper, stripComments, unwrap } from "../utils.mjs";

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
 * @returns {import("../registry.mjs").Diagnosis}
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

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function itemPrototype() {
  const proto = CONFIG.Item.documentClass?.prototype;
  return typeof proto?.rollDamage === "function" ? proto : null;
}

function apply() {
  const proto = itemPrototype();
  if (!proto) throw new Error("Tormenta20 ItemT20#rollDamage not found");
  const rollDamage = proto.rollDamage;
  const ledger = createPartLedger();
  proto.rollDamage = markWrapper(async function (...args) {
    let taken = [];
    try {
      const dano = foundry.utils.getProperty(this?.actor?.system ?? {}, "modificadores.dano");
      taken = ledger.acquire(rollsMissingAlchemicalBonus(this, dano));
    } catch (err) {
      console.warn("t20-community-patches | alchemical-damage-bonus: could not add the alchemical bonus", this?.uuid, err);
    }
    try {
      return await rollDamage.apply(this, args);
    } finally {
      ledger.release(taken);
    }
  }, rollDamage);
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
    actor: { flags: {}, system: { atributos: {}, modificadores: { dano, cura: {} } } },
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

function isNeeded() {
  const original = unwrap(itemPrototype()?.rollDamage);
  if (typeof original !== "function") return { bug: "unknown", confidence: "low", evidence: "rollDamage not found" };
  const source = stripComments(Function.prototype.toString.call(original));
  if (!source.includes(ALCHEMICAL_PART) || !source.includes("modificadores.dano")) {
    return { bug: "unknown", confidence: "low", evidence: "rollDamage not recognized; not executed" };
  }
  return diagnoseAlchemicalBonus({
    alqOnly: runProbe(original, { alq: ["2"], mag: [] }),
    both: runProbe(original, { alq: ["2"], mag: ["1"] })
  });
}

export default {
  id: "alchemical-damage-bonus",
  group: "items",
  issue: 69,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  apply
};
