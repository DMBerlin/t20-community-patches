import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveNonlethal,
  hpSnapshotOf,
  isExplicitNonlethalEdit,
  lethalHp,
  lethalSnapshot,
  nonlethalForUpdate,
  nonlethalOf,
  onCaptureClick,
  onPreUpdateActor,
  pickDamageRoll,
  readChange,
  restorePreparedMin,
  rebaseSnapshot,
  recognizesDamageMethod,
  resolveHpUpdate,
  ruleEnabled,
  syncChatToggles,
  touchesLethalHp,
  widenedMin,
  widenPreparedMin,
  withNonlethalCall
} from "../scripts/rules/nonlethal-damage.mjs";

const MODULE = "t20-community-patches";

Math.clamp ??= (v, min, max) => Math.min(Math.max(v, min), max);

let setting = "off";
globalThis.game = {
  settings: {
    get(module, key) {
      if (setting instanceof Error) throw setting;
      assert.equal(module, MODULE);
      assert.equal(key, "nonlethalDamageRule");
      return setting;
    }
  },
  i18n: { localize: (k) => k, format: (k) => k }
};
const withSetting = (value, fn) => {
  const previous = setting;
  setting = value;
  try {
    return fn();
  } finally {
    setting = previous;
  }
};

/* -------------------------------------------- */
/*  Contract                                    */
/* -------------------------------------------- */

test("effectiveNonlethal: clamps to the missing HP and ignores invalid input", () => {
  assert.equal(effectiveNonlethal(-3, 6, 10), 0);
  assert.equal(effectiveNonlethal(8, 6, 10), 4);
  assert.equal(effectiveNonlethal(4, 12, 10), 0);
  assert.equal(effectiveNonlethal(4.7, 6, 10), 4);
  for (const args of [[NaN, 6, 10], [4, undefined, 10], [4, 6, NaN], [undefined, 6, 10]]) {
    assert.equal(effectiveNonlethal(...args), 0, String(args));
  }
});

test("nonlethalOf reads the flag as an integer >= 0", () => {
  const actor = (value) => ({ getFlag: (scope, key) => (scope === MODULE && key === "nonlethal" ? value : undefined) });
  assert.equal(nonlethalOf(actor(undefined)), 0);
  assert.equal(nonlethalOf(actor("3")), 3);
  assert.equal(nonlethalOf(actor(-2)), 0);
  assert.equal(nonlethalOf(actor(2.9)), 2);
  assert.equal(nonlethalOf({}), 0);
  assert.equal(nonlethalOf(undefined), 0);
});

test("ruleEnabled: only 'on'; false when the setting is not registered", () => {
  assert.equal(withSetting("on", ruleEnabled), true);
  assert.equal(withSetting("off", ruleEnabled), false);
  assert.equal(withSetting(new Error("not registered"), ruleEnabled), false);
});

test("lethalHp and widenedMin", () => {
  assert.equal(lethalHp(6, 4, 10), 10);
  assert.equal(lethalHp(-5, 15, 10), 10);
  assert.equal(lethalHp(0, 0, 10), 0);
  assert.equal(widenedMin(-5, 4), -9);
  assert.equal(widenedMin(-5, 0), -5);
});

test("lethalSnapshot is frozen and depends on the mode", () => {
  const on = lethalSnapshot({ value: 6, nonlethal: 4, max: 10, nonlethalOn: true });
  assert.ok(Object.isFrozen(on));
  assert.equal(on.lethal, 10);
  assert.equal(lethalSnapshot({ value: -10, nonlethal: 20, max: 10, nonlethalOn: true }).lethal, 10);
  const off = lethalSnapshot({ value: 6, nonlethal: 4, max: 10, nonlethalOn: false });
  assert.equal(off.lethal, 6);
  assert.equal(off.rawNonlethal, 4);
  assert.equal(off.nonlethal, 0);
});

test("rebaseSnapshot recomputes under the other mode from the confirmed data", () => {
  const on = lethalSnapshot({ value: -2, nonlethal: 12, max: 10, nonlethalOn: true });
  const off = rebaseSnapshot(on, false);
  assert.equal(off.lethal, -2);
  assert.ok(Object.isFrozen(off));
  assert.equal(rebaseSnapshot(off, true).lethal, 10);
  assert.equal(rebaseSnapshot(on, true), on);
  assert.equal(rebaseSnapshot(undefined, true), undefined);
});

