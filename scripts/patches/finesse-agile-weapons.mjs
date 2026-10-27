/**
 * Agile weapons (Ágil) and Acuidade com Arma.
 *
 * Bug (tormenta20 1.6.5): the rule that lets Acuidade com Arma (or the optional rule "Armas Leves e Ágeis") use
 * Dexterity instead of Strength only checks `empunhadura === "leve"`, in ItemT20#getAttackToHit (attack) and
 * ItemT20#rollDamage (damage with the "Padrão" attribute). Agile weapons (`propriedades.agi`: chicote, cimitarra,
 * corrente de espinhos, florete, katana) keep using Strength, although the book says they "can be used with
 * Acuidade com Arma, even if they are not light weapons".
 *
 * Fix: while the system computes the attack or the damage of an agile melee weapon that meets the system's own
 * condition (Acuidade or the optional rule, and Des > For), the default attribute is temporarily filled with
 * Dexterity, exactly as the system already does for light weapons. Explicit attributes, ranged weapons, light
 * weapons and stored data are untouched.
 *
 * Probe: tormenta20 1.6.6 fixed the bug (T20:6999 and T20:7968). isNeeded() calls the system's original methods
 * with a fake agile weapon and a light control, and reads the attribute they pick. It only runs code it recognizes
 * (1.6.5 or 1.6.6); otherwise, or when the probe is inconclusive, the source diagnosis is the fallback.
 */

import { markWrapper, stripComments, unwrap } from "../utils.mjs";

const RANGED = new Set(["arremesso", "disparo"]);

/**
 * Whitespace-free, comment-free source of ItemT20#getAttackToHit and ItemT20#rollDamage in tormenta20 1.6.5
 * (length and FNV-1a hash). Any other code is "unknown", except the usual fix described in `AGILE_FIX`.
 */
export const REFERENCE = {
  attack: { length: 1899, hash: "57f32932" },
  damage: { length: 2493, hash: "953f8861" }
};

/** The same fingerprints for tormenta20 1.6.6 (T20:6972-7060 and T20:7936-8019), which fixed the bug. */
export const REFERENCE_1_6_6 = {
  attack: { length: 2027, hash: "3f52e31e" },
  damage: { length: 2698, hash: "c5c5ff4f" }
};

// The usual fix widens the light-weapon condition with the agile property, keeping everything else:
// `usarAcuidade && (empunhadura === "leve" || this.system.propriedades?.agi)` (either order, `?.`, `.` or `["agi"]`).
const LIGHT = `empunhadura===["']leve["']`;
const AGI = `(?:(?:this\\.system|itemData)\\??\\.)?propriedades(?:\\??\\.agi|\\??\\.?\\[["']agi["']\\])`;
const AGILE_FIX = new RegExp(`\\((?:${LIGHT}\\|\\|${AGI}|${AGI}\\|\\|${LIGHT})\\)`, "g");
// A fix may also destructure the property next to `empunhadura`.
const DESTRUCTURE_AGI = /const\{empunhadura,proposito,propriedades\}=this\.system;/g;

/**
 * An agile melee weapon that the system does not treat as light. Light weapons and thrown or fired weapons
 * already follow the system's rule, so they are left alone.
 * @param {{type?: string, system?: object}} item
 * @returns {boolean}
 */
export function isAgileMeleeWeapon(item) {
  const system = item?.system;
  if (item?.type !== "arma" || !system) return false;
  if (system.empunhadura === "leve" || RANGED.has(system.proposito)) return false;
  return !!system.propriedades?.agi;
}

/**
 * Mirrors the system's `usarAcuidade` (T20:8172-8173 and T20:9136-9137).
 * @param {{optionalRule?: boolean, acuidade?: unknown, atributos?: object}} args
 * @returns {boolean}
 */
export function prefersDexterity({ optionalRule, acuidade, atributos }) {
  const des = atributos?.des?.value;
  const str = atributos?.for?.value;
  return !!(optionalRule || acuidade) && des > str;
}

/**
 * The attack attribute slot (`parts[1]` = [skill, attribute, ...]) with Dexterity, or null when the system would
 * not choose the attribute itself (no skill, or an explicit attribute).
 * @param {Array<Array<string>>} parts
 * @returns {Array<string>|null}
 */
