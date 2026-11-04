/**
 * The critical chain and roll formulas, applied as the system applies them in the roll.
 */
import { rewriteThreatChanges } from "../../../lib/threat.mjs";
import { FOLDABLE_KEYS, signed, toNumber } from "./classify.mjs";

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
 * @param {import("./classify.mjs").EffectInfo[]} effects   Usage effects reaching the roll, in the system's order.
 * @param {boolean} threatFix
 * @returns {{criticoM: number, criticoX: number, parts: {criticoM: import("./classify.mjs").Part[],
 *   criticoX: import("./classify.mjs").Part[]}, multiplied: boolean}}
 */
export function applyCritEffects(criticoM, criticoX, effects, threatFix) {
  const current = { criticoM: Number(criticoM), criticoX: Number(criticoX) };
  const parts = { criticoM: [], criticoX: [] };
  let multiplied = false;
  for (const effect of overridesFirst(effects ?? [])) {
    const changes = threatFix ? rewriteThreatChanges(effect.changes ?? [], criticoM).changes : (effect.changes ?? []);
    for (const ch of changes) {
      if (!FOLDABLE_KEYS.has(ch?.key)) continue;
      const delta = applyCritChange(current, ch);
      if (delta === null) continue;
      if (ch.type === "multiply" && ch.key === "criticoM") multiplied = true;
      parts[ch.key].push({ label: effect.name ?? "", delta, kind: "applied" });
    }
  }
  return { ...current, parts, multiplied };
}

/** Applies one critical change to `current`; returns its delta label, or null when the system ignores it. */
function applyCritChange(current, ch) {
  const before = current[ch.key];
  const value = toNumber(ch.value);
  if (ch.type === "multiply") {
    if (!value || !Number.isFinite(before)) return null;
    current[ch.key] = before * value;
    return `×${value}`;
  }
  if (ch.type === "add") {
    if (!value || !Number.isFinite(before)) return null;
    current[ch.key] = before + value;
    return signed(value);
  }
  if (ch.type === "override") {
    if (!Number.isFinite(value)) return null;
    current[ch.key] = value;
    return `=${value}`;
  }
  return null;
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
