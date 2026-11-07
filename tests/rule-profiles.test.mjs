import { test } from "node:test";
import assert from "node:assert/strict";
import { FEATURES } from "../scripts/features/index.mjs";
import { RULE_PROFILES } from "../scripts/features/profiles.mjs";
import {
  CUSTOM,
  PROFILE_SETTING,
  matchingProfile,
  profileDiff,
  profileSettingSpec,
  profileWrites,
  resolveProfile,
  saveProfile
} from "../scripts/kernel/profiles.mjs";
import { applyInitialProfile, createProfileGuard } from "../scripts/kernel/rule-profile.mjs";
import { createSettingListeners } from "../scripts/kernel/settings.mjs";
import { createProfileController, profileOptions } from "../scripts/apps/patch-manager/profile.mjs";
import { createSubmitFlow } from "../scripts/apps/patch-manager/submit.mjs";
import { ruleBucket } from "../scripts/apps/patch-manager/view.mjs";
import { createFakePlatform } from "./support/fake-platform.mjs";

const PROFILES = { a: { x: "off", y: "off" }, b: { x: "on", y: "off" } };

/** Settings that log every write and can fail on a key; `onSet` runs after each write, like a core onChange. */
function fakeSettings(initial, { failOn, onSet } = {}) {
  const store = new Map(Object.entries(initial));
  const writes = [];
  return {
    store,
    writes,
    get: (key) => store.get(key),
    async set(key, value) {
      if (key === failOn) throw new Error(`cannot write ${key}`);
      store.set(key, value);
      writes.push([key, value]);
      onSet?.(key, value);
      return value;
    }
  };
}

const user = (active = true) => ({ isActiveGM: () => active });

/** Timers run by hand: `flush()` runs the pending one. */
function manualTimers() {
  let pending = null;
  return {
    set: (fn) => (pending = fn),
    clear: () => (pending = null),
    get pending() {
      return pending;
    },
    flush() {
      const fn = pending;
      pending = null;
      fn?.();
    }
  };
}

test("every profile sets every optional rule key of the Center to a valid value, and no patch key", () => {
  const specs = FEATURES.filter((f) => f.kind === "rule").flatMap((f) => (f.settings ?? []).filter((s) => s.center !== false));
  const patchKeys = FEATURES.filter((f) => f.kind !== "rule").flatMap((f) => (f.settings ?? []).map((s) => s.key));
  assert.ok(specs.length > 0);
  for (const [id, values] of Object.entries(RULE_PROFILES.values)) {
    assert.deepEqual(Object.keys(values).sort(), specs.map((s) => s.key).sort(), id);
    for (const spec of specs) {
      const value = values[spec.key];
      if (spec.choices) assert.ok(Object.hasOwn(spec.choices, value), `${id}.${spec.key}=${value}`);
      else assert.equal(typeof value, typeof spec.default, `${id}.${spec.key}`);
    }
    for (const key of patchKeys) assert.equal(Object.hasOwn(values, key), false, `${id}.${key}`);
  }
  assert.ok(Object.hasOwn(RULE_PROFILES.values, RULE_PROFILES.neutral));
  assert.ok(Object.hasOwn(RULE_PROFILES.values, RULE_PROFILES.recommended));
  assert.deepEqual(Object.keys(profileSettingSpec(RULE_PROFILES.values).choices), [...Object.keys(RULE_PROFILES.values), CUSTOM]);
});

test("matchingProfile and resolveProfile: a profile holds only while all its values match; custom never resolves to one", () => {
  assert.equal(matchingProfile(PROFILES, { x: "on", y: "off" }), "b");
  assert.equal(matchingProfile(PROFILES, { x: "warn", y: "off" }), null);
  assert.equal(resolveProfile({ stored: "a", values: { x: "off", y: "off" }, profiles: PROFILES }), "a");
  assert.equal(resolveProfile({ stored: "a", values: { x: "on", y: "off" }, profiles: PROFILES }), CUSTOM);
  assert.equal(resolveProfile({ stored: CUSTOM, values: { x: "off", y: "off" }, profiles: PROFILES }), CUSTOM);
  assert.equal(resolveProfile({ stored: "gone", values: { x: "off", y: "off" }, profiles: PROFILES }), CUSTOM);
});

