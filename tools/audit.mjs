#!/usr/bin/env node
/**
 * Static audit of the patches against a Tormenta20 version, without Foundry (#90).
 *
 *   node tools/audit.mjs [bundle] [--system-json <path>] [--json] [--write-baseline]
 *   node tools/audit.mjs [bundle] [--system-json <path>] [--json] --promote [--write]
 *
 * bundle            tormenta20.mjs to audit (default: $FOUNDRY_DATA/systems/tormenta20/tormenta20.mjs).
 * --system-json     system.json of that bundle (default: next to the bundle).
 * --json            print the report as JSON.
 * --write-baseline  record the bundle's fingerprints in tests/fixtures/audit-baseline.json.
 * --promote         plan the move of `affected.maximum` from the baseline version to the bundle's (#93): only patches
 *                   whose sources did not change are promoted; the others are listed for review. Dry run by default.
 * --write           with --promote, write the new maximum in the index.mjs of the promoted patches. Never touches the
 *                   baseline nor module.json.
 *
 * The bundle is only read as text and parsed; it is never imported or evaluated. Exit code 1 when a fingerprint
 * changed, a source probe failed or a T20 reference is missing; with --promote, when any patch is left for review.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PATCHES } from "../scripts/features/patches.mjs";
import { baselineEntries, runAudit } from "./audit/run.mjs";
import { formatPromotion, formatReport } from "./audit/report.mjs";
import { VERSION, planPromotion, promoteSource } from "./audit/promote.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "tests/fixtures/audit-baseline.json");

function defaultBundle() {
  const data = process.env.FOUNDRY_DATA || join(homedir(), "Library/Application Support/FoundryVTT/Data");
  return join(data, "systems/tormenta20/tormenta20.mjs");
}

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

/** Every .mjs file under a feature folder, in a stable order. */
function featureSources(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((name) => String(name).endsWith(".mjs"))
    .sort()
    .map((name) => readFileSync(join(dir, String(name)), "utf8"));
}

function indexPath(id) {
  return join(ROOT, "scripts/features", id, "index.mjs");
}

/** Text of each patch's index.mjs, where its `affected` range is declared. */
function indexTexts() {
  const texts = {};
  for (const patch of PATCHES) if (existsSync(indexPath(patch.id))) texts[patch.id] = readFileSync(indexPath(patch.id), "utf8");
  return texts;
}

function shellQuote(text) {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

/** Plans (and with `write`, applies) the promotion; returns the exit code. */
function promote(report, { json, write, command }) {
  if (!report.baseline) {
    console.error("audit: no baseline to promote from (tests/fixtures/audit-baseline.json)");
    return 2;
  }
  if (!VERSION.test(report.system.version)) {
    console.error(`audit: invalid version in system.json: ${JSON.stringify(report.system.version)}`);
    return 2;
  }
  const texts = indexTexts();
  const plan = planPromotion({ report, patches: PATCHES, from: report.baseline, to: report.system.version, texts });
  if (write) {
    for (const row of plan.rows.filter((entry) => entry.action === "promote")) {
      writeFileSync(indexPath(row.id), promoteSource(texts[row.id], plan.from, plan.to));
    }
  }
  console.log(json ? JSON.stringify(plan, null, 2) : formatPromotion(plan, { write, command }));
  return plan.rows.some((row) => row.action === "review") ? 1 : 0;
}

/** Text of each patch: all files of scripts/features/<id>/. */
function patchFiles() {
  const files = {};
  for (const patch of PATCHES) {
    const dir = join(ROOT, "scripts/features", patch.id);
    if (existsSync(dir)) files[patch.id] = featureSources(dir).join("\n");
  }
  return files;
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "system-json": { type: "string" },
      json: { type: "boolean" },
      "write-baseline": { type: "boolean" },
      promote: { type: "boolean" },
      write: { type: "boolean" }
    }
  });
  if (values.write && !values.promote) {
    console.error("audit: --write only works with --promote (use --write-baseline to record fingerprints)");
    return 2;
  }
  if (values.promote && values["write-baseline"]) {
    console.error("audit: --promote never writes the baseline; run --write-baseline separately after reviewing");
    return 2;
  }
  const bundle = resolve(positionals[0] ?? defaultBundle());
  if (!existsSync(bundle)) {
    console.error(`audit: bundle not found: ${bundle}`);
    return 2;
  }
  const system = readJson(values["system-json"] ?? join(dirname(bundle), "system.json"), null);
  if (!system?.version) {
    console.error("audit: system.json not found next to the bundle (use --system-json)");
    return 2;
  }
  const module = readJson(join(ROOT, "module.json"), {});
  const verified = module.relationships?.systems?.find((entry) => entry.id === "tormenta20")?.compatibility?.verified;
  const baseline = readJson(BASELINE, {});
  const report = runAudit({ patches: PATCHES, code: readFileSync(bundle, "utf8"), system, baseline, verified, files: patchFiles() });

  if (values.promote) {
    const target = [bundle, ...(values["system-json"] ? ["--system-json", resolve(values["system-json"])] : [])];
    const command = ["node tools/audit.mjs", ...target.map(shellQuote)].join(" ");
    return promote(report, { json: values.json, write: values.write, command });
  }
  if (values["write-baseline"]) {
    const next = { ...baseline, [system.version]: baselineEntries(report) };
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.error(`audit: baseline ${system.version} written to ${BASELINE}`);
  }
  console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.ok ? 0 : 1;
}

process.exitCode = main();
