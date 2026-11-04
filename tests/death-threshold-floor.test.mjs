import { test } from "node:test";
import assert from "node:assert/strict";

import deathThresholdFloor from "../scripts/features/death-threshold-floor/index.mjs";
import dyingStates from "../scripts/features/dying-states/index.mjs";
import { createWrapRegistry } from "../scripts/kernel/wrap.mjs";
import { createFakePlatform, createTestKernel } from "./support/fake-platform.mjs";

/** An actor class whose damage methods clamp at pv.min, like the system's, and report the HP they would write. */
function makeActorClass() {
  const clamp = function (damage) {
    const pv = this.system.attributes.pv;
    return Promise.resolve(Math.max(pv.value - damage, pv.min));
  };
  return class Actor {
    constructor(type) {
      this.type = type;
      this.system = { attributes: { pv: { value: 5, min: -10 } } };
    }
    applyDamage(damage) {
      return clamp.call(this, damage);
    }
    applyDamageV2(damage) {
      return clamp.call(this, damage);
    }
  };
}

function install(settings) {
  const Actor = makeActorClass();
  const platform = createFakePlatform({ settings, classes: { actor: Actor } });
  const wraps = createWrapRegistry();
  const kernel = createTestKernel({ platform, wraps, features: [deathThresholdFloor, dyingStates] });
  kernel.install(deathThresholdFloor);
  return { Actor, wraps, kernel };
}

test("death-threshold-floor: both damage methods are wrapped with death-threshold as owner", () => {
  const { Actor, wraps } = install({ deathThresholdFloor: "unbounded", dyingStatesRule: "characters" });
  assert.deepEqual(wraps.chain(Actor.prototype, "applyDamage"), ["death-threshold"]);
  assert.deepEqual(wraps.chain(Actor.prototype, "applyDamageV2"), ["death-threshold"]);
});

test("death-threshold-floor: only covered actors go below the threshold, and only while the floor is unbounded", async () => {
  const { Actor, kernel } = install({ deathThresholdFloor: "unbounded", dyingStatesRule: "characters" });
  const hero = new Actor("character");
  assert.equal(await hero.applyDamageV2(30), -25);
  assert.equal(hero.system.attributes.pv.min, -10, "pv.min is restored");
  assert.equal(await new Actor("npc").applyDamage(30), -10, "npcs are not covered in this mode");

  await kernel.changeSetting("dyingStatesRule", "all");
  assert.equal(await new Actor("npc").applyDamage(30), -25);

  await kernel.changeSetting("deathThresholdFloor", "clamp");
  assert.equal(await hero.applyDamageV2(30), -10);
});

test("death-threshold-floor: without the dying states setting the system's clamp stays", async () => {
  const { Actor } = install({ deathThresholdFloor: "unbounded" });
  assert.equal(await new Actor("character").applyDamageV2(30), -10);
});
