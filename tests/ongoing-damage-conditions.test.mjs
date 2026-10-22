import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createKeyedQueue,
  diagnoseConditionData,
  diagnoseDotSource,
  legacyOngoingFormulas,
  selectOngoingConditions,
  skipDialogEvent,
  testPassed
} from "../scripts/patches/ongoing-damage-conditions.mjs";

/** CombatT20#_manageDOTEffects as it appears in tormenta20 1.6.5 (tab-indented class method). */
const SOURCE_165 = `async _manageDOTEffects(combatant, context) {
		if (!combatant.actor) return;
		if (!combatant.actor.isOwner) return;
		const ongoingDamage = combatant.actor.effects.filter((e) => e.isOngoingDamage);
		const rollData = combatant.actor.getRollData();
		for (const effect of ongoingDamage) {
			const messageData = {
				flavor: effect.name,
				speaker: ChatMessage.getSpeaker({ actor: combatant.actor }),
				rolls: []
			};
			for (const change of effect.system.changes) {
				if (change.key != "danoContinuo") continue;
				const roll = Roll.create(\`\${change.value}\`, rollData, {
					title: effect.name
				});
				await roll.evaluate();
				messageData.rolls.push(roll);
			}
			if (!messageData.rolls.length) continue;
			await ChatMessage.create(messageData);
		}
	}`;

const FIRE = { key: "dano", value: "1d6[fogo]", type: "custom" };
const BLEED = { key: "dano", value: "1d6[perda]", type: "custom" };
const OFFICIAL = { key: "danoContinuo", value: "1d6[fogo]", type: "custom" };
const effect = (id, statuses, changes, extra = {}) => ({ id, active: true, fromOtherSource: false, statuses, changes, ...extra });

test("legacyOngoingFormulas reads only the dano changes of an effect not rolled by the system", () => {
  assert.deepEqual(legacyOngoingFormulas([FIRE]), ["1d6[fogo]"]);
  assert.deepEqual(legacyOngoingFormulas([FIRE, OFFICIAL]), []);
  assert.deepEqual(legacyOngoingFormulas([]), []);
  assert.deepEqual(legacyOngoingFormulas(undefined), []);
  assert.deepEqual(legacyOngoingFormulas([{ key: "dano", value: "  " }]), []);
});

test("selectOngoingConditions picks active, own-source copies of Em Chamas and Sangrando", () => {
  assert.deepEqual(selectOngoingConditions([effect("a", ["emchamas"], [FIRE])]), [
    { status: "emchamas", effectId: "a", formulas: ["1d6[fogo]"], removeIds: ["a"] }
  ]);
  assert.deepEqual(selectOngoingConditions([effect("a", ["emchamas"], [FIRE], { active: false })]), []);
  assert.deepEqual(selectOngoingConditions([effect("a", ["emchamas"], [FIRE], { fromOtherSource: true })]), []);
});

test("selectOngoingConditions ignores usage effects that add damage to item rolls", () => {
  assert.deepEqual(selectOngoingConditions([effect("a", [], [FIRE]), effect("b", ["caido"], [FIRE])]), []);
});

test("selectOngoingConditions rolls a condition once and removes every copy", () => {
  const result = selectOngoingConditions([effect("a", ["sangrando"], [BLEED]), effect("b", ["sangrando"], [BLEED])]);
  assert.deepEqual(result, [{ status: "sangrando", effectId: "a", formulas: ["1d6[perda]"], removeIds: ["a", "b"] }]);
});

test("selectOngoingConditions leaves a condition to the system when any eligible copy uses danoContinuo", () => {
  for (const status of ["emchamas", "sangrando"]) {
    const legacy = effect("l", [status], [BLEED]);
    const official = effect("o", [status], [OFFICIAL]);
    assert.deepEqual(selectOngoingConditions([legacy, official]), []);
    assert.deepEqual(selectOngoingConditions([official, legacy]), []);
    assert.deepEqual(selectOngoingConditions([effect("m", [status], [FIRE, OFFICIAL])]), []);
  }
});

test("selectOngoingConditions still handles the legacy copy when the danoContinuo copy is not rolled by the system", () => {
  for (const extra of [{ active: false }, { fromOtherSource: true }]) {
    const result = selectOngoingConditions([effect("o", ["emchamas"], [OFFICIAL], extra), effect("l", ["emchamas"], [FIRE])]);
    assert.equal(result.length, 1);
    assert.equal(result[0].effectId, "l");
    assert.deepEqual(result[0].removeIds, ["o", "l"]);
  }
});

