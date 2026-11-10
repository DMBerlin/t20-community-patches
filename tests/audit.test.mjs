import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { indexBundle } from "../tools/audit/bundle-index.mjs";
import { createAuditPlatform, RequiresFoundry } from "../tools/audit/platform.mjs";
import { checkRef, findRefs } from "../tools/audit/refs.mjs";
import { compareFingerprints, pickBaseline, probePatch, runAudit } from "../tools/audit/run.mjs";
import { findClassMember, parseMethodLabel } from "../scripts/lib/method-label.mjs";
import { createPlatform } from "../scripts/platform/foundry.mjs";
import { markWrapper, sourceFingerprint, stripComments } from "../scripts/lib/source.mjs";
import { PATCHES } from "../scripts/features/patches.mjs";

const CODE = readFileSync(new URL("./fixtures/audit-bundle.mjs.txt", import.meta.url), "utf8");
const BASELINE = JSON.parse(readFileSync(new URL("./fixtures/audit-baseline.json", import.meta.url), "utf8"));
const MODULE = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
const SYSTEM = { id: "tormenta20", version: "1.6.6" };
const index = indexBundle(CODE);

async function evaluateFixture() {
  const helpers = {};
  globalThis.Handlebars = {
    registerHelper: (name, fn) => (typeof name === "string" ? (helpers[name] = fn) : Object.assign(helpers, name))
  };
  try {
    return { ...(await import(`data:text/javascript,${encodeURIComponent(CODE)}`)), helpers };
  } finally {
    delete globalThis.Handlebars;
  }
}

test("the index gives the same text as Function.prototype.toString in Foundry", async () => {
  const { Base, ItemT20, Legacy, Holder, applyEffectChanges, applyItemChanges, helpers } = await evaluateFixture();
  const text = (fn) => Function.prototype.toString.call(fn);
  const getter = (holder, key) => Object.getOwnPropertyDescriptor(holder, key).get;
  assert.equal(index.source("ItemT20#rollDamage"), text(ItemT20.prototype.rollDamage));
  assert.equal(index.source("ItemT20.create"), text(ItemT20.create));
  assert.equal(index.source("ItemT20.label"), text(getter(ItemT20, "label")));
  assert.equal(index.source("Base#isSuppressed"), text(getter(Base.prototype, "isSuppressed")));
  assert.equal(index.source("Legacy#manage"), text(Legacy.prototype.manage));
  assert.equal(index.source("Holder#assigned"), text(Holder.prototype.assigned));
  assert.equal(index.source("Holder.staticAssigned"), text(Holder.staticAssigned));
  assert.equal(index.source("#local:applyEffectChanges"), text(applyEffectChanges));
  assert.equal(index.source("#local:applyItemChanges"), text(applyItemChanges));
  assert.equal(index.source("#helper:fieldBonuses"), text(helpers.fieldBonuses));
  assert.equal(index.source("#helper:other"), text(helpers.other));
});

test("the index skips setters and constructors, and an ambiguous or unknown label is null", () => {
  assert.equal(index.source("ItemT20#value"), null);
  assert.equal(index.source("ItemT20#constructor"), null);
  assert.equal(index.source("Twice#run"), null, "two classes named Twice with different code");
  assert.equal(index.source("ItemT20#missing"), null);
  assert.equal(index.line("ItemT20#rollDamage"), CODE.split("\n").findIndex((line) => line.includes("rollDamage(")) + 1);
  assert.ok(!index.labels().includes("Twice#run"));
});

