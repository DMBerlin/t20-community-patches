/** Text report of `make audit` (#90). */

function probeCell({ probe }) {
  if (probe.kind === "behavior") return "behavior (Foundry)";
  if (probe.kind === "none") return "-";
  if (probe.error) return "ERROR";
  return `${probe.diagnosis.bug}/${probe.diagnosis.confidence}`;
}

function sourcesCell({ sources }) {
  if (sources.status === "none") return "-";
  if (sources.status === "changed") return `CHANGED (${sources.changed.length})`;
  return sources.status;
}

function refsCell({ refs }) {
  if (!refs.length) return "-";
  const counts = {};
  for (const ref of refs) counts[ref.status] = (counts[ref.status] ?? 0) + 1;
  return ["ok", "shifted", "missing", "pinned", "no-anchor"]
    .filter((status) => counts[status])
    .map((status) => `${status === "missing" ? "MISSING" : status} ${counts[status]}`)
    .join(", ");
}

function table(rows) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd()).join("\n");
}

function details(row) {
  const out = [];
  if (row.probe.error) out.push(`  probe: ${row.probe.error}`);
  if (row.probe.diagnosis?.evidence && row.probe.diagnosis.bug !== "present") out.push(`  evidence: ${row.probe.diagnosis.evidence}`);
  for (const label of row.undeclared) out.push(`  undeclared source: ${label} (add it to \`sources\`)`);
  for (const label of row.sources.changed) out.push(`  CHANGED: ${label}`);
  for (const label of row.sources.unrecorded) out.push(`  not in the baseline: ${label}`);
  for (const ref of row.refs) {
    if (ref.status === "missing") out.push(`  MISSING T20:${ref.start} (line ${ref.fileLine}, \`${ref.anchor}\`)`);
    if (ref.status === "shifted") out.push(`  shifted T20:${ref.start} → T20:${ref.line} (line ${ref.fileLine}, \`${ref.anchor}\`)`);
  }
  return out;
}

/**
 * @param {ReturnType<import("./run.mjs").runAudit>} report
 * @returns {string}
 */
export function formatReport(report) {
  const header = `Tormenta20 ${report.system.version} · baseline ${report.baseline ?? "(none)"}`;
  const rows = [["patch", "probe", "sources", "T20 refs"], ...report.rows.map((row) => [row.id, probeCell(row), sourcesCell(row), refsCell(row)])];
  const notes = report.rows.flatMap((row) => {
    const lines = details(row);
    return lines.length ? [`${row.id}`, ...lines] : [];
  });
  const summary = report.ok ? "OK: nothing changed that the patches depend on." : `ATTENTION: ${report.failing.join(", ")}`;
  return [header, "", table(rows), ...(notes.length ? ["", ...notes] : []), "", summary].join("\n");
}

const ACTIONS = ["promote", "review", "current", "retired"];

/**
 * Text of `make audit-promote` (#93).
 * @param {ReturnType<import("./promote.mjs").planPromotion>} plan
 * @param {{write?: boolean, command?: string}} [options]  `command`: the audit command for the same bundle (already
 *   shell-quoted), used in the next steps.
 * @returns {string}
 */
export function formatPromotion(plan, { write = false, command = "node tools/audit.mjs" } = {}) {
  if (!plan.newer) {
    return `Tormenta20 ${plan.to} is not newer than the baseline ${plan.from ?? "(none)"}: nothing to promote.`;
  }
  const header = `Tormenta20 ${plan.from} → ${plan.to} · ${write ? "WRITE" : "dry run (WRITE=1 to write)"}`;
  const ordered = [...plan.rows].sort((a, b) => ACTIONS.indexOf(a.action) - ACTIONS.indexOf(b.action));
  const rows = [["patch", "maximum", "action", "reason"], ...ordered.map((row) => [row.id, row.maximum ?? "-", row.action, row.reason])];
  const counts = ACTIONS.map((action) => `${action} ${plan.rows.filter((row) => row.action === action).length}`).join(" · ");
  const promoted = write ? `maximum ${plan.from} → ${plan.to} written to the index.mjs of every promote` : "no file changed";
  const steps = [
    "Next steps:",
    "  1. review every `review` (playtest in Foundry for behavior probes and patches without sources);",
    `  2. ${write ? "" : `${command} --promote --write, then `}${command} --write-baseline;`,
    "  3. update relationships.systems[0].compatibility.verified in module.json (release skill);",
    "  4. make check."
  ];
  return [header, "", table(rows), "", `${counts} · ${promoted}`, "", ...steps].join("\n");
}
