import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  OUTROS_KEY,
  collectProneCandidates,
  diagnoseProneChanges,
  isBuggyProneChange,
  isProneDefenseChange,
  isSameChange,
  pickProneChange,
  planProneChange,
  toAdditive
} from "../scripts/patches/prone-defense.mjs";

const change = (type, value, phase = "initial", extra = {}) => ({ key: OUTROS_KEY, type, value, phase, priority: 20, ...extra });

function effect(changes, { active = true, statuses = ["caido"] } = {}) {
  return {
    active,
    statuses: new Set(statuses),
    system: { changes },
    shouldApplyChange: (c, o) => c.phase === o?.phase
  };
}

/**
 * Mirrors Actor#applyActiveEffects("initial") + NumberField downgrade/add, with the patch plan in between.
 * Returns the final value of defesa.outros.
 */
function simulate(effects, outros = 0) {
  const candidates = collectProneCandidates(effects);
  const copies = [];
  for (const ef of effects) {
    if (!ef.active) continue;
    for (const c of ef.system.changes) {
      if (!ef.shouldApplyChange(c, { phase: "initial" })) continue;
      copies.push({ ...structuredClone(c), effect: ef });
    }
  }
  copies.sort((a, b) => a.priority - b.priority);
  let counted = false;
  let value = outros;
  for (const c of copies) {
    const plan = planProneChange({ effect: c.effect, change: c, eligible: c.phase === "initial", alreadyCounted: counted }, candidates);
    if (plan === "skip") continue;
    if (plan === "add" || plan === "count") counted = true;
    const next = plan === "add" ? toAdditive(c) : c;
    const delta = Number(next.value);
    value = next.type === "add" ? value + delta : Math.min(value, delta);
  }
  return value;
}

test("recognizes the system's Caído Defense change", () => {
  assert.ok(isBuggyProneChange(change("downgrade", -5)));
  assert.ok(isBuggyProneChange(change("downgrade", "-5")));
  assert.ok(!isBuggyProneChange(change("add", -5)));
  assert.ok(!isBuggyProneChange(change("downgrade", 5)));
  assert.ok(!isBuggyProneChange(change("downgrade", "")));
  assert.ok(!isBuggyProneChange(change("downgrade", null)));
  assert.ok(!isBuggyProneChange({ key: "system.attributes.defesa.condi", type: "downgrade", value: -5 }));
});

test("candidates include downgrade and add penalties, not overrides or bonuses", () => {
  assert.ok(isProneDefenseChange(change("downgrade", -5)));
  assert.ok(isProneDefenseChange(change("add", -5)));
  assert.ok(!isProneDefenseChange(change("add", 5)));
  assert.ok(!isProneDefenseChange(change("override", -5)));
  assert.ok(!isProneDefenseChange({ key: "system.attributes.defesa.condi", type: "add", value: -5 }));
});

test("picks the most severe penalty, the first one on ties", () => {
  const a = {}, b = {};
  assert.equal(pickProneChange([{ effect: a, index: 0, value: -5 }, { effect: b, index: 0, value: -7 }]).effect, b);
  assert.equal(pickProneChange([{ effect: a, index: 0, value: -5 }, { effect: a, index: 1, value: -5 }]).index, 0);
  assert.equal(pickProneChange([]), null);
});

test("compares a cloned change by content", () => {
  assert.ok(isSameChange(change("downgrade", -5), change("downgrade", "-5")));
  assert.ok(!isSameChange(change("downgrade", -5), change("add", -5)));
  assert.ok(!isSameChange(change("downgrade", -5), change("downgrade", -5, "final")));
  assert.ok(!isSameChange(undefined, change("downgrade", -5)));
});

test("collects only active Caído effects in the initial phase", () => {
  const candidates = collectProneCandidates([
    effect([change("downgrade", -5)], { active: false }),
    effect([change("downgrade", -5)], { statuses: ["desprevenido"] }),
    effect([change("downgrade", -7, "final"), change("downgrade", -5), change("add", -5)])
  ]);
  assert.deepEqual(candidates.map((c) => [c.index, c.value, c.buggy]), [[1, -5, true], [2, -5, false]]);
});

