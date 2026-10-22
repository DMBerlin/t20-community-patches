/**
 * Optional rule "Valor efetivo dos itens" (#65).
 *
 * Upgrades, materials and enchantments never show on the item itself: a Full Plate (-5) with Ajustada still shows
 * -5, although the skills use -4, and a Precisa long sword shows 19 but rolls with 18. This rule shows, on the item
 * sheet, the actor inventory and the item chat card, the final value with the breakdown of each source.
 *
 * Modes:
 * - "ends": nothing is drawn or changed (system behavior);
 * - "display" (default): base → effective with a tooltip; item data is untouched;
 * - "effective": same drawing, and the item's derived data (never the stored data) holds the final Defense,
 *   armor penalty and, when the whole chain can be folded, the critical range and multiplier. The actor and the
 *   roll skip what was folded, so nothing is applied twice.
 *
 * Source of truth: what the system and the active patches really apply. Only the item's own effects count.
 *
 * Wrapper order: this rule is installed after the patches (scripts/main.mjs), so its wrappers sit outside those of
 * armor-penalty-reduction (ActiveEffect.applyChange) and threatening-crit-range (_allApplicableOnUseEffects).
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";
import { isPatchApplied } from "../registry.mjs";
import { computePenaltyAdjustments, isArmorPenaltyReducer } from "../patches/armor-penalty-reduction.mjs";
import { rewriteThreatChanges } from "../patches/threatening-crit-range.mjs";
import { hasUsageLimit } from "./usage-effect-max.mjs";

export const ITEM_EFFECTIVE_STATS_SETTING = "itemEffectiveStats";
export const MODES = ["ends", "display", "effective"];
export const DEFAULT_MODE = "display";
/** The only usage effect keys folded into the item. */
export const FOLDABLE_KEYS = new Set(["criticoM", "criticoX"]);
export const PDA_KEY = "system.attributes.defesa.pda";
export const DEFENSE_KEY = "system.attributes.defesa.bonus";
export const ARMOR_TIPOS = new Set(["leve", "pesada", "escudo"]);
export const FLAG = "effectiveStats";

const STEP_KEYS = new Set(["passo", "passos"]);
const I18N = "T20CP.ItemEffectiveStats";

/**
 * @typedef {{key: string, type?: string, value?: unknown}} Change
 * @typedef {{id?: string, name?: string, disabled?: boolean, transfer?: boolean, onuse?: boolean, temporary?: boolean,
 *   selfUse?: boolean, automatic?: boolean, hasStatus?: boolean, identifier?: string, reducer?: boolean,
 *   changes?: Change[]}} EffectInfo
 * @typedef {{label: string, delta?: string, kind: "applied"|"optional"|"not-applied"|"note", i18n?: boolean,
 *   suffix?: string, target?: string}} Part
 * @typedef {{stat: string, base: number|string, final: number|string, parts: Part[], warning?: string}} Stat
 */

/** @param {unknown} value */
export function normalizeMode(value) {
  return MODES.includes(value) ? value : DEFAULT_MODE;
}

/* -------------------------------------------- */
/*  Pure logic                                  */
/* -------------------------------------------- */

/**
 * Classifies the item's own effects.
 * - Passive (`onuse` false): only `disabled === false` counts. `transfer: false` goes to `notApplied` (the system
 *   never gives it to the actor); a non-null `system.status` goes to `bearer` (the actor may suppress it).
 * - Usage (`onuse` true): eligible as in includeEffect (T20:8068-8076): not temporary and `selfUse`. `disabled` is
 *   ignored, as the system does. "Aplicar Sempre" goes to `automatic`, the rest to `optional`.
 * @param {EffectInfo[]} effects
 * @returns {{passive: EffectInfo[], automatic: EffectInfo[], optional: EffectInfo[], notApplied: EffectInfo[],
 *   bearer: EffectInfo[]}}
 */
export function classifyItemEffects(effects) {
  const result = { passive: [], automatic: [], optional: [], notApplied: [], bearer: [] };
  for (const effect of effects ?? []) {
    if (!effect) continue;
    if (effect.onuse) {
      if (effect.temporary || !effect.selfUse) continue;
      (effect.automatic ? result.automatic : result.optional).push(effect);
      continue;
    }
    if (effect.disabled) continue;
    if (effect.transfer === false || effect.appliesToBearer === false) result.notApplied.push(effect);
    else if (effect.hasStatus) result.bearer.push(effect);
    else result.passive.push(effect);
  }
  return result;
}

/** @param {unknown} value */
function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value.trim()) return NaN;
  return Number(value.trim());
}

/**
 * Signed amount of a numeric "add"/"subtract" change, or NaN (formulas, other types).
 * Only these are folded into the item; anything else stays on the system's own path.
 * @param {Change} change
 */
export function foldableAmount(change) {
  if (change?.type !== "add" && change?.type !== "subtract") return NaN;
  const amount = toNumber(change.value);
  if (!Number.isFinite(amount)) return NaN;
  return change.type === "subtract" ? -amount : amount;
}

/** Whether the change is applied in the core's "initial" phase, before prepareDefense (the default phase). */
function isInitial(change) {
  return (change?.phase ?? "initial") === "initial";
}

/**
 * Amount of an "add" change in the "initial" phase, or NaN. Only these are folded into an armor: defesa.bonus is an
 * ArrayField ("subtract" removes an entry), PenaltyField casts any value to a penalty, armor-penalty-reduction only
 * intercepts initial "add" changes, and later phases run after prepareDefense.
 * @param {Change} change
 */
export function armorAmount(change) {
  return change?.type === "add" && isInitial(change) ? foldableAmount(change) : NaN;
}

/** @param {number} n */
export function signed(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return String(n);
  return value < 0 ? `${value}` : `+${value}`;
}

function signedText(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return /^[+-]/.test(text) ? text : `+${text}`;
}

function isReducer(effect) {
  if (typeof effect.reducer === "boolean") return effect.reducer;
  return isArmorPenaltyReducer({ name: effect.name, system: { identifier: effect.identifier } });
}

function isPolished(effect) {
  return effect.identifier === "polished" || /^polid[ao]$|^polished$/i.test(String(effect.name ?? "").trim());
}

