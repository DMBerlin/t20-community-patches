import { test } from "node:test";
import assert from "node:assert/strict";

import { bootFeatures } from "../scripts/kernel/lifecycle.mjs";
import { createServiceRegistry } from "../scripts/kernel/services.mjs";
import { createFeatureContext, createServiceContext } from "../scripts/kernel/context.mjs";
import { createWrapRegistry } from "../scripts/kernel/wrap.mjs";
import { validateFeatures } from "../scripts/kernel/feature.mjs";
import { createFakePlatform } from "./support/fake-platform.mjs";

const SYSTEM = { id: "tormenta20", version: "1.6.6" };
const affected = { minimum: "1.6.5", maximum: "1.6.6" };
const rule = (id, extra = {}) => ({ id, kind: "rule", group: "combat", system: { id: "tormenta20" }, install() {}, ...extra });
const patch = (id, extra = {}) => ({ id, kind: "patch", group: "combat", system: { id: "tormenta20", affected }, install() {}, ...extra });

/** Boots the features over a real service registry, recording installs of services and features in one log. */
function boot(features, { modes = {}, services } = {}) {
  const log = [];
  const platform = createFakePlatform();
  const wraps = createWrapRegistry();
  const defs = services ?? [
    { id: "svc", install: (ctx) => (log.push(`service:${ctx.id}`), { hello: () => "hi" }) }
  ];
  const registry = createServiceRegistry(defs, (service) => createServiceContext(platform, service, { wraps }));
  const contextFor = (feature) => createFeatureContext(platform, feature, { wraps, services: registry });
  const status = bootFeatures({
    features: features.map((f) => ({ ...f, install: (ctx) => (log.push(f.id), f.install(ctx)) })),
    modeOf: (f) => modes[f.id] ?? "auto",
    system: SYSTEM,
    contextFor,
    registerSetting: () => {},
    services: registry,
    log: { info: () => {}, error: () => {} }
  });
  return { status, log, registry };
}

test("a service is installed once, right before the first feature that declares it", () => {
  const seen = [];
  const { log, registry } = boot([
    rule("a"),
    rule("b", { services: ["svc"], install: (ctx) => seen.push(ctx.services.svc.hello()) }),
    rule("c", { services: ["svc"], install: (ctx) => seen.push(ctx.services.svc.hello()) })
  ]);
  assert.deepEqual(log, ["a", "service:svc", "b", "c"]);
  assert.deepEqual(seen, ["hi", "hi"]);
  assert.deepEqual(registry.installed(), ["svc"]);
});

test("a service is not installed when no installed feature declares it", () => {
  const { log, registry } = boot([patch("p", { services: ["svc"] }), rule("r")], { modes: { p: "off" } });
  assert.deepEqual(log, ["r"]);
  assert.deepEqual(registry.installed(), []);
});

test("a disabled patch does not install the service: the next feature that declares it does", () => {
  const { log } = boot([patch("p", { services: ["svc"] }), rule("a"), rule("b", { services: ["svc"] })], { modes: { p: "off" } });
  assert.deepEqual(log, ["a", "service:svc", "b"]);
});

test("ctx.services: an undeclared service throws; a declared one gives the same frozen API", () => {
  const platform = createFakePlatform();
  const wraps = createWrapRegistry();
  const registry = createServiceRegistry([{ id: "svc", install: () => ({ n: 1 }) }, { id: "other", install: () => ({}) }], (s) =>
    createServiceContext(platform, s, { wraps })
  );
  const ctx = createFeatureContext(platform, { id: "f", services: ["svc"] }, { wraps, services: registry });
  assert.throws(() => ctx.services.other, /service "other" is not declared/);
  assert.equal(ctx.services.svc, ctx.services.svc);
  assert.ok(Object.isFrozen(ctx.services.svc));
  assert.equal("svc" in ctx.services, true);
  assert.equal(ctx.services.then, undefined);
});

test("a service that throws fails every feature that declares it, without reinstalling; the others go on", () => {
  let calls = 0;
  const services = [{ id: "svc", install: () => { calls++; throw new Error("boom"); } }];
  const { status } = boot([rule("a", { services: ["svc"] }), rule("b", { services: ["svc"] }), rule("c")], { services });
  assert.deepEqual(status.map((s) => [s.id, s.state]), [["a", "error"], ["b", "error"], ["c", "installed"]]);
  assert.match(status[0].reason, /Service "svc" failed to install: boom/);
  assert.equal(calls, 1);
});

test("a service owns its wrappers", () => {
  const platform = createFakePlatform();
  const wraps = createWrapRegistry();
  const target = { m: () => 1 };
  const registry = createServiceRegistry([{ id: "svc", install: (ctx) => (ctx.wrap(target, "m", (m) => m() + 1), {}) }], (s) =>
    createServiceContext(platform, s, { wraps })
  );
  registry.ensure("svc");
  assert.equal(target.m(), 2);
  assert.deepEqual(wraps.list().map((w) => w.owners), [["svc"]]);
});

test("validateFeatures: an unknown service or interactsWith id throws", () => {
  assert.doesNotThrow(() => validateFeatures([rule("a", { services: ["svc"], interactsWith: ["b"] }), rule("b")], ["combat"], ["svc"]));
  assert.throws(() => validateFeatures([rule("a", { services: ["nope"] })], ["combat"], ["svc"]), /Feature a: unknown service "nope"/);
  assert.throws(() => validateFeatures([rule("a", { interactsWith: ["nope"] })], ["combat"]), /Feature a: interactsWith unknown id "nope"/);
  assert.throws(() => validateFeatures([rule("a", { interactsWith: ["a"] })], ["combat"]), /interactsWith itself/);
});
