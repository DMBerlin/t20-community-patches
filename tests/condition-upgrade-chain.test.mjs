import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UPGRADE_CHAIN, diagnose, hasActiveStatus, hasNewerDuplicate, upgradeOf
} from "../scripts/features/condition-upgrade-chain/domain.mjs";
import feature from "../scripts/features/condition-upgrade-chain/index.mjs";
import { createFakeContext, createFakePlatform, createProbeContext } from "./support/fake-platform.mjs";

const KNOWN = `get isSuppressedByUpgrade() {
		const actor = this.parent.actor;
		const hasUpgrade = !!this.status.upgrade; // stored link
		return hasUpgrade && actor.statuses.has(this.status.upgrade);
	}`;

const statusSet = (...ids) => Object.assign(new Set(ids), { first: () => ids[0] });

class Collection extends Map {
  *[Symbol.iterator]() {
    yield* this.values();
  }
  some(fn) {
    for (const value of this.values()) if (fn(value)) return true;
    return false;
  }
}

/** BaseEffect and ActiveEffectT20 as in tormenta20 1.6.6 (T20:16569-16653, 16897-16901), plus the core loop. */
function makeSystem() {
  class BaseEffect {
    constructor(parent, status) {
      this.parent = parent;
      this.status = status;
    }
    get isSuppressed() {
      let suppressed = false;
      if (this.status) {
        if (!suppressed) suppressed = this.isSuppressedByInheritance;
        if (!suppressed) suppressed = this.isSuppressedByDuplicated;
        if (!suppressed) suppressed = this.isSuppressedByUpgrade;
        if (!suppressed) suppressed = this.isSuppressedByImunity;
      }
      return suppressed;
    }
    get isSuppressedByInheritance() {
      if (this.parent.origin) {
        const origin = this.parent.parent.effects.get(this.parent.origin.split(".").pop());
        if (origin && origin.system.status) return !origin.active;
      }
      return false;
    }
    get isSuppressedByDuplicated() {
      const statusId = this.parent.statuses.first();
      return this.parent.actor.effects.some(
        (ef) => ef.id !== this.parent.id && ef.statuses.has(statusId) && ef._stats.createdTime > this.parent._stats.createdTime
      );
    }
    get isSuppressedByUpgrade() {
      const actor = this.parent.actor;
      const hasUpgrade = !!this.status.upgrade;
      return hasUpgrade && actor.statuses.has(this.status.upgrade);
    }
    get isSuppressedByImunity() {
      return this.parent.actor.immune.has(this.parent.statuses.first());
    }
  }

  class Effect {
    constructor(actor, { id, status, upgrade = "", origin, time, disabled = false, condition = true }) {
      Object.assign(this, { id, parent: actor, actor, origin, disabled, _stats: { createdTime: time } });
      this.statuses = statusSet(status);
      this.system = new BaseEffect(this, condition ? { upgrade } : null);
      this._suppressed = null;
    }
    get isSuppressed() {
      if (this._suppressed) return this._suppressed;
      this._suppressed = this.system.isSuppressed;
      return this._suppressed;
    }
    get active() {
      return !this.disabled && !this.isSuppressed;
    }
  }

  class Actor {
    constructor() {
      this.effects = new Collection();
      this.statuses = new Set();
      this.immune = new Set();
      this.time = 0;
    }
    add(status, options = {}) {
      const id = options.id ?? `${status}${this.effects.size}`;
      const effect = new Effect(this, { id, status, time: ++this.time, ...options });
      this.effects.set(id, effect);
      return effect;
    }
    /** A condition and its children, as _createChildStatus does (T20:16791-16805). */
    condition(status, children = [], options = {}) {
      const parent = this.add(status, options);
      for (const child of children) this.add(child, { origin: `Actor.a.ActiveEffect.${parent.id}` });
      return parent;
    }
    *allApplicableEffects() {
      yield* this.effects.values();
    }
    /** Core applyActiveEffects("initial"): statuses are filled while the effects are walked in creation order. */
    prepare() {
      for (const effect of this.effects.values()) effect._suppressed = null;
      this.statuses.clear();
      const applied = [];
      for (const effect of this.allApplicableEffects()) {
        if (!effect.active) continue;
        applied.push(effect.id);
        for (const id of effect.statuses) this.statuses.add(id);
      }
      return applied;
    }
  }
  return { BaseEffect, Actor };
}

