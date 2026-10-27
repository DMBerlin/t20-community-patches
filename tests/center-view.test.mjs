import { test } from "node:test";
import assert from "node:assert/strict";
import { PATCH_FILTERS, RULE_FILTERS, facetCounts, matchesView, patchBucket, ruleBucket } from "../scripts/apps/center-view.mjs";

test("patchBucket: active is on, unneeded is fixed, attention stays, off is off", () => {
  assert.equal(patchBucket("active"), "on");
  assert.equal(patchBucket("attention"), "attention");
  assert.equal(patchBucket("unneeded"), "fixed");
  assert.equal(patchBucket("off"), "off");
});

test("ruleBucket: only the first setting decides, and settings without off are on", () => {
  assert.equal(ruleBucket(["off"]), "off");
  assert.equal(ruleBucket(["warn"]), "on");
  assert.equal(ruleBucket(["off", "show"]), "off");
  assert.equal(ruleBucket(["on", "off"]), "on");
  assert.equal(ruleBucket(["display"]), "on");
  assert.equal(ruleBucket([10]), "on");
});

const row = (group, bucket, search) => ({ group, bucket, search });
const view = (over = {}) => ({ query: "", group: null, filter: "all", ...over });

test("matchesView: query, group and filter", () => {
  const death = row("conditions", "on", "pv mínimo death-threshold");
  assert.equal(matchesView(death, view({ query: "death" })), true);
  assert.equal(matchesView(death, view({ query: "combate" })), false);
  assert.equal(matchesView(death, view({ query: "   " })), true);
  assert.equal(matchesView(death, view({ group: "combat" })), false);
  assert.equal(matchesView(death, view({ group: "conditions" })), true);
  assert.equal(matchesView(death, view({ filter: "off" })), false);
  assert.equal(matchesView(row("combat", "attention", "x"), view({ filter: "on" })), false);
  assert.equal(matchesView(death, view({ group: "combat" }), { ignoreGroup: true }), true);
  assert.equal(matchesView(death, view({ filter: "off" }), { ignoreFilter: true }), true);
});

test("facetCounts: groups ignore the selected group, filters ignore the selected filter", () => {
  const rows = [
    row("combat", "on", "a"),
    row("combat", "off", "b"),
    row("combat", "attention", "c"),
    row("actor", "on", "d"),
    row("actor", "off", "e"),
    row("combat", "fixed", "f")
  ];
  const counts = facetCounts(rows, view({ group: "combat", filter: "on" }), PATCH_FILTERS);
  assert.deepEqual(counts.groups, { combat: 1, actor: 1 });
  assert.equal(counts.allGroups, 2);
  assert.deepEqual(counts.filters, { all: 4, on: 1, off: 1, fixed: 1, attention: 1 });

  const searched = facetCounts(rows, view({ query: "a" }), PATCH_FILTERS);
  assert.deepEqual(searched.groups, { combat: 1 });
  assert.deepEqual(searched.filters, { all: 1, on: 1, off: 0, fixed: 0, attention: 0 });
});

test("facetCounts: a bucket outside the filter list only counts in all", () => {
  const counts = facetCounts([row("combat", "attention", "a"), row("combat", "on", "b")], view(), RULE_FILTERS);
  assert.deepEqual(counts.filters, { all: 2, on: 1, off: 0 });
});
