import { test } from "node:test";
import assert from "node:assert/strict";
import { PATCH_FILTERS, RULE_FILTERS, facetCounts, matchesView, patchBucket, ruleBucket } from "../scripts/apps/patch-manager/view.mjs";
import {
  collectChanges,
  describeDiagnosis,
  filterButtons,
  groupRows,
  normalizeSearch,
  patchRow,
  patchSummary,
  pendingReload,
  ruleRow,
  searchText,
  settingField
} from "../scripts/apps/patch-manager/rows.mjs";
import { rovingIndex } from "../scripts/apps/patch-manager/focus.mjs";
import { createPatchManagerClass } from "../scripts/apps/patch-manager/app.mjs";
import { registerManagerMenu } from "../scripts/platform/manager-menu.mjs";
import { createFakePlatform } from "./support/fake-platform.mjs";

test("patchBucket: active is on, unneeded is fixed, attention stays, off is off", () => {
  assert.equal(patchBucket("active"), "on");
  assert.equal(patchBucket("attention"), "attention");
  assert.equal(patchBucket("unneeded"), "fixed");
  assert.equal(patchBucket("off"), "off");
});

test("ruleBucket: only the first setting decides, and settings without off are on", () => {
  assert.equal(ruleBucket(["off"]), "off");
  assert.equal(ruleBucket(["warn"]), "on");
  assert.equal(ruleBucket(["off", "show"]), "off");
  assert.equal(ruleBucket(["on", "off"]), "on");
  assert.equal(ruleBucket(["display"]), "on");
  assert.equal(ruleBucket([10]), "on");
});

const row = (group, bucket, search) => ({ group, bucket, search });
const view = (over = {}) => ({ query: "", group: null, filter: "all", ...over });

test("matchesView: query, group and filter", () => {
  const death = row("conditions", "on", "pv mínimo death-threshold");
  assert.equal(matchesView(death, view({ query: "death" })), true);
  assert.equal(matchesView(death, view({ query: "combate" })), false);
  assert.equal(matchesView(death, view({ query: "   " })), true);
  assert.equal(matchesView(death, view({ group: "combat" })), false);
  assert.equal(matchesView(death, view({ group: "conditions" })), true);
  assert.equal(matchesView(death, view({ filter: "off" })), false);
  assert.equal(matchesView(row("combat", "attention", "x"), view({ filter: "on" })), false);
  assert.equal(matchesView(death, view({ group: "combat" }), { ignoreGroup: true }), true);
  assert.equal(matchesView(death, view({ filter: "off" }), { ignoreFilter: true }), true);
});

test("facetCounts: groups ignore the selected group, filters ignore the selected filter", () => {
  const rows = [
    row("combat", "on", "a"),
    row("combat", "off", "b"),
    row("combat", "attention", "c"),
    row("actor", "on", "d"),
    row("actor", "off", "e"),
    row("combat", "fixed", "f")
  ];
  const counts = facetCounts(rows, view({ group: "combat", filter: "on" }), PATCH_FILTERS);
  assert.deepEqual(counts.groups, { combat: 1, actor: 1 });
  assert.equal(counts.allGroups, 2);
  assert.deepEqual(counts.filters, { all: 4, on: 1, off: 1, fixed: 1, attention: 1 });

  const searched = facetCounts(rows, view({ query: "a" }), PATCH_FILTERS);
  assert.deepEqual(searched.groups, { combat: 1 });
  assert.deepEqual(searched.filters, { all: 1, on: 1, off: 0, fixed: 0, attention: 0 });
});

test("facetCounts: a bucket outside the filter list only counts in all", () => {
  const counts = facetCounts([row("combat", "attention", "a"), row("combat", "on", "b")], view(), RULE_FILTERS);
  assert.deepEqual(counts.filters, { all: 2, on: 1, off: 0 });
});

/** Translations that echo the key (and the data), as the rows only pass them through. */
const text = {
  localize: (key) => `L(${key})`,
  format: (key, data) => `F(${key}${data ? ` ${JSON.stringify(data)}` : ""})`,
  escapeHTML: (value) => String(value).replaceAll("<", "&lt;"),
  lang: "pt-BR"
};
const GROUPS = ["conditions", "combat", "actor"];

test("groupRows: GROUPS order, unknown groups last, empty groups skipped", () => {
  const rows = [{ id: "a", group: "actor" }, { id: "b", group: "zzz" }, { id: "c", group: "conditions" }, { id: "d", group: "actor" }];
  const grouped = groupRows(rows, GROUPS, text.localize);
  assert.deepEqual(grouped.map((g) => g.id), ["conditions", "actor", "zzz"]);
  assert.equal(grouped[0].label, "L(T20CP.Groups.conditions)");
  assert.deepEqual(grouped[1].rows.map((r) => r.id), ["a", "d"]);
});

