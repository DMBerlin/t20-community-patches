import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { planPromotion, promoteSource } from "../tools/audit/promote.mjs";
import { formatPromotion } from "../tools/audit/report.mjs";
import { PATCHES } from "../scripts/features/patches.mjs";

const patch = (id, maximum, extra = {}) => ({ id, system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum } }, ...extra });
const indexText = (maximum) =>
  `/** Bug (tormenta20 1.6.5–1.6.6). */\nexport default {\n  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "${maximum}" } },\n};\n`;
const row = (id, overrides = {}) => ({
  id,
  probe: { kind: "behavior", labels: [] },
  fingerprints: { "ItemT20#rollDamage": "abc" },
  sources: { status: "unchanged", changed: [], unrecorded: [] },
  undeclared: [],
  refs: [],
  ...overrides
});

function plan(patches, rows, { from = "1.6.6", to = "1.6.7", texts } = {}) {
  const all = texts ?? Object.fromEntries(patches.map((p) => [p.id, indexText(p.system.affected.maximum)]));
  return planPromotion({ report: { rows }, patches, from, to, texts: all });
}
const actionOf = (result, id) => result.rows.find((entry) => entry.id === id);

test("promotion: current, retired and promote", () => {
  const result = plan(
    [patch("ahead", "1.6.7"), patch("old", "1.6.5"), patch("same", "1.6.6")],
    [row("ahead"), row("old"), row("same", { probe: { kind: "source", diagnosis: { bug: "unknown", confidence: "low" }, labels: [] } })]
  );
  assert.equal(result.newer, true);
  assert.deepEqual(
    result.rows.map(({ id, action }) => [id, action]),
    [["ahead", "current"], ["old", "retired"], ["same", "promote"]]
  );
});

