import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  annotate,
  autoSources,
  concealmentOutcomes,
  installConcealmentRule,
  isMiss,
  missDie,
  onRenderDialog,
  planChecks,
  previewLines,
  resolveMissChance,
  targetLabel
} from "../scripts/rules/concealment-miss-chance.mjs";
import { installAttackVsDefenseRule } from "../scripts/rules/attack-vs-defense.mjs";
import { getConcealmentChecks } from "../scripts/rules/shared/attack-outcome.mjs";
import { USE_PURPOSES, withUsePurpose } from "../scripts/rules/shared/targets.mjs";

const MODULE = "t20-community-patches";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/* -------------------------------------------- */
/*  Pure functions                              */
/* -------------------------------------------- */

test("autoSources: Blind on the attacker and Invisible on the target are total concealment", () => {
  assert.deepEqual(autoSources({ attackerStatuses: ["cego"] }), [{ reason: "blind", chance: 50 }]);
  assert.deepEqual(autoSources({ targetStatuses: new Set(["invisivel"]) }), [{ reason: "invisible", chance: 50 }]);
  assert.deepEqual(autoSources({ attackerStatuses: ["cego"], targetStatuses: ["invisivel"] }).map((s) => s.reason), ["blind", "invisible"]);
  assert.deepEqual(autoSources(), []);
  assert.deepEqual(autoSources({ attackerStatuses: ["ofuscado"], targetStatuses: ["desprevenido"] }), []);
});

test("resolveMissChance: the highest concealment wins, scent replaces it, none ignores it, capped at 75", () => {
  const invisible = { reason: "invisible", chance: 50 };
  assert.deepEqual(resolveMissChance({ choice: "auto" }), { chance: 0, reasons: [] });
  assert.deepEqual(resolveMissChance({ choice: "light" }), { chance: 20, reasons: ["light"] });
  assert.deepEqual(resolveMissChance({ choice: "total" }), { chance: 50, reasons: ["total"] });
  assert.deepEqual(resolveMissChance({ sources: [invisible], choice: "light" }), { chance: 50, reasons: ["invisible"] });
  assert.deepEqual(resolveMissChance({ sources: [{ reason: "blind", chance: 50 }, invisible] }), { chance: 50, reasons: ["blind", "invisible"] });
  assert.deepEqual(resolveMissChance({ sources: [invisible], choice: "scent" }), { chance: 20, reasons: ["invisible", "scent"] });
  assert.deepEqual(resolveMissChance({ choice: "scent" }), { chance: 0, reasons: [] });
  assert.deepEqual(resolveMissChance({ sources: [invisible], choice: "none" }), { chance: 0, reasons: [] });
  for (const choice of ["xyz", undefined]) assert.deepEqual(resolveMissChance({ sources: [invisible], choice }), { chance: 50, reasons: ["invisible"] });
  assert.equal(resolveMissChance({ sources: [{ reason: "a", chance: 60 }, { reason: "b", chance: 90 }] }).chance, 75);
});

test("missDie and isMiss: 1d10 for multiples of 10, 1d100 otherwise", () => {
  assert.deepEqual(missDie(20), { formula: "1d10", threshold: 2 });
  assert.deepEqual(missDie(50), { formula: "1d10", threshold: 5 });
  assert.deepEqual(missDie(75), { formula: "1d100", threshold: 75 });
  for (const chance of [0, NaN, -10]) assert.equal(missDie(chance), null);
  assert.equal(isMiss(2, 2), true);
  assert.equal(isMiss(3, 2), false);
  assert.equal(isMiss(5, 5), true);
  assert.equal(isMiss(6, 5), false);
  assert.equal(isMiss(NaN, 5), false);
});

test("planChecks: one check per attack roll and target with a chance; no targets means one null target", () => {
  const visible = { uuid: "A", name: "A", displayName: 0, statuses: [] };
  const invisible = { uuid: "B", name: "B", displayName: 50, statuses: ["invisivel"] };
  const two = planChecks({ attackNames: ["Ataque", "Disparo"], targets: [invisible] });
  assert.deepEqual(two.map((c) => [c.rollName, c.targetUuid, c.chance, c.threshold]), [["Ataque", "B", 50, 5], ["Disparo", "B", 50, 5]]);
  const mixed = planChecks({ attackNames: ["Ataque"], targets: [visible, invisible] });
  assert.deepEqual(mixed.map((c) => [c.targetUuid, c.index, c.name, c.displayName]), [["B", 2, "B", 50]]);
  const blind = planChecks({ attackNames: ["Ataque"], attackerStatuses: new Set(["cego"]) });
  assert.deepEqual(blind.map((c) => [c.targetUuid, c.index, c.name, c.reasons]), [[null, 1, null, ["blind"]]]);
  assert.deepEqual(planChecks({ attackNames: ["Ataque"] }), []);
  assert.deepEqual(planChecks({ attackNames: ["Ataque"], targets: [invisible], choice: "none" }), []);
});

