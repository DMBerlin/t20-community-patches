import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  KNOWN_APPLY_DAMAGE_V2,
  diagnoseFingerprint,
  groupDamage,
  handOver,
  readExceptionReduction,
  resolveReductions
} from "../scripts/patches/rd-exception-once.mjs";
import { resolvePatchState } from "../scripts/registry.mjs";
import { sourceFingerprint } from "../scripts/utils.mjs";
import { APPLY_DAMAGE_V2 } from "./fixtures/apply-damage-v2-1.6.5.mjs";

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const TYPES = ["dano", "corte", "fogo", "luz", "frio"];

/** "15c + 6f + 1luz" style spec: [[15, "corte"], [6, "fogo"], [1, "luz"]] → roll.terms */
function terms(parts) {
  const out = [];
  parts.forEach(([total, flavor, extra = {}], i) => {
    if (i) out.push({ operator: extra.operator ?? "+" });
    out.push({ total, options: flavor ? { flavor } : {}, faces: extra.faces, number: extra.number });
  });
  return out;
}

function resistances({ general = "", typed = {}, exception = { luz: 10 }, flags = {} } = {}) {
  const rds = {};
  for (const type of TYPES) {
    rds[type] = { value: type === "dano" ? general : typed[type] ?? 0, excecao: exception[type] ?? 0, ...(flags[type] ?? {}) };
  }
  return rds;
}

/** A class with the real Tormenta20 1.6.5 applyDamageV2. */
function realClass() {
  return new Function(`return class FakeActor {
    constructor(rds) {
      this.system = {
        attributes: { pv: { value: 100, temp: 0, min: -100, max: 100 }, pm: { value: 0, temp: 0, min: 0, max: 0 } },
        tracos: { resistencias: rds }
      };
    }
    async update(updates) { this.updates = updates; }
    async displayDamageCard() {}
    ${APPLY_DAMAGE_V2}
  }`)();
}

globalThis.foundry = { utils: { isEmpty: (o) => !o || Object.keys(o).length === 0 } };
Math.clamp ??= (n, min, max) => Math.min(Math.max(n, min), max);

function patchedClass() {
  const Actor = realClass();
  globalThis.CONFIG = { Actor: { documentClass: Actor } };
  patch.apply();
  return Actor;
}

const System = realClass();
const Patched = patchedClass();

async function hpAfter(Actor, rdOptions, parts, { penetration, multiplier = 1 } = {}) {
  const actor = new Actor(resistances(rdOptions));
  const before = JSON.stringify(actor.system.tracos.resistencias);
  const roll = { terms: terms(parts), options: penetration === undefined ? {} : { rd: penetration } };
  const rollBefore = JSON.stringify(roll);
  await actor.applyDamageV2(roll, multiplier);
  return {
    hp: actor.updates["system.attributes.pv.value"],
    rdsUnchanged: JSON.stringify(actor.system.tracos.resistencias) === before,
    rollUnchanged: JSON.stringify(roll) === rollBefore
  };
}

/* -------------------------------------------- */
/*  Pure functions                              */
/* -------------------------------------------- */

test("groupDamage groups by flavor like the system", () => {
  const groups = groupDamage(terms([[15, "corte"], [4], [6, "fogo"], [2, "fogo", { operator: "-" }]]));
  assert.deepEqual([...groups], [["corte", { value: 19, porDado: 0 }], ["fogo", { value: 4, porDado: 0 }]]);
  const dice = groupDamage(terms([[7, "corte", { faces: 6, number: 2 }]]));
  assert.equal(dice.get("corte").porDado, 2);
  const skipped = groupDamage(terms([[5, "perda"], [3, "curapv"], [4, "fogo"]]));
  assert.deepEqual([...skipped.keys()], ["fogo"]);
  assert.deepEqual([...groupDamage(terms([[5]]), "dano").keys()], ["dano"]);
  assert.equal(groupDamage(undefined).size, 0);
});

test("readExceptionReduction reads the first excecao and every excepted type", () => {
  assert.deepEqual(readExceptionReduction({ dano: { value: "" }, luz: { excecao: 10 } }), {
    amount: 10,
    except: new Set(["luz"])
  });
  assert.equal(readExceptionReduction({ dano: { value: 5 }, luz: { excecao: 0 } }), null);
  assert.deepEqual(readExceptionReduction({ luz: { excecao: 10 }, frio: { excecao: 5 } }), {
    amount: 10,
    except: new Set(["luz", "frio"])
  });
});