test("Caído subtracts exactly 5 whatever the manual Outros bonus", () => {
  for (const outros of [3, 0, -2, -6]) {
    assert.equal(simulate([effect([change("downgrade", -5)])], outros), outros - 5);
  }
});

test("a legacy and a fixed copy count once, in either order", () => {
  const legacy = effect([change("downgrade", -5)]);
  const fixed = effect([change("add", -5)]);
  assert.equal(simulate([legacy, fixed]), -5);
  assert.equal(simulate([fixed, legacy]), -5);
  const candidates = collectProneCandidates([legacy, fixed]);
  const legacyChange = { ...legacy.system.changes[0], effect: legacy };
  const fixedChange = { ...fixed.system.changes[0], effect: fixed };
  assert.equal(planProneChange({ effect: legacy, change: legacyChange, eligible: true }, candidates), "add");
  assert.equal(planProneChange({ effect: fixed, change: fixedChange, eligible: true }, candidates), "skip");
  const reversed = collectProneCandidates([fixed, legacy]);
  assert.equal(planProneChange({ effect: fixed, change: fixedChange, eligible: true }, reversed), "count");
  assert.equal(planProneChange({ effect: legacy, change: legacyChange, eligible: true }, reversed), "skip");
});

test("two legacy copies in different effects do not stack", () => {
  assert.equal(simulate([effect([change("downgrade", -5)]), effect([change("downgrade", -5)])], 3), -2);
});

test("several penalties inside one effect: only the most severe counts", () => {
  assert.equal(simulate([effect([change("downgrade", -5), change("add", -5)])]), -5);
  assert.equal(simulate([effect([change("downgrade", -5), change("downgrade", -7)])]), -7);
  assert.equal(simulate([effect([change("downgrade", -5), change("downgrade", -5)])]), -5);
});

test("identical changes in the same effect: the second one is skipped once counted", () => {
  const ef = effect([change("downgrade", -5), change("downgrade", -5)]);
  const candidates = collectProneCandidates([ef]);
  const current = { ...ef.system.changes[1], effect: ef };
  assert.equal(planProneChange({ effect: ef, change: current, eligible: true, alreadyCounted: false }, candidates), "add");
  assert.equal(planProneChange({ effect: ef, change: current, eligible: true, alreadyCounted: true }, candidates), "skip");
});

test("a final-phase copy neither competes nor is changed", () => {
  const initial = effect([change("downgrade", -5)]);
  const final = effect([change("downgrade", -7, "final")]);
  const candidates = collectProneCandidates([initial, final]);
  assert.equal(planProneChange({ effect: initial, change: { ...initial.system.changes[0], effect: initial }, eligible: true }, candidates), "add");
  assert.equal(planProneChange({ effect: final, change: { ...final.system.changes[0], effect: final }, eligible: false }, candidates), "keep");
});

test("keeps the system behavior when no copy has the bug", () => {
  const a = effect([change("add", -5)]);
  const b = effect([change("add", -5)]);
  const candidates = collectProneCandidates([a, b]);
  for (const ef of [a, b]) {
    assert.equal(planProneChange({ effect: ef, change: { ...ef.system.changes[0], effect: ef }, eligible: true }, candidates), "keep");
  }
});

test("a custom, more severe Caído penalty wins over the stock one", () => {
  assert.equal(simulate([effect([change("downgrade", -5)]), effect([change("downgrade", -7)])], 2), -5);
});

test("toAdditive copies the change without touching the original", () => {
  const ef = {};
  const original = change("downgrade", -5, "initial", { effect: ef });
  const copy = toAdditive(original);
  assert.equal(copy.type, "add");
  assert.equal(copy.effect, ef);
  assert.equal(copy.value, -5);
  assert.equal(copy.priority, 20);
  assert.equal(original.type, "downgrade");
});

