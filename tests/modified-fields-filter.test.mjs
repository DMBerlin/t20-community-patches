import { test } from "node:test";
import assert from "node:assert/strict";
import patch, { PROBE_EFFECTS, collectModifiedFields, diagnoseFields } from "../scripts/patches/modified-fields-filter.mjs";

/** Tormenta20 1.6.5 ActorT20#modifiedFields (T20:6952-6962). */
function modifiedFields165() {
  return this.appliedEffects.reduce((acc, ef) => {
    if (ef.modifiesActor) {
      for (let ch of ef.changes) {
        if ([3, 4].includes(ch.value)) continue;
        if (!acc[ch.key]) acc[ch.key] = [];
        acc[ch.key].push({ label: ef.name, value: ch.value, type: ch.type });
      }
    }
    return acc;
  }, {});
}

const effects = [
  { modifiesActor: true, name: "A", changes: [{ key: "def", value: 3, type: "add" }, { key: "def", value: "4", type: "add" }] },
  { modifiesActor: true, name: "B", changes: [{ key: "def", value: 4, type: "add" }, { key: "condi", value: -5, type: "downgrade" }] },
  { modifiesActor: true, name: "C", changes: [{ key: "max", value: 2, type: "upgrade" }, { key: "x", value: 1, type: "override" }] },
  { modifiesActor: false, name: "D", changes: [{ key: "def", value: 9, type: "add" }] }
];

test("collectModifiedFields keeps 3 and 4, skips downgrade/upgrade and effects that do not modify the actor", () => {
  assert.deepEqual(collectModifiedFields(effects), {
    def: [
      { label: "A", value: 3, type: "add" },
      { label: "A", value: "4", type: "add" },
      { label: "B", value: 4, type: "add" }
    ],
    x: [{ label: "C", value: 1, type: "override" }]
  });
  assert.deepEqual(collectModifiedFields(undefined), {});
});

test("collectModifiedFields matches the system for every change the system handles correctly", () => {
  const plain = [{ modifiesActor: true, name: "A", changes: [{ key: "k", value: "2", type: "add" }, { key: "k", value: 5, type: "add" }] }];
  assert.deepEqual(collectModifiedFields(plain), modifiedFields165.call({ appliedEffects: plain }));
});

test("diagnoseFields: the 1.6.5 getter is present/high, the fixed getter fixed/high", () => {
  assert.deepEqual(
    [diagnoseFields(modifiedFields165.call({ appliedEffects: PROBE_EFFECTS })).bug, diagnoseFields(modifiedFields165.call({ appliedEffects: PROBE_EFFECTS })).confidence],
    ["present", "high"]
  );
  assert.deepEqual(diagnoseFields(collectModifiedFields(PROBE_EFFECTS)).bug, "fixed");
  assert.deepEqual(diagnoseFields(collectModifiedFields(PROBE_EFFECTS)).confidence, "high");
  assert.equal(diagnoseFields(undefined).bug, "unknown");
  assert.equal(diagnoseFields({}).bug, "unknown");
});

test("diagnoseFields: a partial fix is still present", () => {
  const fixed = collectModifiedFields(PROBE_EFFECTS);
  const without = (key) => Object.fromEntries(Object.entries(fixed).filter(([k]) => k !== key));
  assert.deepEqual(diagnoseFields(without("add4")), { bug: "present", confidence: "high", evidence: "add 4 hidden" });
  assert.deepEqual(diagnoseFields(without("add3")).evidence, "add 3 hidden");
  assert.deepEqual(diagnoseFields({ ...fixed, up: [{}] }).evidence, "upgrade listed");
  assert.deepEqual(diagnoseFields({ ...fixed, down: [{}] }).evidence, "downgrade listed");
});

test("apply replaces the getter of the document class and isNeeded reads the original", () => {
  class Base {}
  Object.defineProperty(Base.prototype, "modifiedFields", { get: modifiedFields165, configurable: true });
  class Actor extends Base {}
  globalThis.CONFIG = { Actor: { documentClass: Actor } };
  try {
    assert.equal(patch.isNeeded().bug, "present");
    patch.apply();
    const actor = Object.assign(new Actor(), { appliedEffects: effects });
    assert.equal(actor.modifiedFields.def.length, 3);
    assert.equal(actor.modifiedFields.condi, undefined);
    assert.equal(patch.isNeeded().bug, "present");
  } finally {
    delete globalThis.CONFIG;
  }
});
