import { DEFAULT_PRIORITY, phaseIndex } from "./shared.mjs";

const NUMERIC_TYPES = new Set(["add", "subtract", "multiply", "override", "upgrade", "downgrade"]);

/**
 * A change value a NumberField accepts without data or a formula, or null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function plainNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Marginal contribution of each change to a numeric field, in core order (phase → priority → order), with the
 * semantics of NumberField (add, subtract, multiply, override; upgrade → max, downgrade → min).
 * Within a run of upgrades or downgrades, the change that wins (the first with the extreme value, as the core keeps
 * the current value on ties) gets the whole contribution of the run; the losers get 0.
 * @param {number} base  Value of the field before the changes.
 * @param {{label: string, type: string, value: unknown, priority?: number, phase?: string}[]} changes
 * @param {{ordered?: boolean}} [options]  ordered: the changes are already in application order (recorded changes).
 * @returns {{lines: {label: string, type: string, value: number, delta: number}[], result: number}|null}
 *   Lines in application order; null for a custom type, an unknown type or a value that is not a plain number.
 */
export function simulateNumericChanges(base, changes = [], { ordered = false } = {}) {
  let current = Number(base);
  if (!Number.isFinite(current)) return null;
  const indexed = changes.map((change, seq) => ({ change, seq }));
  if (!ordered) indexed.sort(byCoreOrder);
  const lines = [];
  for (const { change } of indexed) {
    if (!NUMERIC_TYPES.has(change.type)) return null;
    const value = plainNumber(change.value);
    if (value === null) return null;
    const before = current;
    current = applyNumeric(current, change.type, value);
    lines.push({ label: change.label, type: change.type, value, delta: current - before, start: before, end: current });
  }
  assignRunWinners(lines);
  return { lines: lines.map(({ label, type, value, delta }) => ({ label, type, value, delta })), result: current };
}

const priorityOf = (change) => change.priority ?? DEFAULT_PRIORITY[change.type] ?? 0;

/** Core order of indexed changes: phase, then priority, then order. */
const byCoreOrder = (a, b) =>
  phaseIndex(a.change.phase) - phaseIndex(b.change.phase) || priorityOf(a.change) - priorityOf(b.change) || a.seq - b.seq;

/** The field after one change of a NumberField. */
function applyNumeric(current, type, value) {
  switch (type) {
    case "add":
      return current + value;
    case "subtract":
      return current - value;
    case "multiply":
      return current * value;
    case "override":
      return value;
    case "upgrade":
      return value > current ? value : current;
    case "downgrade":
      return value < current ? value : current;
  }
  return current;
}

/** In each run of upgrades or downgrades, gives the run's whole contribution to the winner and 0 to the others. */
function assignRunWinners(lines) {
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j < lines.length && lines[j].type === lines[i].type) j++;
    if (lines[i].type === "upgrade" || lines[i].type === "downgrade") {
      const start = lines[i].start;
      const end = lines[j - 1].end;
      const winner = end === start ? -1 : lines.slice(i, j).findIndex((l) => l.value === end);
      for (let k = i; k < j; k++) lines[k].delta = k - i === winner ? end - start : 0;
    }
    i = j;
  }
}
