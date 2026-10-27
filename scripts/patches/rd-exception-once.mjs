/**
 * Damage reduction with exception, applied once per attack (tormenta20 1.6.5).
 *
 * Bug: ActorT20#applyDamageV2 adds the exception RD (`resistencias.<tipo>.excecao`, "RD 10/luz") to every
 * non-excepted damage type of the roll (T20:7422-7424), so an attack with several damage types is reduced several
 * times, and penetration (`roll.options.rd`, e.g. Penetrante) never reduces it.
 *
 * Fix: when the target has an exception RD, the reductions are resolved here and handed to the system through its
 * prepared data, only during the synchronous part of applyDamageV2: the exception RD that is actually absorbed
 * (never more than the non-excepted damage) is added to the general RD, which the system subtracts once from the
 * total. Penetration is spent as the system spends it (general RD, then each type in term order), and what is left
 * reduces the exception RD. The prepared data is restored right after the call; nothing is persisted. The wrapper
 * only acts on the verified applyDamageV2 source (tormenta20 1.6.5).
 */
import { MODULE_ID, markWrapper, sourceFingerprint, unwrap } from "../utils.mjs";

const LOG = `${MODULE_ID} | rd-exception-once:`;

/** sourceFingerprint of ActorT20#applyDamageV2 in tormenta20 1.6.5 (T20:7360-7451). */
export const KNOWN_APPLY_DAMAGE_V2 = "f28e58e0:2657";

/** Roll flavors that applyDamageV2 never treats as damage (T20:7392-7403). */
export const NON_DAMAGE_TYPES = new Set(["perda", "curapv", "curatpv", "curapm", "curatpm"]);

/**
 * Groups the damage terms of a roll by type, as applyDamageV2 does (T20:7377-7390).
 * @param {object[]} terms              roll.terms
 * @param {string} [fallback="dano"]    The `type` argument of applyDamageV2
 * @returns {Map<string, {value: number, porDado: number}>}  In term order; healing and `perda` are left out.
 */
export function groupDamage(terms, fallback = "dano") {
  const groups = new Map();
  if (!Array.isArray(terms)) return groups;
  let lastOperator = "+";
  for (const term of terms) {
    if (!term) continue;
    if (term.operator) {
      lastOperator = term.operator;
      continue;
    }
    const flavor = term.options?.flavor ?? terms[0]?.options?.flavor ?? fallback;
    if (!groups.has(flavor)) groups.set(flavor, { value: 0, porDado: 0 });
    const group = groups.get(flavor);
    const total = Number(term.total) || 0;
    group.value += lastOperator == "+" ? total : -total;
    if (term.faces) group.porDado += Number(term.number) || 0;
  }
  for (const type of NON_DAMAGE_TYPES) groups.delete(type);
  return groups;
}

/**
 * The exception RD, read as applyDamageV2 reads it (T20:7363-7366, 7422-7423): the first `excecao` found, and every
 * type with an `excecao` is excepted.
 * @param {Record<string, {excecao?: number}>} resistances
 * @returns {{amount: number, except: Set<string>}|null}
 */
export function readExceptionReduction(resistances) {
  const except = new Set();
  let amount = null;
  for (const [type, data] of Object.entries(resistances ?? {})) {
    if (!data?.excecao) continue;
    except.add(type);
    amount ??= Number(data.excecao);
  }
  return except.size && Number.isFinite(amount) && amount > 0 ? { amount, except } : null;
}

/**
 * Resolves the reductions of one attack against a target with an exception RD.
 * @param {object} args
 * @param {Map<string, {value: number, porDado: number}>} args.groups  groupDamage()
 * @param {Record<string, object>} args.resistances  Prepared `system.tracos.resistencias`
 * @param {{amount: number, except: Set<string>}} args.exception
 * @param {number} args.multiplier   > 0
 * @param {number} [args.penetration=0]
 * @returns {{general: number, typed: Map<string, number>, absorbed: number}}
 *          The general RD to hand to the system (with the absorbed exception RD), the RD of each type after
 *          penetration, and the absorbed exception RD.
 */
