import { lineHTML } from "../../../lib/applied-breakdown.mjs";
import { simulateNumericChanges } from "./numeric.mjs";
import { EPSILON, TOTAL, signed } from "./shared.mjs";

/**
 * The PV the helper leaves out when the Constituição it reads (value − bonus) is 0: preparePVPM (T20:18842) still
 * raises each level to at least 1 PV, but the helper only counts that inside its Constituição branch (`atributoSemBonus`, T20:3148).
 * @param {{classes: {inicial?: boolean, porNivel: number, niveis: number}[], nivel?: number, nivelPar?: number,
 *   nivelImpar?: number}} data  Classes in item order; sums of the prepared per-level bonuses.
 */
export function pvMinimumCompensation({ classes = [], nivel = 0, nivelPar = 0, nivelImpar = 0 } = {}) {
  let levelSum = 0;
  let compensation = 0;
  for (const c of classes) {
    for (let i = 1; i < Number(c.niveis) + 1; i++) {
      levelSum++;
      const sum = classLevelPV(c, i) + nivel + (levelSum % 2 === 0 ? nivelPar : nivelImpar);
      if (sum < 1) compensation += 1 - sum;
    }
  }
  return Number.isFinite(compensation) ? compensation : 0;
}

/** PV of the class's i-th level before the bonuses: the initial class counts its first level four times. */
const classLevelPV = (c, i) => (c.inicial && i === 1 ? 4 * Number(c.porNivel) : Number(c.porNivel));

/**
 * What prepareDefense adds for the Defesa attribute (`atributo`, T20:18733-18747) minus what the helper shows
 * (`armaduraPesada`, T20:3223-3231).
 * @param {{attribute?: string, rollValue?: number, abilityValue?: number, armorType?: string, maxAtr?: number,
 *   helperHeavy?: boolean}} data  armorType/maxAtr: the first equipped light or heavy armor; helperHeavy: the helper
 *   found an equipped heavy armor with a Defesa value.
 */
export function defenseAbilityDelta({ attribute, rollValue, abilityValue, armorType, maxAtr, helperHeavy } = {}) {
  if (!attribute) return 0;
  const roll = Number(rollValue) || 0;
  const prepared = armorType !== "pesada" ? roll : Math.min(Math.max(Number(abilityValue) || 0, 0), Number(maxAtr) || 0);
  const shown = helperHeavy ? 0 : roll;
  return prepared - shown;
}

/**
 * The Defesa lines that replace the helper's "Outros" line and the aggregated condition line, or null when a
 * simulation is impossible or does not match the prepared values (the tooltip then stays as it is).
 * @param {{sourceOutros: number, outrosChanges: object[], preparedOutros: number, condiBase?: number,
 *   condiChanges: object[], preparedCondi: number, skipped?: {label: string, value: number, reason?: string}[],
 *   condiSkipped?: {label: string, value: number, reason?: string}[], manualLabel?: string}} data
 *   skipped, condiSkipped: changes a feature cut from defesa.outros and defesa.condi (applied-changes), listed muted
 *   with their reason (not stacking by default).
 *   condiBase: persisted defesa.condi (0 for NPCs), listed as condiLabel when not 0.
 *   ordered: the changes are the recorded ones, in application order.
 * @returns {{outros: {label: string, value: number, muted: boolean, reason?: string}[], condi: {label: string,
 *   value: number, muted: boolean, reason?: string}[]}|null}
 */
export function defenseSourceLines(data) {
  const d = sourceLineData(data);
  const outros = simulateNumericChanges(Number(d.sourceOutros) || 0, d.outrosChanges, { ordered: d.ordered });
  const condi = simulateNumericChanges(Number(d.condiBase) || 0, d.condiChanges, { ordered: d.ordered });
  if (!outros || !condi) return null;
  if (mismatch(outros.result, d.preparedOutros) || mismatch(condi.result, d.preparedCondi)) return null;
  const manual = Number(d.sourceOutros) || 0;
  const condiBase = Number(d.condiBase);
  return {
    outros: [...(manual ? [{ label: d.manualLabel, value: manual, muted: false }] : []), ...outros.lines.map(toLine), ...d.skipped.map(cutLine)],
    condi: [
      ...(condiBase ? [{ label: d.condiLabel, value: condiBase, muted: false }] : []),
      ...condi.lines.map(toLine),
      ...d.condiSkipped.map(cutLine)
    ]
  };
}

const sourceLineData = ({
  sourceOutros,
  outrosChanges = [],
  preparedOutros,
  condiBase = 0,
  condiChanges = [],
  preparedCondi,
  skipped = [],
  condiSkipped = [],
  manualLabel = "Outros (manual)",
  condiLabel = "Condição",
  ordered = false
} = {}) => ({
  sourceOutros,
  outrosChanges,
  preparedOutros,
  condiBase,
  condiChanges,
  preparedCondi,
  skipped,
  condiSkipped,
  manualLabel,
  condiLabel,
  ordered
});

/** A simulated result differs from the prepared value. */
const mismatch = (result, prepared) => Math.abs(result - (Number(prepared) || 0)) > EPSILON;

/** A simulated change as a Defesa line; an upgrade or downgrade that did not win is muted and shows its value. */
function toLine(l) {
  const muted = (l.type === "upgrade" || l.type === "downgrade") && l.delta === 0;
  return { label: l.label, value: muted ? l.value : l.delta, muted };
}

/** A change a feature cut, muted with its reason. */
const cutLine = (s) => ({ label: s.label, value: s.value, muted: true, ...(s.reason ? { reason: s.reason } : {}) });

/**
 * Replaces the helper's Defesa "Outros" line with the lines by source and adds the condition lines before the total,
 * marked with data-t20cp="condi" so field-bonuses-tooltip does not add its aggregated line. Muted lines do not count.
 * Returns the HTML unchanged when the "Outros" line (if any) or the total is not found.
 * @param {string} html
 * @param {{preparedOutros: number, outros: object[], condi: object[], notStacking?: string,
 *   noteOf?: (reason: string) => string}} data  noteOf: text of a muted line with a reason (notStacking otherwise).
 */
export function applyDefenseSources(html, { preparedOutros, outros = [], condi = [], notStacking = "doesn't stack", noteOf }) {
  if (typeof html !== "string") return html;
  const hr = html.lastIndexOf("<hr>");
  if (hr < 0 || !TOTAL.test(html.slice(hr))) return html;
  const render = (line, attr = "") => lineHTML(line, line.reason && noteOf ? noteOf(line.reason) : notStacking, attr);
  const sum = (lines) => lines.reduce((s, l) => s + (l.muted ? 0 : l.value), 0);
  const prepared = Number(preparedOutros) || 0;
  let head = html.slice(0, hr);
  const outrosHTML = outros.map((l) => render(l)).join("");
  if (prepared) {
    const line = `<li class="flexrow"><label>Outros:</label><span>${signed(prepared)}</span></li>`;
    const at = head.lastIndexOf(line);
    if (at < 0) return html;
    head = head.slice(0, at) + outrosHTML + head.slice(at + line.length);
  } else if (outrosHTML) {
    head += `${outrosHTML}\n\t\t\t`;
  }
  const condiHTML = condi.map((l) => render(l, ' data-t20cp="condi"')).join("");
  if (condiHTML) head += `${condiHTML}\n\t\t\t`;
  const delta = sum(outros) - prepared + sum(condi);
  const tail = html.slice(hr).replace(TOTAL, (_, open, total, close) => `${open}${signed(Number(total) + delta)}${close}`);
  return head + tail;
}