export function attackPartWithDexterity(parts) {
  const slot = Array.isArray(parts) ? parts[1] : null;
  if (!Array.isArray(slot) || !slot[0] || slot[1]) return null;
  const next = [...slot];
  next[1] = "des";
  return next;
}

/**
 * Damage parts with the "Padrão" attribute (`padrao`) replaced by Dexterity, or null when there is none.
 * @param {Array<Array<string>>} parts
 * @returns {Array<Array<string>>|null}
 */
export function damagePartsWithDexterity(parts) {
  if (!Array.isArray(parts)) return null;
  let changed = false;
  const next = parts.map((part) => {
    if (!Array.isArray(part) || part[0] !== "padrao") return part;
    changed = true;
    return ["@des", ...part.slice(1)];
  });
  return changed ? next : null;
}

/**
 * A new `rolls` array where each damage roll with `padrao` is replaced by a view of it with Dexterity parts (the
 * other fields come from the original roll through the prototype). The original rolls are not changed. Null when
 * no roll changes.
 * @param {Array<object>} rolls
 * @returns {Array<object>|null}
 */
export function rollsWithDexterity(rolls) {
  if (!Array.isArray(rolls)) return null;
  let changed = false;
  const next = rolls.map((roll) => {
    if (roll?.type !== "dano") return roll;
    const parts = damagePartsWithDexterity(roll.parts);
    if (!parts) return roll;
    changed = true;
    return Object.create(roll, { parts: { value: parts, writable: true, enumerable: true, configurable: true } });
  });
  return changed ? next : null;
}

/**
 * The rolls a rollDamage call must see. `current` is `system.rolls` when the call starts; `outer` is the frame of
 * an enclosing call on the same item still in its synchronous start (or undefined). When `current` is the array
 * that call installed, the real rolls are `outer.base`. The call gets its Dexterity view of them when eligible,
 * or the real rolls otherwise.
 * @param {Array<object>} current
 * @param {{base: Array<object>, installed: Array<object>}|undefined} outer
 * @param {boolean} eligible
 * @returns {{base: Array<object>, rolls: Array<object>}}
 */
export function rollsForCall(current, outer, eligible) {
  const base = outer && outer.installed === current ? outer.base : current;
  const rolls = (eligible && rollsWithDexterity(base)) || base;
  return { base, rolls };
}

/**
 * Source without comments and whitespace, so formatting changes do not matter.
 * @param {string|undefined} source
 * @returns {string}
 */
export function normalizeSource(source) {
  const code = typeof source === "string" ? stripComments(source) : "";
  return typeof code === "string" ? code.replace(/\s+/g, "") : "";
}

/**
 * 32-bit FNV-1a hash, as 8 hex digits.
 * @param {string} text
 * @returns {string}
 */
export function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function matches(code, reference) {
  return code.length === reference.length && fingerprint(code) === reference.hash;
}

/**
 * Classifies one of the system's original methods against its 1.6.5 reference: "light-only" (the 1.6.5 code),
 * "agile" (the 1.6.5 code with only the usual fix) or "unknown" (anything else: rewritten code, another module's
 * wrapper, unrelated reads of "agi"...).
 * @param {string|undefined} source
 * @param {{length: number, hash: string}} reference
 * @returns {"light-only"|"agile"|"unknown"}
 */
export function classifyFinesseSource(source, reference) {
  const code = normalizeSource(source);
  if (!code || !reference) return "unknown";
  if (matches(code, reference)) return "light-only";
  let fixes = 0;
  const restored = code
    .replace(AGILE_FIX, () => {
      fixes++;
      return 'empunhadura==="leve"';
    })
    .replace(DESTRUCTURE_AGI, "const{empunhadura,proposito}=this.system;");
  return fixes > 0 && matches(restored, reference) ? "agile" : "unknown";
}