test("resolveReductions applies the exception RD once, up to the non-excepted damage", () => {
  const exception = { amount: 10, except: new Set(["luz"]) };
  const resolve = (parts, { rds = resistances(), penetration = 0, multiplier = 1 } = {}) =>
    resolveReductions({ groups: groupDamage(terms(parts)), resistances: rds, exception, multiplier, penetration });
  assert.equal(resolve([[15, "corte"], [6, "fogo"]]).general, 10);
  assert.equal(resolve([[15, "corte"], [6, "fogo"], [1, "luz"]]).general, 10);
  assert.equal(resolve([[3, "corte"], [20, "luz"]]).general, 3);
  assert.equal(resolve([[21, "luz"]]).general, 0);
  assert.equal(resolve([[8, "corte"], [4, "fogo"]]).general, 10);
  assert.equal(resolve([[21, "corte"]], { penetration: 10 }).general, 0);
  assert.equal(resolve([[15, "corte"], [6, "fogo"]], { penetration: 10 }).general, 0);
  assert.equal(resolve([[15, "corte"], [6, "fogo"]], { penetration: 4 }).general, 6);

  const mixed = resolve([[15, "corte"], [6, "fogo"]], { rds: resistances({ general: 5, typed: { corte: 3 } }), penetration: 12 });
  assert.equal(mixed.general, 6);
  assert.equal(mixed.typed.get("corte"), 0);

  const light = resolve([[21, "luz"]], { rds: resistances({ typed: { luz: 5 } }), penetration: 10 });
  assert.equal(light.general, 0);
  assert.equal(light.typed.get("luz"), 0);
  assert.equal(resolve([[3, "corte"], [20, "luz"]], { rds: resistances({ typed: { luz: 5 } }), penetration: 10 }).general, 3);

  const immune = resolve([[15, "corte"], [6, "fogo"]], { rds: resistances({ flags: { corte: { imunidade: true } } }) });
  assert.equal(immune.absorbed, 6);
  const vulnerable = resolve([[6, "fogo"]], { rds: resistances({ flags: { fogo: { vulnerabilidade: true } } }) });
  assert.equal(vulnerable.absorbed, 9);
});

test("handOver changes the prepared data and the undo restores it", () => {
  const rds = resistances({ typed: { corte: 3 } });
  const before = JSON.stringify(rds);
  const exception = readExceptionReduction(rds);
  const restore = handOver(rds, exception, { general: 7, typed: new Map([["corte", 0]]) });
  assert.equal(rds.dano.value, 7);
  assert.equal(rds.luz.excecao, 0);
  assert.equal(rds.corte.value, 0);
  restore();
  assert.equal(JSON.stringify(rds), before);
});

test("diagnoseFingerprint only recognizes the 1.6.5 code and never answers fixed", () => {
  assert.deepEqual(
    [diagnoseFingerprint(KNOWN_APPLY_DAMAGE_V2).bug, diagnoseFingerprint(KNOWN_APPLY_DAMAGE_V2).confidence],
    ["present", "high"]
  );
  for (const other of ["deadbeef:10", null]) {
    assert.equal(diagnoseFingerprint(other).bug, "unknown");
    assert.equal(diagnoseFingerprint(other).confidence, "low");
  }
});

test("the fixture is the verified applyDamageV2", () => {
  assert.equal(sourceFingerprint(Function.prototype.toString.call(System.prototype.applyDamageV2)), KNOWN_APPLY_DAMAGE_V2);
});

/* -------------------------------------------- */
/*  Integration with the real applyDamageV2     */
/* -------------------------------------------- */

