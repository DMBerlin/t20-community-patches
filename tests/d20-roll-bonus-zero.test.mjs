import { test } from "node:test";
import assert from "node:assert/strict";
import patch from "../scripts/features/d20-roll-bonus-zero/index.mjs";
import {
  GET_ATTACK_TO_HIT,
  diagnose,
  isZeroPart,
  stripMissingBonus,
  withoutZeroParts
} from "../scripts/features/d20-roll-bonus-zero/domain.mjs";
import { createFakeContext, createFakePlatform } from "./support/fake-platform.mjs";

// Tormenta20 1.6.6, T20:4002-4013 and T20:6972-6978 (excerpts).
const D20_ROLL_1_6_6 = `async function d20Roll({ parts = [], data = {}, event = {}, ...options } = {}) {
	parts = parts.concat(["@bonus"]);
	let adv = 0;
	simplifyRollFormula(parts.map((p) => p.toString().replace(/^\\+|\\s/g, "")).filterJoin("+"), data);
	let roll = new Roll(parts.join("+"), data);
	return roll;
}`;
const GET_ATTACK_TO_HIT_1_6_6 = `getAttackToHit() {
		const itemData = this.system;
		const rollData = this.getRollData();
		const roll = itemData.rolls.find((r) => r.type === "ataque");
		if (!this.hasAttack || !itemData || roll.parts.length < 2) return;
		const parts = roll.parts.map((p) => p[0] ?? p); // ;
		parts.shift();
		return { rollData, parts };
	}`;

test("a trailing @bonus is dropped only when the data has no bonus", () => {
  assert.equal(stripMissingBonus("1d20+13+@bonus", undefined), "1d20+13");
  assert.equal(stripMissingBonus("1d20 + @skill + @bonus ", null), "1d20 + @skill");
  assert.equal(stripMissingBonus("1d20+13+@bonus", 2), "1d20+13+@bonus");
  assert.equal(stripMissingBonus("1d20+13+@bonus", 0), "1d20+13+@bonus");
  assert.equal(stripMissingBonus("1d20+@bonus+2", undefined), "1d20+@bonus+2");
  assert.equal(stripMissingBonus("1d20+@bonusExtra", undefined), "1d20+@bonusExtra");
  assert.equal(stripMissingBonus("+@bonus", undefined), "+@bonus");
  assert.equal(stripMissingBonus("2d20kh+@skill+@bonus", undefined), "2d20kh+@skill");
  assert.equal(stripMissingBonus("(1d20+2)[fogo] + @bonus", undefined), "(1d20+2)[fogo]");
  assert.equal(stripMissingBonus("{1d20, 10}kh +@bonus", undefined), "{1d20, 10}kh");
  // A unary sign is not a sum: dropping it would leave an operator without an operand.
  for (const formula of ["1d20 * +@bonus", "1d20 + +@bonus", "1d20 - +@bonus", "1d20+(+@bonus)"]) {
    assert.equal(stripMissingBonus(formula, undefined), formula, formula);
  }
  assert.equal(stripMissingBonus(42, undefined), 42);
});

test("zero parts are the number zero only", () => {
  for (const part of ["0", "+0", "-0", " 0 ", 0, "0.0"]) assert.equal(isZeroPart(part), true, String(part));
  for (const part of ["@skill", "10", "1d0", "", " ", 1, null, undefined]) assert.equal(isZeroPart(part), false, String(part));
});

test("getAttackToHit's result loses its zero parts and keeps the rest", () => {
  const rollData = { skill: 13 };
  const result = withoutZeroParts({ rollData, parts: ["@skill", "0", "4", 0] });
  assert.deepEqual(result.parts, ["@skill", "4"]);
  assert.equal(result.rollData, rollData);
  const clean = { rollData, parts: ["@skill", "1"] };
  assert.equal(withoutZeroParts(clean), clean);
  assert.equal(withoutZeroParts(undefined), undefined);
});