test("promotion: everything the audit cannot vouch for is left for review, with the reason", () => {
  const cases = {
    "no-sources": [row("no-sources", { fingerprints: {}, sources: { status: "none", changed: [], unrecorded: [] } }), /no sources/],
    changed: [row("changed", { sources: { status: "changed", changed: ["ItemT20#rollDamage"], unrecorded: [] } }), /CHANGED: ItemT20#rollDamage/],
    unrecorded: [row("unrecorded", { sources: { status: "unrecorded", changed: [], unrecorded: ["ItemT20#x"] } }), /not in the baseline: ItemT20#x/],
    error: [row("error", { probe: { kind: "source", error: "RequiresFoundry: x", labels: [] } }), /probe error: RequiresFoundry/],
    undeclared: [row("undeclared", { undeclared: ["ItemT20#y"] }), /undeclared source: ItemT20#y/],
    missing: [row("missing", { refs: [{ status: "ok", start: 1 }, { status: "missing", start: 4013 }] }), /MISSING T20:4013/],
    fixed: [row("fixed", { probe: { kind: "source", diagnosis: { bug: "fixed", confidence: "low" }, labels: [] } }), /fixed\/low/]
  };
  const ids = Object.keys(cases);
  const result = plan(ids.map((id) => patch(id, "1.6.6")), ids.map((id) => cases[id][0]));
  for (const id of ids) {
    assert.equal(actionOf(result, id).action, "review", id);
    assert.match(actionOf(result, id).reason, cases[id][1], id);
  }
});

test("promotion: a range between the versions, a missing maximum or a non-canonical index.mjs is reviewed", () => {
  const result = plan([patch("between", "1.6.7"), patch("open", undefined), patch("odd", "1.6.6")], [row("between"), row("open"), row("odd")], {
    to: "1.6.8",
    texts: { between: indexText("1.6.7"), odd: `const affected = { maximum: "1.6.6" };\nexport default { system: { affected } };` }
  });
  assert.match(actionOf(result, "between").reason, /between 1.6.6 and 1.6.8/);
  assert.equal(actionOf(result, "open").action, "review");
  assert.match(actionOf(result, "odd").reason, /canonical/);
});

test("promotion: nothing is planned when the bundle is not newer than the baseline", () => {
  for (const to of ["1.6.6", "1.6.5"]) {
    const result = plan([patch("same", "1.6.6")], [row("same")], { to });
    assert.deepEqual(result.rows, []);
    assert.equal(result.newer, false);
    assert.match(formatPromotion(result), /not newer than the baseline 1.6.6/);
  }
});

test("promoteSource moves only the maximum of the canonical affected line", () => {
  const next = promoteSource(indexText("1.6.6"), "1.6.6", "1.6.7");
  assert.equal(next, indexText("1.6.6").replace('maximum: "1.6.6"', 'maximum: "1.6.7"'));
  assert.match(next, /tormenta20 1\.6\.5–1\.6\.6/, "the comment keeps its version");
  assert.equal(promoteSource("export default {};", "1.6.6", "1.6.7"), null);
  assert.equal(promoteSource(indexText("1.6.6") + indexText("1.6.6"), "1.6.6", "1.6.7"), null);
  assert.equal(promoteSource(indexText("1.6.5"), "1.6.6", "1.6.7"), null);
  assert.equal(promoteSource('affected: { maximum: "1.6.6" }', "1.6.6", "1.6.7"), null);
});

test("every patch's index.mjs declares its range in the canonical form", () => {
  for (const { id, system } of PATCHES) {
    const text = readFileSync(new URL(`../scripts/features/${id}/index.mjs`, import.meta.url), "utf8");
    const { maximum } = system.affected;
    assert.ok(promoteSource(text, maximum, "9.9.9")?.includes(`maximum: "9.9.9"`), id);
  }
});

test("--write without --promote, or --promote with --write-baseline, is refused", () => {
  const run = (...args) => spawnSync(process.execPath, ["tools/audit.mjs", "/nonexistent/tormenta20.mjs", ...args], { encoding: "utf8", cwd: new URL("..", import.meta.url) });
  const write = run("--write");
  assert.equal(write.status, 2);
  assert.match(write.stderr, /--write only works with --promote/);
  const both = run("--promote", "--write-baseline");
  assert.equal(both.status, 2);
  assert.match(both.stderr, /never writes the baseline/);
});

test("promoteSource ignores an affected line inside a comment", () => {
  const shorthand = `// affected: { minimum: "1.6.5", maximum: "1.6.6" }\nconst affected = { minimum: "1.6.5", maximum: "1.6.6" };\nexport default { system: { affected } };\n`;
  assert.equal(promoteSource(shorthand, "1.6.6", "1.6.7"), null);
  const block = `/* affected: { minimum: "1.6.5", maximum: "1.6.6" } */\n${indexText("1.6.6")}`;
  assert.equal(promoteSource(block, "1.6.6", "1.6.7"), block.replace('maximum: "1.6.6" } },', 'maximum: "1.6.7" } },'));
  const inline = 'export default { system: { affected: { minimum: "1.6.5", /* "1.6.6" */ maximum: "1.6.6" } } };';
  assert.equal(promoteSource(inline, "1.6.6", "1.6.7"), inline.replace('maximum: "1.6.6"', 'maximum: "1.6.7"'));
});

test("the next steps name the audited bundle, and only WRITE=1 writes", () => {
  const result = plan([patch("same", "1.6.6")], [row("same")]);
  const text = formatPromotion(result, { command: "node tools/audit.mjs '/tmp/t20 1.6.7/tormenta20.mjs'" });
  assert.match(text, /node tools\/audit.mjs '\/tmp\/t20 1.6.7\/tormenta20.mjs' --promote --write, then node tools\/audit.mjs '\/tmp\/t20 1.6.7\/tormenta20.mjs' --write-baseline/);
  const make = (write) =>
    spawnSync("make", ["-n", "audit-promote", "BUNDLE=/tmp/x.mjs", ...(write ? [`WRITE=${write}`] : [])], {
      encoding: "utf8",
      cwd: new URL("..", import.meta.url)
    }).stdout;
  assert.match(make("1"), /--promote --write/);
  for (const write of [null, "0", "false"]) assert.doesNotMatch(make(write), /--write/, `WRITE=${write}`);
});

test("promoteSource ignores an affected range inside a string or template", () => {
  const strings = [
    'const example = `affected: { minimum: "1.6.5", maximum: "1.6.6" }`;',
    `const other = 'affected: { minimum: "1.6.5", maximum: "1.6.6" }';`
  ].join("\n");
  const shorthand = `${strings}\nconst affected = { minimum: "1.6.5", maximum: "1.6.6" };\nexport default { system: { affected } };\n`;
  assert.equal(promoteSource(shorthand, "1.6.6", "1.6.7"), null);
  const real = `${strings}\n${indexText("1.6.6")}`;
  assert.equal(promoteSource(real, "1.6.6", "1.6.7"), real.replace('maximum: "1.6.6" } },', 'maximum: "1.6.7" } },'));
});

test("promoteSource refuses a range it cannot read or that something else could override", () => {
  const wrap = (system) => `const range = {};\nexport default { system: { ${system} } };\n`;
  const canonical = 'affected: { minimum: "1.6.5", maximum: "1.6.6" }';
  for (const system of [
    "affected: range",
    "affected: null",
    'affected: "1.6.6"',
    "affected: make()",
    "affected",
    `${canonical}, ["affected"]: range`,
    `${canonical}, ...range`,
    'affected: { minimum: "1.6.5", maximum: "1.6.6", ...range }',
    'affected: { minimum: "1.6.5", ["maximum"]: "1.6.6" }'
  ]) {
    assert.equal(promoteSource(wrap(system), "1.6.6", "1.6.7"), null, system);
  }
  assert.equal(promoteSource(`const s = {};\nexport default { ...s, system: { ${canonical} } };`, "1.6.6", "1.6.7"), null);
  const result = plan([patch("odd", "1.6.6")], [row("odd")], { texts: { odd: wrap("affected: range") } });
  assert.equal(actionOf(result, "odd").action, "review");
});

test("only a dotted numeric version is ever written", () => {
  const injected = '1.6.7", injected: (() => { globalThis.__auditInjected = true; })(), ignored: "';
  assert.equal(promoteSource(indexText("1.6.6"), "1.6.6", injected), null);
  assert.equal(promoteSource(indexText("1.6.6"), "1.6.6", "1.6.7\n"), null);
  assert.throws(() => plan([patch("same", "1.6.6")], [row("same")], { to: injected }), /invalid system version/);
});