/**
 * Fallback when the behavior probe is inconclusive. The patch wraps both methods, so it only claims the bug when it
 * recognizes both exactly: an unknown method gives unknown/low (above the verified range, the patch is then not
 * applied). Reading code never proves a fix, so two methods that read the agile property give fixed/low.
 * @param {string|undefined} attackSource  Source of ItemT20#getAttackToHit.
 * @param {string|undefined} damageSource  Source of ItemT20#rollDamage.
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseFinesseSource(attackSource, damageSource) {
  const attack = classifyFinesseSource(attackSource, REFERENCE.attack);
  const damage = classifyFinesseSource(damageSource, REFERENCE.damage);
  const evidence = `attack: ${attack}, damage: ${damage}`;
  if (attack === "unknown" || damage === "unknown") return { bug: "unknown", confidence: "low", evidence };
  if (attack === "agile" && damage === "agile") return { bug: "fixed", confidence: "low", evidence };
  return { bug: "present", confidence: "high", evidence };
}

const PROBE_STOP = Symbol("t20cp-finesse-probe");

/**
 * An owned melee weapon and its actor, only for the behavior probe: Acuidade com Arma, Str 1, Dex 4, Luta 10.
 * `light` is the control case (the system has always used Dexterity for light weapons). The flag is readable both
 * as `flags.tormenta20.acuidade` (1.6.5) and through `getFlag` (1.6.6).
 * @param {{light: boolean}} args
 * @returns {object}
 */
export function probeItem({ light }) {
  const flags = { tormenta20: { acuidade: true } };
  return {
    type: "arma",
    name: "T20CP probe",
    isOwned: true,
    hasAttack: true,
    effects: [],
    getRollData: () => ({}),
    actor: {
      flags,
      getFlag: (scope, key) => flags[scope]?.[key],
      items: null,
      system: {
        atributos: { for: { value: 1 }, des: { value: 4 } },
        pericias: { luta: { value: 10, atributo: "for" } },
        modificadores: {}
      }
    },
    system: {
      empunhadura: light ? "leve" : "uma",
      proposito: "corpo-a-corpo",
      propriedades: light ? {} : { agi: true },
      rolled: {},
      rolls: [
        { type: "ataque", name: "Ataque", parts: [["1d20", "", ""], ["luta", "", ""]] },
        { type: "dano", name: "Dano", parts: [["1d6", "perfuracao", ""], ["padrao", "", ""]] }
      ]
    }
  };
}

/**
 * Whether the behavior probe may call a method: only code known to be the system's own (1.6.5, 1.6.5 with the usual
 * fix, or 1.6.6). Anything else, such as another module's wrapper or an unknown version, could have side effects
 * when called with a fake item, so it is never run.
 * @param {string|undefined} source
 * @param {"attack"|"damage"} kind
 * @returns {boolean}
 */
export function isProbeSafe(source, kind) {
  if (classifyFinesseSource(source, REFERENCE[kind]) !== "unknown") return true;
  return matches(normalizeSource(source), REFERENCE_1_6_6[kind]);
}

/**
 * Attribute the original getAttackToHit picks for the probe item: "des", "for" or null (inconclusive).
 * @param {Function} getAttackToHit
 * @param {object} item  From probeItem.
 * @returns {"des"|"for"|null}
 */
export function probeAttack(getAttackToHit, item) {
  const skill = getAttackToHit.call(item)?.rollData?.skill;
  return skill === 13 ? "des" : skill === 10 ? "for" : null;
}

/**
 * Attribute the original rollDamage picks for the "Padrão" part of the probe item, read when the parts are mapped,
 * before the first await. The probe stops the call right there (and again in getRollData, which damageRoll's
 * arguments read), so nothing is rolled and no message is created.
 * @param {Function} rollDamage
 * @param {object} item  From probeItem.
 * @returns {"des"|"for"|null}
 */
export function probeDamage(rollDamage, item) {
  const captured = [];
  const roll = item.system.rolls.find((r) => r.type === "dano");
  roll.parts = Object.defineProperty([...roll.parts], "map", {
    value(fn, thisArg) {
      captured.push(Array.prototype.map.call(this, fn, thisArg));
      throw PROBE_STOP;
    }
  });
  item.getRollData = () => {
    throw PROBE_STOP;
  };
  try {
    rollDamage.call(item)?.catch?.(() => {});
  } catch (err) {
    if (err !== PROBE_STOP) return null;
  }
  const attribute = captured[0]?.[1]?.[0];
  return attribute === "@des" ? "des" : attribute === "@for" ? "for" : null;
}

/**
 * Diagnosis from the behavior probe, or undefined when it is inconclusive (the light control must use Dexterity).
 * @param {{attack: string|null, damage: string|null, lightAttack: string|null, lightDamage: string|null}} result
 * @returns {import("../registry.mjs").Diagnosis|undefined}
 */
