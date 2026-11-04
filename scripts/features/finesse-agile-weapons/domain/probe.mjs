import { REFERENCE, REFERENCE_1_6_6, classifyFinesseSource, matches, normalizeSource } from "./source.mjs";

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
 * @returns {import("../../../registry.mjs").Diagnosis|undefined}
 */
export function diagnoseFinesseBehavior({ attack, damage, lightAttack, lightDamage }) {
  if (lightAttack !== "des" || lightDamage !== "des" || !attack || !damage) return undefined;
  const evidence = `behavior: attack ${attack}, damage ${damage}`;
  if (attack === "des" && damage === "des") return { bug: "fixed", confidence: "high", evidence };
  return { bug: "present", confidence: "high", evidence };
}
