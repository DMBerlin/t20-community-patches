/**
 * Prolonged care (Cuidados Prolongados) during rest.
 *
 * Bug (tormenta20 1.6.5): ActorT20#descanso multiplies the whole HP recovery by 2 when "Cuidados Prolongados" is
 * checked (`cp = curaCP ? 2 : 1`). The rule (Cura, p. 117) adds +1 HP per level. Both only match on a Normal rest
 * without extra HP.
 *
 * Fix: when curaCP is set, the original method runs with curaCP off and one more extra HP per level, so the system
 * computes floor(level × (condition + extra HP)) + level. MP, chat cards and the other options stay the same.
 */
import { markWrapper, stripComments, unwrap } from "../utils.mjs";

/**
 * Start of ActorT20#descanso in tormenta20 1.6.5 (T20:7038-7050), comments removed and whitespace collapsed, up to
 * the first HP update. This part only reads the level and calls modifyTokenAttribute, so it is safe to run on a
 * fake actor. The probe never runs code that does not start exactly like this.
 */
export const KNOWN_DESCANSO_START =
  'async descanso(modificador = 1, modPV = 0, modPM = 0, curaCP = false, curaAC = false, toChat = true) { ' +
  'let descricao = ""; const nivel = this.system.attributes.nivel.value; let rec = { pv: 0, pm: 0 }; ' +
  "let cp = curaCP ? 2 : 1; let ac = curaAC ? 2 : 1; " +
  "let recuperarPV = Math.floor(nivel * (modificador + modPV) * cp); rec.pv = recuperarPV; " +
  'await this.modifyTokenAttribute("attributes.pv", recuperarPV, true, true);';

/** @param {unknown} source */
export function normalizeSource(source) {
  if (typeof source !== "string") return "";
  return stripComments(source).replace(/\s+/g, " ").trim();
}

/**
 * Whether a function is the known 1.6.5 implementation, read from its source without running it.
 * @param {unknown} fn
 */
export function isKnownDescanso(fn) {
  if (typeof fn !== "function") return false;
  let source;
  try {
    source = Function.prototype.toString.call(fn);
  } catch {
    return false;
  }
  return normalizeSource(source).startsWith(KNOWN_DESCANSO_START);
}

/** Cases that tell the bug from the rule: a fractional condition (Ruim) and a high one with extra HP. */
export const PROBE_CASES = [
  { nivel: 3, modificador: 0.5, modPV: 0 },
  { nivel: 4, modificador: 3, modPV: 1 }
];

/** HP recovered with prolonged care, by the rule. */
export function expectedCareRecovery({ nivel, modificador, modPV }) {
  return Math.floor(nivel * (modificador + modPV)) + nivel;
}

/** HP recovered with prolonged care, as tormenta20 1.6.5 computes it. */
export function buggyCareRecovery({ nivel, modificador, modPV }) {
  return Math.floor(nivel * (modificador + modPV) * 2);
}

/**
 * Arguments for the original ActorT20#descanso(modificador = 1, modPV = 0, modPM = 0, curaCP = false,
 * curaAC = false, toChat = true). Prolonged care becomes one more extra HP per level. Anything the fix cannot
 * interpret is passed through unchanged.
 * @param {unknown[]} args
 * @returns {unknown[]}
 */
export function correctRestArgs(args) {
  const list = [...args];
  if (!list[3]) return list;
  const modPV = list[1] === undefined ? 0 : list[1];
  if (typeof modPV !== "number" || !Number.isFinite(modPV)) return list;
  list[1] = modPV + 1;
  list[3] = false;
  return list;
}

/**
 * Runs a method already accepted by isKnownDescanso on a fake actor and returns the HP it tries to recover. The
 * fake throws on the first modifyTokenAttribute call, so MP, chat and later code never run.
 * @param {Function} descanso
 * @param {{nivel: number, modificador: number, modPV: number}} sample
 * @returns {unknown} The HP value, or undefined when the method never reached the HP update.
 */
export function measureCareRecovery(descanso, { nivel, modificador, modPV }) {
  const stop = new Error("t20-community-patches probe");
  let observed;
  const fake = {
    name: "probe",
    system: { attributes: { nivel: { value: nivel } } },
    modifyTokenAttribute(attribute, value) {
      if (attribute === "attributes.pv") observed = value;
      throw stop;
    }
  };
  try {
    const result = descanso.call(fake, modificador, modPV, 0, true, false, false);
    result?.catch?.(() => {});
  } catch {
    /* a synchronous failure leaves observed undefined */
  }
  return observed;
}

/**
 * Only measures known 1.6.5 code, so it reports the bug or nothing: never "fixed".
 * @param {Array<{nivel: number, modificador: number, modPV: number, observed: unknown}>} samples
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseCareSamples(samples) {
  const evidence = samples.map((s) => `nível ${s.nivel} × ${s.modificador} + ${s.modPV}: ${s.observed}`).join("; ");
  if (!samples.length || samples.some((s) => typeof s.observed !== "number")) {
    return { bug: "unknown", confidence: "low", evidence: `descanso probe: ${evidence || "no samples"}` };
  }
  if (samples.every((s) => s.observed === buggyCareRecovery(s) && s.observed !== expectedCareRecovery(s))) {
    return { bug: "present", confidence: "high", evidence: `prolonged care doubles HP recovery (${evidence})` };
  }
  return { bug: "unknown", confidence: "low", evidence: `unrecognized recovery (${evidence})` };
}

export function isNeeded() {
  const descanso = unwrap(globalThis.CONFIG?.Actor?.documentClass?.prototype?.descanso);
  if (typeof descanso !== "function") {
    return { bug: "unknown", confidence: "low", evidence: "Actor#descanso not found" };
  }
  if (!isKnownDescanso(descanso)) {
    return { bug: "unknown", confidence: "low", evidence: "Actor#descanso differs from tormenta20 1.6.5; not executed" };
  }
  return diagnoseCareSamples(PROBE_CASES.map((s) => ({ ...s, observed: measureCareRecovery(descanso, s) })));
}

function apply() {
  const proto = CONFIG.Actor.documentClass?.prototype;
  const original = proto?.descanso;
  if (typeof original !== "function") {
    console.warn("t20-community-patches | rest-recovery: Actor#descanso not found; nothing patched.");
    return;
  }
  proto.descanso = markWrapper(function (...args) {
    return original.apply(this, correctRestArgs(args));
  }, original);
}

export default {
  id: "rest-recovery",
  group: "actor",
  issue: 31,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  apply
};