test("normalizeSearch and searchText: lowercase in the game language, keeping the accents", () => {
  assert.equal(normalizeSearch("PV MÍNIMO", "pt-BR"), "pv mínimo");
  assert.equal(normalizeSearch(undefined, "pt-BR"), "");
  assert.equal(normalizeSearch("I", "tr"), "ı");
  assert.equal(searchText("Ação Furtiva", "sneak-attack", "pt-BR"), "ação furtiva sneak-attack");
  assert.equal(matchesView({ group: "x", bucket: "on", search: searchText("Ação", "id", "pt-BR") }, view({ query: normalizeSearch("AÇÃO", "pt-BR") })), true);
});

test("filterButtons: localized labels and the disabled ones", () => {
  assert.deepEqual(filterButtons(["all", "attention"], text.localize, { attention: true }), [
    { id: "all", label: "L(T20CP.Manager.Filter.all)", disabled: false },
    { id: "attention", label: "L(T20CP.Manager.Filter.attention)", disabled: true }
  ]);
});

test("describeDiagnosis: empty without a diagnosis, escapes the evidence", () => {
  assert.equal(describeDiagnosis(undefined, text), "");
  const line = describeDiagnosis({ bug: "present", confidence: "high", evidence: "<b>" }, text);
  assert.match(line, /T20CP\.Diagnosis\.Line/);
  assert.match(line, /L\(T20CP\.Diagnosis\.Bug\.present\)/);
  assert.match(line, / \(&lt;b>\)/);
});

test("patchRow: state, bucket, icon and link from the status entry", () => {
  const patch = { id: "prone-defense", group: "conditions", issue: 7 };
  const bugs = "https://example.test/issues";
  const active = patchRow({ patch, entry: { state: "applied" }, mode: "force", bugs, versions: {} }, text);
  assert.equal(active.bucket, "on");
  assert.equal(active.icon, "fa-solid fa-circle-check");
  assert.deepEqual([active.enabled, active.always], [true, true]);
  assert.deepEqual(active.link, { url: `${bugs}/7`, label: "T20CP.Manager.Details" });
  assert.equal(active.search, "l(t20cp.patches.prone-defense.name) prone-defense");

  const error = patchRow({ patch, entry: { state: "error", reason: "<x>" }, mode: "auto", bugs, versions: {} }, text);
  assert.equal(error.bucket, "attention");
  assert.equal(error.iconClass, "error");
  assert.equal(error.link.label, "T20CP.Manager.Report");
  assert.match(error.stateHint, /&lt;x>/);

  const missing = patchRow({ patch: { id: "x", group: "actor" }, mode: "off", bugs: undefined, versions: {} }, text);
  assert.equal(missing.stateLabel, "L(T20CP.States.disabled.Label)");
  assert.equal(missing.bucket, "off");
  assert.equal(missing.link, null);
});

test("patchSummary and pendingReload: counts by category, reload when a saved mode differs from the loaded one", () => {
  const rows = [{ id: "a", mode: "auto" }, { id: "b", mode: "auto" }, { id: "c", mode: "off" }];
  const status = new Map([
    ["a", { state: "applied", mode: "auto" }],
    ["b", { state: "error", mode: "auto" }]
  ]);
  const { counts, summary } = patchSummary(rows, status, text);
  assert.deepEqual(counts, { active: 1, unneeded: 0, attention: 1, off: 1 });
  assert.equal(summary.split(" · ").length, 3);
  assert.match(summary, /T20CP\.Manager\.Count\.active\.one/);
  assert.equal(pendingReload(rows, status), false);
  assert.equal(pendingReload([{ id: "a", mode: "off" }], status), true);
});

test("ruleRow: one key is a single row, several keys a labeled row, none registered is null", () => {
  const entry = { key: "k", value: "off", label: "Regra Única" };
  const single = ruleRow({ id: "r", group: "combat", keys: ["k"] }, [entry], text);
  assert.equal(single.single, true);
  assert.equal(single.bucket, "off");
  assert.equal(single.search, "regra única r");
  const multi = ruleRow({ id: "m", group: "combat", keys: ["a", "b"] }, [{ ...entry, value: "on" }], text);
  assert.equal(multi.single, false);
  assert.equal(multi.label, "L(T20CP.Manager.Rules.m)");
  assert.equal(multi.bucket, "on");
  assert.equal(ruleRow({ id: "n", group: "combat", keys: ["a"] }, [], text), null);
});

/** Minimal foundry.data.fields: each field remembers its options and cleans like the real ones for these cases. */
class DataField {
  constructor(options) {
    this.options = options;
  }
  clean(value) {
    return value;
  }
}
const fields = {
  DataField,
  BooleanField: class extends DataField {},
  NumberField: class extends DataField {
    clean(value) {
      return Number(value);
    }
  },
  StringField: class extends DataField {}
};

