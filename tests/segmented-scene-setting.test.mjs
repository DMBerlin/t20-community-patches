import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LIMIT, exceedsLimit, needsFix, normalizeSegmentedScene, resolveLimit } from "../scripts/patches/segmented-scene-setting.mjs";

test("keeps valid segments and clamps the current segment to [0, max]", () => {
  assert.deepEqual(normalizeSegmentedScene({ max: 3, value: 1 }), { value: 1, max: 3 });
  assert.deepEqual(normalizeSegmentedScene({ max: 3, value: 5 }), { value: 3, max: 3 });
  assert.deepEqual(normalizeSegmentedScene({ max: 3, value: -2 }), { value: 0, max: 3 });
  assert.deepEqual(normalizeSegmentedScene({ max: 3, value: null }), { value: 0, max: 3 });
  assert.deepEqual(normalizeSegmentedScene({ max: 3, value: "" }), { value: 0, max: 3 });
});

test("disables the rule when max is zero, negative, empty or invalid", () => {
  const disabled = { value: null, max: null };
  for (const max of [0, -1, null, undefined, "", "  ", "abc", Infinity]) {
    assert.deepEqual(normalizeSegmentedScene({ max, value: 2 }), disabled, `max=${String(max)}`);
  }
  assert.deepEqual(normalizeSegmentedScene(), disabled);
});

test("accepts numeric strings and truncates decimals", () => {
  assert.deepEqual(normalizeSegmentedScene({ max: "4", value: "2" }), { value: 2, max: 4 });
  assert.deepEqual(normalizeSegmentedScene({ max: 2.7, value: 1.9 }), { value: 1, max: 2 });
});

test("needsFix only matches a config setting whose field cannot render an input", () => {
  class DataField {
    static get hasFormSupport() {
      return this.prototype._toInput !== DataField.prototype._toInput;
    }
    _toInput() {
      throw new Error("not implemented");
    }
  }
  class SchemaField extends DataField {}
  class NumberField extends DataField {
    _toInput() {
      return {};
    }
  }

  assert.equal(needsFix({ config: true, type: new SchemaField() }, DataField), true);
  assert.equal(needsFix({ config: false, type: new SchemaField() }, DataField), false);
  assert.equal(needsFix({ config: true, type: new NumberField() }, DataField), false);
  assert.equal(needsFix({ config: true, type: Object }, DataField), false);
  assert.equal(needsFix(undefined, DataField), false);
});

test("rejects segment counts above the cap, including exponent notation", () => {
  assert.equal(exceedsLimit(normalizeSegmentedScene({ max: "1e9", value: 0 }), 20), true);
  assert.equal(exceedsLimit(normalizeSegmentedScene({ max: 21 }), 20), true);
  assert.equal(exceedsLimit(normalizeSegmentedScene({ max: 20 }), 20), false);
  assert.equal(exceedsLimit(normalizeSegmentedScene({ max: 0 }), 20), false);
  assert.equal(exceedsLimit(undefined, 20), false);
});

test("resolveLimit falls back to the default for invalid caps", () => {
  assert.equal(resolveLimit(50), 50);
  assert.equal(resolveLimit("7"), 7);
  for (const raw of [0, -3, null, undefined, "", "abc"]) assert.equal(resolveLimit(raw), DEFAULT_LIMIT, `raw=${String(raw)}`);
});
