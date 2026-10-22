import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  KNOWN_SOURCES,
  applyMenaceXp,
  diagnoseMenaceXp,
  diagnoseMethod,
  fractionalCrXp,
  probeMenaceXp,
  recognizeSource
} from "../scripts/patches/menace-xp-fraction.mjs";
import { resolvePatchState } from "../scripts/registry.mjs";

function parseFraction(fraction) {
  let [num, denom] = String(fraction).split("/").map(Number);
  denom = isNaN(denom) || denom === 0 ? 1 : denom;
  return num / denom;
}

/** Behaves like MenaceData#prepareBaseData of 1.6.5 (with the bug), counting calls. */
function buggyDouble() {
  const fn = function () {
    fn.calls++;
    const nd = this.attributes.nd;
    if (["S", "S+"].includes(nd)) this.attributes.nivel.value = 20;
    else this.attributes.nivel.value = Number(nd) || 1;
    const nivel = this.attributes.nivel.value;
    this.attributes.treino = nivel > 14 ? 6 : nivel > 6 ? 4 : 2;
    this.attributes.nivel.xp.value = Math.floor(parseFraction(nivel) * 1000);
    this.prepareBaseAtributos();
  };
  fn.calls = 0;
  return fn;
}

const known = () => KNOWN_SOURCES["1.6.5"];

test("fractionalCrXp only knows ND 1/4 and 1/2", () => {
  assert.equal(fractionalCrXp("1/4"), 250);
  assert.equal(fractionalCrXp("1/2"), 500);
  for (const nd of ["1", "5", "S", "S+", "0.5", "1/3", " 1/2", "1 / 2", "", "abc", "toString", null, undefined]) {
    assert.equal(fractionalCrXp(nd), null, String(nd));
  }
});

test("applyMenaceXp corrects the XP of ND 1/2 once and keeps the level", () => {
  const attributes = { nd: "1/2", nivel: { value: 1, xp: { value: 1000 } } };
  assert.equal(applyMenaceXp(attributes), true);
  assert.equal(attributes.nivel.xp.value, 500);
  assert.equal(attributes.nivel.value, 1);
  assert.equal(applyMenaceXp(attributes), false);
});

test("applyMenaceXp leaves other NDs and malformed data untouched", () => {
  const attributes = { nd: "5", nivel: { value: 5, xp: { value: 5000 } } };
  assert.equal(applyMenaceXp(attributes), false);
  assert.equal(attributes.nivel.xp.value, 5000);
  assert.equal(applyMenaceXp({ nd: "1/4", nivel: {} }), false);
  assert.equal(applyMenaceXp(undefined), false);
});

test("recognizeSource ignores comments and formatting but not code changes", () => {
  const reformatted = known().replace("{ const flags", "{\n\t\t// comment\n\t\tconst flags").replaceAll("; ", ";\n\t\t");
  assert.equal(recognizeSource(reformatted), "1.6.5");
  assert.equal(recognizeSource(known().replace("|| 1;", "|| 0.25;")), null);
  assert.equal(recognizeSource(""), null);
});

test("unrecognized code is never executed by the probe", () => {
  const fn = buggyDouble();
  assert.deepEqual(
    { bug: diagnoseMethod(fn).bug, confidence: diagnoseMethod(fn).confidence },
    { bug: "unknown", confidence: "low" }
  );
  const throwing = diagnoseMethod(fn, () => {
    throw new Error("no source");
  });
  assert.equal(throwing.bug, "unknown");
  assert.equal(fn.calls, 0);
});

test("unrecognized code is never executed in any mode or version", () => {
  const fn = buggyDouble();
  globalThis.CONFIG = { Actor: { dataModels: { npc: { prototype: { prepareBaseData: fn } } } } };
  try {
    const cases = [["off", "1.6.5"], ["off", "1.7.0"], ["auto", "1.7.0"], ["force", "1.7.0"]];
    for (const [mode, systemVersion] of cases) {
      const result = resolvePatchState({ patch, mode, systemId: "tormenta20", systemVersion, probe: patch.isNeeded });
      assert.equal(result.diagnosis.bug, "unknown", `${mode} ${systemVersion}`);
    }
    assert.equal(
      resolvePatchState({ patch, mode: "auto", systemId: "tormenta20", systemVersion: "1.7.0", probe: patch.isNeeded }).state,
      "applied-guarded"
    );
    assert.equal(fn.calls, 0);
  } finally {
    delete globalThis.CONFIG;
  }
});

test("recognized buggy code is diagnosed as present with high confidence", () => {
  const fn = buggyDouble();
  const diagnosis = diagnoseMethod(fn, known);
  assert.equal(diagnosis.bug, "present");
  assert.equal(diagnosis.confidence, "high");
  assert.equal(fn.calls, 2);
  assert.equal(probeMenaceXp(buggyDouble(), "1/4"), 1000);
});

test("recognized code is fixed only when both NDs are right", () => {
  const byNd = (xp) =>
    function () {
      this.attributes.nivel.xp.value = xp[this.attributes.nd];
    };
  assert.equal(diagnoseMethod(byNd({ "1/4": 250, "1/2": 500 }), known).bug, "fixed");
  assert.equal(diagnoseMethod(byNd({ "1/4": 250, "1/2": 500 }), known).confidence, "high");
  assert.equal(diagnoseMethod(byNd({ "1/4": 250, "1/2": 1000 }), known).bug, "present");
  assert.equal(diagnoseMethod(byNd({ "1/4": 0, "1/2": 0 }), known).bug, "unknown");
  const failing = () => {
    throw new Error("boom");
  };
  assert.equal(diagnoseMethod(failing, known).bug, "unknown");
  assert.equal(diagnoseMenaceXp({}).confidence, "low");
  assert.equal(diagnoseMethod(undefined).bug, "unknown");
});

test("the wrapper corrects ND 1/4 and 1/2 after the original and keeps its result", () => {
  const fn = buggyDouble();
  const proto = { prepareBaseData: fn };
  globalThis.CONFIG = { Actor: { dataModels: { npc: { prototype: proto } } } };
  try {
    patch.apply();
    const xpFor = (nd) => {
      const data = Object.assign(Object.create(proto), {
        attributes: { nd, nivel: { value: 0, xp: { value: 0 } } },
        prepareBaseAtributos() {}
      });
      data.prepareBaseData();
      return [data.attributes.nivel.value, data.attributes.nivel.xp.value];
    };
    assert.deepEqual(xpFor("1/4"), [1, 250]);
    assert.deepEqual(xpFor("1/2"), [1, 500]);
    assert.deepEqual(xpFor("5"), [5, 5000]);
    assert.deepEqual(xpFor("1/3"), [1, 1000]);
  } finally {
    delete globalThis.CONFIG;
  }
});