test("settingField: the setting's own field, or one built from its type, range and choices", () => {
  const own = new fields.StringField({});
  assert.equal(settingField({ type: own }, fields), own);
  assert.ok(settingField({ type: Boolean }, fields) instanceof fields.BooleanField);
  assert.equal(settingField({ type: Boolean }, fields).options.initial, false);
  const number = settingField({ type: Number, default: 2, range: { min: 0, max: 5, step: 1 } }, fields);
  assert.deepEqual([number.options.min, number.options.max, number.options.step, number.options.initial], [0, 5, 1, 2]);
  const string = settingField({ type: String, choices: { a: "A" }, default: "a" }, fields);
  assert.ok(string instanceof fields.StringField);
  assert.deepEqual(string.options.choices, { a: "A" });
});

test("collectChanges: only the patches and settings this form changed", () => {
  const entries = { n: { type: Number, name: "N", requiresReload: true }, s: { type: String, name: "S" } };
  const changes = collectChanges(
    { "patch:a": true, "always:a": true, "patch:b": true, "patch:c": false, "setting:n": "3", "setting:s": "x", "setting:gone": "y" },
    {
      patches: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      snapshot: { a: "auto", b: "auto", c: "auto", d: "auto" },
      ruleSnapshot: { n: 2, s: "x", gone: "z", absent: "w" },
      entry: (key) => entries[key],
      fields
    }
  );
  assert.deepEqual(changes.patches, [{ id: "a", mode: "force" }, { id: "c", mode: "off" }]);
  assert.deepEqual(changes.settings.map(({ key, value, label, requiresReload }) => ({ key, value, label, requiresReload })), [
    { key: "n", value: 3, label: "N", requiresReload: true }
  ]);
});

test("rovingIndex: arrows wrap around, Home and End jump, other keys do nothing", () => {
  const arrows = { next: "ArrowRight", previous: "ArrowLeft" };
  assert.equal(rovingIndex("ArrowRight", 2, 3, arrows), 0);
  assert.equal(rovingIndex("ArrowLeft", 0, 3, arrows), 2);
  assert.equal(rovingIndex("Home", 2, 3, arrows), 0);
  assert.equal(rovingIndex("End", 0, 3, arrows), 2);
  assert.equal(rovingIndex("ArrowDown", 0, 3, arrows), undefined);
});

/** ApplicationV2 and HandlebarsApplicationMixin stand-ins: only what the Center calls on super. */
const apps = {
  ApplicationV2: class {
    async _prepareContext() {
      return {};
    }
  },
  HandlebarsApplicationMixin: (Base) => class extends Base {}
};

test("createPatchManagerClass: the context comes from the injected patches, rules and status", async () => {
  const StringField = class {
    toInput() {
      return { outerHTML: "<select></select>" };
    }
  };
  const core = { fields: { DataField: class {}, StringField } };
  const platform = createFakePlatform({ apps, core, settings: { patches: { a: "auto", b: "force" }, rule: "off" } });
  platform.foreignEntries.set("t20-community-patches.rule", { type: String, name: "Rule", hint: "Hint" });
  const patches = [{ id: "a", group: "combat", issue: 3 }, { id: "b", group: "actor" }];
  const rule = { id: "rule", group: "combat", settings: [{ key: "rule" }] };
  const status = [{ id: "a", state: "error", mode: "auto" }, { id: "b", state: "applied", mode: "auto" }];
  const PatchManager = createPatchManagerClass({ platform, features: [...patches, rule], patches, groups: ["actor", "combat"], status: () => status });
  const context = await new PatchManager()._prepareContext({});
  assert.deepEqual(context.groups.map((g) => g.patches.map((r) => r.id)), [["b"], ["a"]]);
  assert.equal(context.hasAttention, true);
  assert.equal(context.pendingReload, true);
  assert.equal(context.groups[1].patches[0].link.label, "T20CP.Manager.Report");
  assert.deepEqual(context.rules.map((r) => [r.id, r.single, r.bucket, r.input]), [["rule", true, "off", "<select></select>"]]);
  assert.equal(PatchManager.DEFAULT_OPTIONS.id, "t20cp-patch-manager");
});

test("registerManagerMenu: registers the Center and appends the compatibility line to the hint once i18n loads", () => {
  const platform = createFakePlatform({ apps, module: { systemCompatibility: () => ({ minimum: "1.6.5", verified: "1.6.6" }) } });
  registerManagerMenu(platform, { features: [], patches: [], groups: [], status: () => [] });
  const menu = platform.registered.get("menu:manager");
  assert.equal(menu.hint, "T20CP.Manager.Hint");
  assert.equal(typeof menu.type, "function");
  platform.callHook("i18nInit");
  assert.match(menu.hint, /^T20CP\.Manager\.Hint T20CP\.Manager\.Compatibility .*"installed":"1\.6\.6"/);
});