test("concealmentOutcomes: a target without a check is unknown", () => {
  const checks = [{ rollName: "Ataque", targetUuid: "A", missed: true }];
  assert.deepEqual(concealmentOutcomes(checks, "Ataque", ["A", "B"]), ["miss", "unknown"]);
  assert.deepEqual(concealmentOutcomes(checks, "Disparo", ["A"]), ["unknown"]);
  assert.deepEqual(concealmentOutcomes([{ rollName: "Ataque", targetUuid: null, missed: true }], "Ataque", []), ["miss"]);
});

test("targetLabel: GM, owner or a public name mode see the name", () => {
  const base = { name: "Bandido", index: 1, isGM: false, isOwner: false };
  assert.equal(targetLabel({ ...base, isGM: true, displayName: 0 }).name, "Bandido");
  assert.equal(targetLabel({ ...base, isOwner: true, displayName: 0 }).name, "Bandido");
  for (const mode of [0, 10, 20, 40]) assert.equal(targetLabel({ ...base, displayName: mode }).name, null, `mode ${mode}`);
  for (const mode of [30, 50]) assert.equal(targetLabel({ ...base, displayName: mode }).name, "Bandido", `mode ${mode}`);
  assert.equal(targetLabel({ ...base, name: "", isGM: true, displayName: 50 }).name, null);
  assert.equal(targetLabel({ ...base, displayName: 0 }).index, 1);
});

/* -------------------------------------------- */
/*  Foundry mocks                               */
/* -------------------------------------------- */

function parseSelector(selector) {
  const m = selector.match(/^(\w+)?(?:#([\w-]+))?((?:\.[\w-]+)*)(?:\[([\w-]+)(?:=([\w-]+))?\])?$/);
  if (!m) throw new Error(`unsupported selector ${selector}`);
  return { tag: m[1], id: m[2], classes: m[3] ? m[3].slice(1).split(".") : [], attr: m[4], value: m[5] };
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.classes = new Set();
    this.parent = null;
    this._text = "";
    this.classList = {
      add: (...names) => names.forEach((n) => this.classes.add(n)),
      remove: (...names) => names.forEach((n) => this.classes.delete(n)),
      contains: (name) => this.classes.has(name)
    };
  }
  set className(value) {
    this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  get className() {
    return [...this.classes].join(" ");
  }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }
  append(...nodes) {
    for (const node of nodes) node.parent = this;
    this.children.push(...nodes);
  }
  get parentNode() {
    return this.parent;
  }
  /** Moves the node, like the DOM. */
  detach() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  after(node) {
    node.detach?.();
    const siblings = this.parent.children;
    node.parent = this.parent;
    siblings.splice(siblings.indexOf(this) + 1, 0, node);
  }
  before(node) {
    node.detach?.();
    const siblings = this.parent.children;
    node.parent = this.parent;
    siblings.splice(siblings.indexOf(this), 0, node);
  }
  matches(selector) {
    const { tag, id, classes, attr, value } = parseSelector(selector);
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    if (id && this.id !== id) return false;
    if (classes.some((c) => !this.classes.has(c))) return false;
    if (attr?.startsWith("data-")) return attr.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()) in this.dataset;
    if (attr) return value === undefined ? attr in this : this[attr] === value;
    return true;
  }
  closest(selector) {
    for (let el = this; el; el = el.parent) if (el.matches?.(selector)) return el;
    return null;
  }
  querySelectorAll(selector) {
    const out = [];
    for (const child of this.children) {
      if (child.matches?.(selector)) out.push(child);
      if (child.querySelectorAll) out.push(...child.querySelectorAll(selector));
    }
    return out;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === "object") flatten(value, `${prefix}${key}.`, out);
    else out[`${prefix}${key}`] = value;
  }
  return out;
}
const STRINGS = flatten(JSON.parse(readFileSync(new URL("../lang/pt-BR.json", import.meta.url))));

function makeToken(id, { name = id, defense = 10, statuses = [], displayName = 0, isOwner = false, actor: shared } = {}) {
  const actor = shared ?? {
    type: "npc",
    system: { attributes: { defesa: { value: defense, outros: 0 } } },
    _source: { system: { attributes: { defesa: { outros: 0 } } } },
    statuses: new Set(statuses),
    testUserPermission: () => false
  };
  return { actor, document: { uuid: `Scene.s.Token.${id}`, name, displayName, actor, isOwner } };
}

/**
 * @param {{rules?: string[], order?: string[], avd?: string}} options
 *   order: install order of the module's rollAttack wrappers ("concealment", "avd"); the first is the innermost.
 */
