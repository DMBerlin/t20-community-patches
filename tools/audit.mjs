#!/usr/bin/env node
/**
 * Static audit of the patches against a Tormenta20 version, without Foundry (#90).
 *
 *   node tools/audit.mjs [bundle] [--system-json <path>] [--json] [--write-baseline]
 *
 * bundle            tormenta20.mjs to audit (default: $FOUNDRY_DATA/systems/tormenta20/tormenta20.mjs).
 * --system-json     system.json of that bundle (default: next to the bundle).
 * --json            print the report as JSON.
 * --write-baseline  record the bundle's fingerprints in tests/fixtures/audit-baseline.json.
 *
 * The bundle is only read as text and parsed; it is never imported or evaluated. Exit code 1 when a fingerprint
 * changed, a source probe failed or a T20 reference is missing.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PATCHES } from "../scripts/patches/index.mjs";
import { baselineEntries, runAudit } from "./audit/run.mjs";
import { formatReport } from "./audit/report.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "tests/fixtures/audit-baseline.json");

function defaultBundle() {
  const data = process.env.FOUNDRY_DATA || join(homedir(), "Library/Application Support/FoundryVTT/Data");
  return join(data, "systems/tormenta20/tormenta20.mjs");
}

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

function patchFiles() {
  const files = {};
  for (const patch of PATCHES) {
    const path = join(ROOT, "scripts/patches", `${patch.id}.mjs`);
    if (existsSync(path)) files[patch.id] = readFileSync(path, "utf8");
  }
  return files;
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { "system-json": { type: "string" }, json: { type: "boolean" }, "write-baseline": { type: "boolean" } }
  });
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

  if (values["write-baseline"]) {
    const next = { ...baseline, [system.version]: baselineEntries(report) };
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.error(`audit: baseline ${system.version} written to ${BASELINE}`);
  }
  console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.ok ? 0 : 1;
}

process.exitCode = main();