export function diagnoseFinesseBehavior({ attack, damage, lightAttack, lightDamage }) {
  if (lightAttack !== "des" || lightDamage !== "des" || !attack || !damage) return undefined;
  const evidence = `behavior: attack ${attack}, damage ${damage}`;
  if (attack === "des" && damage === "des") return { bug: "fixed", confidence: "high", evidence };
  return { bug: "present", confidence: "high", evidence };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function usesAgileFinesse(item) {
  const actor = item?.actor;
  if (!item?.isOwned || !actor || !isAgileMeleeWeapon(item)) return false;
  return prefersDexterity({
    optionalRule: game.settings.get("tormenta20", "lightFinesseWeapons"),
    acuidade: actor.flags?.tormenta20?.acuidade,
    atributos: actor.system?.atributos
  });
}

function warn(err) {
  console.warn("t20-community-patches | finesse-agile-weapons:", err);
}

/** @type {WeakMap<object, {base: Array<object>, installed: Array<object>}>} */
const frames = new WeakMap();

function getItemClass() {
  const ItemClass = CONFIG.Item.documentClass;
  if (typeof ItemClass?.prototype?.getAttackToHit !== "function" || typeof ItemClass.prototype.rollDamage !== "function") {
    return null;
  }
  return ItemClass;
}

function isNeeded() {
  const ItemClass = getItemClass();
  if (!ItemClass) return undefined;
  const attack = unwrap(ItemClass.prototype.getAttackToHit);
  const damage = unwrap(ItemClass.prototype.rollDamage);
  const attackSource = Function.prototype.toString.call(attack);
  const damageSource = Function.prototype.toString.call(damage);
  const fromSource = diagnoseFinesseSource(attackSource, damageSource);
  if (!isProbeSafe(attackSource, "attack") || !isProbeSafe(damageSource, "damage")) return fromSource;
  try {
    const behavior = diagnoseFinesseBehavior({
      attack: probeAttack(attack, probeItem({ light: false })),
      damage: probeDamage(damage, probeItem({ light: false })),
      lightAttack: probeAttack(attack, probeItem({ light: true })),
      lightDamage: probeDamage(damage, probeItem({ light: true }))
    });
    return behavior ?? fromSource;
  } catch (err) {
    warn(err);
    return fromSource;
  }
}

function apply() {
  const ItemClass = getItemClass();
  if (!ItemClass) throw new Error("Tormenta20 ItemT20#getAttackToHit/rollDamage not found");

  // Synchronous: the attribute is restored before anything else can read the roll.
  const getAttackToHit = ItemClass.prototype.getAttackToHit;
  ItemClass.prototype.getAttackToHit = markWrapper(function (...args) {
    let roll = null;
    let original;
    try {
      if (usesAgileFinesse(this)) {
        roll = this.system.rolls?.find((r) => r.type === "ataque") ?? null;
        const slot = roll && attackPartWithDexterity(roll.parts);
        if (slot) {
          original = roll.parts[1];
          roll.parts[1] = slot;
        } else roll = null;
      }
    } catch (err) {
      roll = null;
      warn(err);
    }
    try {
      return getAttackToHit.apply(this, args);
    } finally {
      if (roll) roll.parts[1] = original;
    }
  }, getAttackToHit);

  // ItemT20#rollDamage is async, but it reads `this.system.rolls` (the `for…of` iterator and the attack skill)
  // before its first `await` (damageRoll → Roll#evaluate, T20:9170-9182). So each call installs its own `rolls`
  // array only for its synchronous start and restores the previous value before returning the promise; the loop
  // keeps iterating that call's array. The synchronous start can still reach a nested call on the same item
  // (Roll#evaluate starts before the `await`; a hook may roll again): `frames` keeps the item's real rolls while a
  // per-call array is installed, so the nested call builds its own array from them, whatever its eligibility.
  const rollDamage = ItemClass.prototype.rollDamage;
  ItemClass.prototype.rollDamage = markWrapper(function (...args) {
    const outer = frames.get(this);
    let before;
    let installed = null;
    try {
      before = this.system.rolls;
      const { base, rolls } = rollsForCall(before, outer, usesAgileFinesse(this));
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
  id: "finesse-agile-weapons",
  group: "items",
  issue: 44,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  apply
};