function setup({ rule = "on", avd = "off", order = ["concealment"], isGM = true } = {}) {
  const settings = { [`${MODULE}.concealmentMissChance`]: rule, [`${MODULE}.attackVsDefenseRule`]: avd, "tormenta20.showFoeDc": true };
  const docs = new Map();
  const seen = [];
  const calls = [];
  const hooks = {};
  const dialogHooks = [];
  const counts = { original: 0, concealment: 0, avd: 0 };
  const dice = { queue: [], created: [], fail: false };
  globalThis.Hooks = { on: (name, fn) => name === "renderAbilityUseDialog" && dialogHooks.push(fn) };
  globalThis.game = {
    user: { isGM, targets: new Set() },
    settings: { get: (scope, key) => settings[`${scope}.${key}`] },
    i18n: {
      has: (key) => key in STRINGS,
      localize: (key) => STRINGS[key] ?? key,
      format: (key, data) => (STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => data[k])
    }
  };
  class Roll {
    constructor(formula) {
      this.formula = formula;
      dice.created.push(this);
    }
    async evaluate() {
      await tick();
      if (dice.fail) throw new Error("dice failure");
      this.total = dice.queue.shift() ?? 10;
      return this;
    }
  }
  globalThis.foundry = { utils: { fromUuidSync: (uuid) => docs.get(uuid) ?? null }, dice: { Roll } };
  globalThis.document = { createElement: (tag) => new FakeElement(tag), createTextNode: (text) => ({ textContent: String(text) }) };

  const attacker = { statuses: new Set() };
  class ItemT20 {
    constructor(system, actor = attacker) {
      this.system = system;
      this.actor = actor;
    }
    clone() {
      return new ItemT20(structuredClone({ ...this.system, rolled: undefined }), this.actor);
    }
    /** Mirrors the system: synchronous clone, the use dialog, then attack, damage and card on the clone. */
    async roll() {
      const item = this.clone({}, { keepId: true });
      await tick();
      hooks.duringDialog?.(item);
      item.system.rolled = {};
      await item.rollAttack({ options: { ...(hooks.dialogOptions ?? {}) } });
      await item.rollDamage();
      return item;
    }
    /** Fake original: one roll per attack entry, with the d20 picked by the test. */
    async rollAttack(...args) {
      counts.original++;
      calls.push({ self: this, args, checks: getConcealmentChecks(this) });
      hooks.duringAttack?.(this);
      await tick();
      if (this.system.cancel) return null;
      const naturals = [...(this.system.naturals ?? [])];
      for (const r of this.system.rolls.filter((x) => x.type === "ataque")) {
        const natural = naturals.shift() ?? 10;
        const roll = { terms: [{ faces: 20, total: natural }], total: natural + this.system.bonus, options: { type: "attack", ...structuredClone(this.system.options ?? {}) } };
        roll._critical = natural >= this.system.criticoM;
        this.system.rolled[r.name] = roll;
      }
      return "attack-result";
    }
    async rollDamage() {
      seen.push({ critical: this.system.rolled?.Ataque?._critical || false });
    }
  }
  class ChatMessageT20 {
    async renderHTML() {
      return this.html;
    }
  }
  globalThis.CONFIG = { Item: { documentClass: ItemT20 }, ChatMessage: { documentClass: ChatMessageT20 } };
  const proto = ItemT20.prototype;
  const count = (key) => {
    const inner = proto.rollAttack;
    proto.rollAttack = async function (...args) {
      counts[key]++;
      return inner.apply(this, args);
    };
  };
  for (const key of order) {
    if (key === "concealment") installConcealmentRule();
    else installAttackVsDefenseRule();
    count(key);
  }

  const weapon = (overrides = {}) =>
    new ItemT20({
      rolls: [{ type: "ataque", name: "Ataque", parts: [["1d20"], ["luta"]] }],
      criticoM: 19,
      bonus: 5,
      ...overrides
    });
  const target = (...tokens) => {
    for (const token of tokens) docs.set(token.document.uuid, token.document);
    game.user.targets = new Set(tokens);
  };
  const data = (item, name = "Ataque") => item.system.rolled[name]?.options[MODULE]?.concealment;
  const dialog = (app, html) => dialogHooks.forEach((fn) => fn(app, html));
  return { ItemT20, ChatMessageT20, attacker, weapon, target, data, dialog, seen, calls, hooks, docs, dice, counts, settings };
}

/* -------------------------------------------- */
/*  rollAttack                                  */
/* -------------------------------------------- */

test("rule off: the original runs with the same arguments and result, and no die is rolled", async () => {
  const env = setup({ rule: "off" });
  env.target(makeToken("A", { statuses: ["invisivel"] }));
  const item = env.weapon({ naturals: [19] });
  item.system.rolled = {};
  const args = { options: { t20cpConcealment: "total" } };
  assert.equal(await item.rollAttack(args), "attack-result");
  assert.deepEqual([env.calls.length, env.calls[0].self, env.calls[0].args[0]], [1, item, args]);
  assert.equal(env.dice.created.length, 0);
  assert.equal(env.data(item), undefined);
  assert.equal(item.system.rolled.Ataque._critical, true);
});