test("profileWrites: a ready-made profile restores every saved value that differs, keeping the other form changes", () => {
  const values = { x: "on", y: "warn" };
  const changes = [{ key: "y", value: "on" }, { key: "z", value: 3 }];
  assert.deepEqual(profileDiff(PROFILES, "a", values), [{ key: "x", from: "on", to: "off" }, { key: "y", from: "warn", to: "off" }]);
  assert.deepEqual(profileWrites({ profiles: PROFILES, target: "a", values, changes }), [
    { key: "z", value: 3 },
    { key: "x", value: "off" },
    { key: "y", value: "off" }
  ]);
  assert.equal(profileWrites({ profiles: PROFILES, target: CUSTOM, values, changes }), changes);
});

test("saveProfile: custom first, then the rules, then the profile; no write when nothing changes", async () => {
  const settings = fakeSettings({ [PROFILE_SETTING]: "b", x: "on", y: "off" });
  assert.equal(await saveProfile({ settings, profiles: PROFILES, target: "a", writes: [{ key: "x", value: "off" }] }), "a");
  assert.deepEqual(settings.writes, [[PROFILE_SETTING, CUSTOM], ["x", "off"], [PROFILE_SETTING, "a"]]);

  settings.writes.length = 0;
  assert.equal(await saveProfile({ settings, profiles: PROFILES, target: "a", writes: [] }), "a");
  assert.deepEqual(settings.writes, []);

  assert.equal(await saveProfile({ settings, profiles: PROFILES, target: CUSTOM, writes: [] }), CUSTOM);
  assert.deepEqual(settings.writes, [[PROFILE_SETTING, CUSTOM]]);
});

test("saveProfile: a failed rule write leaves custom, never a profile that does not hold", async () => {
  const settings = fakeSettings({ [PROFILE_SETTING]: "b", x: "on", y: "off" }, { failOn: "y" });
  const writes = [{ key: "x", value: "off" }, { key: "y", value: "on" }];
  await assert.rejects(saveProfile({ settings, profiles: PROFILES, target: CUSTOM, writes }));
  assert.equal(settings.store.get(PROFILE_SETTING), CUSTOM);
});

test("saveProfile: a target whose values do not hold after the writes is saved as custom", async () => {
  const settings = fakeSettings({ [PROFILE_SETTING]: CUSTOM, x: "on", y: "on" });
  assert.equal(await saveProfile({ settings, profiles: PROFILES, target: "a", writes: [{ key: "x", value: "off" }] }), CUSTOM);
  assert.deepEqual(settings.writes, [["x", "off"]]);
});

test("profile guard: the active GM turns a broken profile into custom, once per batch", async () => {
  const timers = manualTimers();
  const listeners = createSettingListeners();
  const settings = fakeSettings({ [PROFILE_SETTING]: "a", x: "off", y: "off" }, { onSet: (key, value) => listeners.emit(key, value) });
  const guard = createProfileGuard({ settings, user: user(), profiles: PROFILES, timers });
  guard.listen(listeners);

  await settings.set("x", "on");
  await settings.set("y", "on");
  settings.writes.length = 0;
  timers.flush();
  await guard.check();
  assert.equal(settings.store.get(PROFILE_SETTING), CUSTOM);
  assert.deepEqual(settings.writes, [[PROFILE_SETTING, CUSTOM]]);
});

test("profile guard: nothing is written by a client that is not the active GM, or for a profile that holds", async () => {
  const settings = fakeSettings({ [PROFILE_SETTING]: "a", x: "on", y: "off" });
  await createProfileGuard({ settings, user: user(false), profiles: PROFILES }).check();
  assert.deepEqual(settings.writes, []);

  settings.store.set("x", "off");
  await createProfileGuard({ settings, user: user(), profiles: PROFILES }).check();
  assert.deepEqual(settings.writes, []);
});

