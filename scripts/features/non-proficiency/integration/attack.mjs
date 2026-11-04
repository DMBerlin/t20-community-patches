/** Attack roll: -5 for a character's weapon without proficiency (Tormenta20 Jogo do Ano, p. 142). */
import { WEAPON_PENALTY, diagnoseSource } from "../domain/index.mjs";
import { weaponStatusOf } from "./actor.mjs";

const UNKNOWN_KEY = "T20CP.NonProficiency.UnknownSource";

/** Diagnoses the original method; an unrecognized one is still wrapped, with a warning. */
export function checkSource(env, name, fn) {
  const { platform } = env;
  const diagnosis = diagnoseSource(name, platform.sourceOf(fn) ?? "", platform.system.version);
  if (diagnosis.bug === "unknown") {
    env.unrecognized.add(name);
    env.log.warn(`${diagnosis.evidence}; installed anyway, check that the system does not apply the penalty too`);
  }
}

export function notifyUnrecognized(env) {
  if (env.unrecognized.size && env.platform.user.isGM() && env.isOn()) {
    env.platform.notify.warn(env.platform.i18n.format(UNKNOWN_KEY, { methods: [...env.unrecognized].join(", ") }));
  }
}

export function installAttack(env) {
  const proto = env.platform.classes.item?.prototype;
  const original = proto?.getAttackToHit;
  if (typeof original !== "function") throw new Error("ItemT20#getAttackToHit not found");
  checkSource(env, "getAttackToHit", original);
  env.wrap(proto, "getAttackToHit", function (original, ...args) {
    const result = original.apply(this, args);
    try {
      if (result?.parts && this.isOwned && env.isOn() && weaponStatusOf(env, this) === "penalty") {
        result.parts.push(String(WEAPON_PENALTY));
      }
    } catch (err) {
      env.warnOnce(err);
    }
    return result;
  });
}