test("an invisible target: a d10 in the miss range cancels the threat before the damage; outside it keeps it", async () => {
  const env = setup();
  env.target(makeToken("A", { name: "Bandido", statuses: ["invisivel"], displayName: 30 }));
  env.dice.queue = [3];
  const missed = await env.weapon({ naturals: [19] }).roll();
  assert.equal(env.dice.created[0].formula, "1d10");
  const data = env.data(missed);
  assert.deepEqual(data.checks, [
    { rollName: "Ataque", targetUuid: "Scene.s.Token.A", index: 1, name: "Bandido", displayName: 30, chance: 50, reasons: ["invisible"], formula: "1d10", threshold: 5, total: 3, missed: true }
  ]);
  assert.deepEqual([missed.system.rolled.Ataque._critical, data.criticalCancelled, env.seen[0].critical], [false, true, false]);

  env.dice.queue = [7];
  const passed = await env.weapon({ naturals: [19] }).roll();
  assert.deepEqual([env.data(passed).checks[0].missed, env.data(passed).criticalCancelled, passed.system.rolled.Ataque._critical], [false, false, true]);
});

test("the dialog choice and Blind: the highest wins, scent lowers to 20%, none rolls nothing", async () => {
  const env = setup();
  env.target(makeToken("A", { statuses: ["invisivel"] }));
  for (const [choice, expected] of [["light", [50, 5]], ["scent", [20, 2]], ["bogus", [50, 5]]]) {
    env.hooks.dialogOptions = { t20cpConcealment: choice };
    const item = await env.weapon().roll();
    assert.deepEqual([env.data(item).checks[0].chance, env.data(item).checks[0].threshold], expected, choice);
  }
  env.hooks.dialogOptions = { t20cpConcealment: "none" };
  const before = env.dice.created.length;
  const none = await env.weapon().roll();
  assert.equal(env.data(none), undefined);
  assert.equal(env.dice.created.length, before);
});

test("duplicate attack names: one d10 per kept roll, so a shadowed duplicate never cancels its critical", async () => {
  const env = setup();
  env.target(makeToken("A", { statuses: ["invisivel"] }));
  env.dice.queue = [10, 1];
  let checks;
  env.hooks.duringAttack = (self) => (checks = getConcealmentChecks(self));
  const rolls = [{ type: "ataque", name: "Ataque", parts: [["1d20"], ["luta"]] }, { type: "ataque", name: "Ataque", parts: [["1d20"], ["luta"]] }];
  const item = await env.weapon({ rolls, naturals: [19, 19] }).roll();
  assert.equal(env.dice.created.length, 1);
  assert.deepEqual(checks.map((c) => [c.rollName, c.total, c.missed]), [["Ataque", 10, false]]);
  assert.deepEqual(env.data(item).checks.map((c) => c.total), [10]);
  assert.deepEqual([item.system.rolled.Ataque._critical, env.data(item).criticalCancelled], [true, false]);
});

test("two targets: one missed by concealment and one without concealment keep the critical", async () => {
  const env = setup();
  env.target(makeToken("A", { statuses: ["invisivel"] }), makeToken("B"));
  env.dice.queue = [1];
  const item = await env.weapon({ naturals: [20] }).roll();
  assert.deepEqual(env.data(item).checks.map((c) => [c.targetUuid, c.index, c.missed]), [["Scene.s.Token.A", 1, true]]);
  assert.equal(item.system.rolled.Ataque._critical, true);
  assert.equal(env.data(item).criticalCancelled, false);
});

test("no targets and a blind attacker: a single unlabeled check that can cancel the critical", async () => {
  const env = setup();
  env.attacker.statuses = new Set(["cego"]);
  env.dice.queue = [5];
  const item = await env.weapon({ naturals: [19] }).roll();
  assert.deepEqual(env.data(item).checks.map((c) => [c.targetUuid, c.name, c.missed]), [[null, null, true]]);
  assert.equal(item.system.rolled.Ataque._critical, false);
  env.attacker.statuses = new Set();
  const plain = await env.weapon({ naturals: [19] }).roll();
  assert.equal(env.data(plain), undefined);
});

test("the attacker's own token is not a target", async () => {
  const env = setup();
  env.attacker.statuses = new Set(["cego"]);
  env.target(makeToken("Self", { actor: env.attacker }), makeToken("B"));
  const item = await env.weapon().roll();
  assert.deepEqual(env.data(item).checks.map((c) => [c.targetUuid, c.index]), [["Scene.s.Token.B", 1]]);
});