function installed() {
  const system = makeSystem();
  const platform = createFakePlatform({ config: { ActiveEffect: { dataModels: { base: system.BaseEffect } } } });
  const ctx = createFakeContext(feature, platform);
  feature.install(ctx);
  return { ...system, platform };
}

/** Effects with the status that the core loop applied (not a later read, when actor.statuses is already complete). */
const activeOf = (actor, status) => {
  const applied = new Set(actor.prepare());
  return [...actor.effects.values()].filter((e) => e.statuses.has(status) && applied.has(e.id));
};

test("upgradeOf: the stored link wins; an empty link falls back to the book's chain", () => {
  assert.equal(upgradeOf({ upgrade: "" }, "fatigado"), "exausto");
  assert.equal(upgradeOf({ upgrade: "x" }, "fatigado"), "x");
  assert.equal(upgradeOf(null, "fatigado"), "");
  assert.equal(upgradeOf({ upgrade: "" }, "cego"), "");
  assert.equal(upgradeOf({ upgrade: "" }, "constructor"), "");
  assert.equal(upgradeOf({ upgrade: "" }, undefined), "");
});

test("UPGRADE_CHAIN has the six links of the book", () => {
  assert.deepEqual({ ...UPGRADE_CHAIN }, {
    abalado: "apavorado", debilitado: "inconsciente", exausto: "inconsciente",
    fatigado: "exausto", fraco: "debilitado", frustrado: "esmorecido"
  });
});

test("hasActiveStatus ignores the effect itself and inactive effects, and accepts a generator", () => {
  const self = { statuses: new Set(["exausto"]), active: true };
  const inactive = { statuses: new Set(["exausto"]), active: false };
  const active = { statuses: new Set(["exausto"]), active: true };
  assert.equal(hasActiveStatus([self], "exausto", self), false);
  assert.equal(hasActiveStatus([self, inactive], "exausto", self), false);
  assert.equal(hasActiveStatus((function* () {
    yield inactive;
    yield active;
  })(), "exausto", self), true);
});

test("hasNewerDuplicate ignores older effects, itself and newer effects suppressed by inheritance", () => {
  const make = (id, time) => ({ id, statuses: new Set(["vulneravel"]), _stats: { createdTime: time } });
  const self = make("a", 2);
  const older = make("b", 1);
  const newer = make("c", 3);
  assert.equal(hasNewerDuplicate([self, older], self, "vulneravel", () => false), false);
  assert.equal(hasNewerDuplicate([self, newer], self, "vulneravel", () => false), true);
  assert.equal(hasNewerDuplicate([self, newer], self, "vulneravel", (e) => e === newer), false);
});

test("diagnose: the known getter is present/low; anything else is unknown/low", () => {
  assert.deepEqual(
    { ...diagnose(KNOWN), evidence: undefined },
    { bug: "present", confidence: "low", evidence: undefined }
  );
  assert.equal(diagnose("get isSuppressedByUpgrade() { return false; }").bug, "unknown");
  assert.deepEqual({ ...diagnose(undefined), evidence: undefined }, { bug: "unknown", confidence: "low", evidence: undefined });
});

test("isNeeded reads BaseEffect#isSuppressedByUpgrade, which is listed in sources", () => {
  assert.ok(feature.sources.includes("BaseEffect#isSuppressedByUpgrade"));
  const ctx = createProbeContext(feature, { "BaseEffect#isSuppressedByUpgrade": KNOWN });
  assert.equal(feature.isNeeded(ctx).bug, "present");
});

test("without the patch, Fatigued created before Exhausted stays active (the bug)", () => {
  const { Actor } = makeSystem();
  const actor = new Actor();
  actor.condition("fatigado", ["fraco", "vulneravel"], { upgrade: "exausto" });
  actor.condition("exausto", ["debilitado", "lento", "vulneravel"]);
  assert.equal(activeOf(actor, "fraco").length, 1);
});

