import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  allowsBelowThreshold,
  applyDeathThreshold,
  deathThreshold,
  diagnoseNpcSource,
  diagnoseSamples,
  wrapDamageFloor
} from "../scripts/patches/death-threshold.mjs";
import { isSystemVersionAffected } from "../scripts/utils.mjs";
import { withNonlethalCall } from "../scripts/rules/nonlethal-damage.mjs";

test("deathThreshold uses -10 or minus half the maximum, whichever is lower", () => {
  const cases = [[8, -10], [12, -10], [19, -10], [20, -10], [21, -10], [22, -11], [30, -15], [0, -10], ["25", -12]];
  for (const [max, min] of cases) assert.equal(deathThreshold(max), min, `max ${max}`);
  assert.equal(deathThreshold(NaN), null);
  assert.equal(deathThreshold(undefined), null);
});

test("applyDeathThreshold overwrites pv.min of prepared data", () => {
  const system = { attributes: { pv: { max: 8, min: -4 } } };
  assert.equal(applyDeathThreshold(system), true);
  assert.equal(system.attributes.pv.min, -10);
});

test("applyDeathThreshold leaves data without HP or with an invalid maximum untouched", () => {
  assert.equal(applyDeathThreshold({ attributes: {} }), false);
  assert.equal(applyDeathThreshold(undefined), false);
  const system = { attributes: { pv: { max: "abc", min: 0 } } };
  assert.equal(applyDeathThreshold(system), false);
  assert.equal(system.attributes.pv.min, 0);
});

const NPC_165 = `prepareDerivedData() {
		const rollData = this.parent.getRollData();
		this.prepareAtributos({ rollData });
		AttributesFields.prepareDefense.call(this, rollData);
		this.prepareSkills({ rollData });

		AttributesFields.prepareEncumbrance.call(this, rollData);
		AttributesFields.prepareMovement.call(this);
		AttributesFields.prepareDamageResistances.call(this, rollData);
		this.attributes.pv.min = Math.floor(this.attributes.pv.max / 2) * -1;
	}`;
const BUGGY_LINE = "this.attributes.pv.min = Math.floor(this.attributes.pv.max / 2) * -1;";

test("diagnoseNpcSource recognizes the 1.6.5 method", () => {
  assert.deepEqual(
    { bug: diagnoseNpcSource(NPC_165).bug, confidence: diagnoseNpcSource(NPC_165).confidence },
    { bug: "present", confidence: "high" }
  );
});

test("diagnoseNpcSource never reports the bug for unrecognized or corrected code", () => {
  const variants = [
    NPC_165.replace(BUGGY_LINE, `// ${BUGGY_LINE}`),
    NPC_165.replace(BUGGY_LINE, `${BUGGY_LINE}\n\t\tthis.attributes.pv.min = Math.min(-10, this.attributes.pv.min);`),
    NPC_165.replace(BUGGY_LINE, `${BUGGY_LINE}\n\t\tthis.fixDeath();`),
    NPC_165.replace(BUGGY_LINE, "this.attributes.pv.min = Math.min(-10, -Math.floor(this.attributes.pv.max / 2));"),
    undefined
  ];
  for (const source of variants) {
    const { bug, confidence } = diagnoseNpcSource(source);
    assert.deepEqual({ bug, confidence }, { bug: "unknown", confidence: "low" });
  }
});

const SAMPLES = [
  ["character 8", 8], ["character 30", 30],
  ["character without class 12", 12], ["character without class 40", 40],
  ["character manual 12", 12], ["character manual 40", 40],
  ["npc 12", 12], ["npc 40", 40],
  ["simple 12", 12], ["simple 40", 40]
];
const LABELS = SAMPLES.map(([label]) => label);
const correct = () => SAMPLES.map(([label, max]) => ({ label, max, expectedMax: max, min: deathThreshold(max), prepared: true }));
const withSample = (label, changes) => correct().map((s) => (s.label === label ? { ...s, ...changes } : s));

test("diagnoseSamples reports the bug when a sample stops above the threshold", () => {
  const result = diagnoseSamples(withSample("npc 12", { min: -6 }), LABELS);
  assert.equal(result.bug, "present");
  assert.equal(result.confidence, "high");
  assert.match(result.evidence, /npc 12/);
});

test("diagnoseSamples reports a fix only when every path follows both regimes", () => {
  assert.deepEqual(
    (({ bug, confidence }) => ({ bug, confidence }))(diagnoseSamples(correct(), LABELS)),
    { bug: "fixed", confidence: "high" }
  );
});

