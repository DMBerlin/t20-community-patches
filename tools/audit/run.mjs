/**
 * Static audit of the patches against a Tormenta20 bundle (#90). Pure: the caller reads the files. The bundle is
 * only parsed (acorn), never imported or evaluated.
 */
import { indexBundle } from "./bundle-index.mjs";
import { createAuditPlatform } from "./platform.mjs";
import { checkRef, findRefs } from "./refs.mjs";
import { createFeatureContext } from "../../scripts/kernel/context.mjs";
import { createWrapRegistry } from "../../scripts/kernel/wrap.mjs";
import { normalizeDiagnosis } from "../../scripts/registry.mjs";
import { sourceFingerprint } from "../../scripts/lib/source.mjs";
import { compareVersions } from "../../scripts/lib/version.mjs";

/**
 * Runs a source probe against the bundle. A behavior probe is not run; a probe that throws (a legacy global, a port
 * that needs Foundry) is an error, because its patch should be marked `probeKind: "behavior"` or migrated.
 * @returns {{kind: "source"|"behavior"|"none", diagnosis?: object, error?: string, labels: string[]}}
 */
export function probePatch(patch, { index, system }) {
  if (patch.probeKind === "behavior") return { kind: "behavior", labels: [] };
  if (typeof patch.isNeeded !== "function") return { kind: "none", labels: [] };
  const labels = new Set();
  const platform = createAuditPlatform({ index, system, onLabel: (label) => labels.add(label) });
  try {
    const ctx = createFeatureContext(platform, patch, { wraps: createWrapRegistry() });
    return { kind: "source", diagnosis: normalizeDiagnosis(patch.isNeeded(ctx)), labels: [...labels] };
  } catch (err) {
    return { kind: "source", error: `${err?.name ?? "Error"}: ${err?.message ?? err}`, labels: [...labels] };
  }
}

/** Fingerprint of each label in the bundle (null when the label is absent or ambiguous). */
export function fingerprintLabels(labels, index) {
  return Object.fromEntries([...labels].sort().map((label) => [label, sourceFingerprint(index.source(label))]));
}

/**
 * The baseline to compare with: the verified version's, else the newest one recorded.
 * @param {Record<string, Record<string, string|null>>} baseline
 * @param {string} [verified]
 * @returns {{version: string, entries: Record<string, string|null>}|null}
 */
export function pickBaseline(baseline, verified) {
  const versions = Object.keys(baseline ?? {});
  if (!versions.length) return null;
  const version = versions.includes(verified) ? verified : versions.sort(compareVersions).at(-1);
  return { version, entries: baseline[version] };
}

/**
 * Compares a patch's fingerprints with the baseline.
 * @returns {{status: "unchanged"|"changed"|"unrecorded"|"none", changed: string[], unrecorded: string[]}}
 */
export function compareFingerprints(current, reference) {
  const labels = Object.keys(current);
  if (!labels.length) return { status: "none", changed: [], unrecorded: [] };
  const entries = reference?.entries ?? {};
  const unrecorded = labels.filter((label) => !Object.hasOwn(entries, label));
  const changed = labels.filter((label) => Object.hasOwn(entries, label) && entries[label] !== current[label]);
  if (changed.length) return { status: "changed", changed, unrecorded };
  return { status: unrecorded.length ? "unrecorded" : "unchanged", changed, unrecorded };
}

/** Checks the `T20:<line>` references of a file. */
export function auditRefs(text, lines, version) {
  return findRefs(text).map((ref) => ({ ...ref, ...checkRef(ref, lines, version) }));
}

/**
 * @param {object} args
 * @param {object[]} args.patches  Raw patch modules (PATCHES).
 * @param {string} args.code  Text of the bundle.
 * @param {{id?: string, version: string}} args.system  From the bundle's system.json.
 * @param {Record<string, Record<string, string|null>>} [args.baseline]
 * @param {string} [args.verified]  Version declared as verified in module.json.
 * @param {Record<string, string>} [args.files]  Patch id → text of its source file, for the T20 references.
 */
export function runAudit({ patches, code, system, baseline = {}, verified, files = {} }) {
  const index = indexBundle(code);
  const reference = pickBaseline(baseline, verified);
  const rows = patches.map((patch) => {
    const probe = probePatch(patch, { index, system });
    const current = fingerprintLabels(new Set([...(patch.sources ?? []), ...probe.labels]), index);
    const undeclared = probe.labels.filter((label) => !(patch.sources ?? []).includes(label));
    const refs = files[patch.id] === undefined ? [] : auditRefs(files[patch.id], index.lines, system.version);
    return { id: patch.id, probe, fingerprints: current, sources: compareFingerprints(current, reference), undeclared, refs };
  });
  const failing = rows.filter(
    (row) =>
      row.probe.error ||
      row.undeclared.length ||
      row.sources.status === "changed" ||
      row.refs.some((ref) => ref.status === "missing")
  );
  return { system, baseline: reference?.version ?? null, rows, ok: failing.length === 0, failing: failing.map((row) => row.id) };
}

/** Baseline entries of the audited bundle: every label of every patch. */
export function baselineEntries(report) {
  return Object.fromEntries(
    report.rows
      .flatMap((row) => Object.entries(row.fingerprints))
      .sort(([a], [b]) => a.localeCompare(b))
  );
}
