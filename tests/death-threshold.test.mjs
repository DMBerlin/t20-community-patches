import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  applyDeathThreshold,
  deathThreshold,
  diagnoseNpcSource,
  diagnoseSamples
} from "../scripts/patches/death-threshold.mjs";
import { isSystemVersionAffected } from "../scripts/utils.mjs";

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
