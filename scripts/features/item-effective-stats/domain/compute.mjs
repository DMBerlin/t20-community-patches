/**
 * Effective values of an item (armor penalty, Defense, critical, attack, damage), with the breakdown of each source.
 */
import { computePenaltyAdjustments } from "../../../lib/armor-penalty.mjs";
import {
  ARMOR_TIPOS,
  DEFENSE_KEY,
  PDA_KEY,
  STEP_KEYS,
  armorAmount,
  foldableAmount,
  isPolished,
  isReducer,
  signed,
  signedText
} from "./classify.mjs";
import { appendFormula, applyCritEffects } from "./crit.mjs";

function stat(name, base, final, parts = [], warning) {
  const entry = { stat: name, base, final, parts };
  if (warning) entry.warning = warning;
  return entry;
}

function changeParts(effect, kind, keyFilter, suffix) {
  const parts = [];
  for (const ch of effect.changes ?? []) {
    if (!keyFilter(ch?.key)) continue;
    const amount = foldableAmount(ch);
    const delta = Number.isFinite(amount) ? signed(amount) : ch.type === "add" ? signedText(ch.value) : `${ch.type ?? ""} ${ch.value ?? ""}`.trim();
    const part = { label: effect.name ?? "", delta, kind };
    if (suffix) part.suffix = suffix;
    parts.push(part);
  }
  return parts;
}

/** Armor penalty: `portador` receives the changes that stay on the bearer. */
function penaltyStat(base, { passive, notApplied }, patches, portador) {
  const basePenalty = Number(base.armadura?.penalidade) || 0;
  const penaltyParts = [];
  let reductions = 0;
  let increases = 0;
  let reducerAsPenalty = false;
  for (const effect of passive) {
    for (const ch of effect.changes ?? []) {
      if (ch?.key !== PDA_KEY) continue;
      const amount = armorAmount(ch);
      if (!Number.isFinite(amount)) {
        portador.push(...changeParts({ ...effect, changes: [ch] }, "note", () => true));
        continue;
      }
      const magnitude = Math.abs(amount);
      if (!magnitude) continue;
      if (isReducer(effect) && patches.penaltyFix) {
        reductions += magnitude;
        penaltyParts.push({ label: effect.name ?? "", delta: signed(magnitude), kind: "applied" });
        continue;
      }
      // The system's PenaltyField turns every value into a penalty (T20:12565-12575).
      if (isReducer(effect)) reducerAsPenalty = true;
      increases += magnitude;
      penaltyParts.push({ label: effect.name ?? "", delta: signed(-magnitude), kind: "applied" });
    }
  }
  let finalPenalty = basePenalty - increases;
  if (patches.penaltyFix && reductions) {
    const id = "item";
    const { items, actorDelta } = computePenaltyAdjustments(
      new Map([[id, basePenalty]]),
      new Map([[id, reductions]]),
      new Map([[id, increases]]),
      id
    );
    finalPenalty = (items.get(id) ?? basePenalty) - increases + actorDelta;
  }
  for (const effect of notApplied) {
    for (const ch of effect.changes ?? []) {
      if (ch?.key !== PDA_KEY) continue;
      const magnitude = Math.abs(foldableAmount(ch));
      const delta = Number.isFinite(magnitude) ? signed(isReducer(effect) && patches.penaltyFix ? magnitude : -magnitude) : String(ch.value);
      penaltyParts.push({ label: effect.name ?? "", delta, kind: "not-applied" });
    }
  }
  return stat("penalty", basePenalty, finalPenalty, penaltyParts, reducerAsPenalty ? "PenaltyFixOff" : undefined);
}

/** Armor Defense: `portador` receives the changes that stay on the bearer. */
function defenseStat(base, { passive, notApplied }, portador) {
  const baseDefense = Number(base.armadura?.value) || 0;
  const defenseParts = [];
  let finalDefense = baseDefense;
  let polished = false;
  for (const effect of passive) {
    for (const ch of effect.changes ?? []) {
      if (ch?.key !== DEFENSE_KEY) continue;
      const amount = armorAmount(ch);
      if (!Number.isFinite(amount)) {
        portador.push(...changeParts({ ...effect, changes: [ch] }, "note", () => true));
        continue;
      }
      finalDefense += amount;
      defenseParts.push({ label: effect.name ?? "", delta: signed(amount), kind: "applied" });
      if (isPolished(effect)) polished = true;
    }
  }
  if (polished) defenseParts.push({ label: "PolishedNote", kind: "note", i18n: true });
  for (const effect of notApplied) defenseParts.push(...changeParts(effect, "not-applied", (k) => k === DEFENSE_KEY));
  return stat("defense", baseDefense, finalDefense, defenseParts);
}