test("targets and names are frozen at the start of the use; the dialog preview shows the same list", async () => {
  const env = setup();
  const A = makeToken("A", { name: "Bandido", statuses: ["invisivel"] });
  env.target(A);
  let preview;
  env.hooks.duringDialog = (clone) => {
    A.document.name = "Renamed";
    env.target(makeToken("B", { statuses: ["invisivel"] }));
    preview = previewLines(clone);
  };
  env.hooks.duringAttack = () => env.target(makeToken("C", { statuses: ["invisivel"] }));
  const item = await env.weapon().roll();
  assert.deepEqual(preview, ["Bandido: 50% (alvo invisível)"]);
  assert.deepEqual(env.data(item).checks.map((c) => [c.targetUuid, c.name]), [["Scene.s.Token.A", "Bandido"]]);

  // After the use ends, a direct call reads the current selection again.
  env.hooks.duringDialog = env.hooks.duringAttack = undefined;
  env.target(makeToken("D", { statuses: ["invisivel"] }));
  item.system.rolled = {};
  await item.rollAttack({ options: {} });
  assert.equal(env.data(item).checks[0].targetUuid, "Scene.s.Token.D");
});

test("consecutive calls on the same object never inherit the previous checks", async () => {
  for (const second of ["off", "dice-failure"]) {
    const env = setup({ avd: "on", order: ["concealment", "avd"] });
    env.target(makeToken("A", { defense: 5, statuses: ["invisivel"] }));
    const item = env.weapon({ naturals: [19] });
    item.system.rolled = {};
    env.dice.queue = [1];
    await item.rollAttack({ options: {} });
    assert.equal(getConcealmentChecks(item)[0].missed, true, second);
    assert.equal(item.system.rolled.Ataque._critical, false, second);

    if (second === "off") env.settings[`${MODULE}.concealmentMissChance`] = "off";
    else env.dice.fail = true;
    item.system.rolled = {};
    const originalError = console.error;
    console.error = () => {};
    try {
      await item.rollAttack({ options: {} });
    } finally {
      console.error = originalError;
    }
    assert.equal(env.counts.original, 2, second);
    assert.deepEqual(env.calls[1].checks, [], second);
    assert.deepEqual(getConcealmentChecks(item), [], second);
    assert.equal(item.system.rolled.Ataque._critical, true, second);
    assert.equal(item.system.rolled.Ataque.options[MODULE].attackVsDefense.targets[0].outcome, "hit", second);
  }
});

test("the module key of the roll is merged, not replaced", async () => {
  const env = setup();
  env.target(makeToken("A", { statuses: ["invisivel"] }));
  const item = await env.weapon({ options: { [MODULE]: { attackVsDefense: { v: 1 } } } }).roll();
  assert.deepEqual(Object.keys(item.system.rolled.Ataque.options[MODULE]).sort(), ["attackVsDefense", "concealment"]);
});

test("a cancelled attack records nothing, even over a roll left by a previous call", async () => {
  const env = setup();
  env.target(makeToken("A", { statuses: ["invisivel"] }));
  const item = env.weapon({ cancel: true });
  const stale = { options: { type: "attack" }, _critical: true };
  item.system.rolled = { Ataque: stale };
  assert.equal(await item.rollAttack({ options: {} }), null);
  assert.equal(stale.options[MODULE], undefined);
  assert.equal(stale._critical, true);
});

test("a maneuver resistance use rolls no d10 and records nothing", async () => {
  const env = setup();
  env.target(makeToken("A", { statuses: ["invisivel"] }));
  env.attacker.statuses = new Set(["cego"]);
  let clone;
  env.hooks.duringAttack = (self) => (clone = self);
  const item = await withUsePurpose(USE_PURPOSES.MANEUVER_RESISTANCE, () => env.weapon({ naturals: [19] }).roll());
  assert.equal(env.dice.created.length, 0);
  assert.equal(env.counts.original, 1);
  assert.equal(clone, item);
  assert.deepEqual(getConcealmentChecks(item), []);
  assert.equal(env.data(item), undefined);
  assert.equal(item.system.rolled.Ataque._critical, true);
});

test("overlapping uses on different clones do not mix their checks", async () => {
  const env = setup();
  env.target(makeToken("A", { statuses: ["invisivel"] }));
  const first = env.weapon({ naturals: [19] }).roll();
  env.target(makeToken("B", { statuses: ["invisivel"] }));
  const second = env.weapon({ naturals: [19] }).roll();
  env.dice.queue = [1, 9];
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(env.data(a).checks.map((c) => [c.targetUuid, c.missed]), [["Scene.s.Token.A", true]]);
  assert.deepEqual(env.data(b).checks.map((c) => [c.targetUuid, c.missed]), [["Scene.s.Token.B", false]]);
  assert.deepEqual([a.system.rolled.Ataque._critical, b.system.rolled.Ataque._critical], [false, true]);
});

