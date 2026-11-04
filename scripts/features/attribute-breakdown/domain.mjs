const KEY = /^system\.atributos\.([^.*]+)\.(value|bonus)$/;
export const I18N = "T20CP.AttributeBreakdown";
export const TEMPLATE = "systems/tormenta20/templates/actor/parts/abilities.hbs";

/**
 * The attribute and field a concrete change key targets (wildcards are expanded by the system before applying).
 * @param {unknown} key
 * @returns {{attribute: string, target: "value"|"bonus"}|null}
 */
export function attributeTarget(key) {
  const match = KEY.exec(typeof key === "string" ? key : "");
  return match ? { attribute: match[1], target: match[2] } : null;
}

/**
 * Records an applied change in an attribute log; changes that did not move the value are left out.
 * @param {{entries: Record<string, object[]>}} log
 * @param {object} entry
 * @param {string} entry.key       Concrete change key.
 * @param {string} entry.phase     Application phase.
 * @param {string} [entry.label]   Effect name.
 * @param {string} [entry.type]    Change type.
 * @param {unknown} entry.before
 * @param {unknown} entry.after
 * @returns {boolean} Whether it was recorded.
 */
export function recordChange(log, { key, phase, label, type, before, after }) {
  const target = attributeTarget(key);
  const delta = Number(after) - Number(before);
  if (!target || typeof before !== "number" || typeof after !== "number" || !Number.isFinite(delta) || !delta) return false;
  (log.entries[target.attribute] ??= []).push({ phase, target: target.target, label: String(label ?? ""), type, delta });
  return true;
}

/**
 * Lines of the breakdown of one attribute. Value and bonus changes of the "initial" phase add up independently
 * (prepareAtributos sums the bonus into the value afterwards); later phases only count on the value. "Outros"
 * closes any gap with the prepared value, so the lines always add up to the sheet.
 * @param {object} input
 * @param {{base?: number, racial?: number, value?: number}} input.prepared  Prepared system.atributos.<key>.
 * @param {{base?: number, racial?: number, bonus?: number}} [input.start]   Snapshot before the "initial" phase.
 * @param {number} [input.sourceBonus]   Persisted manual bonus, used without a snapshot.
 * @param {{phase: string, target: "value"|"bonus", label: string, type?: string, delta: number}[]} [input.entries]
 * @returns {{lines: {key?: string, label?: string, value: number, type?: string}[], total: number}}
 */
export function attributeBreakdown({ prepared, start, sourceBonus = 0, entries = [] }) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const total = num(prepared?.value);
  const base = num(start ? start.base : prepared?.base);
  const racial = num(start ? start.racial : prepared?.racial);
  const manual = num(start ? start.bonus : sourceBonus);
  const lines = [{ key: "Base", value: base }];
  if (racial) lines.push({ key: "Racial", value: racial });
  const effects = (filter) => {
    for (const e of entries) if (filter(e)) lines.push({ label: e.label, value: e.delta, type: e.type });
  };
  effects((e) => e.phase === "initial" && e.target === "value");
  if (manual) lines.push({ key: "Temporary", value: manual });
  effects((e) => e.phase === "initial" && e.target === "bonus");
  effects((e) => e.phase !== "initial" && e.target === "value");
  const gap = total - lines.reduce((sum, line) => sum + line.value, 0);
  if (gap) lines.push({ key: "Other", value: gap });
  return { lines, total };
}

const signed = (n) => (n >= 0 ? `+${n}` : String(n));
const escapeHTML = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * The tooltip HTML, in the markup of the system's breakdowns (`ul.fieldBonuses`, T20:3282-3288).
 * @param {ReturnType<typeof attributeBreakdown>} breakdown
 * @param {(key: string) => string} localize  Localizes a key (Base, Racial, Temporary, Other, Total, Type.<type>).
 * @returns {string}
 */
export function breakdownHTML({ lines, total }, localize) {
  const items = lines.map((line) => {
    const label = line.label ?? localize(line.key);
    const mark = ["override", "upgrade", "downgrade", "multiply"].includes(line.type) ? ` (${localize(`Type.${line.type}`)})` : "";
    return `<li class="flexrow"><label>${escapeHTML(label + mark)}:</label><span>${signed(line.value)}</span></li>`;
  });
  return `<ul class="fieldBonuses">${items.join("")}<hr><li class="flexrow"><label>${escapeHTML(localize("Total"))}:</label><span>${signed(total)}</span></li></ul>`;
}

/**
 * Reads the abilities template: the value has a tooltip only inside `{{#if wip}}`.
 * @param {string|undefined} source
 * @returns {import("../../registry.mjs").Diagnosis|undefined}
 */
export function diagnoseTemplate(source) {
  if (typeof source !== "string" || !source.includes("atributo-value")) return undefined;
  const live = source.replace(/{{#if\s+wip}}[\s\S]*?{{\/if}}/g, "");
  if (/data-tooltip/.test(live)) return { bug: "fixed", confidence: "low", evidence: `${TEMPLATE}: attribute tooltip outside {{#if wip}}` };
  if (/{{#if\s+wip}}[^{]*data-tooltip/.test(source)) return { bug: "present", confidence: "high", evidence: `${TEMPLATE}: attribute tooltip only under {{#if wip}}` };
  return { bug: "present", confidence: "low", evidence: `${TEMPLATE}: no attribute tooltip` };
}
