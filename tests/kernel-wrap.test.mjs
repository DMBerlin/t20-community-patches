import { test } from "node:test";
import assert from "node:assert/strict";
import { createWrapRegistry, fromFactory } from "../scripts/kernel/wrap.mjs";
import { unwrap } from "../scripts/utils.mjs";

test("the first registered wrapper is the innermost and chain lists owners inside out", () => {
  const { wrap, chain, list } = createWrapRegistry();
  class Target {
    run() {
      return ["base"];
    }
  }
  wrap(Target.prototype, "run", "a", function (original, ...args) {
    return [...original.apply(this, args), "a"];
  });
  wrap(Target.prototype, "run", "b", function (original, ...args) {
    return [...original.apply(this, args), "b"];
  });
  assert.deepEqual(new Target().run(), ["base", "a", "b"]);
  assert.deepEqual(chain(Target.prototype, "run"), ["a", "b"]);
  assert.deepEqual(chain(Target.prototype, "other"), []);
  assert.deepEqual(list(), [{ label: "Target#run", owners: ["a", "b"] }]);
});

test("labels default to the class name for static targets and accept an explicit label", () => {
  const { wrap, list } = createWrapRegistry();
  class Static {
    static make() {}
  }
  const model = { prepareDerivedData() {} };
  wrap(Static, "make", "a", (original) => original());
  wrap(model, "prepareDerivedData", "b", (original) => original(), { label: "CharacterData#prepareDerivedData" });
  assert.deepEqual(list(), [
    { label: "Static.make", owners: ["a"] },
    { label: "CharacterData#prepareDerivedData", owners: ["b"] }
  ]);
});

test("the wrapper receives this, the arguments and the original's return value untouched", async () => {
  const { wrap } = createWrapRegistry();
  const promise = Promise.resolve(1);
  function* gen() {
    yield 1;
  }
  const generator = gen();
  const target = {
    seen: null,
    sync(...args) {
      this.seen = args;
      return "ret";
    },
    async() {
      return promise;
    },
    gen() {
      return generator;
    }
  };
  for (const method of ["sync", "async", "gen"]) {
    wrap(target, method, "a", function (original, ...args) {
      return original.apply(this, args);
    });
  }
  assert.equal(target.sync(1, 2), "ret");
  assert.deepEqual(target.seen, [1, 2]);
  assert.equal(target.async(), promise);
  assert.equal(target.gen(), generator);
  assert.equal(await target.async(), 1);
});

test("exceptions of the original propagate through the wrapper", () => {
  const { wrap } = createWrapRegistry();
  const target = {
    fail() {
      throw new RangeError("boom");
    }
  };
  wrap(target, "fail", "a", function (original, ...args) {
    return original.apply(this, args);
  });
  assert.throws(() => target.fail(), RangeError);
});

test("unwrap returns the original after two wraps and wrap returns the replaced function", () => {
  const { wrap } = createWrapRegistry();
  const base = () => 1;
  const target = { run: base };
  assert.equal(wrap(target, "run", "a", (original) => original()), base);
  const first = target.run;
  assert.equal(wrap(target, "run", "b", (original) => original()), first);
  assert.equal(unwrap(target.run), base);
});

test("an invalid target, method or wrapper throws a TypeError naming the owner and leaves the target untouched", () => {
  const { wrap, list } = createWrapRegistry();
  const target = { run() {} };
  const snapshot = { ...target };
  assert.throws(() => wrap(target, "missing", "owner-x", (o) => o()), (e) => e instanceof TypeError && /owner-x/.test(e.message));
  assert.throws(() => wrap(target, "run", "owner-y", null), (e) => e instanceof TypeError && /owner-y/.test(e.message));
  assert.throws(() => wrap(null, "run", "owner-z", (o) => o()), (e) => e instanceof TypeError && /owner-z/.test(e.message));
  assert.deepEqual({ ...target }, snapshot);
  assert.equal("missing" in target, false);
  assert.deepEqual(list(), []);
});

test("fromFactory builds the replacement once from the captured original and keeps this, arguments and return", () => {
  const { wrap } = createWrapRegistry();
  const base = function (x) {
    return [this.id, x];
  };
  const target = { id: "t", run: base };
  const seen = [];
  wrap(
    target,
    "run",
    "a",
    fromFactory((original) => {
      seen.push(original);
      return function (...args) {
        return [...original.apply(this, args), "a"];
      };
    })
  );
  assert.deepEqual(target.run(1), ["t", 1, "a"]);
  assert.deepEqual(target.run(2), ["t", 2, "a"]);
  assert.deepEqual(seen, [base]);
});
