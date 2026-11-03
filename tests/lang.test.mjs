import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FEATURES } from "../scripts/features/index.mjs";
import { centerSettings } from "../scripts/kernel/settings.mjs";

const load = (lang) => JSON.parse(readFileSync(new URL(`../lang/${lang}.json`, import.meta.url), "utf8"));

function keys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  );
}

test("locale files parse and have the same keys", () => {
  const pt = keys(load("pt-BR")).sort();
  const en = keys(load("en")).sort();
  assert.deepEqual(en, pt);
});

test("every optional rule with several settings has a group title in the Center", () => {
  const ids = centerSettings(FEATURES).filter((e) => e.keys.length > 1).map((e) => e.id);
  assert.ok(ids.length > 1);
  const rules = load("pt-BR").T20CP.Manager.Rules;
  for (const id of ids) assert.ok(rules[id], id);
});
