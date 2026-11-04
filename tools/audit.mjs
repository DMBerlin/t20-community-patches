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
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PATCHES } from "../scripts/features/patches.mjs";
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

/** Every .mjs file under a feature folder, in a stable order. */
function featureSources(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((name) => String(name).endsWith(".mjs"))
    .sort()
    .map((name) => readFileSync(join(dir, String(name)), "utf8"));
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
