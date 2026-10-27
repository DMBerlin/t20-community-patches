/**
 * "Padrão" damage attribute.
 *
 * Bug (tormenta20 1.6.6): ItemT20#rollDamage only resolves the "Padrão" damage attribute (`padrao`) for light or
 * agile weapons at index 1 (T20:7963-7982). Anywhere else `padrao` reaches the Roll as a string and
 * Roll#evaluate throws "Unresolved StringTerm padrao requested for evaluation": a new weapon (created with
 * "Padrão") that is not light or agile cannot roll damage. 1.6.5 resolved every `padrao` part.
 *
 * Fix: while the system computes the damage, each `padrao` part the system will not resolve is replaced with the
 * 1.6.5 attribute (fired: Des with Estilo de Disparo or nothing; thrown: Des with Acuidade and Des > For, else For;
 * melee and other items: For). Parts the system resolves itself, explicit attributes and stored data are untouched.
 */

import { markWrapper, sourceFingerprint, unwrap } from "../utils.mjs";
import { prefersDexterity } from "./finesse-agile-weapons.mjs";

/** sourceFingerprint of ItemT20#rollDamage in tormenta20 1.6.6. */
export const REFERENCE = "b6191939:3049";

const SKIPPED_TYPES = new Set(["curatpv", "curapm", "curatpm", "perda"]);

/**
 * Whether tormenta20 1.6.6 resolves `padrao` at this part itself (T20:7963-7965).
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

/**
 * Present/high only for the exact 1.6.6 code; anything else (a fixed system, another module's wrapper) is unknown.
 * @param {string|undefined} source
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseDamageSource(source) {
  const fp = sourceFingerprint(source);
  if (fp === REFERENCE) return { bug: "present", confidence: "high", evidence: `rollDamage ${fp}` };
  return { bug: "unknown", confidence: "low", evidence: `rollDamage ${fp ?? "not found"}` };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function context(item) {
  const actor = item?.actor;
  if (!actor) return null;
  return {
    finesse: prefersDexterity({
      optionalRule: game.settings.get("tormenta20", "lightFinesseWeapons"),
      acuidade: actor.getFlag("tormenta20", "acuidade"),
      atributos: actor.system?.atributos
    }),
    shootingStyle: actor.getFlag("tormenta20", "estiloDisparo")
  };
}

function warn(err) {
  console.warn("t20-community-patches | default-damage-attribute:", err);
}

/** @type {WeakMap<object, {base: Array<object>, installed: Array<object>}>} */
const frames = new WeakMap();

function getItemClass() {
  const ItemClass = CONFIG.Item.documentClass;
  return typeof ItemClass?.prototype?.rollDamage === "function" ? ItemClass : null;
}

function isNeeded() {
  const ItemClass = getItemClass();
  if (!ItemClass) return undefined;
  return diagnoseDamageSource(Function.prototype.toString.call(unwrap(ItemClass.prototype.rollDamage)));
}

function apply() {
  const ItemClass = getItemClass();
  if (!ItemClass) throw new Error("Tormenta20 ItemT20#rollDamage not found");

  // rollDamage reads `this.system.rolls` (the for…of iterator) before its first `await`, so the view is installed
  // only for the synchronous start and restored before the promise is returned (see finesse-agile-weapons).
  const rollDamage = ItemClass.prototype.rollDamage;
  ItemClass.prototype.rollDamage = markWrapper(function (...args) {
    const outer = frames.get(this);
    let before;
    let installed = null;
    try {
      before = this.system.rolls;
      const ctx = context(this);
      const transform = (base) => (ctx ? rollsWithDefaultAttribute(base, this, ctx) : null);
      const { base, rolls } = rollsForCall(before, outer, transform);
      if (rolls !== before) {
        this.system.rolls = rolls;
        installed = rolls;
        frames.set(this, { base, installed: rolls });
      }
    } catch (err) {
      warn(err);
    }
    try {
      return rollDamage.apply(this, args);
    } finally {
      if (installed) {
        if (this.system.rolls === installed) this.system.rolls = before;
        if (outer) frames.set(this, outer);
        else frames.delete(this);
      }
    }
  }, rollDamage);
}

export default {
  id: "default-damage-attribute",
  group: "items",
  issue: 77,
  system: { id: "tormenta20", affected: { minimum: "1.6.6", maximum: "1.6.6" } },
  isNeeded,
  apply
};
