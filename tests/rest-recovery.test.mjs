import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  correctRestArgs,
  diagnoseCareSamples,
  isKnownDescanso,
  isNeeded,
  measureCareRecovery,
  PROBE_CASES
} from "../scripts/patches/rest-recovery.mjs";

// Copy of ActorT20#descanso from tormenta20 1.6.5 (T20:7038-7078), with a comment and different line breaks.
class Actor165 {
	// the system's rest method
	async descanso(modificador = 1, modPV = 0, modPM = 0, curaCP = false, curaAC = false, toChat = true) {
		let descricao = "";
		const nivel = this.system.attributes.nivel.value;
		let rec = { pv: 0,
			pm: 0 };

		let cp = curaCP ? 2 : 1; /* doubles everything */
		let ac = curaAC ? 2 : 1;
		let recuperarPV = Math.floor(nivel * (modificador + modPV) * cp);
		rec.pv = recuperarPV;
		await this.modifyTokenAttribute("attributes.pv", recuperarPV, true, true);

		let recuperarPM = Math.floor(nivel * (modificador + modPM) * ac);
		rec.pm = recuperarPM;
		await this.modifyTokenAttribute("attributes.pm", recuperarPM, true, true);

		descricao = `${this.name} recuperou ${rec.pv} PV e ${rec.pm} PM.`;

		if (!toChat) return descricao;
		throw new Error("chat not available in tests");
	}
}

class ActorFixed {
	async descanso(modificador = 1, modPV = 0, modPM = 0, curaCP = false, curaAC = false, toChat = true) {
		const nivel = this.system.attributes.nivel.value;
		const recuperarPV = Math.floor(nivel * (modificador + modPV)) + (curaCP ? nivel : 0);
		await this.modifyTokenAttribute("attributes.pv", recuperarPV, true, true);
	}
}

function fakeActor(nivel) {
  const calls = [];
  return {
    calls,
    name: "Guerreiro",
    system: { attributes: { nivel: { value: nivel } } },
    async modifyTokenAttribute(attribute, value) {
      calls.push([attribute, value]);
    }
  };
}

async function rest(nivel, args) {
  const actor = fakeActor(nivel);
  const descricao = await Actor165.prototype.descanso.apply(actor, args);
  return { pv: actor.calls[0][1], pm: actor.calls[1][1], descricao };
}

function withConfig(documentClass, fn) {
  const previous = globalThis.CONFIG;
  globalThis.CONFIG = { Actor: { documentClass } };
  try {
    return fn();
  } finally {
    globalThis.CONFIG = previous;
  }
}

test("correctRestArgs turns prolonged care into one more extra HP per level", () => {
  assert.deepEqual(correctRestArgs([3, 0, 0, true, false, false]), [3, 1, 0, false, false, false]);
  assert.deepEqual(correctRestArgs([0.5, 2, 1, true]), [0.5, 3, 1, false]);
  assert.deepEqual(correctRestArgs([1, undefined, 0, true]), [1, 1, 0, false]);
  assert.deepEqual(correctRestArgs([1, 0, 0, 1]), [1, 1, 0, false]);
});

test("correctRestArgs passes through calls without prolonged care or with an unusable extra HP", () => {
  for (const args of [[2], [2, 0, 0, false, true], [1, NaN, 0, true], [1, "2", 0, true], []]) {
    assert.deepEqual(correctRestArgs(args), args);
  }
});

test("the 1.6.5 method with corrected arguments follows the rule and keeps MP", async () => {
  assert.deepEqual(await rest(4, correctRestArgs([3, 0, 0, true, false, false])), {
    pv: 16, pm: 12, descricao: "Guerreiro recuperou 16 PV e 12 PM."
  });
  assert.deepEqual((await rest(3, correctRestArgs([0.5, 0, 0, true, false, false]))).pv, 4);
  assert.deepEqual((await rest(7, correctRestArgs([0.5, 0, 0, true, false, false]))).pv, 10);
  assert.deepEqual(await rest(4, correctRestArgs([1, 2, 0, true, false, false])), {
    pv: 16, pm: 4, descricao: "Guerreiro recuperou 16 PV e 4 PM."
  });
  assert.deepEqual((await rest(4, correctRestArgs([3, 0, 0, false, false, false]))).pv, 12);
});

