/** Pure decisions of the lethal or nonlethal attack choice (#74). */
import { MODULE_ID } from "../../lib/module.mjs";
import { matchesSource } from "../../lib/spell-source.mjs";
import { ROLL_DATA_KEY } from "../../lib/nonlethal.mjs";

export const NATURAL_FLAG = "naturalDamage";
export const NATURAL_MODES = Object.freeze(["auto", "lethal", "nonlethal"]);
export const CHOICES = Object.freeze(["lethal", "nonlethal"]);
export const PENALTY = -5;
export const DATA_VERSION = 1;
export const UNARMED_REF = Object.freeze({ id: "NFepeG0ojjq3Xggs", names: new Set(["ataque desarmado"]) });
export const MERCIFUL_ID = "merciful";
export const MELEE_PURPOSES = Object.freeze(["corpo-a-corpo", "corpo-a-corpo-arremesso"]);
export const WAIVERS = Object.freeze([
  Object.freeze({ id: "piedoso", ref: { id: "whJFemzRCrz6gvtp", names: new Set(["ataque piedoso"]) }, to: ["nonlethal"], melee: true }),
  Object.freeze({ id: "estilo", ref: { id: "DNLooQ6SGKf2hqEc", names: new Set(["estilo desarmado"]) }, to: ["lethal", "nonlethal"], unarmed: true }),
  Object.freeze({ id: "paoCirco", ref: { id: "k4kKX4hcWhrum67F", names: new Set(["pão e circo"]) }, to: ["nonlethal"] })
]);
const NOT_DAMAGE_TYPES = new Set(["curapv", "curatpv", "curapm", "curatpm", "perda"]);
export const LINE_CLASS = "t20cp-nonlethal-attack";
export const FIELD_CLASS = "t20cp-natural-damage";

/** "lethal" | "nonlethal": the field's mode, or, in "auto" (or an unknown value), unarmed or active Piedosa. */
export function naturalType({ mode, unarmed, merciful }) {
  if (mode === "lethal" || mode === "nonlethal") return mode;
  return unarmed || merciful ? "nonlethal" : "lethal";
}

/** Ids of WAIVERS that waive the -5 of this choice with this weapon. Empty when there is no penalty to waive. */
export function waiversFor({ choice, natural, unarmed, melee, powers }) {
  if (!CHOICES.includes(choice) || choice === natural) return [];
  const owned = powers instanceof Set ? powers : new Set(powers ?? []);
  return WAIVERS.filter(
    (w) => owned.has(w.id) && w.to.includes(choice) && (!w.melee || melee) && (!w.unarmed || unarmed)
  ).map((w) => w.id);
}

/** 0 when the choice is the natural type or a power waives it; otherwise PENALTY. */
export function penaltyFor({ choice, natural, waived }) {
  if (choice === natural || (Array.isArray(waived) ? waived.length : waived)) return 0;
  return PENALTY;
}

/** "lethal" | "nonlethal" | null from the raw form value (string, array with nulls, undefined). */
export function parseChoice(raw) {
  const values = (Array.isArray(raw) ? raw : [raw]).filter((v) => CHOICES.includes(v));
  return values.length === 1 || (values.length > 1 && values.every((v) => v === values[0])) ? values[0] : null;
}

/** Whether a damage roll's parts are damage (not healing, mana recovery or HP loss). */
export function isDamageParts(parts) {
  return Array.isArray(parts) && !parts.some((p) => NOT_DAMAGE_TYPES.has(p?.[1]));
}

/** The whole decision for a choice: penalty and waivers. */
export function decide({ choice, natural, unarmed, melee, powers }) {
  const waivers = waiversFor({ choice, natural, unarmed, melee, powers });
  return { choice, natural, waivers, penalty: penaltyFor({ choice, natural, waived: waivers }) };
}

/** What the decision needs from the weapon and its actor. */
export function weaponContext(item) {
  const mode = item?.flags?.[MODULE_ID]?.[NATURAL_FLAG] ?? item?.getFlag?.(MODULE_ID, NATURAL_FLAG);
  const unarmed = matchesSource(item, UNARMED_REF);
  const merciful = [...(item?.effects ?? [])].some((e) => e?.system?.identifier === MERCIFUL_ID && !e.disabled);
  const melee = MELEE_PURPOSES.includes(item?.system?.proposito);
  const powers = new Set();
  for (const owned of item?.actor?.items ?? []) {
    if (owned?.type !== "poder") continue;
    for (const w of WAIVERS) if (matchesSource(owned, w.ref)) powers.add(w.id);
  }
  return { natural: naturalType({ mode, unarmed, merciful }), unarmed, melee, powers };
}

/** Records the choice in every damage roll of the clone. */
export function recordDamage(item, decision) {
  const rolled = item?.system?.rolled;
  if (!rolled || !decision) return;
  for (const r of item.system.rolls ?? []) {
    if (r?.type !== "dano" || !isDamageParts(r.parts)) continue;
    const roll = rolled[r.name];
    if (!roll?.options) continue;
    (roll.options[MODULE_ID] ??= {})[ROLL_DATA_KEY] = { v: DATA_VERSION, nonlethal: decision.choice === "nonlethal" };
  }
}
