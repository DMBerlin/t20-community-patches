/** Pure logic of the "Ataque contra Defesa" rule (#42): Defense against an attack, outcome and visibility. */
import { finalOutcome } from "../../lib/attack-outcome.mjs";

export const ATTACK_VS_DEFENSE_SETTING = "attackVsDefenseRule";
export const ATTACK_VS_DEFENSE_VISIBILITY_SETTING = "attackVsDefenseVisibility";
export const VISIBILITY_MODES = ["show", "announce", "hide"];
export const DATA_KEY = "attackVsDefense";
export const DATA_VERSION = 1;
export const PRONE = "caido";

/**
 * Melee or ranged, with the same split the system uses for attack bonuses (T20:8205-8210).
 * @param {unknown} skill  The attack roll's skill (rolls[].parts[1][0]).
 * @returns {"melee"|"ranged"}
 */
export function attackKind(skill) {
  return skill === "pont" ? "ranged" : "melee";
}

/**
 * Defense against this attack.
 * Prone is the only change on defesa.outros in the compendiums, so outros - _source.outros is what Prone applied
 * (with or without the prone-defense patch). A ranged attack undoes it and adds +5. Then the per-target adjustments
 * from other rules (shared defenseAdjustmentsFor) are added, in order.
 * @param {{value: unknown, kind: "melee"|"ranged", prone?: boolean, outros?: unknown, sourceOutros?: unknown,
 *   extra?: {id: string, delta: number}[]}} params
 * @returns {{defense: number|null, adjustments: string[]}}
 */
export function effectiveDefense({ value, kind, prone = false, outros = 0, sourceOutros = 0, extra = [] }) {
  if (value === null || value === undefined || value === "") return { defense: null, adjustments: [] };
  let defense = Number(value);
  if (!Number.isFinite(defense)) return { defense: null, adjustments: [] };
  const adjustments = [];
  if (prone && kind === "ranged") {
    defense += 5 - Math.min(0, (Number(outros) || 0) - (Number(sourceOutros) || 0));
    adjustments.push("prone-ranged");
  }
  for (const adj of Array.isArray(extra) ? extra : []) {
    const delta = Number(adj?.delta);
    if (!adj?.id || !Number.isFinite(delta)) continue;
    defense += delta;
    adjustments.push(String(adj.id));
  }
  return { defense, adjustments };
}

/**
 * Result of one attack against one Defense.
 * @param {{total: number, natural: number, threat: boolean, defense: number|null}} params
 * @returns {{outcome: "hit"|"miss"|"unknown", critical: boolean, automatic: "nat20"|"nat1"|null}}
 */
export function resolveAttack({ total, natural, threat, defense }) {
  if (natural === 20) return { outcome: "hit", critical: !!threat, automatic: "nat20" };
  if (natural === 1) return { outcome: "miss", critical: false, automatic: "nat1" };
  if (!Number.isFinite(defense) || !Number.isFinite(total)) return { outcome: "unknown", critical: false, automatic: null };
  const hit = total >= defense;
  return { outcome: hit ? "hit" : "miss", critical: hit && !!threat, automatic: null };
}

/**
 * Policy of this rule for the TARGET's Defense. It only reuses the system setting "Exibir CD de Ameaças ao jogadores"
 * (showFoeDc); ChatMessageT20#_hideDC (T20:10535-10544) looks at the speaker and hides only the card's DC.
 * GMs, observers of the target actor (they already see the full sheet) and character targets always see the number.
 * @param {{isGM: boolean, isObserver: boolean, actorType: string|null, showFoeDc: boolean}} params
 */
export function canSeeDefense({ isGM, isObserver, actorType, showFoeDc }) {
  return !!(isGM || isObserver || actorType === "character" || showFoeDc);
}

/**
 * What the current user sees of one target's result. GMs see everything; for players, the mode chosen by the GM:
 * show (verdict, and the number per canSeeDefense), announce (verdict; number only for observers and character
 * targets) or hide (nothing). An unknown mode behaves like "show".
 * @param {{mode: string, isGM: boolean, isObserver: boolean, actorType: string|null, showFoeDc: boolean}} params
 * @returns {{verdict: boolean, defense: boolean}}
 */
export function resultVisibility({ mode, isGM, isObserver, actorType, showFoeDc }) {
  if (isGM) return { verdict: true, defense: true };
  if (mode === "hide") return { verdict: false, defense: false };
  if (mode === "announce") return { verdict: true, defense: !!(isObserver || actorType === "character") };
  return { verdict: true, defense: canSeeDefense({ isGM, isObserver, actorType, showFoeDc }) };
}

/**
 * Combines the Defense result of one target with the concealment check of #49 (shared finalOutcome: concealment
 * wins, p. 238). A target missed by concealment never shows a hit or a critical.
 * @param {{outcome: string, critical: boolean}} result  From buildTargetResult.
 * @param {boolean} concealmentMiss
 */
export function combineWithConcealment(result, concealmentMiss) {
  const outcome = finalOutcome(result.outcome, concealmentMiss);
  if (!concealmentMiss) return { ...result, outcome };
  return { ...result, defenseOutcome: result.outcome, outcome, critical: false, concealment: true };
}

/**
 * Result of the attack against one target.
 * @param {object} snapshot  The frozen record ({uuid, name, displayName}) plus live Defense data (see readDefense).
 * @param {{kind: "melee"|"ranged", total: number, natural: number, threat: boolean}} attack
 */
export function buildTargetResult(snapshot, { kind, total, natural, threat }) {
  const { defense, adjustments } = effectiveDefense({ ...snapshot, kind });
  return {
    uuid: snapshot.uuid ?? null,
    name: String(snapshot.name ?? ""),
    actorType: snapshot.actorType ?? null,
    displayName: Number(snapshot.displayName) || 0,
    defense,
    adjustments,
    ...resolveAttack({ total, natural, threat, defense })
  };
}
