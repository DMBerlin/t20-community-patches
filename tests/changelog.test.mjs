import { test } from "node:test";
import assert from "node:assert/strict";
import { addEntry, compatibilityLine, cutRelease, nextVersion, releaseNotes, updateManifest } from "../tools/changelog.mjs";

const BASE = "# Changelog\n\nIntro.\n\n## Unreleased\n\n## v0.1.0 - 2026-01-01\n\n### Fixed\n\n- old / old\n";

test("adds entries to Unreleased in canonical section order", () => {
  let text = addEntry(BASE, "Fixed", "fix / fix");
  text = addEntry(text, "Added", "feat / feat");
  const unreleased = text.split("## v0.1.0")[0];
  assert.match(unreleased, /## Unreleased\n\n### Added\n\n- feat \/ feat\n\n### Fixed\n\n- fix \/ fix\n\n$/);
  assert.match(text, /## v0\.1\.0 - 2026-01-01\n\n### Fixed\n\n- old \/ old\n$/);
  assert.throws(() => addEntry(BASE, "Misc", "x"));
  assert.throws(() => addEntry(BASE, "Fixed", "a\nb"));
});

test("rejects Unreleased content it would otherwise drop", () => {
  assert.throws(() => addEntry(`${BASE.replace("## Unreleased\n", "## Unreleased\n\n### Fixed\n\n- a\n  - nested\n")}`, "Fixed", "b"));
});

test("suggests SemVer from Unreleased sections", () => {
  assert.equal(nextVersion(addEntry(BASE, "Fixed", "f"), "0.1.0", "0.1.0"), "0.1.1");
  assert.equal(nextVersion(addEntry(BASE, "Added", "a"), "0.1.0", "0.1.0"), "0.2.0");
  assert.equal(nextVersion(addEntry(BASE, "Removed", "r"), "0.1.0", "0.1.0"), "0.2.0");
  assert.equal(nextVersion(addEntry(BASE, "Fixed", "BREAKING x"), "1.2.3", "1.2.3"), "2.0.0");
  assert.equal(nextVersion(addEntry(BASE, "Fixed", "f"), null, "0.1.0"), "0.1.0");
  assert.throws(() => nextVersion(BASE, "0.1.0", "0.1.0"));
});

test("cuts a release, leaves an empty Unreleased and extracts notes", () => {
  const text = cutRelease(addEntry(BASE, "Fixed", "new / new"), "0.1.1", "2026-02-02");
  assert.match(text, /## Unreleased\n\n## v0\.1\.1 - 2026-02-02\n\n### Fixed\n\n- new \/ new\n\n## v0\.1\.0/);
  assert.equal(releaseNotes(text, "0.1.1"), "### Fixed\n\n- new / new\n");
  assert.throws(() => cutRelease(text, "0.1.2", "2026-02-02"), /empty/);
  assert.throws(() => cutRelease(addEntry(text, "Fixed", "x"), "0.1.0", "2026-02-02"), /exists/);
  assert.throws(() => cutRelease(addEntry(text, "Fixed", "x"), "v1", "2026-02-02"));
});

test("points the manifest download at the release tag", () => {
  const manifest = updateManifest({ version: "0.1.0", url: "https://github.com/o/r", download: "x" }, "0.2.0");
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.download, "https://github.com/o/r/releases/download/v0.2.0/module.zip");
});

test("records the declared compatibility in the released version and its notes", () => {
  const manifest = {
    compatibility: { minimum: "14", verified: "14.369" },
    relationships: { systems: [{ id: "tormenta20", compatibility: { minimum: "1.6.5", verified: "1.6.6" } }] }
  };
  const line = compatibilityLine(manifest);
  assert.equal(line, "**Compatibilidade:** Foundry VTT (mínimo 14, verificado 14.369) · Tormenta20 (mínimo 1.6.5, verificado 1.6.6)");
  const text = cutRelease(addEntry(BASE, "Fixed", "new"), "0.1.1", "2026-02-02", line);
  assert.equal(releaseNotes(text, "0.1.1"), `${line}\n\n### Fixed\n\n- new\n`);
  assert.match(addEntry(text, "Added", "next"), /## Unreleased\n\n### Added\n\n- next\n\n## v0\.1\.1/);
  assert.throws(() => compatibilityLine({ compatibility: { verified: "14" }, relationships: { systems: [] } }), /verified/);
});