test("a member replaced by an assignment the index cannot read is null, never the old code", () => {
  const replaced = indexBundle(`class ItemT20 { run() { return "old"; } static make() { return 1; } }
function replacement() { return "new"; }
ItemT20.prototype.run = replacement;
ItemT20.make ??= () => 2;
class ActorT20 { roll() { return "old"; } }
ActorT20["prototype"]["roll"] = replacement;
function applyOnUseEffects() { return "old"; }
applyOnUseEffects = replacement;
Handlebars.registerHelper("fieldBonuses", function () { return "old"; });
Handlebars.registerHelper("fieldBonuses", replacement);
Handlebars.registerHelper({ other: () => "old" });
Handlebars.registerHelper({ other: replacement });
ActorT20.prototype.kept = function () { return "kept"; };`);
  for (const label of ["ItemT20#run", "ItemT20.make", "ActorT20#roll", "#local:applyOnUseEffects", "#helper:fieldBonuses", "#helper:other"]) {
    assert.equal(replaced.source(label), null, label);
    assert.ok(!replaced.labels().includes(label), label);
  }
  assert.match(replaced.source("ActorT20#kept"), /"kept"/);
  assert.match(replaced.source("#local:replacement"), /"new"/);
});

test("a class binding reassigned to any value drops every member indexed under it", () => {
  const index = indexBundle(`let ItemT20 = class { run() { return 1; } static make() { return 1; } };
ItemT20 = class {};
let ActorT20 = class { roll() { return 1; } };
ActorT20 = Replacement;
class ActiveEffectT20 { active() { return 1; } }`);
  for (const label of ["ItemT20#run", "ItemT20.make", "ActorT20#roll"]) assert.equal(index.source(label), null, label);
  assert.match(index.source("ActiveEffectT20#active"), /return 1/);
});

test("members a bundler rewrites after the class body are null, never the old code", () => {
  const index = indexBundle(`let ItemT20$1 = class ItemT20 { run() { return 1; } legacy() { return 1; } };
ItemT20$1 = class { run() { return 2; } };
class ItemT20 { current() { return 0; } }
class A { run() { return 1; } ["run"]() { return 2; } static make() { return 1; } static make = () => 2; }
class B { static make() { return 1; } static { this.make = () => 2; } }
class C { run() { return 1; } }
__decorateClass([dec], C.prototype, "run", 1);
class D { run() { return 1; } }
Object.assign(D.prototype, { run() { return 2; } });
class E { run() { return 1; } }
delete E.prototype.run;
class F { run() { return 1; } }
Handlebars.registerHelper("fieldBonuses", () => 1);
Handlebars.registerHelper({ ["fieldBonuses"]: () => 2 });
Handlebars.registerHelper("other", () => 1);
Handlebars.unregisterHelper("other");
var applyOnUseEffects = function () { return 1; };
var applyOnUseEffects = function () { return 2; };`);
  for (const label of ["ItemT20#run", "ItemT20#legacy", "A#run", "A.make", "B.make", "C#run", "D#run", "E#run", "#helper:fieldBonuses", "#helper:other", "#local:applyOnUseEffects"]) {
    assert.equal(index.source(label), null, label);
  }
  assert.match(index.source("ItemT20#current"), /return 0/);
  assert.match(index.source("F#run"), /return 1/);
  const spread = indexBundle(`Handlebars.registerHelper("fieldBonuses", () => 1);\nHandlebars.registerHelper({ ...extra });`);
  assert.equal(spread.source("#helper:fieldBonuses"), null);
});

test("fingerprints keep string and regex literals byte for byte and skip only real comments", () => {
  const fp = sourceFingerprint;
  assert.notEqual(fp("m() { return /ND ([0-9])/; }"), fp("m() { return /ND  ([0-9])/; }"));
  assert.notEqual(fp('m() { return "a b"; }'), fp('m() { return "a  b"; }'));
  assert.notEqual(fp("m() { const u = /https?:\\/\\//; return 1; }"), fp("m() { const u = /https?:\\/\\//; return 2; }"));
  assert.equal(fp("m() {\n  return a / b; // note\n}"), fp("m() { return a / b; }"));
  assert.equal(fp("m() { /* x */ return  1; }"), fp("m() { return 1; }"));
  assert.equal(stripComments("x = /\\/\\//.test(y); // c"), "x = /\\/\\//.test(y); \n");
  assert.equal(stripComments("z = arr[0] / 2 / 3; // c"), "z = arr[0] / 2 / 3; \n");
});