test("diagnoses the shipped Caído data", () => {
  const shipped = [
    { key: "system.pericias.luta.condi", value: -5, type: "downgrade" },
    { key: OUTROS_KEY, value: -5, type: "downgrade" },
    { key: "system.attributes.movement.*.base", value: 1.5, type: "downgrade" }
  ];
  assert.deepEqual(
    [diagnoseProneChanges(shipped).bug, diagnoseProneChanges(shipped).confidence],
    ["present", "high"]
  );
  const fixed = diagnoseProneChanges([{ key: OUTROS_KEY, value: -5, type: "add" }]);
  assert.deepEqual([fixed.bug, fixed.confidence], ["fixed", "low"]);
  assert.equal(diagnoseProneChanges([shipped[0]]).bug, "unknown");
  assert.equal(diagnoseProneChanges(undefined).bug, "unknown");
});

/* Wrapper integration: a minimal core with Actor#applyActiveEffects and NumberField add/downgrade. */
let throwOnce = false;
class FakeActor {
  constructor(outros, effects) {
    this.system = { attributes: { defesa: { outros } } };
    this.effects = effects;
    this.overrides = {};
  }
  allApplicableEffects() {
    return this.effects[Symbol.iterator]();
  }
  applyActiveEffects(phase) {
    const copies = [];
    for (const ef of this.effects) {
      if (!ef.active) continue;
      for (const c of ef.system.changes) if (ef.shouldApplyChange(c, { phase })) copies.push({ ...structuredClone(c), effect: ef });
    }
    copies.sort((a, b) => a.priority - b.priority);
    for (const c of copies) {
      try {
        CONFIG.ActiveEffect.documentClass.applyChange(this, c, {});
      } catch {
        /* the core would surface the error; the pass continues */
      }
    }
  }
}
class FakeEffect {
  static applyChange(target, c, options) {
    if (throwOnce) {
      throwOnce = false;
      throw new Error("boom");
    }
    const defesa = target.system.attributes.defesa;
    const value = c.type === "add" ? defesa.outros + Number(c.value) : Math.min(defesa.outros, Number(c.value));
    if (options?.modifyTarget !== false) defesa.outros = value;
    return { [c.key]: value };
  }
}
globalThis.foundry = { documents: { Actor: FakeActor } };
globalThis.CONFIG = { Actor: { documentClass: FakeActor }, ActiveEffect: { documentClass: FakeEffect } };
patch.apply();

test("wrapper: the preparation pass adds -5 once, even with identical changes in one effect", () => {
  const actor = new FakeActor(3, [effect([change("downgrade", -5), change("downgrade", -5)])]);
  actor.applyActiveEffects("initial");
  assert.equal(actor.system.attributes.defesa.outros, -2);
  const again = new FakeActor(3, actor.effects);
  again.applyActiveEffects("initial");
  assert.equal(again.system.attributes.defesa.outros, -2);
});

test("wrapper: a query does not consume the penalty of a later application", () => {
  const ef = effect([change("downgrade", -5)]);
  const actor = new FakeActor(3, [ef]);
  const c = { ...ef.system.changes[0], effect: ef };
  assert.deepEqual(FakeEffect.applyChange(actor, c, { modifyTarget: false }), { [OUTROS_KEY]: -2 });
  assert.equal(actor.system.attributes.defesa.outros, 3);
  FakeEffect.applyChange(actor, { ...c }, {});
  assert.equal(actor.system.attributes.defesa.outros, -2);
});

test("wrapper: a failed application does not mark the penalty as counted", () => {
  const actor = new FakeActor(3, [effect([change("downgrade", -5), change("downgrade", -5)])]);
  throwOnce = true;
  actor.applyActiveEffects("initial");
  assert.equal(actor.system.attributes.defesa.outros, -2);
});
