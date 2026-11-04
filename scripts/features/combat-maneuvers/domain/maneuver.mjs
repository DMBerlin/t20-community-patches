/** Pure maneuver rules of "Manobras de combate" (#48): sizes, tests, opposed result and card state. */
import { MODULE_ID } from "../../../lib/module.mjs";
import { concealmentChecksOf } from "../../../lib/concealment.mjs";

export const COMBAT_MANEUVERS_SETTING = "combatManeuversRule";
/** Fields of the use dialog (they reach rollAttack, rollDamage and displayCard in `options`). */
export const FORM_KIND = "t20cpManeuver";
export const FORM_VERSATILE = "t20cpManeuverVersatile";
export const MANEUVERS = ["agarrar", "derrubar", "desarmar", "empurrar", "quebrar", "atropelar"];
export const MANEUVER_FLAG = "maneuver";
export const RESULT_FLAG = "maneuverResult";
const CONDITIONS = { agarrar: "agarrado", derrubar: "caido", atropelar: "caido" };
const VERSATILE_DEFAULT = new Set(["derrubar", "desarmar"]);
export const DATA_VERSION = 1;
export const LUTA = "luta";

/** Maneuver modifier for a size: the opposite of the Stealth one (book, p. 106). */
export function maneuverSizeModifier(size, sizeModifiers) {
  const v = Number(sizeModifiers?.[size]);
  return Number.isFinite(v) && v !== 0 ? -v : 0;
}

/** The item (or the itemData of a card) has a melee attack: the attack uses Luta. */
export function isMeleeAttackCard(itemData) {
  const attack = itemData?.rolls?.find?.((r) => r?.type === "ataque");
  return attack?.parts?.[1]?.[0] === LUTA;
}

/** Weapons of the defender that can make the maneuver test: Luta attack, wielded first. */
export function maneuverWeapons(items) {
  return [...(items ?? [])]
    .filter((i) => i?.type === "arma" && isMeleeAttackCard(i.system))
    .sort((a, b) => Number(!!b.system?.equipado) - Number(!!a.system?.equipado));
}

/** The first d20 roll that is not damage (the weapon's main attack, or a skill test). */
export function pickTestRoll(rolls) {
  if (!Array.isArray(rolls)) return null;
  return rolls.find((r) => r?.dice?.[0]?.faces === 20 && r?.options?.type !== "damage") ?? null;
}

/** Total, kept d20 and bonus of the first d20 test of a list of rolls; null when there is none. */
export function attackFromRolls(rolls) {
  const roll = pickTestRoll(rolls);
  if (!roll || !Number.isFinite(roll.total)) return null;
  const d20 = Number(roll.dice[0].total);
  if (!Number.isFinite(d20)) return null;
  return { roll: roll.total, d20, bonus: roll.total - d20 };
}

/** Adds the module's modifiers to a test. */
export function maneuverTest({ roll, d20 }, { sizeMod = 0, versatile = false, other = 0 } = {}) {
  const extra = sizeMod + (versatile ? 2 : 0) + (Number(other) || 0);
  return { total: roll + extra, bonus: roll - d20 + extra };
}

/** Opposed test (book, p. 234): higher total wins; on a tie, the higher bonus; equal bonuses, test again. */
export function resolveOpposed(attacker, defender) {
  if (attacker.total !== defender.total) {
    const winner = attacker.total > defender.total ? "attacker" : "defender";
    return { winner, margin: Math.abs(attacker.total - defender.total), tieBreak: false };
  }
  if (attacker.bonus !== defender.bonus) {
    return { winner: attacker.bonus > defender.bonus ? "attacker" : "defender", margin: 0, tieBreak: true };
  }
  return { winner: "reroll", margin: 0, tieBreak: true };
}

/** What each maneuver does with the result. */
export function maneuverOutcome(kind, result) {
  const won = result.winner === "attacker";
  const out = { ...result, condition: null, pushMeters: 0, noteKey: `${kind}.${result.winner}` };
  if (!won) return out;
  if (CONDITIONS[kind]) out.condition = CONDITIONS[kind];
  if (kind === "empurrar") out.pushMeters = 1.5 * (1 + Math.floor(result.margin / 5));
  if ((kind === "derrubar" || kind === "desarmar") && result.margin >= 5) out.pushMeters = 1.5;
  return out;
}

/** State to draw, derived only from the visible results: for B (selfId null) or for one C (selfId = its id). */
export function maneuverState({ kind, resultIds = [], canonicalId = null, selfId = null, concealed = false }) {
  if (selfId !== null) return selfId === canonicalId ? "result" : "superseded";
  if (concealed) return "concealed";
  if (resultIds.length) return "resolved";
  return kind === "atropelar" ? "resist+passage" : "resist";
}

/**
 * The miss chance check (concealment-miss-chance, #49) of the maneuver's attack roll that failed against its target:
 * the maneuver fails, with no resistance test. Checks of other targets do not count. Null when it did not fail.
 */
export function maneuverConcealment(roll, targetUuid) {
  if (!targetUuid) return null;
  const check = concealmentChecksOf(roll).find((c) => c?.targetUuid === targetUuid && c.missed === true);
  if (!check) return null;
  return { formula: String(check.formula ?? ""), total: Number(check.total), threshold: Number(check.threshold), chance: Number(check.chance) };
}

/** "Arma versátil (+2)" starts checked for Derrubar and Desarmar. */
export function versatileDefault(kind, propriedades) {
  return !!(propriedades?.ver || propriedades?.versatil) && VERSATILE_DEFAULT.has(kind);
}

/** Results of one maneuver whose content the current user can read (the only selection used anywhere). */
export function selectVisibleResults(messages, bId) {
  return [...(messages ?? [])].filter(
    (c) => c?.flags?.[MODULE_ID]?.[RESULT_FLAG]?.of === bId && c.isContentVisible === true
  );
}

/** The canonical result among result messages of one maneuver: oldest timestamp, then smallest id. */
export function findCanonicalResult(results) {
  return [...(results ?? [])].sort((a, b) => (a.timestamp - b.timestamp) || String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

export const isVersatile = (item) => !!(item?.system?.propriedades?.ver || item?.system?.propriedades?.versatil);

/**
 * Copies of the rolls for a new message: ChatMessage.create serializes the array it receives in place, so a live
 * message's or item's Roll objects (and their array) are never handed to it.
 */
export function rollData(rolls) {
  return (rolls ?? []).map((r) => (typeof r?.toJSON === "function" ? r.toJSON() : r));
}
