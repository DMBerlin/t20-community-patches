import { test } from "node:test";
import assert from "node:assert/strict";

import { createWrapRegistry } from "../scripts/kernel/wrap.mjs";
import { createFeatureContext } from "../scripts/kernel/context.mjs";
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