test("profile guard: losing the GM role during the check writes nothing", async () => {
  let calls = 0;
  const settings = fakeSettings({ [PROFILE_SETTING]: "a", x: "on", y: "off" });
  await createProfileGuard({ settings, user: { isActiveGM: () => ++calls === 1 }, profiles: PROFILES }).check();
  assert.deepEqual(settings.writes, []);
});

test("profile guard: during a save, the writes of the protocol never leave a spurious custom", async () => {
  const timers = manualTimers();
  const listeners = createSettingListeners();
  const settings = fakeSettings({ [PROFILE_SETTING]: "b", x: "on", y: "off" }, { onSet: (key, value) => listeners.emit(key, value) });
  const guard = createProfileGuard({ settings, user: user(), profiles: PROFILES, timers });
  guard.listen(listeners);

  const saving = saveProfile({ settings, profiles: PROFILES, target: "a", writes: [{ key: "x", value: "off" }] });
  // A check in the middle of the protocol finds "custom" and leaves it.
  await guard.check();
  await saving;
  timers.flush();
  await guard.check();
  assert.equal(settings.store.get(PROFILE_SETTING), "a");
});

test("profile guard: checks are queued one at a time, and a pending one covers new calls", async () => {
  const settings = fakeSettings({ [PROFILE_SETTING]: "a", x: "off", y: "off" });
  const guard = createProfileGuard({ settings, user: user(), profiles: PROFILES, timers: manualTimers() });
  const first = guard.check();
  assert.equal(guard.check(), first);
  settings.store.set("x", "on");
  await first;
  assert.equal(settings.store.get(PROFILE_SETTING), CUSTOM);
});

test("profile guard: a save queued after a pending custom write ends on the saved profile", async () => {
  let release;
  const settings = fakeSettings({ [PROFILE_SETTING]: "a", x: "on", y: "off" });
  const set = settings.set;
  settings.set = async (key, value) => {
    // The guard's write of "custom" is slow: it lands after anything not queued behind it.
    if (key === PROFILE_SETTING && value === CUSTOM && !release) await new Promise((resolve) => (release = resolve));
    return set(key, value);
  };
  const guard = createProfileGuard({ settings, user: user(), profiles: PROFILES, timers: manualTimers() });
  const checking = guard.check();
  await new Promise((resolve) => setImmediate(resolve));
  const saving = guard.exclusive(() => saveProfile({ settings, profiles: PROFILES, target: "a", writes: [{ key: "x", value: "off" }] }));
  release();
  await Promise.all([checking, saving]);
  assert.equal(settings.store.get(PROFILE_SETTING), "a");
  assert.equal(settings.store.get("x"), "off");
});

test("profile guard: a client that becomes the active GM checks again", async () => {
  const timers = manualTimers();
  const hooks = new Map();
  let active = false;
  const settings = fakeSettings({ [PROFILE_SETTING]: "a", x: "on", y: "off" });
  const guard = createProfileGuard({ settings, user: { isActiveGM: () => active }, profiles: PROFILES, timers });
  guard.watchAuthority({ on: (name, fn) => hooks.set(name, fn) });
  await guard.check();
  assert.deepEqual(settings.writes, []);

  active = true;
  hooks.get("userConnected")();
  timers.flush();
  await guard.check();
  assert.equal(settings.store.get(PROFILE_SETTING), CUSTOM);
  assert.equal(typeof hooks.get("updateUser"), "function");
});

test("applyInitialProfile: a new world gets the recommended profile from the active GM, and asks for a reload when needed", async () => {
  const catalog = { values: PROFILES, neutral: "a", recommended: "a" };
  const initial = { [PROFILE_SETTING]: CUSTOM, x: "on", y: "off" };

  const existing = fakeSettings(initial);
  assert.deepEqual(await applyInitialProfile({ fresh: false, settings: existing, user: user(), catalog, requiresReload: () => true, isStored: () => false }), { saved: false, reload: false });
  const player = fakeSettings(initial);
  assert.deepEqual(await applyInitialProfile({ fresh: true, settings: player, user: user(false), catalog, requiresReload: () => true, isStored: () => false }), { saved: false, reload: false });
  assert.deepEqual([...existing.writes, ...player.writes], []);

  const fresh = fakeSettings(initial);
  const result = await applyInitialProfile({ fresh: true, settings: fresh, user: user(), catalog, requiresReload: (key) => key === "x", isStored: () => false });
  assert.deepEqual(result, { saved: true, reload: true });
  assert.deepEqual(fresh.writes, [["x", "off"], [PROFILE_SETTING, "a"]]);

  const matching = fakeSettings({ ...initial, x: "off" });
  assert.deepEqual(await applyInitialProfile({ fresh: true, settings: matching, user: user(), catalog, requiresReload: () => true, isStored: () => false }), { saved: true, reload: false });
  assert.deepEqual(matching.writes, [[PROFILE_SETTING, "a"]]);
});

