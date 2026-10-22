import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