export function resolveReductions({ groups, resistances, exception, multiplier, penetration = 0 }) {
  let left = Math.abs(Number(penetration) || 0);
  const spend = (rd) => {
    const value = Math.max(rd - left, 0);
    left = Math.max(left - rd, 0);
    return value;
  };
  const general = spend(Number(resistances.dano?.value) || 0);
  const typed = new Map();
  let open = 0;
  for (const [type, group] of groups) {
    const data = resistances[type] ?? {};
    let rd = 0;
    if (type !== "dano") {
      rd = spend(Number(data.value) || 0);
      typed.set(type, rd);
    }
    let value = group.value;
    if (data.imunidade) value = 0;
    else if (data.vulnerabilidade) value = Math.floor(value * 1.5);
    else if (data.danoPorDado) value += group.porDado;
    if (!exception.except.has(type)) open += Math.max(value * multiplier - rd, 0);
  }
  // Penetration left over after the RDs the system already reduces only reduces the exception RD.
  const exceptionRD = Math.max(exception.amount - left, 0);
  const absorbed = Math.min(exceptionRD, open);
  return { general: general + absorbed, typed, absorbed };
}

/**
 * Hands the resolved reductions to the prepared data, in place, and returns a function that undoes it.
 * @param {Record<string, object>} resistances
 * @param {{amount: number, except: Set<string>}} exception
 * @param {{general: number, typed: Map<string, number>}} resolved
 * @returns {() => void}
 */
export function handOver(resistances, exception, resolved) {
  const saved = [];
  const set = (data, key, value) => {
    saved.push([data, key, data[key]]);
    data[key] = value;
  };
  try {
    for (const type of exception.except) set(resistances[type], "excecao", 0);
    set(resistances.dano, "value", resolved.general);
    for (const [type, rd] of resolved.typed) if (resistances[type]) set(resistances[type], "value", rd);
  } catch (err) {
    for (const [data, key, value] of saved.reverse()) data[key] = value;
    throw err;
  }
  return () => {
    for (const [data, key, value] of saved.reverse()) data[key] = value;
  };
}

/**
 * @param {string|null} fingerprint  sourceFingerprint of the unwrapped applyDamageV2
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseFingerprint(fingerprint) {
  if (fingerprint === KNOWN_APPLY_DAMAGE_V2) {
    return { bug: "present", confidence: "high", evidence: "applyDamageV2 is the verified 1.6.5 code" };
  }
  return { bug: "unknown", confidence: "low", evidence: `unrecognized applyDamageV2 (${fingerprint})` };
}

/**
 * Resolves and hands over the reductions for one call; returns the undo function, or null when nothing changes.
 * @param {object} actor
 * @param {object} roll
 * @param {number} multiplier
 * @param {string} type
 * @returns {(() => void)|null}
 */
export function prepareCall(actor, roll, multiplier, type) {
  if (!(Number(multiplier) > 0)) return null;
  const resistances = actor?.system?.tracos?.resistencias;
  if (!resistances?.dano) return null;
  const exception = readExceptionReduction(resistances);
  if (!exception) return null;
  const groups = groupDamage(roll?.terms, type ?? "dano");
  if (!groups.size) return null;
  const resolved = resolveReductions({
    groups,
    resistances,
    exception,
    multiplier: Number(multiplier),
    penetration: roll?.options?.rd
  });
  return handOver(resistances, exception, resolved);
}

function originalSource(fn) {
  try {
    return typeof fn === "function" ? Function.prototype.toString.call(fn) : null;
  } catch {
    return null;
  }
}

function isNeeded() {
  const original = unwrap(CONFIG.Actor?.documentClass?.prototype?.applyDamageV2);
  if (typeof original !== "function") return { bug: "unknown", confidence: "low", evidence: "applyDamageV2 not found" };
  return diagnoseFingerprint(sourceFingerprint(originalSource(original)));
}

function apply() {
  const prototype = CONFIG.Actor.documentClass?.prototype;
  const original = prototype?.applyDamageV2;
  if (typeof original !== "function") throw new Error("Tormenta20 applyDamageV2 not found");
  const known = sourceFingerprint(originalSource(unwrap(original))) === KNOWN_APPLY_DAMAGE_V2;
  if (!known) console.warn(`${LOG} unrecognized applyDamageV2, not changing it`);

  // applyDamageV2 reads the resistances synchronously, before its first await (this.update, T20:7449), so the
  // prepared data can be restored as soon as the original returns its promise.
  prototype.applyDamageV2 = markWrapper(function (roll, multiplier = 1, type = "dano", ...rest) {
    let restore = null;
    if (known) {
      try {
        restore = prepareCall(this, roll, multiplier, type);
      } catch (err) {
        restore = null;
        console.warn(`${LOG} could not resolve the reductions`, err);
      }
    }
    // Penetration was already spent by resolveReductions; the caller's roll is never changed.
    const call = restore ? Object.create(roll, { options: { value: { ...roll.options, rd: 0 } } }) : roll;
    try {
      return original.call(this, call, multiplier, type, ...rest);
    } finally {
      restore?.();
    }
  }, original);
}

export default {
  id: "rd-exception-once",
  group: "combat",
  issue: 64,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  apply
};
