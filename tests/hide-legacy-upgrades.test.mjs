import { test } from "node:test";
import assert from "node:assert/strict";
import { findLegacyFieldsets, isLegacyFieldset, onRenderItemSheet } from "../scripts/patches/hide-legacy-upgrades.mjs";

/** Fake fieldset: `matches` lists the selectors (as passed by the patch) that find something inside it. */
function fieldset({ legend, matches = [] } = {}) {
  return {
    removed: false,
    querySelector(sel) {
      if (sel === ":scope > legend") return legend === undefined ? null : { textContent: legend };
      return matches.includes(sel) ? {} : null;
    },
    remove() {
      this.removed = true;
    }
  };
}

const LEGACY = 'input[name="system.enableAutoUpgrades"], select.updateUpgrades';

function root(fieldsets) {
  return {
    querySelectorAll: (sel) => (sel === ".tab.enhancements fieldset" ? fieldsets : [])
  };
}

test("recognizes the legacy fieldset by its controls", () => {
  assert.ok(isLegacyFieldset(fieldset({ legend: "Outro", matches: [LEGACY] })));
});

test("recognizes the legacy fieldset by its legend, ignoring whitespace", () => {
  assert.ok(isLegacyFieldset(fieldset({ legend: "\n\t Deprecated  " })));
});

test("keeps other fieldsets", () => {
  assert.ok(!isLegacyFieldset(fieldset({ legend: "Melhorias" })));
  assert.ok(!isLegacyFieldset(fieldset()));
});

test("finds only the legacy fieldset in the enhancements tab", () => {
  const legacy = fieldset({ legend: "Deprecated", matches: [LEGACY] });
  const other = fieldset({ legend: "Melhorias" });
  assert.deepEqual(findLegacyFieldsets(root([other, legacy])), [legacy]);
});

test("removes the legacy fieldset from a jQuery-like render argument and fails safe", () => {
  const legacy = fieldset({ legend: "Deprecated" });
  const other = fieldset({ legend: "Melhorias" });
  onRenderItemSheet({}, [root([legacy, other])]);
  assert.ok(legacy.removed);
  assert.ok(!other.removed);
  assert.doesNotThrow(() => onRenderItemSheet({}, undefined));
  assert.doesNotThrow(() => onRenderItemSheet({}, []));
});