test("annotate only cancels a critical, never restores one", () => {
  const roll = { options: { type: "attack" }, _critical: false };
  const item = { system: { rolled: { Ataque: roll } } };
  annotate(item, [], [{ rollName: "Ataque", targetUuid: null, reasons: ["blind"], missed: false }]);
  assert.equal(roll._critical, false);
  assert.equal(roll.options[MODULE].concealment.criticalCancelled, false);
});

/* -------------------------------------------- */
/*  With attack-vs-defense (#42)                */
/* -------------------------------------------- */

const ORDERS = [["concealment", "avd"], ["avd", "concealment"]];

async function combined(order, tokens, d10, natural = 19) {
  const env = setup({ avd: "on", order });
  env.target(...tokens);
  env.dice.queue = [...d10];
  const item = await env.weapon({ naturals: [natural] }).roll();
  assert.deepEqual(env.counts, { original: 1, concealment: 1, avd: 1 }, order.join(" > "));
  const avd = item.system.rolled.Ataque.options[MODULE].attackVsDefense;
  return { env, item, avd, critical: item.system.rolled.Ataque._critical };
}

test("both rules: a hit by Defense missed by concealment is a miss and cancels the critical, in both orders", async () => {
  for (const order of ORDERS) {
    const { avd, critical, env } = await combined(order, [makeToken("A", { defense: 5, statuses: ["invisivel"] })], [2]);
    assert.deepEqual([avd.targets[0].outcome, avd.targets[0].critical, avd.targets[0].concealment], ["miss", false, true], order.join());
    assert.deepEqual([critical, avd.critical, env.seen[0].critical], [false, false, false], order.join());
  }
});

test("both rules: A missed by Defense and B missed by concealment cancel the critical, in both orders", async () => {
  for (const order of ORDERS) {
    const { avd, critical } = await combined(order, [makeToken("A", { defense: 40 }), makeToken("B", { defense: 5, statuses: ["invisivel"] })], [1]);
    assert.deepEqual(avd.targets.map((t) => t.outcome), ["miss", "miss"], order.join());
    assert.equal(critical, false, order.join());
  }
});

test("both rules: A missed by concealment and B hit or of unknown Defense keep the critical, in both orders", async () => {
  for (const order of ORDERS) {
    for (const defenseB of [5, null]) {
      const label = `${order.join()} B=${defenseB}`;
      const { avd, critical, item, env } = await combined(order, [makeToken("A", { defense: 5, statuses: ["invisivel"] }), makeToken("B", { defense: defenseB })], [1]);
      assert.deepEqual(avd.targets.map((t) => t.outcome), ["miss", defenseB === null ? "unknown" : "hit"], label);
      assert.equal(critical, true, label);
      assert.equal(env.data(item).criticalCancelled, false, label);
    }
  }
});

test("both rules: a cancelled attack leaves the previous roll untouched, in both orders", async () => {
  for (const order of ORDERS) {
    const env = setup({ avd: "on", order });
    env.target(makeToken("A", { defense: 5, statuses: ["invisivel"] }));
    env.dice.queue = [10];
    const item = env.weapon({ naturals: [19] });
    item.system.rolled = {};
    await item.rollAttack({ options: {} });
    const previous = item.system.rolled.Ataque;
    const copy = structuredClone(previous);
    assert.equal(previous._critical, true, order.join());
    item.system.cancel = true;
    env.dice.queue = [1];
    assert.equal(await item.rollAttack({ options: {} }), null, order.join());
    assert.equal(item.system.rolled.Ataque, previous, order.join());
    assert.deepEqual(previous, copy, order.join());
  }
});

test("both rules: the cancelled critical notice appears once on the card, in both orders", async () => {
  for (const order of ORDERS) {
    const { item, env } = await combined(order, [makeToken("A", { defense: 5, statuses: ["invisivel"] })], [2]);
    const { root, total } = card();
    const msg = new env.ChatMessageT20();
    Object.assign(msg, { isContentVisible: true, html: root, rolls: [{ ...item.system.rolled.Ataque, options: { ...item.system.rolled.Ataque.options, title: "Ataque" } }] });
    await msg.renderHTML();
    const notices = root.textContent.split("Sem acerto crítico").length - 1;
    assert.equal(notices, 1, order.join());
    assert.equal(total.classList.contains("critical"), false, order.join());
    assert.equal(root.querySelectorAll(".t20cp-miss-chance").length, 1, order.join());
  }
});

test("both rules: in hide mode a player sees no cancelled critical notice from either rule", async () => {
  for (const order of ORDERS) {
    const { item, env } = await combined(order, [makeToken("A", { defense: 5, statuses: ["invisivel"] })], [2]);
    env.settings[`${MODULE}.attackVsDefenseVisibility`] = "hide";
    game.user.isGM = false;
    const { root, total } = card();
    const msg = new env.ChatMessageT20();
    Object.assign(msg, { isContentVisible: true, html: root, rolls: [{ ...item.system.rolled.Ataque, options: { ...item.system.rolled.Ataque.options, title: "Ataque" } }] });
    await msg.renderHTML();
    assert.doesNotMatch(root.textContent, /Sem acerto crítico/, order.join());
    assert.equal(root.querySelectorAll(".t20cp-attack-vs-defense").length, 0, order.join());
    assert.equal(total.classList.contains("critical"), false, order.join());
  }
});