test("applyInitialProfile: losing the active GM role between writes stops writing and leaves custom", async () => {
  const catalog = { values: PROFILES, neutral: "a", recommended: "a" };
  const settings = fakeSettings({ [PROFILE_SETTING]: CUSTOM, x: "on", y: "on" });
  const result = await applyInitialProfile({ fresh: true, settings, user: { isActiveGM: () => settings.writes.length === 0 }, catalog, requiresReload: () => true, isStored: () => false });
  assert.deepEqual(result, { saved: false, reload: false });
  assert.deepEqual(settings.writes, [["x", "off"]]);
  assert.equal(settings.store.get(PROFILE_SETTING), CUSTOM);
});

test("applyInitialProfile: a profile saved by another client since init is kept", async () => {
  const catalog = { values: PROFILES, neutral: "a", recommended: "a" };
  // Another GM finished the initial profile and then saved "b" before this client reached "ready".
  const settings = fakeSettings({ [PROFILE_SETTING]: "b", x: "on", y: "off" });
  const result = await applyInitialProfile({ fresh: true, settings, user: user(), catalog, requiresReload: () => true, isStored: (key) => key === PROFILE_SETTING });
  assert.deepEqual(result, { saved: false, reload: false });
  assert.deepEqual(settings.writes, []);
});

test("ruleBucket: with neutral values, a row is off only while every setting is neutral", () => {
  assert.equal(ruleBucket(["show"], ["show"]), "off");
  assert.equal(ruleBucket(["off", "hide"], ["off", "show"]), "on");
  assert.equal(ruleBucket(["ends"], ["ends"]), "off");
  assert.equal(ruleBucket(["display"], ["ends"]), "on");
  assert.equal(ruleBucket(["unbounded"], ["unbounded"]), "off");
});

test("profileOptions: ready-made profiles, then custom; the recommended one is marked and the current one selected", () => {
  const options = profileOptions({ values: PROFILES, recommended: "a" }, "b", (key) => key);
  assert.deepEqual(options.map((o) => [o.id, o.label, o.selected]), [
    ["a", "T20CP.Profiles.a.Name T20CP.Profiles.Recommended", false],
    ["b", "T20CP.Profiles.b.Name", true],
    [CUSTOM, "T20CP.Profiles.custom.Name", false]
  ]);
});

test("submit: a profile is compared with the saved values, not the form, and its changes are confirmed before saving", async () => {
  const confirms = [];
  const dice = { DialogV2: { confirm: async (options) => (confirms.push(options), true) } };
  // Another GM changed y since the Center opened: the form has no change, but y is still restored.
  const platform = createFakePlatform({ dice, settings: { [PROFILE_SETTING]: CUSTOM, x: "off", y: "on", patches: {} } });
  const entry = (key) => ({ name: `Rule ${key}`, choices: { on: "On", off: "Off" }, requiresReload: key === "y" });
  const flow = createSubmitFlow(platform, { catalog: { values: PROFILES, neutral: "a", recommended: "a" }, entry });
  let closed = 0;
  let reloads = 0;
  platform.ui.reloadConfirm = async () => reloads++;
  await flow.submit({ close: async () => closed++ }, { patches: [], settings: [] }, "a");

  assert.equal(confirms.length, 1);
  assert.match(confirms[0].content, /Rule y: On → Off/);
  assert.doesNotMatch(confirms[0].content, /Rule x/);
  assert.equal(platform.settings.get("y"), "off");
  assert.equal(platform.settings.get(PROFILE_SETTING), "a");
  assert.equal(closed, 1);
  assert.equal(reloads, 1);
});