test("hpSnapshotOf reads the prepared HP, the flag and the mode", () => {
  const actor = { system: { attributes: { pv: { value: 6, max: 10 } } }, getFlag: () => 4 };
  assert.equal(withSetting("on", () => hpSnapshotOf(actor)).lethal, 10);
  assert.equal(withSetting("off", () => hpSnapshotOf(actor)).lethal, 6);
});

test("touchesLethalHp: nested and dotted keys", () => {
  assert.equal(touchesLethalHp({ system: { attributes: { pv: { value: 3 } } } }), true);
  assert.equal(touchesLethalHp({ "system.attributes.pv.max": 12 }), true);
  assert.equal(touchesLethalHp({ flags: { [MODULE]: { nonlethal: 1 } } }), true);
  assert.equal(touchesLethalHp({ [`flags.${MODULE}.nonlethal`]: 1 }), true);
  assert.equal(touchesLethalHp({ system: { attributes: { pv: { temp: 3 } } } }), false);
  assert.equal(touchesLethalHp({ name: "x" }), false);
  assert.equal(touchesLethalHp(undefined), false);
});

/* -------------------------------------------- */
/*  Pure logic                                  */
/* -------------------------------------------- */

test("resolveHpUpdate", () => {
  assert.deepEqual(resolveHpUpdate({ before: 10, after: 6, nonlethal: 0, max: 10, isNonlethal: true }), { value: 6, nonlethal: 4 });
  assert.deepEqual(resolveHpUpdate({ before: 6, after: 9, nonlethal: 4, max: 10 }), { value: 9, nonlethal: 1 });
  assert.equal(resolveHpUpdate({ before: 6, after: 10, nonlethal: 4, max: 10 }).nonlethal, 0);
  assert.equal(resolveHpUpdate({ before: 6, after: 12, nonlethal: 4, max: 10 }).nonlethal, 0);
  assert.equal(resolveHpUpdate({ before: 6, after: 2, nonlethal: 4, max: 10, isNonlethal: false }).nonlethal, 4);
  assert.deepEqual(resolveHpUpdate({ before: 10, after: -10, nonlethal: 0, max: 10, isNonlethal: true }), { value: -10, nonlethal: 20 });
  assert.equal(resolveHpUpdate({ before: 6, after: 9, nonlethal: 4, max: 10, explicit: 2 }).nonlethal, 2);
  assert.deepEqual(resolveHpUpdate({ before: 6, after: 6, nonlethal: 4, max: 10 }), { value: 6, nonlethal: 4 });
});

test("isExplicitNonlethalEdit: a full form submission is not an edit", () => {
  assert.equal(isExplicitNonlethalEdit(4, 4, 4), false);
  assert.equal(isExplicitNonlethalEdit(2, 4, 4), true);
  assert.equal(isExplicitNonlethalEdit(0, undefined, 0), false);
  assert.equal(isExplicitNonlethalEdit(undefined, 4, 4), false);
  // Stale flag (12 stored, 4 shown): sending the shown value back is not an edit; clearing the field is.
  assert.equal(isExplicitNonlethalEdit(4, 12, 4), false);
  assert.equal(isExplicitNonlethalEdit("", 4, 4), true);
  assert.equal(isExplicitNonlethalEdit(null, 0, 0), false);
});

test("nonlethalForUpdate: explicit edits are limited to the missing HP", () => {
  const base = { before: 10, stored: 0, max: 10, isNonlethal: false, enabled: true };
  assert.equal(nonlethalForUpdate({ ...base, hp: { found: false }, flag: { found: true, value: 4 } }), 0);
  assert.equal(nonlethalForUpdate({ ...base, before: 6, hp: { found: false }, flag: { found: true, value: 9 } }), 4);
  assert.equal(nonlethalForUpdate({ ...base, hp: { found: true, value: 6 }, flag: { found: false } }), null);
  assert.equal(nonlethalForUpdate({ ...base, hp: { found: true, value: 6 }, flag: { found: false }, isNonlethal: true }), 4);
  assert.equal(nonlethalForUpdate({ ...base, hp: { found: true, value: 6 }, flag: { found: false }, isNonlethal: true, enabled: false }), null);
});

test("pickDamageRoll mirrors _onChatApplyDamage", () => {
  const a = { options: { title: "Dano" } };
  const b = { options: { title: "Dano", type: "damage" } };
  const c = { options: { title: "Dano", type: "attack" } };
  assert.equal(pickDamageRoll([a], "Dano"), a);
  assert.equal(pickDamageRoll([c, b], "Dano"), b);
  assert.equal(pickDamageRoll([c], "Dano"), undefined);
  assert.equal(pickDamageRoll([a], "Outro"), undefined);
  assert.equal(pickDamageRoll(undefined, "Dano"), undefined);
});