test("make audit passes a BUNDLE with spaces as one argument", () => {
  const command = execFileSync("make", ["--no-print-directory", "-n", "audit", "BUNDLE=/tmp/Application Support/t20.mjs"], { encoding: "utf8" });
  assert.match(command, /node tools\/audit\.mjs "\/tmp\/Application Support\/t20\.mjs"/);
  assert.match(execFileSync("make", ["--no-print-directory", "-n", "audit"], { encoding: "utf8" }), /node tools\/audit\.mjs\s*$/);
});

test("a class declaration wins over the inner name of a class expression", () => {
  assert.match(index.source("Legacy#manage"), /"current"/);
  assert.match(index.source("Legacy$1#manage"), /"legacy"/);
});

test("method labels resolve at run time on the first root that declares them", async () => {
  assert.deepEqual(parseMethodLabel("ItemT20#rollDamage"), { kind: "instance", className: "ItemT20", member: "rollDamage" });
  assert.deepEqual(parseMethodLabel("ItemT20.create"), { kind: "static", className: "ItemT20", member: "create" });
  assert.deepEqual(parseMethodLabel("#helper:fieldBonuses"), { kind: "helper", name: "fieldBonuses" });
  assert.equal(parseMethodLabel("rollDamage"), null);

  const { Base, ItemT20, Legacy, Legacy$1 } = await evaluateFixture();
  class Sub extends ItemT20 {}
  const isSuppressed = Object.getOwnPropertyDescriptor(Base.prototype, "isSuppressed").get;
  assert.equal(findClassMember(parseMethodLabel("Base#isSuppressed"), [Sub]), isSuppressed, "found through the lineage");
  assert.equal(findClassMember(parseMethodLabel("ItemT20.create"), [Sub]), ItemT20.create);
  assert.equal(findClassMember(parseMethodLabel("ItemT20#create"), [Sub]), null, "instance label on a static member");
  assert.equal(findClassMember(parseMethodLabel("Legacy#manage"), [Legacy$1, Legacy]), Legacy$1.prototype.manage);
  assert.equal(findClassMember(parseMethodLabel("Legacy#manage"), [Legacy, Legacy$1]), Legacy.prototype.manage);

  class Override extends ItemT20 {
    rollDamage() {
      return "another module";
    }
    static create() {
      return "another module";
    }
  }
  const rollDamage = parseMethodLabel("ItemT20#rollDamage");
  assert.equal(findClassMember(rollDamage, [Override]), Override.prototype.rollDamage, "the override the root runs");
  assert.equal(findClassMember(parseMethodLabel("ItemT20.create"), [Override]), Override.create);
  assert.equal(findClassMember(parseMethodLabel("Override#rollDamage"), [Override]), Override.prototype.rollDamage);
});