test("submit: a rule changed while the confirmation is open is confirmed again and the whole profile is applied", async () => {
  const confirms = [];
  const dice = {
    DialogV2: {
      confirm: async (options) => {
        confirms.push(options.content);
        if (confirms.length === 1) await platform.settings.set("y", "on");
        return true;
      }
    }
  };
  const platform = createFakePlatform({ dice, settings: { [PROFILE_SETTING]: CUSTOM, x: "on", y: "off", patches: {} } });
  const flow = createSubmitFlow(platform, { catalog: { values: PROFILES, neutral: "a", recommended: "a" } });
  await flow.submit({ close: async () => {} }, { patches: [], settings: [] }, "a");
  assert.equal(confirms.length, 2);
  assert.match(confirms[1], /y/);
  assert.deepEqual([platform.settings.get("x"), platform.settings.get("y"), platform.settings.get(PROFILE_SETTING)], ["off", "off", "a"]);
});

test("submit: cancelling the profile confirmation saves nothing", async () => {
  const dice = { DialogV2: { confirm: async () => false } };
  const platform = createFakePlatform({ dice, settings: { [PROFILE_SETTING]: CUSTOM, x: "on", y: "off", patches: {} } });
  const flow = createSubmitFlow(platform, { catalog: { values: PROFILES, neutral: "a", recommended: "a" } });
  let closed = 0;
  await flow.submit({ close: async () => closed++ }, { patches: [], settings: [] }, "a");
  assert.equal(platform.settings.get("x"), "on");
  assert.equal(platform.settings.get(PROFILE_SETTING), CUSTOM);
  assert.equal(closed, 0);
});

/** A Center form with the profile selector and one control per setting key. */
function fakeForm(profile, keys) {
  const select = { name: "profile", value: profile };
  const controls = Object.fromEntries(keys.map((key) => [key, { name: `setting:${key}`, value: "" }]));
  const hint = { textContent: "" };
  const live = { textContent: "" };
  const root = {
    querySelector(selector) {
      if (selector === 'select[name="profile"]') return select;
      if (selector === ".t20cp-profile-hint") return hint;
      if (selector === ".t20cp-profile-live") return live;
      return controls[/^\[name="setting:(.+)"\]$/.exec(selector)?.[1]] ?? null;
    },
    querySelectorAll: () => []
  };
  return { root, select, controls, hint, live };
}

test("profile controller: the selector previews a profile; only a profile key switches it to custom", () => {
  const platform = createFakePlatform({ settings: { [PROFILE_SETTING]: "a" } });
  const profile = createProfileController({ platform, catalog: { values: PROFILES, neutral: "a", recommended: "a" }, entry: () => undefined });
  const form = fakeForm("b", ["x", "y", "segmentedSceneMaxSegments"]);

  profile.onChange(form.root, form.select);
  assert.deepEqual([form.controls.x.value, form.controls.y.value], ["on", "off"]);
  assert.equal(form.hint.textContent, "T20CP.Profiles.b.Hint");

  profile.onChange(form.root, form.controls.segmentedSceneMaxSegments);
  assert.equal(form.select.value, "b");
  assert.equal(form.live.textContent, "");

  profile.onChange(form.root, form.controls.x);
  assert.equal(form.select.value, CUSTOM);
  assert.equal(form.live.textContent, "T20CP.Profiles.SwitchedToCustom");
});

test("submit: choosing custom over a ready-made profile saves custom without touching the rules", async () => {
  const platform = createFakePlatform({ settings: { [PROFILE_SETTING]: "a", x: "off", y: "off", patches: {} } });
  const flow = createSubmitFlow(platform, { catalog: { values: PROFILES, neutral: "a", recommended: "a" } });
  await flow.submit({ close: async () => {} }, { patches: [], settings: [] }, CUSTOM);
  assert.equal(platform.settings.get(PROFILE_SETTING), CUSTOM);
  assert.deepEqual([platform.settings.get("x"), platform.settings.get("y")], ["off", "off"]);
});