/** "system.pericias.dipl.bonus" → "pericias.dipl" (only for the tooltip). */
export function targetLabel(key) {
  const parts = String(key ?? "").replace(/^system\./, "").split(".");
  while (parts.length > 1 && ["bonus", "value", "outros", "base"].includes(parts.at(-1))) parts.pop();
  return parts.join(".");
}

function overridesFirst(effects) {
  const hasOverride = (e) => (e.changes ?? []).some((ch) => ch?.type === "override");
  // Same comparator as the system (T20:6395-6402); Array#sort is stable.
  return [...effects].sort((a, b) => (hasOverride(a) && !hasOverride(b) ? -1 : hasOverride(b) && !hasOverride(a) ? 1 : 0));
}

/**
 * Applies usage effects to the critical fields like applyItemChanges (T20:6109-6145) does in the roll: effects with
 * an override first, then each change on the current value. With threatening-crit-range applied, each effect's
 * threat multiplications are rewritten on the BASE criticoM first, as that patch does.
 * @param {number} criticoM
 * @param {number} criticoX
 * @param {EffectInfo[]} effects   Usage effects reaching the roll, in the system's order.
 * @param {boolean} threatFix
 * @returns {{criticoM: number, criticoX: number, parts: {criticoM: Part[], criticoX: Part[]}, multiplied: boolean}}
 */
export function applyCritEffects(criticoM, criticoX, effects, threatFix) {
  const current = { criticoM: Number(criticoM), criticoX: Number(criticoX) };
  const parts = { criticoM: [], criticoX: [] };
  let multiplied = false;
  for (const effect of overridesFirst(effects ?? [])) {
    const changes = threatFix ? rewriteThreatChanges(effect.changes ?? [], criticoM).changes : (effect.changes ?? []);
    for (const ch of changes) {
      if (!FOLDABLE_KEYS.has(ch?.key)) continue;
      const before = current[ch.key];
      const value = toNumber(ch.value);
      let delta;
      if (ch.type === "multiply") {
        if (!value || !Number.isFinite(before)) continue;
        current[ch.key] = before * value;
        if (ch.key === "criticoM") multiplied = true;
        delta = `×${value}`;
      } else if (ch.type === "add") {
        if (!value || !Number.isFinite(before)) continue;
        current[ch.key] = before + value;
        delta = signed(value);
      } else if (ch.type === "override") {
        if (!Number.isFinite(value)) continue;
        current[ch.key] = value;
        delta = `=${value}`;
      } else continue;
      parts[ch.key].push({ label: effect.name ?? "", delta, kind: "applied" });
    }
  }
  return { ...current, parts, multiplied };
}

/**
 * Joins numeric constants to the trailing constant of a formula, and appends the other parts as text.
 * Never evaluates anything: "1d8+3" + ["1", "1d6"] → "1d8+4+1d6".
 * @param {string} base
 * @param {Array<string|number>} parts
 * @returns {string}
 */
export function appendFormula(base, parts) {
  let out = String(base ?? "").trim();
  const spaced = /\s[+-]\s/.test(out);
  const join = (sign, term) => (out ? `${out}${spaced ? ` ${sign} ` : sign}${term}` : sign === "-" ? `-${term}` : term);
  let constant = 0;
  const extra = [];
  for (const part of parts ?? []) {
    const text = String(part ?? "").trim();
    if (!text) continue;
    if (/^[+-]?\s*\d+(\.\d+)?$/.test(text)) constant += Number(text.replace(/\s+/g, ""));
    else extra.push(text);
  }
  if (constant) {
    const match = out.match(/(^|[+-])\s*(\d+(?:\.\d+)?)\s*$/);
    if (match) {
      const sign = match[1] === "-" ? -1 : 1;
      const value = sign * Number(match[2]) + constant;
      const prefix = out.slice(0, match.index).trimEnd();
      if (!prefix) out = value < 0 ? `${value}` : match[1] === "+" ? `+${value}` : `${value}`;
      else if (value === 0) out = prefix;
      else {
        out = prefix;
        out = join(value < 0 ? "-" : "+", Math.abs(value));
      }
    } else {
      out = join(constant < 0 ? "-" : "+", Math.abs(constant));
    }
  }
  for (const text of extra) {
    if (/^[+-]/.test(text)) out = join(text[0], text.slice(1).trim());
    else out = join("+", text);
  }
  return out;
}

/** Critical label as the system builds it (T20:8887-8888): x2 → "18", otherwise "18/3x". */
export function critLabel(criticoM, criticoX) {
  return Number(criticoX) === 2 ? `${criticoM}` : `${criticoM}/${criticoX}x`;
}

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

/**
 * Computes the effective values of an item.
 * @param {{type: string, tipo?: string, armadura?: {value?: number, penalidade?: number}, criticoM?: number,
 *   criticoX?: number, labels?: {toHit?: string, dano?: string}}} base   `_source.system` values and official labels.
 * @param {ReturnType<typeof classifyItemEffects>} effects
 * @param {{penaltyFix?: boolean, threatFix?: boolean}} patches
 * @returns {Record<string, Stat>}  Keys: "armadura.penalidade", "armadura.value", "criticoM", "criticoX", "ataque",
 *   "dano", "passo", "portador" (only those that apply to the item).
 */