for (const order of ["fatigado-first", "exausto-first"]) {
  test(`Fatigued + Exhausted (${order}): Fatigued, Weakened and its Vulnerable are suppressed`, () => {
    const { Actor } = installed();
    const actor = new Actor();
    const add = {
      fatigado: () => actor.condition("fatigado", ["fraco", "vulneravel"]),
      exausto: () => actor.condition("exausto", ["debilitado", "lento", "vulneravel"])
    };
    const [first, second] = order === "fatigado-first" ? ["fatigado", "exausto"] : ["exausto", "fatigado"];
    add[first]();
    add[second]();
      assert.deepEqual(["fatigado", "fraco"].map((s) => activeOf(actor, s).length), [0, 0]);
    assert.deepEqual(["exausto", "debilitado", "lento"].map((s) => activeOf(actor, s).length), [1, 1, 1]);
    const vulnerable = activeOf(actor, "vulneravel");
    assert.equal(vulnerable.length, 1);
    assert.equal(actor.effects.get(vulnerable[0].origin.split(".").pop()).statuses.first(), "exausto");
  });

  test(`Fatigued + immune Exhausted (${order}): Fatigued keeps exactly one Vulnerable`, () => {
    const { Actor } = installed();
    const actor = new Actor();
    actor.immune.add("exausto");
    const add = {
      fatigado: () => actor.condition("fatigado", ["fraco", "vulneravel"]),
      exausto: () => actor.condition("exausto", ["debilitado", "lento", "vulneravel"])
    };
    const [first, second] = order === "fatigado-first" ? ["fatigado", "exausto"] : ["exausto", "fatigado"];
    add[first]();
    add[second]();
      assert.deepEqual(["fatigado", "fraco", "exausto", "debilitado"].map((s) => activeOf(actor, s).length), [1, 1, 0, 0]);
    const vulnerable = activeOf(actor, "vulneravel");
    assert.equal(vulnerable.length, 1);
    assert.equal(actor.effects.get(vulnerable[0].origin.split(".").pop()).statuses.first(), "fatigado");
  });
}

test("every pair of the chain suppresses the milder condition in both orders", () => {
  for (const [mild, severe] of Object.entries(UPGRADE_CHAIN)) {
    for (const reversed of [false, true]) {
      const { Actor } = installed();
      const actor = new Actor();
      for (const status of reversed ? [severe, mild] : [mild, severe]) actor.add(status);
          assert.equal(activeOf(actor, mild).length, 0, `${mild} with ${severe}`);
      assert.equal(activeOf(actor, severe).length, 1, `${severe} with ${mild}`);
    }
  }
});

test("removing or disabling the upgrade reactivates the milder condition; only the direct link counts", () => {
  const { Actor } = installed();
  const actor = new Actor();
  actor.add("fatigado");
  const exausto = actor.add("exausto");
  assert.equal(activeOf(actor, "fatigado").length, 0);
  exausto.disabled = true;
  assert.equal(activeOf(actor, "fatigado").length, 1);
  actor.effects.delete(exausto.id);
  actor.add("inconsciente");
  assert.equal(activeOf(actor, "fatigado").length, 1);
});

test("a stored link wins over the book's chain", () => {
  const { Actor } = installed();
  const actor = new Actor();
  actor.add("fatigado", { upgrade: "inconsciente" });
  actor.add("exausto");
  assert.equal(activeOf(actor, "fatigado").length, 1);
  actor.add("inconsciente");
  assert.equal(activeOf(actor, "fatigado").length, 0);
});

test("a cycle in edited links does not overflow the stack", () => {
  const { Actor } = installed();
  const actor = new Actor();
  actor.add("a", { upgrade: "b" });
  actor.add("b", { upgrade: "a" });
  assert.doesNotThrow(() => actor.prepare());
});

test("duplicates outside the chain keep the system's rule", () => {
  const { Actor } = installed();
  const actor = new Actor();
  actor.add("cego");
  actor.add("cego", { disabled: true });
  assert.equal(activeOf(actor, "cego").length, 0);
});

test("an error in the new getter falls back to the original one", () => {
  const { Actor, platform } = installed();
  const actor = new Actor();
  const fatigado = actor.add("fatigado", { upgrade: "exausto" });
  actor.allApplicableEffects = () => {
    throw new Error("boom");
  };
  actor.statuses.add("exausto");
  assert.equal(fatigado.system.isSuppressedByUpgrade, true);
  assert.ok(platform.logs.some((entry) => JSON.stringify(entry).includes("upgrade chain")));
});

test("install throws when a getter is missing", () => {
  class Bare {
    get isSuppressedByUpgrade() {
      return false;
    }
  }
  const platform = createFakePlatform({ config: { ActiveEffect: { dataModels: { base: Bare } } } });
  assert.throws(() => feature.install(createFakeContext(feature, platform)), /isSuppressedByDuplicated/);
  const empty = createFakePlatform({ config: {} });
  assert.throws(() => feature.install(createFakeContext(feature, empty)), /isSuppressedByUpgrade/);
});