test("in Foundry, a label names the system's declaration unless another module's class overrides it", () => {
  class ActorSheetT20 {
    getData() {
      return "system";
    }
  }
  class ActorSheetT20Character extends ActorSheetT20 {
    getData() {
      return super.getData();
    }
  }
  class ItemT20 {
    rollDamage() {
      return "system";
    }
  }
  class OtherModuleItem extends ItemT20 {
    rollDamage() {
      return "another module";
    }
  }
  class CoreActor {
    _onDeleteDescendantDocuments() {
      return "core";
    }
  }
  class ActorT20 extends CoreActor {}
  class OtherModuleActor extends ActorT20 {
    _onDeleteDescendantDocuments() {
      return "another module";
    }
  }
  class MenaceData {
    prepareDerivedData() {
      return "system";
    }
  }
  class OtherModuleMenace extends MenaceData {
    prepareDerivedData() {
      return "another module";
    }
  }
  globalThis.CONFIG = {
    Item: { documentClass: OtherModuleItem },
    Actor: { documentClass: OtherModuleActor, dataModels: { npc: OtherModuleMenace } }
  };
  globalThis.tormenta20 = {
    documents: { ItemT20, ActorT20 },
    applications: { ActorSheetT20Character, ActorSheetT20 },
    data: { models: { MenaceData } }
  };
  try {
    const { sourceOfMethod } = createPlatform();
    assert.match(sourceOfMethod("ActorSheetT20#getData"), /"system"/, "a system subclass delegating to super");
    assert.match(sourceOfMethod("ActorSheetT20Character#getData"), /super\.getData/);
    assert.match(sourceOfMethod("ItemT20#rollDamage"), /"another module"/, "what CONFIG's class runs");
    assert.match(sourceOfMethod("MenaceData#prepareDerivedData"), /"another module"/, "a data model replaced in CONFIG");
    assert.match(sourceOfMethod("ActorT20#_onDeleteDescendantDocuments"), /"another module"/, "a core hook overridden");
    globalThis.CONFIG.Actor = { documentClass: ActorT20 };
    assert.equal(sourceOfMethod("ActorT20#_onDeleteDescendantDocuments"), null, "a core hook only inherited");
    const coreHook = CoreActor.prototype._onDeleteDescendantDocuments;
    ActorT20.prototype._onDeleteDescendantDocuments = markWrapper(function (...args) {
      return coreHook.apply(this, args);
    }, coreHook);
    assert.equal(sourceOfMethod("ActorT20#_onDeleteDescendantDocuments"), null, "this module's wrapper of a core hook");
    class ConfiguredActor extends ActorT20 {}
    const systemWrapper = ActorT20.prototype._onDeleteDescendantDocuments;
    ConfiguredActor.prototype._onDeleteDescendantDocuments = markWrapper(function (...args) {
      return systemWrapper.apply(this, args);
    }, systemWrapper);
    globalThis.CONFIG.Actor = { documentClass: ConfiguredActor };
    assert.equal(sourceOfMethod("ActorT20#_onDeleteDescendantDocuments"), null, "wrappers on two classes of the chain");
    const rollDamage = ItemT20.prototype.rollDamage;
    ItemT20.prototype.rollDamage = markWrapper(function (...args) {
      return rollDamage.apply(this, args);
    }, rollDamage);
    globalThis.CONFIG.Item = { documentClass: ItemT20 };
    assert.match(sourceOfMethod("ItemT20#rollDamage"), /"system"/, "this module's wrapper of a system method");
  } finally {
    delete globalThis.CONFIG;
    delete globalThis.tormenta20;
  }
});

test("references: anchor, ok, shifted, missing, pinned and no anchor", () => {
  const lines = CODE.split("\n");
  const at = index.line("ItemT20#rollDamage");
  const text = [
    `// ItemT20#rollDamage (T20:${at})`,
    `// rollDamage (T20:${at + 20})`,
    `// rollDamage (T20:${at + 500})`,
    `// rollDamage on tormenta20 1.6.5 (T20:${at + 500})`,
    `// the system (T20:${at})`
  ].join("\n");
  const refs = findRefs(text);
  assert.deepEqual(
    refs.map((ref) => ref.anchor),
    ["rollDamage", "rollDamage", "rollDamage", "rollDamage", null]
  );
  assert.deepEqual(
    refs.map((ref) => checkRef(ref, lines, "1.6.6")),
    [{ status: "ok" }, { status: "shifted", line: at }, { status: "missing" }, { status: "pinned" }, { status: "no-anchor" }]
  );
});

const samplePatch = (overrides) => ({
  id: "sample",
  system: { id: "tormenta20" },
  sources: ["ItemT20#rollDamage"],
  isNeeded(ctx) {
    const source = ctx.platform.sourceOfMethod("ItemT20#rollDamage");
    if (source == null) return undefined;
    return source.includes("@danoALQ") ? { bug: "present", confidence: "high" } : undefined;
  },
  ...overrides
});

test("the audit runs source probes on the bundle and never runs behavior probes", () => {
  assert.deepEqual(probePatch(samplePatch(), { index, system: SYSTEM }), {
    kind: "source",
    diagnosis: { bug: "present", confidence: "high" },
    labels: ["ItemT20#rollDamage"]
  });
  let ran = false;
  const behavior = samplePatch({ probeKind: "behavior", isNeeded: () => (ran = true) });
  assert.equal(probePatch(behavior, { index, system: SYSTEM }).kind, "behavior");
  assert.equal(ran, false);
});