export function computeEffectiveStats(base, effects, patches = {}) {
  const result = {};
  const { passive = [], automatic = [], optional = [], notApplied = [], bearer = [] } = effects ?? {};
  const isArmor = base?.type === "equipamento" && ARMOR_TIPOS.has(base?.tipo);
  const isWeapon = base?.type === "arma";
  if (!isArmor && !isWeapon) return result;

  const ownKeys = isArmor ? new Set([PDA_KEY, DEFENSE_KEY]) : new Set();
  const portador = [];

  if (isArmor) {
    // Armor penalty
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
        } else {
          // The system's PenaltyField turns every value into a penalty (T20:12565-12575).
          if (isReducer(effect)) reducerAsPenalty = true;
          increases += magnitude;
          penaltyParts.push({ label: effect.name ?? "", delta: signed(-magnitude), kind: "applied" });
        }
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
    result["armadura.penalidade"] = stat(
      "penalty",
      basePenalty,
      finalPenalty,
      penaltyParts,
      reducerAsPenalty ? "PenaltyFixOff" : undefined
    );

    // Defense
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
    result["armadura.value"] = stat("defense", baseDefense, finalDefense, defenseParts);
  }

  if (isWeapon) {
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

    const rollStat = (name, label, matches, format) => {
      if (label === undefined || label === null || label === "") return;
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
      result[name] = stat(name === "ataque" ? "attack" : "damage", label, final, parts);
    };
    rollStat("ataque", base.labels?.toHit, (k) => k === "ataque", (f) => (/^[+-]/.test(f) ? f : `+${f}`));
    rollStat("dano", base.labels?.dano, (k) => k === "dano" || /^dano:/.test(String(k ?? "")), (f) => f);

    const stepParts = [
      ...automatic.flatMap((e) => changeParts(e, "note", (k) => STEP_KEYS.has(k), "StepNotAdded")),
      ...optional.flatMap((e) => changeParts(e, "optional", (k) => STEP_KEYS.has(k), "StepNotAdded"))
    ];
    for (const part of stepParts) if (/^custom\s+/.test(part.delta)) part.delta = signedText(part.delta.replace(/^custom\s+/, ""));
    if (stepParts.length) result.passo = stat("step", "", "", stepParts);
  }

  // Changes that are not statistics of the item itself.
  for (const effect of passive) portador.push(...changeParts(effect, "note", (k) => !ownKeys.has(k)));
  for (const effect of bearer) portador.push(...changeParts(effect, "note", () => true, "BearerDepends"));
  for (const effect of notApplied) portador.push(...changeParts(effect, "not-applied", (k) => !ownKeys.has(k)));
  if (portador.length) result.portador = stat("bearer", "", "", portador);
  return result;
}

/**
 * Fold plan of the critical chain in "effective" mode. All or nothing: the chain (criticoM and criticoX) is folded
 * only if every effect touching it is the item's own, in "Aplicar Sempre", has only FOLDABLE_KEYS and no override, and
 * is not bound to the usage dialog (PM cost, "aumenta" or a usage-effect-max limit), since folding removes it from the
 * list that charges and validates it.
 * @param {Array<{id: string, own: boolean, automatic: boolean, usageBound?: boolean, changes: Change[]}>} rollEffects
 * @returns {{fold: boolean, effectIds: Set<string>}}
 */
export function planCritFold(rollEffects) {
  const ids = new Set();
  for (const effect of rollEffects ?? []) {
    const changes = effect?.changes ?? [];
    if (!changes.some((ch) => FOLDABLE_KEYS.has(ch?.key))) continue;
    const ok =
      effect.own &&
      effect.automatic &&
      !effect.usageBound &&
      changes.every((ch) => FOLDABLE_KEYS.has(ch?.key) && ch?.type !== "override");
    if (!ok) return { fold: false, effectIds: new Set() };
    ids.add(effect.id);
  }
  return ids.size ? { fold: true, effectIds: ids } : { fold: false, effectIds: ids };
}

/**
 * Armor penalty, all or nothing: false when an own, transferred, enabled passive effect touching defesa.pda has a
 * status (the actor may suppress it) or a change other than a numeric initial "add" (it stays on the actor and needs the reductions'
 * excess, armor-penalty-reduction), or when actor effects touching defesa.pda point to the item by origin
 * (armor-penalty-reduction counts them for the item), or when any other enabled effect of the bearer changes
 * defesa.pda other than by "add" (a subtract, multiply or override depends on the folded amounts).
 * @param {EffectInfo[]} effects   Same input as classifyItemEffects.
 * @param {number} linkedPdaCount
 * @param {Array<{disabled?: boolean, changes?: Change[]}>} [external]   Bearer's other passive effects.
 */
export function canFoldPenalty(effects, linkedPdaCount, external = []) {
  if (linkedPdaCount) return false;
  const blocks = (ch) => ch?.key === PDA_KEY && ch.type !== "add";
  if ((external ?? []).some((e) => e && !e.disabled && (e.changes ?? []).some(blocks))) return false;
  return !(effects ?? []).some(
    (e) =>
      e &&
      !e.onuse &&
      e.transfer !== false &&
      !e.disabled &&
      (e.changes ?? []).some((ch) => ch?.key === PDA_KEY && (e.hasStatus || !Number.isFinite(armorAmount(ch))))
  );
}

/**
 * Armor Defense, all or nothing: false when an own, transferred, enabled passive effect changes defesa.bonus other
 * than by an "add" in the "initial" phase (a "subtract" could remove an entry that folding took out of the array), or
 * when any other enabled effect of the bearer (actor or other item) does so.
 * @param {EffectInfo[]} effects   Same input as classifyItemEffects.
 * @param {Array<{disabled?: boolean, changes?: Change[]}>} [external]   Bearer's other passive effects.
 */
export function canFoldDefense(effects, external = []) {
  const blocks = (ch) => ch?.key === DEFENSE_KEY && (ch.type !== "add" || !isInitial(ch));
  if ((external ?? []).some((e) => e && !e.disabled && (e.changes ?? []).some(blocks))) return false;
  return !(effects ?? []).some(
    (e) =>
      e &&
      !e.onuse &&
      e.transfer !== false &&
      !e.disabled &&
      (e.changes ?? []).some(blocks)
  );
}

/** Whether one stat has anything to show. */
export function statHasDetails(entry) {
  if (!entry) return false;
  return String(entry.base) !== String(entry.final) || (entry.parts?.length ?? 0) > 0;
}

/** Whether a stat's number changed. */
export function statChanged(entry) {
  return !!entry && String(entry.base) !== String(entry.final);
}

/**
 * Whether there is anything to show: some field with base ≠ final, or some part (optional, not applied, note or
 * bearer). Items without numeric change but with notes only get the info marker.
 * @param {Record<string, Stat>} stats
 */
export function hasDetails(stats) {
  return Object.values(stats ?? {}).some(statHasDetails);
}