test("isKnownDescanso recognizes only the 1.6.5 source", () => {
  assert.equal(isKnownDescanso(Actor165.prototype.descanso), true);
  assert.equal(isKnownDescanso(ActorFixed.prototype.descanso), false);
  assert.equal(isKnownDescanso(function (...args) { return Actor165.prototype.descanso.apply(this, args); }), false);
  assert.equal(isKnownDescanso("async descanso() {}"), false);
  assert.equal(isKnownDescanso(undefined), false);
});

test("the probe measures the 1.6.5 bug without reaching MP or chat", () => {
  const observed = [];
  for (const sample of PROBE_CASES) {
    let calls = 0;
    const descanso = function (...args) {
      const proxy = new Proxy(this, {
        get(target, key) {
          if (key !== "modifyTokenAttribute") return target[key];
          return (...a) => { calls++; return target.modifyTokenAttribute(...a); };
        }
      });
      return Actor165.prototype.descanso.apply(proxy, args);
    };
    observed.push({ ...sample, observed: measureCareRecovery(descanso, sample) });
    assert.equal(calls, 1);
  }
  assert.deepEqual(observed.map((s) => s.observed), [3, 32]);
  assert.deepEqual(
    { bug: diagnoseCareSamples(observed).bug, confidence: diagnoseCareSamples(observed).confidence },
    { bug: "present", confidence: "high" }
  );
});

test("diagnoseCareSamples never reports fixed", () => {
  const [ruim, luxuoso] = PROBE_CASES;
  const cases = [
    [{ ...ruim, observed: 4 }, { ...luxuoso, observed: 20 }],
    [{ ...ruim, observed: 3 }, { ...luxuoso, observed: 20 }],
    [{ ...ruim, observed: 7 }, { ...luxuoso, observed: 1 }],
    [{ ...ruim, observed: undefined }, { ...luxuoso, observed: 32 }],
    []
  ];
  for (const samples of cases) {
    const { bug, confidence } = diagnoseCareSamples(samples);
    assert.deepEqual({ bug, confidence }, { bug: "unknown", confidence: "low" });
  }
});

test("measureCareRecovery returns undefined when the method fails before the HP update", () => {
  const throwsSync = function () { throw new Error("boom"); };
  const rejects = async function () { throw new Error("boom"); };
  assert.equal(measureCareRecovery(throwsSync, PROBE_CASES[0]), undefined);
  assert.equal(measureCareRecovery(rejects, PROBE_CASES[0]), undefined);
});

test("isNeeded never runs an unknown descanso", () => {
  let runs = 0;
  class Other {
    async descanso() {
      runs++;
      await this.modifyTokenAttribute("attributes.pv", 0, true, true);
    }
  }
  const diagnosis = withConfig(Other, isNeeded);
  assert.equal(runs, 0);
  assert.deepEqual({ bug: diagnosis.bug, confidence: diagnosis.confidence }, { bug: "unknown", confidence: "low" });
  assert.equal(withConfig(class {}, isNeeded).bug, "unknown");
});

test("isNeeded reports the bug on the 1.6.5 method, also behind this module's wrapper", () => {
  class Actor extends Actor165 {}
  assert.deepEqual(withConfig(Actor, () => {
    const { bug, confidence } = isNeeded();
    return { bug, confidence };
  }), { bug: "present", confidence: "high" });
  withConfig(Actor, () => {
    patch.apply();
    assert.equal(isNeeded().bug, "present");
  });
});

test("apply wraps descanso, preserving this and the return value", async () => {
  class Actor extends Actor165 {}
  Actor.prototype.descanso = Actor165.prototype.descanso;
  withConfig(Actor, () => patch.apply());
  const actor = Object.assign(Object.create(Actor.prototype), fakeActor(4));
  const descricao = await actor.descanso(3, 0, 0, true, false, false);
  assert.equal(descricao, "Guerreiro recuperou 16 PV e 12 PM.");
  assert.deepEqual(actor.calls, [["attributes.pv", 16], ["attributes.pm", 12]]);
});