/** Copy of ActorT20#applyDamage (tormenta20 1.6.5). */
const SYSTEM_APPLY_DAMAGE = `async applyDamage(amount = 0, multiplier = 1, applyRD = false) {
  amount = Math.floor(parseInt(amount) * multiplier);
  const pv = this.system.attributes.pv;
  // Prepare Damage Reduction if damage
  const rd = applyRD ? this.system.tracos?.resistencias?.dano?.value || 0 : 0;
  amount = amount > 0 ? Math.max(amount - rd, 0) : amount;
  const tmp = parseInt(pv.temp) || 0;
  const dt = amount > 0 ? Math.min(tmp, amount) : 0;
  const dh = Math.clamp(pv.value - (amount - dt), pv.min, pv.max);
  const updates = {
    "system.attributes.pv.temp": tmp - dt,
    "system.attributes.pv.value": dh
  };
  const allowed = Hooks.call("modifyTokenAttribute", { attribute: "attributes.pv", value: amount, isDelta: false, isBar: true }, updates);
  return allowed !== false ? this.update(updates) : this;
}`;

test("recognizesDamageMethod", () => {
  assert.equal(recognizesDamageMethod(SYSTEM_APPLY_DAMAGE), true);
  assert.equal(recognizesDamageMethod(SYSTEM_APPLY_DAMAGE.replace("return allowed", "this.update({}); return allowed")), false);
  assert.equal(recognizesDamageMethod(SYSTEM_APPLY_DAMAGE.replace('"system.attributes.pv.value"', '"system.attributes.pv.x"')), false);
  assert.equal(recognizesDamageMethod(SYSTEM_APPLY_DAMAGE.replace("Math.clamp(", "Math.max(")), false);
  assert.equal(recognizesDamageMethod(SYSTEM_APPLY_DAMAGE.replace("const pv =", "this.#x; const pv =")), false);
  assert.equal(recognizesDamageMethod(SYSTEM_APPLY_DAMAGE.replace("// Prepare", "// this.update( Prepare")), true);
  assert.equal(recognizesDamageMethod(undefined), false);
});

/* -------------------------------------------- */
/*  Per-call Proxy                              */
/* -------------------------------------------- */

function fakeActor() {
  const calls = [];
  const actor = {
    name: "Glop",
    system: { attributes: { pv: { value: 10, min: -5, max: 10, temp: 0 }, pm: { value: 3 } }, tracos: { resistencias: { dano: { value: 0 } } } },
    async update(data, options) {
      await Promise.resolve();
      calls.push({ data, options, self: this });
      return this;
    },
    whoAmI() {
      return this;
    }
  };
  return { actor, calls };
}

test("withNonlethalCall: options, pv.min and this", async () => {
  const { actor, calls } = fakeActor();
  const proxy = withNonlethalCall(actor);
  assert.equal(proxy.system.attributes.pv.min, -Infinity);
  assert.equal(proxy.system.attributes.pv.value, 10);
  assert.equal(proxy.system.attributes.pv.temp, 0);
  assert.equal(proxy.system.attributes.pm, actor.system.attributes.pm);
  assert.equal(proxy.system.tracos, actor.system.tracos);
  assert.equal(actor.system.attributes.pv.min, -5);
  assert.equal(proxy.whoAmI(), actor);

  await proxy.update({ a: 1 }, { render: false, [MODULE]: { dyingStates: 1 } });
  assert.deepEqual(calls[0].options, { render: false, [MODULE]: { dyingStates: 1, nonlethal: true } });
  assert.equal(calls[0].self, actor);

  const second = withNonlethalCall(actor);
  await Promise.all([proxy.update({ b: 1 }, { x: 1 }), second.update({ c: 1 }, { y: 2 }), actor.update({ d: 1 }, {})]);
  assert.deepEqual(calls[1].options, { x: 1, [MODULE]: { nonlethal: true } });
  assert.deepEqual(calls[2].options, { y: 2, [MODULE]: { nonlethal: true } });
  assert.deepEqual(calls[3].options, {});
});

test("the system's applyDamage called with the Proxy is not cut by the floor", async () => {
  globalThis.Hooks = { call: () => true };
  const applyDamage = new Function(`return ({ ${SYSTEM_APPLY_DAMAGE} }).applyDamage;`)();
  const { actor, calls } = fakeActor();
  await applyDamage.call(withNonlethalCall(actor), 20, 1, true);
  assert.equal(calls[0].data["system.attributes.pv.value"], -10);
  assert.equal(calls[0].options[MODULE].nonlethal, true);
  await applyDamage.call(actor, 20, 1, true);
  assert.equal(calls[1].data["system.attributes.pv.value"], -5);
});