/** Keeps only the entries worth showing (chat snapshot). The critical range and multiplier go together. */
export function detailedStats(stats) {
  const crit = statHasDetails(stats?.criticoM) || statHasDetails(stats?.criticoX);
  return Object.fromEntries(
    Object.entries(stats ?? {}).filter(([key, entry]) => statHasDetails(entry) || (crit && (key === "criticoM" || key === "criticoX")))
  );
}

const STAT_TITLES = {
  penalty: "Stat.penalty",
  defense: "Stat.defense",
  threat: "Stat.threat",
  multiplier: "Stat.multiplier",
  attack: "Stat.attack",
  damage: "Stat.damage",
  step: "Stat.step",
  bearer: "Bearer"
};

/**
 * Escaped HTML of one stat's tooltip.
 * @param {Stat} entry
 * @param {(key: string, data?: object) => string} i18n   Localizes keys relative to T20CP.ItemEffectiveStats.
 * @param {(text: string) => string} escape                foundry.utils.escapeHTML
 * @returns {string}
 */
export function tooltipHtml(entry, i18n, escape) {
  if (!entry) return "";
  const e = (v) => escape(String(v ?? ""));
  const lines = [`<strong>${e(i18n(STAT_TITLES[entry.stat] ?? entry.stat))}</strong>`];
  const numeric = entry.base !== "" && entry.base !== undefined;
  if (numeric) lines.push(`${e(i18n("Base"))} ${e(entry.base)}`);
  for (const part of entry.parts ?? []) {
    const label = part.i18n ? i18n(part.label) : part.label;
    const text = [label, part.delta].filter((v) => v !== undefined && v !== "").join(" ");
    const suffix = part.suffix ? ` (${e(i18n(part.suffix))})` : "";
    if (part.kind === "optional") lines.push(`${e(text)}${suffix}: ${e(i18n("Optional"))}`);
    else if (part.kind === "not-applied") lines.push(`${e(text)}${suffix}: ${e(i18n("NotApplied"))}`);
    else if (part.kind === "note" && part.i18n) lines.push(`<em>${e(text)}</em>`);
    else lines.push(`${e(text)}${suffix}`);
  }
  if (numeric) lines.push(`<strong>${e(i18n("Final"))} ${e(entry.final)}</strong>`);
  if (entry.warning) lines.push(`<em>${e(i18n(entry.warning, { value: entry.final }))}</em>`);
  return lines.join("<br>");
}

/** Tooltip of several stats, separated by a rule. */
export function combinedTooltip(entries, i18n, escape) {
  return entries
    .filter(statHasDetails)
    .map((entry) => tooltipHtml(entry, i18n, escape))
    .join("<hr>");
}

/** Text of a weapon's summary, like the system's "t20-itemLabels" helper (T20:4588-4592). */
export function weaponSummary(toHit, dano, critico) {
  return dano ? `${toHit} (${dano}, ${critico})` : `${toHit}`;
}

/**
 * Whether the actor must skip a change already folded into the item (mode "effective").
 * `consumed`: the item is the armor or shield that prepareDefense reads (consumedArmorIds); the folded values of
 * any other one never reach the actor, so its changes must keep applying.
 * @param {{mode: string, key?: string, change?: Change, targetIsActor: boolean, ownedByTarget: boolean,
 *   consumed?: boolean, itemType?: string, tipo?: string, hasStatus: boolean, onuse?: boolean, folded?: {value?: boolean, penalty?: boolean}}} p
 */
export function shouldSkipFoldedChange({ mode, change, targetIsActor, ownedByTarget, consumed, itemType, tipo, hasStatus, onuse, folded }) {
  if (mode !== "effective" || !targetIsActor || !ownedByTarget || !consumed || !folded) return false;
  if (change?.key !== PDA_KEY && change?.key !== DEFENSE_KEY) return false;
  if (itemType !== "equipamento" || !ARMOR_TIPOS.has(tipo) || hasStatus || onuse) return false;
  if (!Number.isFinite(armorAmount(change))) return false;
  return change.key === PDA_KEY ? folded.penalty === true : folded.value === true;
}

/**
 * Ids of the armor and shield read by AttributesFields.prepareDefense (T20:19876-19897): the first equipped
 * "leve"/"pesada" and the first equipped "escudo", in itemTypes order.
 * @param {Array<{id: string, system: object}>} equipment   actor.itemTypes.equipamento
 * @param {boolean} equipmentSlots   Setting tormenta20.equipmentSlots
 */
export function consumedArmorIds(equipment, equipmentSlots) {
  const equipped = (equipment ?? []).filter((i) => (equipmentSlots ? i?.system?.equipado2?.slot : i?.system?.equipado));
  const armor = equipped.find((i) => ["leve", "pesada"].includes(i.system.tipo));
  const shield = equipped.find((i) => i.system.tipo === "escudo");
  return new Set([armor?.id, shield?.id].filter(Boolean));
}

/** Item and actor ids of an item chat card (templates/chat/chat-card.hbs:1), without parsing HTML. */
export function parseItemCard(content) {
  const tag = String(content ?? "").match(/<div\b[^>]*\bclass="[^"]*\bitem-card\b[^"]*"[^>]*>/);
  if (!tag) return null;
  const itemId = tag[0].match(/\bdata-item-id="([^"]*)"/)?.[1];
  if (!itemId) return null;
  return { itemId, actorId: tag[0].match(/\bdata-actor-id="([^"]*)"/)?.[1] };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

/** Effective-mode state of each prepared item: what was folded. @type {WeakMap<object, {value?: boolean, penalty?: boolean, crit?: boolean}>} */
const folded = new WeakMap();
/** Roll clones that keep the base critical (their chain stays on the roll). */
const keepsBase = new WeakSet();

/** What "effective" mode folded into the item in its last preparation. */
export function foldedState(item) {
  return folded.get(item);
}

export function currentMode() {
  try {
    return normalizeMode(game.settings.get(MODULE_ID, ITEM_EFFECTIVE_STATS_SETTING));
  } catch {
    return DEFAULT_MODE;
  }
}

export function patchState() {
  const status = globalThis.game?.modules?.get?.(MODULE_ID)?.api?.status;
  return {
    penaltyFix: isPatchApplied(status, "armor-penalty-reduction"),
    threatFix: isPatchApplied(status, "threatening-crit-range")
  };
}

