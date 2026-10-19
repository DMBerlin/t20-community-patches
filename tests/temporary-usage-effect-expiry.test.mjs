import { test } from "node:test";
import assert from "node:assert/strict";
import patch, { diagnose, findDescriptor, isTrackableUsageEffect } from "../scripts/patches/temporary-usage-effect-expiry.mjs";

const usageEffect = (overrides = {}) => ({
  system: { onuse: true },
  parent: { documentName: "Actor" },
  persisted: true,
  inCompendium: false,
  disabled: false,
  isSuppressed: false,
  start: { time: 0 },
  isTemporary: true,
  ...overrides
});

// Mirrors core v14 ActiveEffect#isExpiryTrackable and ActiveEffectT20#active (tormenta20 1.6.5).
class CoreEffect {
  constructor(data) { Object.assign(this, data); }
  get isEmbedded() { return !!this.parent; }
  get isUsage() { return false; }
  get active() { return !this.disabled && !this.isSuppressed; }
  get isExpiryTrackable() {
    return this.persisted && !this.inCompendium && this.isEmbedded && this.active && !!this.start && this.isTemporary;
  }
}
class SystemEffect extends CoreEffect {
  get isUsage() { return this.system.onuse; }
  get active() { return !this.disabled && !this.isSuppressed && !this.isUsage; }
}

test("tracks enabled temporary usage effects on actors", () => {
  assert.equal(isTrackableUsageEffect(usageEffect()), true);
});

test("does not track usage effects that are templates, disabled, suppressed or not temporary", () => {
  for (const overrides of [
    { parent: { documentName: "Item" } },
    { parent: null },
    { disabled: true },
    { isSuppressed: true },
    { start: null },
    { isTemporary: false },
    { system: { onuse: false } },
    { persisted: false },
    { inCompendium: true }
  ]) {
    assert.equal(isTrackableUsageEffect(usageEffect(overrides)), false, JSON.stringify(overrides));
  }
  assert.equal(isTrackableUsageEffect(null), false);
});

test("finds a getter on an ancestor prototype", () => {
  assert.equal(typeof findDescriptor(SystemEffect.prototype, "isExpiryTrackable").get, "function");
  assert.equal(findDescriptor(SystemEffect.prototype, "missing"), undefined);
});

test("diagnoses the bug with the real active and tracking getters", () => {
  const get = (cls) => findDescriptor(cls.prototype, "isExpiryTrackable").get;
  assert.equal(diagnose(SystemEffect.prototype, get(SystemEffect)), true);
  assert.equal(diagnose(CoreEffect.prototype, get(CoreEffect)), false);
  assert.equal(diagnose(SystemEffect.prototype, function () { throw new Error("x"); }), undefined);
  assert.equal(diagnose(undefined, get(SystemEffect)), undefined);
  assert.equal(diagnose(SystemEffect.prototype, undefined), undefined);
});

test("apply makes usage effects trackable and keeps other effects unchanged", () => {
  class Effect extends SystemEffect {}
  globalThis.CONFIG = { ActiveEffect: { documentClass: Effect } };
  try {
    assert.equal(patch.isNeeded(), true);
    patch.apply();
    assert.equal(new Effect(usageEffect()).isExpiryTrackable, true);
    assert.equal(new Effect(usageEffect({ disabled: true })).isExpiryTrackable, false);
    assert.equal(new Effect(usageEffect({ parent: { documentName: "Item" } })).isExpiryTrackable, false);
    assert.equal(new Effect(usageEffect({ system: { onuse: false } })).isExpiryTrackable, true);
    assert.equal(new Effect(usageEffect({ system: { onuse: false }, isTemporary: false })).isExpiryTrackable, false);
    const broken = new Effect(usageEffect());
    Object.defineProperty(broken, "isTemporary", { get() { throw new Error("boom"); } });
    assert.equal(broken.isExpiryTrackable, false);
    assert.equal(new SystemEffect(usageEffect()).isExpiryTrackable, false);
  } finally {
    delete globalThis.CONFIG;
  }
});