test("diagnoseSamples catches partial fixes", () => {
  const fixedTen = correct().map((s) => ({ ...s, min: -10 }));
  assert.equal(diagnoseSamples(fixedTen, LABELS).bug, "present");
  assert.equal(diagnoseSamples(withSample("simple 12", { min: 0 }), LABELS).bug, "present");
  assert.equal(diagnoseSamples(withSample("character without class 12", { min: 0 }), LABELS).bug, "present");
});

test("diagnoseSamples learns nothing from invalid, missing or unexpected samples", () => {
  assert.equal(diagnoseSamples(withSample("simple 12", { min: 0, prepared: false }), LABELS), undefined);
  assert.equal(diagnoseSamples(withSample("character 8", { max: 10 }), LABELS), undefined);
  assert.equal(diagnoseSamples(correct().filter((s) => s.label !== "npc 40"), LABELS), undefined);
  assert.equal(diagnoseSamples(withSample("npc 12", { min: -12 }), LABELS), undefined);
});

test("covers the verified system version", () => {
  assert.equal(isSystemVersionAffected("1.6.5", patch.system.affected), true);
});

test("allowsBelowThreshold needs the unbounded floor and an actor covered by the rule", () => {
  assert.equal(allowsBelowThreshold({ floor: "unbounded", covered: true }), true);
  assert.equal(allowsBelowThreshold({ floor: "clamp", covered: true }), false);
  assert.equal(allowsBelowThreshold({ floor: "unbounded", covered: false }), false);
  assert.equal(allowsBelowThreshold({ floor: undefined, covered: true }), false);
});

/** Mimics the system: clamps synchronously, then awaits the update. */
function damageActor(value = 5) {
  const actor = { system: { attributes: { pv: { value, min: -10, max: 20 } } } };
  actor.applyDamage = async function (amount) {
    const pv = this.system.attributes.pv;
    const next = Math.max(pv.min, pv.value - amount);
    await null;
    pv.value = next;
    return { self: this, next };
  };
  return actor;
}

test("wrapDamageFloor lets damage pass the threshold and restores pv.min before any await", async () => {
  const actor = damageActor();
  const original = actor.applyDamage;
  actor.applyDamage = wrapDamageFloor(original, () => true);
  const promise = actor.applyDamage(30);
  assert.equal(actor.system.attributes.pv.min, -10);
  const result = await promise;
  assert.equal(actor.system.attributes.pv.value, -25);
  assert.equal(result.self, actor);
  assert.equal(result.next, -25);
});

test("wrapDamageFloor keeps the clamp when not allowed, when allows throws or without HP", async () => {
  const kept = damageActor();
  kept.applyDamage = wrapDamageFloor(kept.applyDamage, () => false);
  await kept.applyDamage(30);
  assert.equal(kept.system.attributes.pv.value, -10);

  const throwing = damageActor();
  throwing.applyDamage = wrapDamageFloor(throwing.applyDamage, () => { throw new Error("boom"); });
  const warn = console.warn;
  console.warn = () => {};
  try {
    await throwing.applyDamage(30);
  } finally {
    console.warn = warn;
  }
  assert.equal(throwing.system.attributes.pv.value, -10);

  let calls = 0;
  const noHp = { system: {} };
  const wrapped = wrapDamageFloor(function (...args) { calls++; return [this, ...args]; }, () => true);
  assert.deepEqual(wrapped.call(noHp, 1, 2), [noHp, 1, 2]);
  assert.equal(calls, 1);
});

test("wrapDamageFloor restores pv.min and rethrows a synchronous error", () => {
  const actor = { system: { attributes: { pv: { value: 5, min: -10 } } } };
  const wrapped = wrapDamageFloor(function () {
    assert.equal(this.system.attributes.pv.min, Number.NEGATIVE_INFINITY);
    throw new Error("sync");
  }, () => true);
  assert.throws(() => wrapped.call(actor), /sync/);
  assert.equal(actor.system.attributes.pv.min, -10);
});

test("wrapDamageFloor called through the nonlethal Proxy leaves the real pv.min untouched", async () => {
  const actor = damageActor();
  const original = actor.applyDamage;
  let allowed = true;
  actor.applyDamage = wrapDamageFloor(original, () => allowed);
  const cancelled = wrapDamageFloor(function () { return null; }, () => allowed);
  cancelled.call(withNonlethalCall(actor));
  assert.equal(actor.system.attributes.pv.min, -10);
  await actor.applyDamage.call(withNonlethalCall(actor), 3);
  assert.equal(actor.system.attributes.pv.min, -10);
  allowed = false;
  await actor.applyDamage(30);
  assert.equal(actor.system.attributes.pv.value, -10);
});