/* -------------------------------------------- */
/*  Card                                        */
/* -------------------------------------------- */

function card(titles = ["Ataque"]) {
  const root = new FakeElement("li");
  const chatCard = new FakeElement("div");
  chatCard.className = "chat-card";
  root.append(chatCard);
  const containers = titles.map((title) => {
    const container = new FakeElement("div");
    container.className = "roll";
    container.dataset.rollTitle = title;
    const total = new FakeElement("h4");
    total.className = "dice-total success critical";
    container.append(total);
    chatCard.append(container);
    return container;
  });
  return { root, chatCard, containers, total: containers[0].querySelector(".dice-total") };
}

const recordedCheck = (overrides = {}) => ({
  rollName: "Disparo",
  targetUuid: "Scene.s.Token.A",
  index: 1,
  name: "Bandido",
  displayName: 0,
  chance: 50,
  reasons: ["invisible"],
  formula: "1d10",
  threshold: 5,
  total: 4,
  missed: true,
  ...overrides
});

function cardMessage(env, data, { visible = true, title = "Disparo" } = {}) {
  const msg = new env.ChatMessageT20();
  msg.isContentVisible = visible;
  msg.rolls = [{ options: { title, type: "attack", [MODULE]: { concealment: data } } }];
  return msg;
}

test("renderHTML: the block goes right after its attack roll, once, without roll classes", async () => {
  const env = setup();
  const { root, chatCard, containers } = card(["Ataque", "Disparo"]);
  const msg = cardMessage(env, { v: 1, checks: [recordedCheck()], criticalCancelled: true });
  msg.html = root;
  await msg.renderHTML();
  await msg.renderHTML();
  const blocks = root.querySelectorAll(".t20cp-miss-chance");
  assert.equal(blocks.length, 1);
  assert.equal(chatCard.children.indexOf(blocks[0]), chatCard.children.indexOf(containers[1]) + 1);
  assert.equal(blocks[0].classList.contains("roll") || blocks[0].classList.contains("roll--dano"), false);
  assert.match(blocks[0].textContent, /Chance de falha/);
  assert.match(blocks[0].textContent, /Sem acerto crítico/);
  assert.match(blocks[0].textContent, /Bandido: 50% \(alvo invisível\) · 1d10: 4 \(falha em 1-5\) · Errou por camuflagem/);
  assert.equal(blocks[0].querySelector(".t20cp-miss").textContent, "Errou por camuflagem");
  const disparoTotal = containers[1].querySelector(".dice-total");
  assert.deepEqual([disparoTotal.classList.contains("critical"), disparoTotal.classList.contains("failure")], [false, true]);
  assert.equal(containers[0].querySelector(".dice-total").classList.contains("critical"), true);
});

test("renderHTML: the target name follows the reader's rights for the same message", async () => {
  const env = setup({ isGM: false });
  const data = { v: 1, checks: [recordedCheck({ missed: false, total: 8 })], criticalCancelled: false };
  const text = async () => {
    const { root } = card(["Disparo"]);
    const msg = cardMessage(env, data);
    msg.html = root;
    await msg.renderHTML();
    return root.querySelector(".t20cp-miss-chance").textContent;
  };
  // Deleted token: the recorded name mode (Never) applies.
  assert.match(await text(), /Alvo 1: .*Passou pela camuflagem/);
  assert.doesNotMatch(await text(), /Sem acerto crítico/);
  const token = makeToken("A", { name: "Renamed", displayName: 0 });
  env.docs.set(token.document.uuid, token.document);
  assert.match(await text(), /Alvo 1:/);
  token.document.isOwner = true;
  assert.match(await text(), /Bandido:/);
  token.document.isOwner = false;
  token.document.displayName = 50;
  assert.match(await text(), /Bandido:/);
  token.document.displayName = 0;
  game.user.isGM = true;
  assert.match(await text(), /Bandido:/);
});

test("renderHTML: hidden content and rolls without data are left alone; no anchor appends to the card", async () => {
  const env = setup();
  const hidden = card(["Disparo"]);
  const blind = cardMessage(env, { v: 1, checks: [recordedCheck()], criticalCancelled: true }, { visible: false });
  blind.html = hidden.root;
  await blind.renderHTML();
  assert.equal(hidden.root.querySelector(".t20cp-miss-chance"), null);
  assert.equal(hidden.total.classList.contains("critical"), true);

  const plain = card(["Disparo"]);
  const none = new env.ChatMessageT20();
  Object.assign(none, { isContentVisible: true, rolls: [{ options: { title: "Disparo" } }], html: plain.root });
  await none.renderHTML();
  assert.equal(plain.root.querySelector(".t20cp-miss-chance"), null);

  const orphan = card(["Outro"]);
  const msg = cardMessage(env, { v: 1, checks: [recordedCheck({ targetUuid: null, name: null })], criticalCancelled: false });
  msg.html = orphan.root;
  await msg.renderHTML();
  assert.equal(orphan.chatCard.children.at(-1).className, "t20cp-miss-chance");
  assert.match(orphan.chatCard.children.at(-1).textContent, /Sem alvo: /);
});

