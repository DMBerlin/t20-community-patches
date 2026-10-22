import { test } from "node:test";
import assert from "node:assert/strict";
import { CAST_OUTCOME_KEY, castCompleted, castFailed, isCastUse, markCastFailed } from "../scripts/rules/cast-outcome.mjs";

test("castCompleted: a message, the card data and a spell without effects count; null, true and failures do not", () => {
  assert.equal(castCompleted({ documentName: "ChatMessage" }, { effects: [] }), true);
  assert.equal(castCompleted({ content: "<p>card</p>" }, { effects: [] }), true);
  for (const result of [null, undefined, true]) assert.equal(castCompleted(result, { effects: [] }), false);
  const options = { effects: [] };
  markCastFailed(options, { rule: "arcane-armor-casting", reason: "misticismo" });
  assert.equal(castFailed(options), true);
  assert.equal(castCompleted({ documentName: "ChatMessage" }, options), false);
});

test("markCastFailed keeps the other keys of the module namespace", () => {
  const options = { [CAST_OUTCOME_KEY]: { other: 1 } };
  markCastFailed(options, { rule: "r", reason: "x", messageId: "m1" });
  assert.deepEqual(options[CAST_OUTCOME_KEY], { other: 1, castOutcome: { status: "failed", rule: "r", reason: "x", messageId: "m1" } });
  assert.doesNotThrow(() => markCastFailed(null, {}));
});

test("isCastUse: only uses carry options.effects; the sheet's 'Mostrar no Chat' does not", () => {
  assert.equal(isCastUse({ effects: [] }), true);
  assert.equal(isCastUse({ itemId: "i1" }), false);
  assert.equal(isCastUse(undefined), false);
});
