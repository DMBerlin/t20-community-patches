import { test } from "node:test";
import assert from "node:assert/strict";

import { createWrapRegistry } from "../scripts/kernel/wrap.mjs";
import { createFeatureContext } from "../scripts/kernel/context.mjs";
import { createPublished } from "../scripts/kernel/publish.mjs";
import { createSettingListeners } from "../scripts/kernel/settings.mjs";
import { createFakePlatform } from "./support/fake-platform.mjs";

const feature = { id: "demo", settings: [{ key: "demoMode" }] };

test("ctx.wrap registers the wrapper with the feature id as owner", () => {
  const wraps = createWrapRegistry();
  const ctx = createFeatureContext(createFakePlatform(), feature, { wraps });
  class Target {
    run(x) {
      return x + 1;
    }
  }
  ctx.wrap(Target.prototype, "run", function (original, x) {
    return original.call(this, x) * 10;
  });
  assert.equal(new Target().run(1), 20);
  assert.deepEqual(wraps.chain(Target.prototype, "run"), ["demo"]);
});

test("ctx.setting reads declared keys and throws on undeclared ones", () => {
  const platform = createFakePlatform({ settings: { demoMode: "on", other: "x" } });
  const ctx = createFeatureContext(platform, feature, { wraps: createWrapRegistry() });
  assert.equal(ctx.setting("demoMode"), "on");
  assert.throws(() => ctx.setting("other"), /not declared/);
});

test("the context is frozen and logs with the feature id", () => {
  const platform = createFakePlatform();
  const ctx = createFeatureContext(platform, feature, { wraps: createWrapRegistry() });
  assert.ok(Object.isFrozen(ctx));
  assert.throws(() => {
    ctx.platform = null;
  }, TypeError);
  ctx.log.warn("hello");
  assert.deepEqual(platform.logs, [{ level: "warn", args: ["demo:", "hello"] }]);
});

test("wrapOwner names the wrapper owner instead of the feature id", () => {
  const wraps = createWrapRegistry();
  const ctx = createFeatureContext(createFakePlatform(), { ...feature, wrapOwner: "legacy-owner" }, { wraps });
  class Target {
    run() {}
  }
  ctx.wrap(Target.prototype, "run", function (original) {
    return original.call(this);
  });
  assert.deepEqual(wraps.chain(Target.prototype, "run"), ["legacy-owner"]);
});

test("ctx.publish adds a module API name once and rejects reserved or repeated names", () => {
  const published = createPublished(["status"]);
  const ctx = createFeatureContext(createFakePlatform(), feature, { wraps: createWrapRegistry(), publish: published.add });
  const api = { open: () => 1 };
  ctx.publish("rewards", api);
  assert.equal(published.entries().rewards, api);
  assert.throws(() => ctx.publish("rewards", {}), /rewards/);
  assert.throws(() => ctx.publish("status", {}), /status/);
  const bare = createFeatureContext(createFakePlatform(), feature, { wraps: createWrapRegistry() });
  assert.throws(() => bare.publish("x", {}), /no module API/);
});

test("ctx.onSettingChange listens only to declared keys and can be removed", () => {
  const listeners = createSettingListeners();
  const ctx = createFeatureContext(createFakePlatform(), feature, { wraps: createWrapRegistry(), settingListeners: listeners });
  const seen = [];
  const off = ctx.onSettingChange("demoMode", (value) => seen.push(value));
  assert.throws(() => ctx.onSettingChange("other", () => {}), /not declared/);
  listeners.emit("demoMode", "a");
  off();
  listeners.emit("demoMode", "b");
  assert.deepEqual(seen, ["a"]);
});

test("ctx.state is a mutable bag of each context, never shared between contexts", () => {
  const first = createFeatureContext(createFakePlatform(), feature, { wraps: createWrapRegistry() });
  const second = createFeatureContext(createFakePlatform(), feature, { wraps: createWrapRegistry() });
  first.state.seen = true;
  assert.equal(first.state.seen, true);
  assert.equal(second.state.seen, undefined);
});
