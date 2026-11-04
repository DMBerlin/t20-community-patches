/** sourceFingerprint of ActorT20#applyDamageV2 in tormenta20 1.6.5 (T20:7360-7451). */
export const KNOWN_APPLY_DAMAGE_V2 = "f28e58e0:2657";

/** Roll flavors that applyDamageV2 never treats as damage (`damage.perda` and the healing `map`, T20:6216-6227). */
export const NON_DAMAGE_TYPES = new Set(["perda", "curapv", "curatpv", "curapm", "curatpm"]);

/**
 * Groups the damage terms of a roll by type, as applyDamageV2 does (`roll.terms`, T20:6201-6214).
 * @param {object[]} terms              roll.terms
 * @param {string} [fallback="dano"]    The `type` argument of applyDamageV2
 * @returns {Map<string, {value: number, porDado: number}>}  In term order; healing and `perda` are left out.
 */
export function groupDamage(terms, fallback = "dano") {
  const groups = new Map();
  if (!Array.isArray(terms)) return groups;
  const defaultFlavor = terms[0]?.options?.flavor ?? fallback;
  let lastOperator = "+";
  for (const term of terms) {
    if (!term) continue;
    if (term.operator) {
      lastOperator = term.operator;
      continue;
    }
    addTerm(groups, term.options?.flavor ?? defaultFlavor, term, lastOperator);
  }
  for (const type of NON_DAMAGE_TYPES) groups.delete(type);
  return groups;
}

function addTerm(groups, flavor, term, operator) {
  if (!groups.has(flavor)) groups.set(flavor, { value: 0, porDado: 0 });
  const group = groups.get(flavor);
  const total = Number(term.total) || 0;
  group.value += operator === "+" ? total : -total;
  if (term.faces) group.porDado += Number(term.number) || 0;
}

/**
 * The exception RD, read as applyDamageV2 reads it (`rdsEx`, T20:6187-6190, 6246-6247): the first `excecao` found, and
 * every type with an `excecao` is excepted.
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
    if (!exception.except.has(type)) open += Math.max(typedDamage(group, data) * multiplier - rd, 0);
  }
  // Penetration left over after the RDs the system already reduces only reduces the exception RD.
  const exceptionRD = Math.max(exception.amount - left, 0);
  const absorbed = Math.min(exceptionRD, open);
  return { general: general + absorbed, typed, absorbed };
}

/** The damage of one type after immunity, vulnerability and per-die damage, as applyDamageV2 computes it. */
function typedDamage(group, data) {
  if (data.imunidade) return 0;
  if (data.vulnerabilidade) return Math.floor(group.value * 1.5);
  if (data.danoPorDado) return group.value + group.porDado;
  return group.value;
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
 * @returns {import("../../registry.mjs").Diagnosis}
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
  const target = exceptionTarget(actor, multiplier);
  if (!target) return null;
  const { resistances, exception } = target;
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

/** The prepared resistances and the exception RD of a damage call, or null when there is no exception RD to handle. */
function exceptionTarget(actor, multiplier) {
  if (!(Number(multiplier) > 0)) return null;
  const resistances = actor?.system?.tracos?.resistencias;
  if (!resistances?.dano) return null;
  const exception = readExceptionReduction(resistances);
  return exception ? { resistances, exception } : null;
}