/** Attack or damage label with the automatic "add" changes appended; undefined without a label. */
function rollStat(name, label, { automatic, optional }, matches, format) {
  if (label === undefined || label === null || label === "") return undefined;
  const values = [];
  const parts = [];
  for (const effect of automatic) {
    for (const ch of effect.changes ?? []) {
      if (!matches(ch?.key) || ch.type !== "add") continue;
      const text = String(ch.value ?? "").trim();
      if (!text || text === "0") continue;
      values.push(text);
      parts.push({ label: effect.name ?? "", delta: signedText(text), kind: "applied" });
    }
  }
  for (const effect of optional) parts.push(...changeParts(effect, "optional", matches));
  const final = values.length ? format(appendFormula(label, values)) : label;
  return stat(name === "ataque" ? "attack" : "damage", label, final, parts);
}

function weaponStats(base, effects, patches, result) {
  const { automatic, optional } = effects;
  const crit = applyCritEffects(base.criticoM, base.criticoX, automatic, !!patches.threatFix);
  const optionalCrit = (key) => optional.flatMap((e) => changeParts(e, "optional", (k) => k === key));
  result.criticoM = stat(
    "threat",
    Number(base.criticoM),
    crit.criticoM,
    [...crit.parts.criticoM, ...optionalCrit("criticoM")],
    crit.multiplied && !patches.threatFix ? "ThreatFixOff" : undefined
  );
  result.criticoX = stat("multiplier", Number(base.criticoX), crit.criticoX, [
    ...crit.parts.criticoX,
    ...optionalCrit("criticoX")
  ]);

  const ataque = rollStat("ataque", base.labels?.toHit, effects, (k) => k === "ataque", (f) => (/^[+-]/.test(f) ? f : `+${f}`));
  if (ataque) result.ataque = ataque;
  const dano = rollStat("dano", base.labels?.dano, effects, (k) => k === "dano" || /^dano:/.test(String(k ?? "")), (f) => f);
  if (dano) result.dano = dano;

  const stepParts = [
    ...automatic.flatMap((e) => changeParts(e, "note", (k) => STEP_KEYS.has(k), "StepNotAdded")),
    ...optional.flatMap((e) => changeParts(e, "optional", (k) => STEP_KEYS.has(k), "StepNotAdded"))
  ];
  for (const part of stepParts) if (/^custom\s+/.test(part.delta)) part.delta = signedText(part.delta.replace(/^custom\s+/, ""));
  if (stepParts.length) result.passo = stat("step", "", "", stepParts);
}

/**
 * Computes the effective values of an item.
 * @param {{type: string, tipo?: string, armadura?: {value?: number, penalidade?: number}, criticoM?: number,
 *   criticoX?: number, labels?: {toHit?: string, dano?: string}}} base   `_source.system` values and official labels.
 * @param {ReturnType<typeof import("./classify.mjs").classifyItemEffects>} effects
 * @param {{penaltyFix?: boolean, threatFix?: boolean}} patches
 * @returns {Record<string, import("./classify.mjs").Stat>}  Keys: "armadura.penalidade", "armadura.value", "criticoM",
 *   "criticoX", "ataque", "dano", "passo", "portador" (only those that apply to the item).
 */
export function computeEffectiveStats(base, effects, patches = {}) {
  const result = {};
  const { passive = [], automatic = [], optional = [], notApplied = [], bearer = [] } = effects ?? {};
  const classified = { passive, automatic, optional, notApplied, bearer };
  const isArmor = base?.type === "equipamento" && ARMOR_TIPOS.has(base?.tipo);
  const isWeapon = base?.type === "arma";
  if (!isArmor && !isWeapon) return result;

  const ownKeys = isArmor ? new Set([PDA_KEY, DEFENSE_KEY]) : new Set();
  const portador = [];

  if (isArmor) {
    result["armadura.penalidade"] = penaltyStat(base, classified, patches, portador);
    result["armadura.value"] = defenseStat(base, classified, portador);
  }
  if (isWeapon) weaponStats(base, classified, patches, result);

  // Changes that are not statistics of the item itself.
  for (const effect of passive) portador.push(...changeParts(effect, "note", (k) => !ownKeys.has(k)));
  for (const effect of bearer) portador.push(...changeParts(effect, "note", () => true, "BearerDepends"));
  for (const effect of notApplied) portador.push(...changeParts(effect, "not-applied", (k) => !ownKeys.has(k)));
  if (portador.length) result.portador = stat("bearer", "", "", portador);
  return result;
}
