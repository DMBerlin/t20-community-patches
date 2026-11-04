import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";

import { FEATURES, GROUPS } from "../scripts/features/index.mjs";
import { validateFeatures } from "../scripts/kernel/feature.mjs";

const ROOT = new URL("../scripts/features/", import.meta.url);
const folders = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

test("every feature folder has an index.mjs whose default export is the feature registered under the folder name", async () => {
  assert.ok(folders.length > 0);
  assert.doesNotThrow(() => validateFeatures(FEATURES, GROUPS));
  const byId = new Map(FEATURES.map((feature) => [feature.id, feature]));
  for (const folder of folders) {
    assert.ok(existsSync(new URL(`${folder}/index.mjs`, ROOT)), `${folder}: index.mjs missing`);
    const { default: exported } = await import(new URL(`${folder}/index.mjs`, ROOT));
    assert.equal(exported?.id, folder, `${folder}: id does not match the folder`);
    assert.equal(byId.get(folder)?.install, exported.install, `${folder}: FEATURES does not register this export`);
    if (byId.get(folder)?.kind === "patch") assert.ok(exported.system?.affected, `${folder}: patch without system.affected`);
  }
});

test("every folder is registered in FEATURES, and every patch in FEATURES has its folder", async () => {
  const registered = new Set(FEATURES.map((feature) => feature.id));
  for (const folder of folders) assert.ok(registered.has(folder), `${folder}: not in FEATURES`);
  for (const feature of FEATURES.filter((f) => f.kind === "patch")) {
    assert.ok(folders.includes(feature.id), `${feature.id}: patch outside scripts/features/<id>/`);
  }
});
