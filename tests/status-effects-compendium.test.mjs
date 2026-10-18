import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONDITION_FOLDER,
  STATUS_PACK,
  selectConditionSources,
  shouldRebuild,
  shouldSubstitute
} from "../scripts/patches/status-effects-compendium.mjs";

const condition = (id, folder = CONDITION_FOLDER) => ({ _id: id, name: id, statuses: [id], folder });

test("selects only the conditions of the Condições folder and moves them to the pack root", () => {
  const sources = [
    condition("cego"),
    condition("inconsciente"),
    { _id: "upgrade", name: "Ajustada", statuses: [], folder: CONDITION_FOLDER },
    { _id: "other", name: "Outro", statuses: ["x"], folder: "OTHER" }
  ];
  const result = selectConditionSources(sources);
  assert.deepEqual(result.map((s) => s._id), ["cego", "inconsciente"]);
  assert.ok(result.every((s) => s.folder === null));
});

test("falls back to every effect with statuses when the folder is missing, without mutating input", () => {
  const sources = [condition("cego", "A"), { _id: "u", statuses: [], folder: "A" }, condition("morto", null)];
  const result = selectConditionSources(sources);
  assert.deepEqual(result.map((s) => s._id), ["cego", "morto"]);
  assert.equal(sources[0].folder, "A");
});

test("substitutes only the active GM's empty copy into an empty world.statuses", () => {
  const ok = { indexSize: 0, isActiveGM: true };
  assert.ok(shouldSubstitute([], { pack: STATUS_PACK, keepId: true }, ok));
  assert.ok(!shouldSubstitute([], { pack: STATUS_PACK }, { ...ok, indexSize: 3 }));
  assert.ok(!shouldSubstitute([], { pack: STATUS_PACK }, { ...ok, indexSize: -1 }));
  assert.ok(!shouldSubstitute([], { pack: "world.item-upgrades" }, ok));
  assert.ok(!shouldSubstitute([{ name: "x" }], { pack: STATUS_PACK }, ok));
  assert.ok(!shouldSubstitute([], { pack: STATUS_PACK }, { ...ok, isActiveGM: false }));
  assert.ok(!shouldSubstitute({}, { pack: STATUS_PACK }, ok));
  assert.ok(!shouldSubstitute([], undefined, ok));
});

test("rebuilds only on other clients still missing the conditions", () => {
  const base = { collection: STATUS_PACK, userId: "gm", currentUserId: "player", hasUnconscious: false };
  assert.ok(shouldRebuild(base));
  assert.ok(!shouldRebuild({ ...base, currentUserId: "gm" }));
  assert.ok(!shouldRebuild({ ...base, collection: "world.item-upgrades" }));
  assert.ok(!shouldRebuild({ ...base, hasUnconscious: true }));
});
