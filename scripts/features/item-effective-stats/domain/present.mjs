/**
 * What to show: stats with details, tooltips and summary labels.
 */
import { signed } from "./classify.mjs";

/** "system.pericias.dipl.bonus" → "pericias.dipl" (only for the tooltip). */
export function targetLabel(key) {
  const parts = String(key ?? "").replace(/^system\./, "").split(".");
  while (parts.length > 1 && ["bonus", "value", "outros", "base"].includes(parts.at(-1))) parts.pop();
  return parts.join(".");
}

/** Critical label as the system builds it (T20:8887-8888): x2 → "18", otherwise "18/3x". */
export function critLabel(criticoM, criticoX) {
  return Number(criticoX) === 2 ? `${criticoM}` : `${criticoM}/${criticoX}x`;
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
 * @param {Record<string, import("./classify.mjs").Stat>} stats
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
 * @param {import("./classify.mjs").Stat} entry
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

/** Final values for display. */
export function finals(stats) {
  const pick = (key, fallback) => (stats[key] ? stats[key].final : fallback);
  return {
    defense: pick("armadura.value"),
    penalty: pick("armadura.penalidade"),
    toHit: pick("ataque"),
    dano: pick("dano"),
    critico: stats.criticoM ? critLabel(stats.criticoM.final, stats.criticoX?.final ?? 2) : undefined
  };
}

export function weaponChanged(stats) {
  return ["ataque", "dano", "criticoM", "criticoX"].some((k) => statChanged(stats[k]));
}

export function armorChanged(stats) {
  return ["armadura.value", "armadura.penalidade"].some((k) => statChanged(stats[k]));
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
