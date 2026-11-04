import { stripComments, unwrap } from "../../lib/source.mjs";
import { ALCHEMICAL_PART, createPartLedger, diagnoseAlchemicalBonus, rollsMissingAlchemicalBonus, runProbe } from "./domain.mjs";

function itemPrototype(ctx) {
  const proto = ctx.platform.classes.item?.prototype;
  return typeof proto?.rollDamage === "function" ? proto : null;
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const proto = itemPrototype(ctx);
  if (!proto) throw new Error("Tormenta20 ItemT20#rollDamage not found");
  const ledger = createPartLedger();
  const { getProperty } = ctx.platform.utils;
  ctx.wrap(proto, "rollDamage", async function (rollDamage, ...args) {
    let taken = [];
    try {
      const dano = getProperty(this?.actor?.system ?? {}, "modificadores.dano");
      taken = ledger.acquire(rollsMissingAlchemicalBonus(this, dano));
    } catch (err) {
      ctx.log.warn("could not add the alchemical bonus", this?.uuid, err);
    }
    try {
      return await rollDamage.apply(this, args);
    } finally {
      ledger.release(taken);
    }
  });
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const original = unwrap(itemPrototype(ctx)?.rollDamage);
  if (typeof original !== "function") return { bug: "unknown", confidence: "low", evidence: "rollDamage not found" };
  const source = stripComments(ctx.platform.sourceOf(original) ?? "");
  if (!source.includes(ALCHEMICAL_PART) || !source.includes("modificadores.dano")) {
    return { bug: "unknown", confidence: "low", evidence: "rollDamage not recognized; not executed" };
  }
  return diagnoseAlchemicalBonus({
    alqOnly: runProbe(original, { alq: ["2"], mag: [] }),
    both: runProbe(original, { alq: ["2"], mag: ["1"] })
  });
}