function setHas(collection, value) {
  if (!collection) return false;
  if (typeof collection.has === "function") return collection.has(value);
  return Array.isArray(collection) && collection.includes(value);
}

/**
 * @param {object} effect  ActiveEffect owned by `item`
 * @param {object} item
 * @returns {EffectInfo}
 */
export function describeEffect(effect, item) {
  const system = effect?.system ?? {};
  const use = system.abilityUse ?? {};
  let reducer = false;
  try {
    reducer = isArmorPenaltyReducer(effect);
  } catch {
    reducer = false;
  }
  return {
    id: effect?.id,
    name: effect?.name ?? "",
    disabled: !!effect?.disabled,
    transfer: effect?.transfer !== false,
    onuse: !!system.onuse,
    temporary: !!effect?.isTemporary,
    selfUse: setHas(use.types, "self") || setHas(use.names, item?.name),
    automatic: !!use.automatic,
    usageBound: isUsageBound(effect),
    appliesToBearer: auraAppliesToBearer(system),
    hasStatus: system.status !== null && system.status !== undefined,
    identifier: system.identifier,
    reducer,
    changes: (system.changes ?? []).map((ch) => ({ key: ch?.key, type: ch?.type, value: ch?.value, phase: ch?.phase }))
  };
}

/**
 * ActiveEffectT20#shouldApplyChange (T20:18120-18133): an aura that applies effects reaches its own bearer only when
 * its targets include "self".
 */
export function auraAppliesToBearer(system) {
  const aura = system?.aura;
  if (!aura?.isAura) return true;
  const applies = Object.values(aura.behaviors ?? {}).some((b) => b?.type === "applyActiveEffect");
  return !applies || setHas(system.targets, "self");
}

/** The usage dialog charges, multiplies or limits this usage effect. */
function isUsageBound(effect) {
  const use = effect?.system?.abilityUse ?? {};
  const cost = use.custo;
  return (cost !== null && cost !== undefined && Number(cost) !== 0) || !!use.aumenta || hasUsageLimit(effect);
}

function describeItemEffects(item) {
  return [...(item?.effects ?? [])].map((effect) => describeEffect(effect, item));
}

function baseOf(item) {
  const src = item?._source?.system ?? {};
  return {
    type: item?.type,
    tipo: src.tipo,
    armadura: src.armadura,
    criticoM: src.criticoM,
    criticoX: src.criticoX,
    labels: { toHit: item?.labels?.toHit, dano: item?.labels?.dano }
  };
}

/** Own usage effects the system would accept in this item's roll (includeEffect, T20:8068-8076). */
function prepRollEffects(descriptors) {
  return descriptors
    .filter((d) => d.onuse && !d.temporary && d.selfUse)
    .map((d) => ({ id: d.id, own: true, automatic: d.automatic, usageBound: d.usageBound, changes: d.changes }));
}

/** Actor effects touching defesa.pda whose origin points to the item (armor-penalty-reduction resolveItemId). */
export function linkedPdaCount(item, parseUuid = globalThis.foundry?.utils?.parseUuid) {
  const actor = item?.parent;
  if (!actor || actor.documentName !== "Actor" || typeof parseUuid !== "function") return 0;
  let count = 0;
  for (const effect of actor.effects ?? []) {
    if (!effect?.origin || !(effect.system?.changes ?? []).some((ch) => ch?.key === PDA_KEY)) continue;
    try {
      if (parseUuid(effect.origin)?.id === item.id) count++;
    } catch {
      /* unparsable origin */
    }
  }
  return count;
}

/** Passive effects of the bearer other than the item's own: the actor's and the other items' transferred ones. */
function bearerEffects(item) {
  const actor = item?.parent;
  if (!actor || actor.documentName !== "Actor") return [];
  const list = [];
  for (const effect of actor.effects ?? []) list.push({ disabled: !!effect?.disabled, changes: effect?.system?.changes ?? [] });
  for (const other of actor.items?.values?.() ?? actor.items ?? []) {
    if (other === item || other?.id === item.id) continue;
    for (const effect of other?.effects ?? []) {
      if (effect?.transfer === false || effect?.system?.onuse) continue;
      list.push({ disabled: !!effect?.disabled, changes: effect?.system?.changes ?? [] });
    }
  }
  return list;
}

/** Whether prepareDefense reads this armor (always true outside an actor: nothing else reads it there). */
function isConsumedArmor(item) {
  const actor = item?.parent;
  if (!actor || actor.documentName !== "Actor") return true;
  let slots = false;
  try {
    slots = !!game.settings.get("tormenta20", "equipmentSlots");
  } catch {
    slots = false;
  }
  return consumedArmorIds(actor.itemTypes?.equipamento, slots).has(item.id);
}

/**
 * Effective stats of an item, with the "applied on the roll" note when the critical chain was not folded in
 * "effective" mode.
 */
export function statsFor(item, mode = currentMode(), patches = patchState()) {
  const stats = computeEffectiveStats(baseOf(item), classifyItemEffects(describeItemEffects(item)), patches);
  if (mode === "effective" && item?.type === "arma" && folded.get(item)?.crit !== true) {
    for (const key of ["criticoM", "criticoX"]) {
      if (statChanged(stats[key])) stats[key].parts.push({ label: "AppliedOnRoll", kind: "note", i18n: true });
    }
  }
  return stats;
}

/**
 * Mode "effective": writes the final values into the item's derived data. Always computed from `_source`, so it is
 * idempotent. Called after the type data model's prepareDerivedData.
 * @param {object} system   The item's TypeDataModel instance
 */