test("patched applyDamageV2 follows the book against RD 10/luz", async () => {
  const cases = [
    [[[15, "corte"], [6, "fogo"]], {}, 89],
    [[[15, "corte"], [6, "fogo"], [1, "luz"]], {}, 88],
    [[[8, "corte"], [4, "fogo"]], {}, 98],
    [[[21, "corte"]], {}, 89],
    [[[21, "luz"]], {}, 79],
    [[[3, "corte"], [20, "luz"]], {}, 80],
    [[[15, "corte"], [6, "fogo"]], { multiplier: 0.5 }, 99.5],
    [[[21, "corte"]], { penetration: 10 }, 79],
    [[[15, "corte"], [6, "fogo"]], { penetration: 10 }, 79],
    [[[15, "corte"], [6, "fogo"]], { penetration: 4 }, 85],
    [[[15, "corte"], [6, "fogo"]], { multiplier: -1 }, 100],
    [[[10, "curapv"]], {}, 90]
  ];
  for (const [parts, options, expected] of cases) {
    const result = await hpAfter(Patched, {}, parts, options);
    assert.equal(result.hp, expected, JSON.stringify({ parts, options }));
    assert.ok(result.rdsUnchanged);
    assert.ok(result.rollUnchanged);
  }
  // Healing (multiplier <= 0) is untouched: an actor at 90 HP healed by 10 goes back to 100.
  const actor = new Patched(resistances());
  actor.system.attributes.pv.value = 90;
  await actor.applyDamageV2({ terms: terms([[10, "corte"]]), options: {} }, -1);
  assert.equal(actor.updates["system.attributes.pv.value"], 100);
});

test("patched applyDamageV2 matches the fixed results of the issue, system column unchanged", async () => {
  const light5 = { typed: { luz: 5 } };
  const mixed = { general: 5, typed: { corte: 3 } };
  const mixedLight = { general: 5, typed: { corte: 3, luz: 5 } };
  const rows = [
    [{}, [[15, "corte"], [6, "fogo"]], 0, 5, 11],
    [{}, [[15, "corte"], [6, "fogo"], [1, "luz"]], 0, 6, 12],
    [{}, [[8, "corte"], [4, "fogo"]], 0, 0, 2],
    [{}, [[21, "corte"]], 0, 11, 11],
    [{}, [[21, "luz"]], 0, 21, 21],
    [{}, [[3, "corte"], [20, "luz"]], 0, 20, 20],
    [{}, [[21, "corte"]], 10, 11, 21],
    [{}, [[15, "corte"], [6, "fogo"]], 10, 5, 21],
    [{}, [[15, "corte"], [6, "fogo"]], 4, 5, 15],
    [{}, [[21, "luz"]], 10, 21, 21],
    [light5, [[21, "luz"]], 0, 16, 16],
    [light5, [[21, "luz"]], 10, 21, 21],
    [light5, [[15, "corte"], [21, "luz"]], 0, 21, 21],
    [light5, [[15, "corte"], [21, "luz"]], 10, 26, 31],
    [light5, [[15, "corte"], [21, "luz"]], 15, 26, 36],
    [light5, [[3, "corte"], [20, "luz"]], 10, 20, 20],
    [mixed, [[15, "corte"], [6, "fogo"]], 0, 0, 3],
    [mixed, [[15, "corte"], [6, "fogo"]], 12, 5, 15],
    [mixed, [[21, "corte"]], 0, 3, 3],
    [mixed, [[21, "corte"]], 20, 11, 21],
    [mixedLight, [[15, "corte"], [6, "fogo"], [21, "luz"]], 0, 13, 19],
    [mixedLight, [[15, "corte"], [6, "fogo"], [21, "luz"]], 12, 25, 31],
    [mixedLight, [[15, "corte"], [6, "fogo"], [21, "luz"]], 20, 26, 39],
    [mixedLight, [[21, "luz"]], 8, 19, 19]
  ];
  for (const [rds, parts, penetration, system, patched] of rows) {
    const label = JSON.stringify({ rds, parts, penetration });
    assert.equal(100 - (await hpAfter(System, rds, parts, { penetration })).hp, system, `system ${label}`);
    const result = await hpAfter(Patched, rds, parts, { penetration });
    assert.equal(100 - result.hp, patched, `patched ${label}`);
    assert.ok(result.rdsUnchanged, label);
  }
});

test("actors without an exception RD keep the system result", async () => {
  const rds = { general: 5, typed: { corte: 3 }, exception: {} };
  for (const penetration of [undefined, 0, 4, 12]) {
    const parts = [[15, "corte"], [6, "fogo"]];
    assert.equal((await hpAfter(Patched, rds, parts, { penetration })).hp, (await hpAfter(System, rds, parts, { penetration })).hp);
  }
});

