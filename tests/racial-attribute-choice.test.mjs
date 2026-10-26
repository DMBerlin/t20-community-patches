import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isThreeDistinctRule,
  normalizeText,
  raceDialogDiagnosis,
  selectionState,
  toggleSelection
} from "../scripts/patches/racial-attribute-choice.mjs";

// Excerpt of ItemT20.prototype._onCreateOwnedRace in tormenta20 1.6.5.
const SOURCE_165 = `async _onCreateOwnedRace(data, actorData, isNPC) {
  const openRaces = game.settings.get("tormenta20", "openRaces");
  await foundry.applications.api.DialogV2.wait({
    content: await foundry.applications.handlebars.renderTemplate(
      "systems/tormenta20/templates/apps/dynamic-attributes-dialog.hbs", { config: CONFIG.T20, description, atributosList }),
    buttons: [{ action: "apply", callback: (event, button) => {
      const fd = new foundry.applications.ux.FormDataExtended(button.form);
      for (const [key, value] of Object.entries(fd.object)) {
        const base = openRaces ? 0 : this.system.atributos[key];
        changes[\`system.atributos.\${key}.racial\`] = base + (value ?? 0);
      }
    } }]
  });
  this.actor.update(changes);
}`;

test("normalizeText strips accents, case and extra spaces", () => {
  assert.equal(normalizeText("  +1 em  Três\nAtributos   Diferentes "), "+1 em tres atributos diferentes");
  assert.equal(normalizeText(undefined), "");
});

test("isThreeDistinctRule recognizes the rule in pt and en, and the local translation", () => {
  assert.ok(isThreeDistinctRule("+1 em Três Atributos Diferentes"));
  assert.ok(isThreeDistinctRule("+1 em tres atributos diferentes"));
  assert.ok(isThreeDistinctRule("+1 in Three Different Attributes"));
  assert.ok(isThreeDistinctRule("+1 su tre attributi", "+1 su tre attributi"));
});

test("isThreeDistinctRule rejects other rules, empty text and missing translation keys", () => {
  assert.equal(isThreeDistinctRule("Distribua os atributos da sua raça"), false);
  assert.equal(isThreeDistinctRule("+2 em Dois Atributos Diferentes"), false);
  assert.equal(isThreeDistinctRule(""), false);
  assert.equal(isThreeDistinctRule(undefined), false);
  assert.equal(isThreeDistinctRule("", ""), false);
  assert.equal(isThreeDistinctRule("T20.DynamicAbilitiesDesc", "T20.DynamicAbilitiesDesc"), false);
});

test("toggleSelection picks up to three, ignores the fourth and frees a slot on unpick", () => {
  let s = [];
  for (const k of ["for", "des", "con"]) s = toggleSelection(s, k);
  assert.deepEqual(s, ["for", "des", "con"]);
  assert.deepEqual(toggleSelection(s, "int"), ["for", "des", "con"]);
  s = toggleSelection(s, "des");
  assert.deepEqual(s, ["for", "con"]);
  assert.deepEqual(toggleSelection(s, "int"), ["for", "con", "int"]);
});

test("selectionState only allows Apply with exactly three distinct attributes and locks the rest", () => {
  const keys = ["for", "des", "con", "int", "sab", "car"];
  for (const sel of [[], ["for"], ["for", "des"]]) {
    assert.deepEqual(selectionState(keys, sel), { canApply: false, locked: [] });
  }
  assert.deepEqual(selectionState(keys, ["for", "des", "sab"]), { canApply: true, locked: ["con", "int", "car"] });
  assert.equal(selectionState(keys, ["for", "for", "des"]).canApply, false);
  assert.deepEqual(selectionState(keys, ["for", "des", "xyz"]), { canApply: false, locked: [] });
});

test("raceDialogDiagnosis: 1.6.5 code is present/high", () => {
  assert.deepEqual(
    { bug: raceDialogDiagnosis(SOURCE_165).bug, confidence: raceDialogDiagnosis(SOURCE_165).confidence },
    { bug: "present", confidence: "high" }
  );
});

test("raceDialogDiagnosis: commented, changed or missing code is unknown", () => {
  const commented = `async _onCreateOwnedRace() { /* ${SOURCE_165.replaceAll("*/", "")} */ return 1; }`;
  assert.equal(raceDialogDiagnosis(commented).bug, "unknown");
  const validated = SOURCE_165.replace("base + (value ?? 0)", "base + Math.clamp(value ?? 0, 0, 1)");
  assert.equal(raceDialogDiagnosis(validated).bug, "unknown");
  assert.equal(raceDialogDiagnosis(undefined).bug, "unknown");
  assert.equal(raceDialogDiagnosis(undefined).confidence, "low");
});