test("testPassed applies the DC with natural 20 and natural 1", () => {
  assert.equal(testPassed({ natural: 20, total: 5, dc: 15 }), true);
  assert.equal(testPassed({ natural: 1, total: 30, dc: 15 }), false);
  assert.equal(testPassed({ natural: 10, total: 15, dc: 15 }), true);
  assert.equal(testPassed({ natural: 10, total: 14, dc: 15 }), false);
});

test("skipDialogEvent follows the UsageConfig setting", () => {
  assert.deepEqual(skipDialogEvent("default"), { shiftKey: true });
  assert.deepEqual(skipDialogEvent("shift"), { shiftKey: false });
});

test("createKeyedQueue serializes turn starts of the same actor and rereads the conditions", async () => {
  const run = createKeyedQueue();
  const actor = { effects: [effect("s", ["sangrando"], [BLEED])] };
  const log = [];
  const turnStart = async () => {
    const [bleeding] = selectOngoingConditions(actor.effects);
    if (!bleeding) return log.push("nothing");
    log.push("test");
    await new Promise((r) => setTimeout(r, 5));
    actor.effects = actor.effects.filter((e) => !bleeding.removeIds.includes(e.id));
  };
  await Promise.all([run("Actor.a", turnStart), run("Actor.a", turnStart)]);
  assert.deepEqual(log, ["test", "nothing"]);
});

test("createKeyedQueue keeps going after a failed task and does not block other keys", async () => {
  const run = createKeyedQueue();
  const order = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const first = run("a", async () => {
    await gate;
    throw new Error("boom");
  });
  const second = run("a", () => order.push("a2"));
  await run("b", () => order.push("b"));
  assert.deepEqual(order, ["b"]);
  release();
  await assert.rejects(first, /boom/);
  await second;
  assert.deepEqual(order, ["b", "a2"]);
});

test("diagnoseDotSource recognizes only the 1.6.5 body", () => {
  assert.deepEqual(diagnoseDotSource(SOURCE_165).bug, "present");
  assert.equal(diagnoseDotSource(SOURCE_165).confidence, "low");
  assert.equal(diagnoseDotSource(SOURCE_165.replace(/\t/g, "  ")).bug, "present");
  const commented = SOURCE_165.replace("if (!combatant.actor) return;", '// key "dano"\n/* dano */ if (!combatant.actor) return;');
  assert.equal(diagnoseDotSource(commented).bug, "present");
  assert.equal(
    diagnoseDotSource('async _manageDOTEffects(combatant, context) { const k = "danoContinuo"; return game.tormenta20.dot(combatant, k); }').bug,
    "unknown"
  );
  const extended = SOURCE_165.replace(
    'if (change.key != "danoContinuo") continue;',
    'if (change.key != "danoContinuo" && change.key != "dano") continue;'
  );
  assert.equal(diagnoseDotSource(extended).bug, "unknown");
  assert.equal(diagnoseDotSource("function (...args) { return original.apply(this, args); }").bug, "unknown");
  assert.equal(diagnoseDotSource(undefined).bug, "unknown");
});

test("diagnoseConditionData needs both conditions to confirm the bug", () => {
  const code = diagnoseDotSource(SOURCE_165);
  assert.deepEqual(
    [diagnoseConditionData(code, { emchamas: [FIRE], sangrando: [BLEED] })].map((d) => [d.bug, d.confidence]),
    [["present", "high"]]
  );
  const onlyFire = diagnoseConditionData(code, { emchamas: [FIRE] });
  assert.deepEqual([onlyFire.bug, onlyFire.confidence], ["unknown", "low"]);
  const mixed = diagnoseConditionData(code, { emchamas: [FIRE], sangrando: [OFFICIAL] });
  assert.deepEqual([mixed.bug, mixed.confidence], ["unknown", "low"]);
  const fixed = diagnoseConditionData(code, { emchamas: [OFFICIAL], sangrando: [OFFICIAL] });
  assert.deepEqual([fixed.bug, fixed.confidence], ["fixed", "low"]);
  assert.equal(diagnoseConditionData(code, {}), undefined);
  assert.equal(diagnoseConditionData(diagnoseDotSource("x"), { emchamas: [FIRE], sangrando: [BLEED] }), undefined);
});