/* -------------------------------------------- */
/*  preUpdateActor                              */
/* -------------------------------------------- */

function hookActor({ type = "npc", value = 6, nonlethal = 4, max = 10 } = {}) {
  return {
    type,
    name: "Glop",
    _source: { system: { attributes: { pv: { value } } } },
    system: { attributes: { pv: { value, max, min: -5 } } },
    getFlag: (scope, key) => (scope === MODULE && key === "nonlethal" ? nonlethal : undefined)
  };
}
const flagOf = (changes) => readChange(changes, `flags.${MODULE}.nonlethal`);

test("preUpdateActor: nested and dotted changes", () => withSetting("on", () => {
  const nested = { system: { attributes: { pv: { value: 9 } } } };
  onPreUpdateActor(hookActor(), nested, {});
  assert.deepEqual(flagOf(nested), { found: true, value: 1 });

  const dotted = { "system.attributes.pv.value": 2 };
  onPreUpdateActor(hookActor(), dotted, { [MODULE]: { nonlethal: true } });
  assert.equal(nested.flags[MODULE].nonlethal, 1);
  assert.equal(dotted.flags[MODULE].nonlethal, 8);

  const dottedFlag = { "system.attributes.pv.value": 9, [`flags.${MODULE}.nonlethal`]: 4 };
  onPreUpdateActor(hookActor(), dottedFlag, {});
  assert.equal(Object.hasOwn(dottedFlag, `flags.${MODULE}.nonlethal`), false);
  assert.equal(dottedFlag.flags[MODULE].nonlethal, 1);
}));

test("preUpdateActor: full sheet submission heals N; a changed flag wins", () => withSetting("on", () => {
  const full = { system: { attributes: { pv: { value: 9, temp: 0 } } }, flags: { [MODULE]: { nonlethal: 4 } } };
  onPreUpdateActor(hookActor(), full, {});
  assert.equal(full.flags[MODULE].nonlethal, 1);

  const edit = { system: { attributes: { pv: { value: 6, temp: 0 } } }, flags: { [MODULE]: { nonlethal: 2 } } };
  onPreUpdateActor(hookActor(), edit, {});
  assert.equal(edit.flags[MODULE].nonlethal, 2);
}));

test("preUpdateActor: hazards and updates without HP are ignored", () => withSetting("on", () => {
  const changes = { system: { attributes: { pv: { value: 9 } } } };
  onPreUpdateActor(hookActor({ type: "hazard" }), changes, {});
  assert.equal(flagOf(changes).found, false);
  const other = { name: "x" };
  onPreUpdateActor(hookActor(), other, {});
  assert.deepEqual(other, { name: "x" });
}));

test("preUpdateActor with the rule off: only healing consumes N", () => withSetting("off", () => {
  const heal = { system: { attributes: { pv: { value: 9 } } } };
  onPreUpdateActor(hookActor(), heal, {});
  assert.equal(heal.flags[MODULE].nonlethal, 1);
  const damage = { system: { attributes: { pv: { value: 2 } } } };
  onPreUpdateActor(hookActor(), damage, { [MODULE]: { nonlethal: true } });
  assert.equal(flagOf(damage).found, false);
}));

test("preUpdateActor never throws", () => withSetting("on", () => {
  const error = console.error;
  console.error = () => {};
  try {
    const actor = hookActor();
    actor.getFlag = () => {
      throw new Error("boom");
    };
    assert.doesNotThrow(() => onPreUpdateActor(actor, { system: { attributes: { pv: { value: 9 } } } }, {}));
  } finally {
    console.error = error;
  }
}));

test("repeated preparations do not lower the floor twice", () => {
  // SimpleData keeps pv.min from the source and never resets it.
  const model = { attributes: { pv: { value: 6, max: 10, min: -5 } }, parent: { getFlag: () => 4 } };
  for (let i = 0; i < 3; i++) {
    restorePreparedMin(model);
    widenPreparedMin(model);
  }
  assert.equal(model.attributes.pv.min, -9);
  // A floor set again by the system (CharacterData, MenaceData) is kept as the new base.
  restorePreparedMin(model);
  model.attributes.pv.min = -7;
  widenPreparedMin(model);
  assert.equal(model.attributes.pv.min, -11);
  // Without N the floor goes back to the base.
  model.parent.getFlag = () => 0;
  restorePreparedMin(model);
  widenPreparedMin(model);
  assert.equal(model.attributes.pv.min, -7);
});

