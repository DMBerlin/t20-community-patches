/**
 * Promotion of the affected range of the patches to a newer Tormenta20 version (#93). Pure: the caller runs the
 * audit, reads each patch's index.mjs and writes the result.
 */
import { parse } from "acorn";
import { compareVersions } from "../../scripts/lib/version.mjs";

/** A dotted numeric version ("1.6.7"), the only text ever written into a patch. */
export const VERSION = /^\d+(\.\d+)*$/;

/**
 * Every property `name` of an object literal (all of them, to catch duplicates); null when the object is not a
 * literal or has a spread or computed key, which could override the property read here.
 */
function properties(node, name) {
  if (node?.type !== "ObjectExpression") return null;
  if (node.properties.some((prop) => prop.type !== "Property" || prop.computed)) return null;
  return node.properties.filter((prop) => (prop.key.name ?? prop.key.value) === name);
}

const isString = (node) => node?.type === "Literal" && typeof node.value === "string";

/**
 * The `maximum` literal of the canonical range: `export default { system: { affected: { minimum: "x", maximum: "y" } } }`,
 * each key once, both values string literals and nothing else in `affected`. Else null.
 * @param {string} text
 */
export function affectedMaximum(text) {
  let program;
  try {
    program = parse(text, { ecmaVersion: "latest", sourceType: "module" });
  } catch {
    return null;
  }
  const exported = program.body.filter((node) => node.type === "ExportDefaultDeclaration");
  if (exported.length !== 1) return null;
  const system = properties(exported[0].declaration, "system");
  if (system?.length !== 1) return null;
  const affected = properties(system[0].value, "affected");
  if (affected?.length !== 1) return null;
  const range = affected[0].value;
  const minimum = properties(range, "minimum");
  const maximum = properties(range, "maximum");
  if (minimum?.length !== 1 || maximum?.length !== 1 || range.properties.length !== 2) return null;
  return isString(minimum[0].value) && isString(maximum[0].value) ? maximum[0].value : null;
}

/**
 * The index.mjs text with the canonical range's maximum moved from `from` to `to`, else null: no `affected`, more
 * than one, a non-canonical form, a maximum other than `from` or a `to` that is not a dotted numeric version. The file is parsed (acorn), so comments and strings
 * never count; nothing else in it changes.
 * @param {string} text
 * @param {string} from
 * @param {string} to
 * @returns {string|null}
 */
export function promoteSource(text, from, to) {
  if (typeof text !== "string" || !VERSION.test(to)) return null;
  const literal = affectedMaximum(text);
  if (!literal || literal.value !== from) return null;
  const quote = text[literal.start];
  return `${text.slice(0, literal.start)}${quote}${to}${quote}${text.slice(literal.end)}`;
}

/** Why the audit row blocks an automatic promotion (empty when nothing does). */
function auditReasons(row) {
  const reasons = [];
  if (row.sources.status === "none") reasons.push("no sources: the audit cannot see what it fixes");
  for (const label of row.sources.changed) reasons.push(`CHANGED: ${label}`);
  for (const label of row.sources.unrecorded) reasons.push(`not in the baseline: ${label}`);
  if (row.probe.error) reasons.push(`probe error: ${row.probe.error}`);
  for (const label of row.undeclared) reasons.push(`undeclared source: ${label}`);
  for (const ref of row.refs) if (ref.status === "missing") reasons.push(`MISSING T20:${ref.start}`);
  if (row.probe.kind === "source" && row.probe.diagnosis?.bug === "fixed") {
    reasons.push(`probe says fixed/${row.probe.diagnosis.confidence}: the system may have fixed the bug`);
  }
  return reasons;
}

function classify(patch, row, { from, to, texts }) {
  const maximum = patch.system?.affected?.maximum;
  if (!maximum) return { action: "review", reason: "no affected.maximum" };
  if (compareVersions(maximum, to) >= 0) return { action: "current", reason: `maximum ${maximum} ≥ ${to}` };
  if (compareVersions(maximum, from) < 0) return { action: "retired", reason: `fixed before ${from}` };
  if (compareVersions(maximum, from) > 0) return { action: "review", reason: `maximum ${maximum} between ${from} and ${to}` };
  if (!row) return { action: "review", reason: "not in the audit report" };
  const reasons = auditReasons(row);
  if (reasons.length) return { action: "review", reason: reasons.join("; ") };
  if (promoteSource(texts[patch.id], from, to) === null) {
    return { action: "review", reason: "affected is not in the canonical form in index.mjs" };
  }
  return { action: "promote", reason: `sources unchanged since ${from}` };
}

/**
 * The promotion plan of every patch.
 * - `current`: maximum ≥ `to`; `retired`: maximum < `from` (fixed earlier, never promoted);
 * - `review`: anything the audit cannot vouch for (no sources, a changed, unrecorded or missing source, a probe error
 *   or `fixed` diagnosis, an undeclared label, a missing reference, a non-canonical `affected`, a maximum between
 *   `from` and `to`);
 * - `promote`: maximum = `from` and nothing above.
 * When `to` is not newer than `from`, nothing is planned (`newer: false`).
 * @param {object} args
 * @param {ReturnType<import("./run.mjs").runAudit>} args.report
 * @param {object[]} args.patches  PATCHES.
 * @param {string} args.from  Version of the baseline the audit compared with.
 * @param {string} args.to  Version of the audited bundle.
 * @param {Record<string, string>} [args.texts]  Patch id → text of its index.mjs.
 * @returns {{from: string, to: string, newer: boolean, rows: {id: string, action: string, reason: string, maximum?: string}[]}}
 */
export function planPromotion({ report, patches, from, to, texts = {} }) {
  if (!VERSION.test(to ?? "")) throw new Error(`audit-promote: invalid system version ${JSON.stringify(to)}`);
  if (!from || compareVersions(to, from) <= 0) return { from, to, newer: false, rows: [] };
  const rows = patches.map((patch) => {
    const row = report.rows.find((entry) => entry.id === patch.id);
    return { id: patch.id, maximum: patch.system?.affected?.maximum, ...classify(patch, row, { from, to, texts }) };
  });
  return { from, to, newer: true, rows };
}