test("a probe that reads Foundry state is an error, and so is a label missing from sources", () => {
  const settings = samplePatch({ isNeeded: (ctx) => ctx.platform.settings.get("x") });
  const report = runAudit({ patches: [settings], code: CODE, system: SYSTEM });
  assert.match(report.rows[0].probe.error, /RequiresFoundry: platform.settings requires Foundry/);
  assert.equal(report.ok, false);

  const undeclared = runAudit({ patches: [samplePatch({ sources: [] })], code: CODE, system: SYSTEM });
  assert.deepEqual(undeclared.rows[0].undeclared, ["ItemT20#rollDamage"]);
  assert.equal(undeclared.ok, false);
  assert.throws(() => createAuditPlatform({ index, system: SYSTEM }).dice, RequiresFoundry);
});

test("a changed source is CHANGED and fails the audit; the same source passes", () => {
  const fingerprint = sourceFingerprint(index.source("ItemT20#rollDamage"));
  const run = (entries, code = CODE) =>
    runAudit({ patches: [samplePatch()], code, system: SYSTEM, baseline: { "1.6.6": entries }, verified: "1.6.6" });

  const same = run({ "ItemT20#rollDamage": fingerprint });
  assert.equal(same.rows[0].sources.status, "unchanged");
  assert.equal(same.ok, true);

  const changed = run({ "ItemT20#rollDamage": fingerprint }, CODE.replace('// collects "@danoALQ"', "areEffectsSuppressed();"));
  assert.deepEqual(changed.rows[0].sources.changed, ["ItemT20#rollDamage"]);
  assert.equal(changed.ok, false);

  const removed = run({ "ItemT20#rollDamage": fingerprint }, CODE.replace("rollDamage(options", "rollDamage2(options"));
  assert.equal(removed.rows[0].sources.status, "changed");
  assert.equal(removed.rows[0].probe.diagnosis.bug, "unknown");
});

test("the baseline is the verified version's, else the newest one", () => {
  const baseline = { "1.6.5": { a: "1" }, "1.6.10": { a: "2" }, "1.6.6": { a: "3" } };
  assert.equal(pickBaseline(baseline, "1.6.6").version, "1.6.6");
  assert.equal(pickBaseline(baseline, "1.7.0").version, "1.6.10");
  assert.equal(pickBaseline({}, "1.6.6"), null);
  assert.equal(compareFingerprints({}, null).status, "none");
  assert.equal(compareFingerprints({ a: "1" }, null).status, "unrecorded");
});

/** An index that answers every label (with `body`), so each probe reads all the labels it can. */
const answering = (body) => ({ source: () => body, line: () => null, labels: () => [], lines: [] });

test("every source probe runs without Foundry and declares the labels it reads", () => {
  for (const patch of PATCHES) {
    if (patch.probeKind === "behavior" || typeof patch.isNeeded !== "function") continue;
    for (const fake of [answering(null), answering("function probe() {}")]) {
      const result = probePatch(patch, { index: fake, system: SYSTEM });
      assert.equal(result.error, undefined, `${patch.id}: ${result.error}`);
      for (const label of result.labels) assert.ok(patch.sources?.includes(label), `${patch.id} reads ${label}`);
    }
  }
});

test("every declared source is a valid label recorded in the baseline of the verified version", () => {
  const verified = MODULE.relationships.systems.find((entry) => entry.id === "tormenta20").compatibility.verified;
  const entries = BASELINE[verified];
  assert.ok(entries, `baseline for ${verified}`);
  for (const patch of PATCHES) {
    for (const label of patch.sources ?? []) {
      assert.ok(parseMethodLabel(label), `${patch.id}: ${label}`);
      assert.ok(Object.hasOwn(entries, label), `${patch.id}: ${label} not in the baseline`);
    }
  }
});