export function foldItemSystem(system, mode = currentMode(), patches = patchState()) {
  const item = system?.parent;
  if (!item || mode !== "effective") return;
  if (keepsBase.has(item)) return;
  const src = item._source?.system;
  if (!src) return;
  const descriptors = describeItemEffects(item);
  const classified = classifyItemEffects(descriptors);
  const base = baseOf(item);

  if (item.type === "equipamento" && ARMOR_TIPOS.has(src.tipo) && system.armadura) {
    const stats = computeEffectiveStats(base, classified, patches);
    // armor-penalty-reduction reads the penalty of every owned armor; only the one prepareDefense uses is folded.
    const external = bearerEffects(item);
    const foldPenalty = isConsumedArmor(item) && canFoldPenalty(descriptors, linkedPdaCount(item), external);
    const foldValue = canFoldDefense(descriptors, external);
    system.armadura.value = foldValue ? stats["armadura.value"].final : Number(src.armadura?.value) || 0;
    system.armadura.penalidade = foldPenalty ? stats["armadura.penalidade"].final : Number(src.armadura?.penalidade) || 0;
    folded.set(item, { value: foldValue, penalty: foldPenalty });
    return;
  }

  if (item.type === "arma") {
    const plan = item.isEmbedded ? planCritFold(prepRollEffects(descriptors)) : { fold: false };
    if (plan.fold) {
      const crit = applyCritEffects(src.criticoM, src.criticoX, classified.automatic, !!patches.threatFix);
      system.criticoM = crit.criticoM;
      system.criticoX = crit.criticoX;
    } else {
      system.criticoM = src.criticoM;
      system.criticoX = src.criticoX;
    }
    folded.set(item, { crit: plan.fold });
  }
}

/**
 * Wrapper of ItemT20#_allApplicableOnUseEffects for mode "effective". The inner wrappers (threatening-crit-range)
 * always see the base critical. On the real item nothing changes; on the roll clone, the folded effects are removed
 * only when the full list confirms the preparation's plan, otherwise the clone keeps the base and the whole list.
 * @param {Function} original
 * @param {{mode?: () => string, patches?: () => object}} [deps]
 */
export function createOnUseWrapper(original, { mode = currentMode, patches = patchState } = {}) {
  return markWrapper(function (...args) {
    let active = false;
    try {
      active = this?.type === "arma" && mode() === "effective" && !!this._source?.system;
    } catch {
      active = false;
    }
    if (!active) return original.apply(this, args);

    const system = this.system;
    const src = this._source.system;
    const saved = { criticoM: system.criticoM, criticoX: system.criticoX };
    let isRollClone = false;
    try {
      isRollClone = !!this.actor && this.actor.items?.get?.(this.id) !== this;
    } catch {
      isRollClone = false;
    }

    if (!isRollClone) {
      system.criticoM = src.criticoM;
      system.criticoX = src.criticoX;
      try {
        return original.apply(this, args);
      } finally {
        system.criticoM = saved.criticoM;
        system.criticoX = saved.criticoX;
      }
    }

    system.criticoM = src.criticoM;
    system.criticoX = src.criticoX;
    keepsBase.add(this);
    const effects = original.apply(this, args);
    try {
      if (!Array.isArray(effects)) return effects;
      const prepPlan = planCritFold(prepRollEffects(describeItemEffects(this)));
      const isOwn = (ef) => ef?.parent?.documentName === "Item" && ef.parent.id === this.id;
      const fullPlan = planCritFold(
        effects.map((ef) => ({
          id: ef?.id,
          own: isOwn(ef),
          automatic: !!ef?.system?.abilityUse?.automatic,
          usageBound: isUsageBound(ef),
          changes: ef?.system?.changes ?? []
        }))
      );
      const same =
        prepPlan.fold &&
        fullPlan.fold &&
        prepPlan.effectIds.size === fullPlan.effectIds.size &&
        [...prepPlan.effectIds].every((id) => fullPlan.effectIds.has(id));
      if (!same) return effects;
      const recomputed = applyCritEffects(
        src.criticoM,
        src.criticoX,
        classifyItemEffects(describeItemEffects(this)).automatic,
        !!patches().threatFix
      );
      system.criticoM = recomputed.criticoM;
      system.criticoX = recomputed.criticoX;
      keepsBase.delete(this);
      return effects.filter((ef) => !(isOwn(ef) && fullPlan.effectIds.has(ef.id)));
    } catch (err) {
      console.error(`${MODULE_ID} | item-effective-stats: failed to plan the roll's critical`, err);
      system.criticoM = src.criticoM;
      system.criticoX = src.criticoX;
      keepsBase.add(this);
      return effects;
    }
  }, original);
}

/* -------------------------------------------- */
/*  Drawing                                     */
/* -------------------------------------------- */