test("preUpdateActor: an explicit N is limited by the maximum sent in the same update", () => withSetting("on", () => {
  const raise = { system: { attributes: { pv: { max: 20 } } }, flags: { [MODULE]: { nonlethal: 10 } } };
  onPreUpdateActor(hookActor(), raise, {});
  assert.equal(raise.flags[MODULE].nonlethal, 10);
  const lower = { "system.attributes.pv.max": 8, [`flags.${MODULE}.nonlethal`]: 3 };
  onPreUpdateActor(hookActor(), lower, {});
  assert.equal(lower.flags[MODULE].nonlethal, 2);
}));

test("widenPreparedMin lowers the floor by the effective N", () => {
  const model = { attributes: { pv: { value: 0, max: 10, min: -5 } }, parent: { getFlag: () => 10 } };
  widenPreparedMin(model);
  assert.equal(model.attributes.pv.min, -15);
  const none = { attributes: { pv: { value: 10, max: 10, min: -5 } }, parent: { getFlag: () => 4 } };
  widenPreparedMin(none);
  assert.equal(none.attributes.pv.min, -5);
});

/* -------------------------------------------- */
/*  Chat controls                               */
/* -------------------------------------------- */

function fakeToggle(pressed) {
  const attrs = { "aria-pressed": String(pressed) };
  return {
    hidden: false,
    getAttribute: (k) => attrs[k],
    setAttribute: (k, v) => (attrs[k] = String(v))
  };
}

test("syncChatToggles hides and resets every toggle, and shows them again", () => {
  const toggles = [fakeToggle(true), fakeToggle(false)];
  const doc = { querySelectorAll: (selector) => (selector === "button.t20cp-nonlethal" ? toggles : []) };
  syncChatToggles(false, doc);
  assert.deepEqual(toggles.map((b) => [b.hidden, b.getAttribute("aria-pressed")]), [[true, "false"], [true, "false"]]);
  syncChatToggles(true, doc);
  assert.deepEqual(toggles.map((b) => b.hidden), [false, false]);
});

function chatClick({ mod, pressed, amount = 7 }) {
  const toggle = fakeToggle(pressed);
  const row = {
    dataset: { rollTitle: "Dano" },
    querySelector: (selector) => (selector === ".dice-total" ? { innerText: String(amount) } : selector === "button.t20cp-nonlethal" ? toggle : null)
  };
  const button = { dataset: { mod: String(mod) }, closest: (s) => (s === ".roll" ? row : null) };
  const event = {
    target: { closest: (s) => (s === ".apply-dmg" ? button : null) },
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {},
    stopImmediatePropagation() {}
  };
  return event;
}

test("capture listener: only intercepts with the rule on, a pressed toggle and damage", async () => {
  const applied = [];
  const actor = {
    name: "Glop",
    system: { attributes: { pv: { value: 10, min: -5, max: 10 } } },
    applyDamageV2(roll, mult) {
      applied.push({ self: this, roll, mult, min: this.system.attributes.pv.min });
    },
    applyDamage() {
      throw new Error("not expected");
    }
  };
  const roll = { options: { title: "Dano" } };
  const message = { rolls: [roll] };
  globalThis.canvas = { tokens: { controlled: [{ actor }] } };
  const warnings = [];
  globalThis.ui = { notifications: { warn: (m) => warnings.push(m) } };

  setting = "off";
  const off = chatClick({ mod: 1, pressed: true });
  assert.equal(onCaptureClick(off, message), undefined);
  assert.equal(off.prevented, false);
  setting = "on";
  try {
    for (const [mod, pressed] of [[1, false], [-1, true]]) {
      const event = chatClick({ mod, pressed });
      onCaptureClick(event, message);
      assert.equal(event.prevented, false, `mod ${mod} pressed ${pressed}`);
    }
    const event = chatClick({ mod: 0.5, pressed: true });
    await onCaptureClick(event, message);
    assert.equal(event.prevented, true);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].roll, roll);
    assert.equal(applied[0].mult, 0.5);
    assert.equal(applied[0].min, -Infinity);

    globalThis.canvas.tokens.controlled = [];
    await onCaptureClick(chatClick({ mod: 2, pressed: true }), message);
    assert.deepEqual(warnings, ["T20CP.NonlethalDamage.NoTokens"]);
  } finally {
    setting = "off";
  }
  assert.equal(actor.system.attributes.pv.min, -5);
});