test("diagnosis: 1.6.6 is present/high, a fix is fixed/low, anything else unknown", () => {
  assert.deepEqual(
    { ...diagnose(D20_ROLL_1_6_6, GET_ATTACK_TO_HIT_1_6_6), evidence: undefined },
    { bug: "present", confidence: "high", evidence: undefined }
  );
  const fixedD20 = D20_ROLL_1_6_6.replace("let adv = 0;", "if (!data.bonus) parts.pop();\n\tlet adv = 0;");
  const fixedAttack = GET_ATTACK_TO_HIT_1_6_6.replace("parts.shift();", "parts.shift();\n\t\tparts = parts.filter((p) => p !== \"0\");");
  assert.equal(diagnose(fixedD20, fixedAttack).bug, "fixed");
  assert.equal(diagnose(fixedD20, fixedAttack).confidence, "low");
  assert.equal(diagnose(fixedD20, GET_ATTACK_TO_HIT_1_6_6).bug, "unknown");
  assert.equal(diagnose("function wrapper(...a) { return other(...a); }", GET_ATTACK_TO_HIT_1_6_6).bug, "unknown");
  assert.equal(diagnose(null, GET_ATTACK_TO_HIT_1_6_6).bug, "unknown");
  // A comment never counts as the fix.
  assert.equal(diagnose(D20_ROLL_1_6_6.replace("let adv", "// parts.pop()\n\tlet adv"), GET_ATTACK_TO_HIT_1_6_6).bug, "present");
});

test("isNeeded reads d20Roll from tormenta20.dice and getAttackToHit by label", () => {
  const d20Roll = () => {};
  const platform = createFakePlatform({
    t20: { dice: { d20Roll } },
    sourceOf: (fn) => (fn === d20Roll ? D20_ROLL_1_6_6 : null),
    sources: { [GET_ATTACK_TO_HIT]: GET_ATTACK_TO_HIT_1_6_6 }
  });
  assert.equal(patch.isNeeded(createFakeContext(patch, platform)).bug, "present");
  assert.equal(patch.isNeeded(createFakeContext(patch, createFakePlatform({ t20: {} }))).bug, "unknown");
});

test("the wrappers drop the null parts and preserve this, arguments and results", () => {
  const seen = [];
  class Roll {
    static parse(formula, data, extra) {
      seen.push({ self: this, formula, data, extra });
      return [formula];
    }
  }
  class RollT20 extends Roll {}
  const rollData = { skill: 13 };
  class Item {
    getAttackToHit() {
      return this.attack;
    }
  }
  const platform = createFakePlatform({ dice: { Roll }, classes: { item: Item } });
  patch.install(createFakeContext(patch, platform));

  const data = { skill: 13 };
  assert.deepEqual(RollT20.parse("1d20+@skill+@bonus", data, "x"), ["1d20+@skill"]);
  assert.equal(seen[0].self, RollT20);
  assert.equal(seen[0].data, data);
  assert.equal(seen[0].extra, "x");
  assert.deepEqual(Roll.parse("1d20+@bonus", { bonus: 2 }), ["1d20+@bonus"]);
  assert.deepEqual(Roll.parse("1d20+@bonus"), ["1d20"]);

  const item = new Item();
  item.attack = { rollData, parts: ["@skill", "0", "4"] };
  assert.deepEqual(item.getAttackToHit(), { rollData, parts: ["@skill", "4"] });
  item.attack = undefined;
  assert.equal(item.getAttackToHit(), undefined);
});

test("install fails early without the system's methods", () => {
  const platform = createFakePlatform({ dice: { Roll: class {} }, classes: { item: class { getAttackToHit() {} } } });
  assert.throws(() => patch.install(createFakeContext(patch, platform)), /Roll\.parse/);
  const noItem = createFakePlatform({ dice: { Roll: class { static parse() {} } }, classes: { item: class {} } });
  assert.throws(() => patch.install(createFakeContext(patch, noItem)), /getAttackToHit/);
});