test("property: never less damage than the system, excepted-only attacks unchanged, data restored", async () => {
  let seed = 64;
  const rand = (n) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) % n;
  };
  const flavors = ["corte", "fogo", "luz", "frio"];
  for (let i = 0; i < 2000; i++) {
    const exception = rand(3) ? { luz: 10 } : { luz: 10, frio: 10 };
    const typed = Object.fromEntries(flavors.map((f) => [f, rand(8)]));
    const rds = { general: rand(10), typed, exception };
    const parts = Array.from({ length: 1 + rand(3) }, () => [rand(25), flavors[rand(4)]]);
    const penetration = rand(25);
    const multiplier = [1, 0.5, 2][rand(3)];
    const system = await hpAfter(System, rds, parts, { penetration, multiplier });
    const patched = await hpAfter(Patched, rds, parts, { penetration, multiplier });
    const label = JSON.stringify({ rds, parts, penetration, multiplier });
    assert.ok(patched.hp <= system.hp, label);
    if (parts.every(([, f]) => exception[f])) assert.equal(patched.hp, system.hp, label);
    assert.ok(patched.rdsUnchanged, label);
  }
});

/* -------------------------------------------- */
/*  Probe and unknown code                      */
/* -------------------------------------------- */

const MODES = [
  ["auto", "1.6.5"],
  ["off", "1.6.5"],
  ["force", "1.6.5"],
  ["auto", "1.7.0"],
  ["force", "1.7.0"]
];

test("isNeeded never runs applyDamageV2 and only recognizes the 1.6.5 code", () => {
  let calls = 0;
  class Unknown {
    async applyDamageV2(roll, multiplier = 1, type = "dano") {
      calls++;
    }
  }
  globalThis.CONFIG = { Actor: { documentClass: Unknown } };
  const unknownStates = MODES.map(([mode, systemVersion]) => {
    const { state, diagnosis } = resolvePatchState({ patch, mode, systemId: "tormenta20", systemVersion, probe: patch.isNeeded });
    assert.equal(diagnosis.bug, "unknown");
    assert.equal(diagnosis.confidence, "low");
    return state;
  });
  assert.deepEqual(unknownStates, ["applied", "disabled", "forced", "unverified", "forced"]);

  // Running the real method on the prototype would throw (no this.system), and the probe would answer unknown.
  globalThis.CONFIG = { Actor: { documentClass: realClass() } };
  const knownStates = MODES.map(([mode, systemVersion]) => {
    const { state, diagnosis } = resolvePatchState({ patch, mode, systemId: "tormenta20", systemVersion, probe: patch.isNeeded });
    assert.equal(diagnosis.bug, "present");
    assert.equal(diagnosis.confidence, "high");
    return state;
  });
  assert.deepEqual(knownStates, ["applied", "disabled", "forced", "applied-unverified", "forced"]);
  assert.equal(calls, 0);
});

test("on unrecognized code the wrapper passes the original roll and leaves the data alone", async () => {
  const seen = [];
  class Unknown {
    constructor() {
      this.system = { tracos: { resistencias: resistances() } };
    }
    async applyDamageV2(roll, multiplier = 1, type = "dano") {
      seen.push({ roll, excecao: this.system.tracos.resistencias.luz.excecao, general: this.system.tracos.resistencias.dano.value });
    }
  }
  globalThis.CONFIG = { Actor: { documentClass: Unknown } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    patch.apply();
  } finally {
    console.warn = warn;
  }
  const roll = { terms: terms([[15, "corte"], [6, "fogo"]]), options: { rd: 4 } };
  await new Unknown().applyDamageV2(roll, 1);
  assert.equal(seen[0].roll, roll);
  assert.equal(seen[0].excecao, 10);
  assert.equal(seen[0].general, "");
});

test("the wrapper restores the data even when the original throws synchronously", () => {
  const Real = realClass();
  globalThis.CONFIG = { Actor: { documentClass: Real } };
  patch.apply();
  const actor = new Real(resistances());
  const before = JSON.stringify(actor.system.tracos.resistencias);
  // A roll whose terms throw on the second read: the first read (patch) works, the system's loop throws.
  let reads = 0;
  const parts = terms([[15, "corte"], [6, "fogo"]]);
  const roll = {
    get terms() {
      if (reads++) throw new Error("boom");
      return parts;
    },
    options: {}
  };
  return assert.rejects(actor.applyDamageV2(roll, 1), /boom/).then(() => {
    assert.equal(JSON.stringify(actor.system.tracos.resistencias), before);
  });
});