const i18n = (key, data) => {
  const full = `${I18N}.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
};
const escape = (text) => foundry.utils.escapeHTML(String(text ?? ""));

function rootOf(html) {
  if (globalThis.HTMLElement && html instanceof HTMLElement) return html;
  return html?.[0] ?? null;
}

function marker(tooltip, info = false) {
  const icon = document.createElement("i");
  icon.className = info ? "fa-solid fa-circle-info t20cp-effective-info" : "fa-solid fa-wand-magic-sparkles t20cp-effective";
  icon.dataset.tooltipHtml = tooltip;
  return icon;
}

function badge(text, tooltip) {
  const span = document.createElement("span");
  span.className = "t20cp-effective-badge t20cp-effective";
  span.dataset.tooltipHtml = tooltip;
  span.append(marker(tooltip), ` → ${text}`);
  return span;
}

/** Final values for display. */
function finals(stats) {
  const pick = (key, fallback) => (stats[key] ? stats[key].final : fallback);
  return {
    defense: pick("armadura.value"),
    penalty: pick("armadura.penalidade"),
    toHit: pick("ataque"),
    dano: pick("dano"),
    critico: stats.criticoM ? critLabel(stats.criticoM.final, stats.criticoX?.final ?? 2) : undefined
  };
}

function weaponChanged(stats) {
  return ["ataque", "dano", "criticoM", "criticoX"].some((k) => statChanged(stats[k]));
}

function armorChanged(stats) {
  return ["armadura.value", "armadura.penalidade"].some((k) => statChanged(stats[k]));
}

function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function setText(el, text, tooltip) {
  el.textContent = `${text} `;
  el.append(marker(tooltip));
}

const INPUTS = {
  "system.armadura.value": ["armadura.value"],
  "system.armadura.penalidade": ["armadura.penalidade"],
  "system.criticoM": ["criticoM", "criticoX"],
  "system.criticoX": ["criticoX", "criticoM"]
};

/** Item sheet (AppV1, jQuery html). */
export function renderItemSheet(app, html) {
  const mode = currentMode();
  if (mode === "ends") return;
  const item = app?.item ?? app?.document;
  const root = rootOf(html);
  if (!item || !root?.querySelectorAll || !["arma", "equipamento"].includes(item.type)) return;
  const src = item._source?.system ?? {};

  // The template reads item.system, which holds the effective value: the editable field keeps the stored base.
  if (mode === "effective") {
    for (const [name, value] of [
      ["system.armadura.value", src.armadura?.value],
      ["system.armadura.penalidade", src.armadura?.penalidade],
      ["system.criticoM", src.criticoM],
      ["system.criticoX", src.criticoX]
    ]) {
      const input = root.querySelector(`input[name="${name}"]`);
      if (input && value !== undefined) {
        input.value = String(value);
        input.setAttribute("value", String(value));
      }
    }
  }

  const stats = statsFor(item, mode);
  if (!hasDetails(stats)) return;
  const all = combinedTooltip(Object.values(stats), i18n, escape);
  const f = finals(stats);

  for (const [name, keys] of Object.entries(INPUTS)) {
    const [key] = keys;
    if (!statChanged(stats[key])) continue;
    const input = root.querySelector(`input[name="${name}"]`);
    if (!input || input.parentElement?.querySelector(`.t20cp-effective-badge[data-field="${name}"]`)) continue;
    const el = badge(stats[key].final, combinedTooltip(keys.map((k) => stats[k]), i18n, escape));
    el.dataset.field = name;
    input.after(el);
  }

  let drawn = false;
  const header = root.querySelector(".sheet-header .summary");
  if (header && item.type === "equipamento" && armorChanged(stats)) {
    for (const [icon, key] of [
      ["fa-shield", "armadura.value"],
      ["fa-person-hiking", "armadura.penalidade"]
    ]) {
      const label = header.querySelector(`label:has(> i.${icon})`) ?? header.querySelector(`i.${icon}`)?.parentElement;
      if (!label || !statChanged(stats[key])) continue;
      const i = label.querySelector(`i.${icon}`);
      label.textContent = "";
      if (i) label.append(i);
      label.append(` ${stats[key].final} `, marker(combinedTooltip([stats[key]], i18n, escape)));
      drawn = true;
    }
  }
  if (header && item.type === "arma" && weaponChanged(stats)) {
    const labels = item.labels ?? {};
    const expected = normalizeText(`${labels.toHit} (${labels.dano ? `${labels.dano}, ` : ""}${labels.critico})`);
    const li = [...header.querySelectorAll("li")].find((el) => normalizeText(el.textContent) === expected);
    if (li) {
      setText(li, `${f.toHit ?? labels.toHit} (${f.dano ? `${f.dano}, ` : ""}${f.critico ?? labels.critico})`, all);
      drawn = true;
    }
  }

  // Description properties (templates/item/parts/item-description.hbs:52-53).
  if (item.type === "equipamento") {
    for (const li of root.querySelectorAll(".properties-list li")) {
      const match = li.textContent.match(/^\s*(Defesa|Penalidade):/);
      if (!match) continue;
      const key = match[1] === "Defesa" ? "armadura.value" : "armadura.penalidade";
      if (!statChanged(stats[key])) continue;
      setText(li, `${match[1]}: ${stats[key].final}`, combinedTooltip([stats[key]], i18n, escape));
    }
  }

  if (!drawn && header && !header.querySelector(".t20cp-effective-info, .t20cp-effective")) {
    const li = document.createElement("li");
    li.className = "t20cp-effective-summary";
    li.append(marker(all, !(armorChanged(stats) || weaponChanged(stats))));
    header.append(li);
  }
}

/** Actor sheet inventory rows (templates/actor/parts/lists/list-equipment.hbs, list-weapon.hbs). */
export function renderActorSheet(app, html) {
  const mode = currentMode();
  if (mode === "ends") return;
  const actor = app?.actor ?? app?.document;
  const root = rootOf(html);
  if (!actor?.items || !root?.querySelectorAll) return;
  for (const li of root.querySelectorAll("li[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    if (!item || !["arma", "equipamento"].includes(item.type)) continue;
    const cell = li.querySelector(item.type === "arma" ? ".item-rolls" : ".item-def");
    if (!cell || cell.querySelector(".t20cp-effective, .t20cp-effective-info")) continue;
    const stats = statsFor(item, mode);
    if (!hasDetails(stats)) continue;
    const tooltip = combinedTooltip(Object.values(stats), i18n, escape);
    const f = finals(stats);
    if (item.type === "equipamento" && armorChanged(stats)) {
      setText(cell, `${signed(f.defense)} / ${f.penalty}`, tooltip);
    } else if (item.type === "arma" && weaponChanged(stats)) {
      const labels = item.labels ?? {};
      setText(cell, weaponSummary(f.toHit ?? labels.toHit, f.dano ?? labels.dano, f.critico ?? labels.critico), tooltip);
    } else {
      cell.append(" ", marker(tooltip, true));
    }
  }
}

/** preCreateChatMessage: snapshot of the item's effective stats in the card's flags. */
export function onPreCreateChatMessage(message, data) {
  if (currentMode() === "ends") return;
  const content = data?.content ?? message?.content;
  if (typeof content !== "string" || !content.includes("item-card")) return;
  const card = parseItemCard(content);
  if (!card) return;
  const ChatMessageClass = CONFIG.ChatMessage?.documentClass ?? globalThis.ChatMessage;
  const actor = ChatMessageClass?.getSpeakerActor?.(message.speaker ?? data?.speaker);
  const item = actor?.items?.get?.(card.itemId);
  if (!item || !["arma", "equipamento"].includes(item.type)) return;
  const snapshot = detailedStats(statsFor(item));
  if (!Object.keys(snapshot).length) return;
  message.updateSource({ [`flags.${MODULE_ID}.${FLAG}`]: snapshot });
}

/** Summary line of a snapshot: "Defesa +11 · Penalidade -4" or "Ataque +8 · Dano 1d8+4 · Crítico 18/3x". */
export function chatSummary(stats, i18nFn) {
  const out = [];
  const f = finals(stats);
  if (stats["armadura.value"]) out.push(`${i18nFn("Stat.defense")} ${signed(f.defense)}`);
  if (stats["armadura.penalidade"]) out.push(`${i18nFn("Stat.penalty")} ${f.penalty}`);
  if (stats.ataque) out.push(`${i18nFn("Stat.attack")} ${f.toHit}`);
  if (stats.dano) out.push(`${i18nFn("Stat.damage")} ${f.dano}`);
  if (stats.criticoM) out.push(`${i18nFn("Stat.critical")} ${f.critico}`);
  return out.join(" · ");
}

/** renderChatMessageHTML (HTMLElement): draws the snapshot below the card header. */
export function renderChatMessage(message, html) {
  if (currentMode() === "ends") return;
  const stats = message?.flags?.[MODULE_ID]?.[FLAG];
  const root = rootOf(html);
  if (!stats || typeof stats !== "object" || !root?.querySelector) return;
  const card = root.querySelector(".item-card");
  if (!card || card.querySelector(".t20cp-effective-line")) return;
  const tooltip = combinedTooltip(Object.values(stats), i18n, escape);
  if (!tooltip) return;
  const line = document.createElement("div");
  line.className = "t20cp-effective-line";
  const changed = Object.values(stats).some(statChanged);
  if (changed) {
    line.append(`${chatSummary(stats, i18n)} `, marker(tooltip));
  } else {
    line.append(marker(tooltip, true));
  }
  const header = card.querySelector(".card-header");
  if (header) header.after(line);
  else card.prepend(line);
}

/* -------------------------------------------- */
/*  Setting and installation                    */
/* -------------------------------------------- */

/** Registers the world setting. Runs on "init" for every system, so the setting always exists. */
export function registerItemEffectiveStatsSetting() {
  game.settings.register(MODULE_ID, ITEM_EFFECTIVE_STATS_SETTING, {
    name: `${I18N}.Setting.Name`,
    hint: `${I18N}.Setting.Hint`,
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(MODES.map((m) => [m, `${I18N}.Setting.${m}`])),
    default: DEFAULT_MODE,
    // Derived data only changes on a new preparation: a reload prepares every document again.
    requiresReload: true
  });
}

function guarded(label, fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      console.error(`${MODULE_ID} | item-effective-stats: ${label}`, err);
    }
  };
}

/**
 * Installs the rule. Must run after the patches and the other rules, so these wrappers are the outermost ones.
 */
export function installItemEffectiveStatsRule() {
  const itemProto = CONFIG.Item?.documentClass?.prototype;
  const EffectClass = CONFIG.ActiveEffect?.documentClass;
  const onUse = itemProto?._allApplicableOnUseEffects;
  const finalAttributes = itemProto?.prepareFinalAttributes;
  const applyChange = EffectClass?.applyChange;
  if (typeof onUse !== "function") throw new Error("Tormenta20 usage effect API not found");
  if (typeof finalAttributes !== "function") throw new Error("ItemT20#prepareFinalAttributes not found");
  if (typeof applyChange !== "function") throw new Error("ActiveEffect.applyChange not found");

  // Effective attack and damage labels; the official labels are never overwritten.
  itemProto.prepareFinalAttributes = markWrapper(function (...args) {
    const result = finalAttributes.apply(this, args);
    try {
      if (this?.type === "arma" && this.labels && currentMode() !== "ends") {
        const stats = computeEffectiveStats(baseOf(this), classifyItemEffects(describeItemEffects(this)), patchState());
        this.labels.t20cpEffective = { toHit: stats.ataque?.final, dano: stats.dano?.final };
      }
    } catch (err) {
      console.error(`${MODULE_ID} | item-effective-stats: failed to prepare the labels of ${this?.name}`, err);
    }
    return result;
  }, finalAttributes);

  itemProto._allApplicableOnUseEffects = createOnUseWrapper(onUse);

  EffectClass.applyChange = markWrapper(function (targetDoc, change, options) {
    try {
      const effect = change?.effect;
      const item = effect?.parent;
      const skip =
        item?.documentName === "Item" &&
        shouldSkipFoldedChange({
          mode: currentMode(),
          change,
          targetIsActor: targetDoc instanceof foundry.documents.Actor,
          ownedByTarget: item.parent === targetDoc,
          consumed:
            item.type === "equipamento" &&
            item.parent === targetDoc &&
            consumedArmorIds(
              targetDoc.itemTypes?.equipamento,
            !!game.settings.get("tormenta20", "equipmentSlots")
          ).has(item.id),
          itemType: item.type,
          tipo: item._source?.system?.tipo,
          hasStatus: effect.system?.status !== null && effect.system?.status !== undefined,
          onuse: !!effect.system?.onuse,
          folded: foldedState(item)
        });
      if (skip) return undefined;
    } catch (err) {
      console.error(`${MODULE_ID} | item-effective-stats: failed to check a change`, err);
    }
    return applyChange.call(this, targetDoc, change, options);
  }, applyChange);

  // EquipmentData and WeaponData inherit prepareDerivedData; each gets its own wrapper.
  for (const type of ["equipamento", "arma"]) {
    const proto = CONFIG.Item?.dataModels?.[type]?.prototype;
    const prepare = proto?.prepareDerivedData;
    if (typeof prepare !== "function") continue;
    proto.prepareDerivedData = markWrapper(function (...args) {
      const result = prepare.apply(this, args);
      try {
        foldItemSystem(this);
      } catch (err) {
        console.error(`${MODULE_ID} | item-effective-stats: failed to fold ${this?.parent?.name}`, err);
      }
      return result;
    }, prepare);
  }

  Hooks.on("renderItemSheetT20", guarded("failed to draw the item sheet", renderItemSheet));
  Hooks.on("renderActorSheetT20", guarded("failed to draw the inventory", renderActorSheet));
  Hooks.on("preCreateChatMessage", guarded("failed to snapshot the chat card", onPreCreateChatMessage));
  Hooks.on("renderChatMessageHTML", guarded("failed to draw the chat card", renderChatMessage));
}