/* -------------------------------------------- */
/*  Dialog                                      */
/* -------------------------------------------- */

function dialogForm() {
  const form = new FakeElement("form");
  form.id = "ability-use-form";
  const group = new FakeElement("div");
  group.className = "form-group";
  const select = new FakeElement("select");
  select.name = "rollKeep";
  group.append(select);
  const after = new FakeElement("div");
  after.className = "form-group";
  form.append(group, after);
  const root = new FakeElement("div");
  root.append(form);
  return { root, form, group };
}

test("dialog: the field goes after 'Melhor/Pior de 2d20' once, with the Automatic preview", async () => {
  const env = setup();
  env.target(makeToken("A", { name: "Bandido", statuses: ["invisivel"] }), makeToken("B"));
  const { root, form, group } = dialogForm();
  const app = { item: env.weapon(), setPosition: () => (app.positioned = true) };
  env.dialog(app, [root]);
  env.dialog(app, root);
  const fields = form.querySelectorAll(".t20cp-concealment");
  assert.equal(fields.length, 1);
  assert.equal(form.children.indexOf(fields[0]), form.children.indexOf(group) + 1);
  const select = fields[0].querySelector("select");
  assert.equal(select.name, "t20cpConcealment");
  assert.deepEqual(select.children.map((o) => o.value), ["auto", "light", "total", "scent", "none"]);
  assert.equal(fields[0].querySelector(".t20cp-concealment-preview").textContent, "Bandido: 50% (alvo invisível)");
  assert.equal(app.positioned, true);

  env.target(makeToken("B"));
  const empty = dialogForm();
  env.dialog({ item: env.weapon() }, empty.root);
  assert.equal(empty.form.querySelector(".t20cp-concealment-preview").textContent, "Automático: nenhuma camuflagem detectada nos alvos.");
});

test("dialog: the field stays right after 'Melhor/Pior' whatever the other rules' fields and hook order", async () => {
  // Stand-ins for the other rules' hooks, inserting as they do: situational-modifiers right after "Melhor/Pior";
  // nonlethal-attack before the situational section, else right after "Melhor/Pior".
  const block = (cls) => {
    const el = new FakeElement("div");
    el.className = `form-group ${cls}`;
    return el;
  };
  const situational = (form, group) => group.after(block("t20cp-situational"));
  const nonlethal = (form, group) => {
    const section = form.querySelector(".t20cp-situational");
    if (section) section.before(block("t20cp-nonlethal"));
    else group.after(block("t20cp-nonlethal"));
  };
  const cases = [
    [[nonlethal], ["t20cp-concealment", "t20cp-nonlethal"]],
    [[situational, nonlethal], ["t20cp-concealment", "t20cp-nonlethal", "t20cp-situational"]]
  ];
  for (const [others, expected] of cases) {
    for (const first of [true, false]) {
      const env = setup();
      const { root, form, group } = dialogForm();
      const app = { item: env.weapon() };
      if (!first) others.forEach((hook) => hook(form, group));
      env.dialog(app, root);
      if (first) others.forEach((hook) => hook(form, group));
      await Promise.resolve();
      const order = form.children.slice(1, 1 + expected.length).map((el) => [...el.classes].find((c) => c.startsWith("t20cp-")));
      assert.deepEqual(order, expected, `${others.length} others, concealment ${first ? "first" : "last"}`);
    }
  }
});

test("dialog: nothing with the rule off, without an attack roll or in a maneuver resistance use", async () => {
  const off = setup({ rule: "off" });
  const a = dialogForm();
  off.dialog({ item: off.weapon() }, a.root);
  assert.equal(a.form.querySelector(".t20cp-concealment"), null);

  const env = setup();
  const b = dialogForm();
  onRenderDialog({ item: env.weapon({ rolls: [{ type: "dano", name: "Dano", parts: [["1d6"]] }] }) }, b.root);
  assert.equal(b.form.querySelector(".t20cp-concealment"), null);

  const c = dialogForm();
  env.hooks.duringDialog = (clone) => onRenderDialog({ item: clone }, c.root);
  await withUsePurpose(USE_PURPOSES.MANEUVER_RESISTANCE, () => env.weapon().roll());
  assert.equal(c.form.querySelector(".t20cp-concealment"), null);
});
