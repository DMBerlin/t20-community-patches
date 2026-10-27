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

test("every optional rule with several settings has a group title in the Center", () => {
  const source = readFileSync(new URL("../scripts/settings.mjs", import.meta.url), "utf8");
  const ids = [...source.matchAll(/\{ id: "([\w-]+)", group: "[\w-]+", keys: \[([^\]]*)\] \}/g)]
    .filter(([, , list]) => list.split(",").length > 1)
    .map(([, id]) => id);
  assert.ok(ids.length > 1);
  const rules = load("pt-BR").T20CP.Manager.Rules;
  for (const id of ids) assert.ok(rules[id], id);
});

test("every optional rule sits in one of the Center's groups", () => {
  const settings = readFileSync(new URL("../scripts/settings.mjs", import.meta.url), "utf8");
  const index = readFileSync(new URL("../scripts/patches/index.mjs", import.meta.url), "utf8");
  const groups = JSON.parse(index.match(/export const GROUPS = (\[[^\]]*\]);/)[1]);
  const block = settings.slice(settings.indexOf("export const RULE_SETTINGS"), settings.indexOf("];", settings.indexOf("export const RULE_SETTINGS")));
  const entries = [...block.matchAll(/\{ id: "([\w-]+)"(?:, group: "([\w-]+)")?/g)];
  assert.ok(entries.length > 10);
  for (const [, id, group] of entries) assert.ok(groups.includes(group), `${id}: ${group}`);
});
