import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  attackKind,
  buildTargetResult,
  canSeeDefense,
  combineWithConcealment,
  describeTarget,
  effectiveDefense,
  installAttackVsDefenseRule,
  resolveAttack
} from "../scripts/rules/attack-vs-defense.mjs";
import { finalOutcome, keepCritical, setConcealmentChecks } from "../scripts/rules/shared/attack-outcome.mjs";
import { USE_PURPOSES, addDefenseAdjustments, withUsePurpose } from "../scripts/rules/shared/targets.mjs";
import { markWrapper } from "../scripts/utils.mjs";

const MODULE = "t20-community-patches";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/* -------------------------------------------- */
/*  Pure functions                              */
/* -------------------------------------------- */

test("attackKind: Pontaria is ranged, everything else melee", () => {
  assert.equal(attackKind("pont"), "ranged");
  for (const skill of ["luta", undefined, "mist"]) assert.equal(attackKind(skill), "melee");
});

test("effectiveDefense: prone against ranged undoes the condition and adds +5", () => {
  const prone = { prone: true, outros: -5, sourceOutros: 0 };
  assert.deepEqual(effectiveDefense({ value: 15, kind: "melee", ...prone }), { defense: 15, adjustments: [] });
  assert.deepEqual(effectiveDefense({ value: 15, kind: "ranged", ...prone }), { defense: 25, adjustments: ["prone-ranged"] });
  // Without prone-defense (#40): min(3, -5) - 3 = -8 is undone.
  assert.equal(effectiveDefense({ value: 12, kind: "ranged", prone: true, outros: -5, sourceOutros: 3 }).defense, 25);
  // Outros -6: Prone (min) changed nothing.
  assert.equal(effectiveDefense({ value: 10, kind: "ranged", prone: true, outros: -6, sourceOutros: -6 }).defense, 15);
  assert.deepEqual(effectiveDefense({ value: 15, kind: "ranged" }), { defense: 15, adjustments: [] });
  for (const value of [undefined, null, "", "abc"]) {
    assert.deepEqual(effectiveDefense({ value, kind: "melee", extra: [{ id: "cover", delta: 5 }] }), { defense: null, adjustments: [] });
  }
});

test("effectiveDefense: extra adjustments come after prone; invalid ones are ignored", () => {
  const extra = [{ id: "cover", delta: 5 }, { id: "bad", delta: "x" }, { delta: 2 }];
  assert.deepEqual(effectiveDefense({ value: 15, kind: "ranged", prone: true, outros: -5, sourceOutros: 0, extra }), {
    defense: 30,
    adjustments: ["prone-ranged", "cover"]
  });
});

test("resolveAttack: equal hits, natural 20 and 1 are automatic, threat only counts on a hit", () => {
  assert.deepEqual(resolveAttack({ total: 15, natural: 10, threat: false, defense: 15 }), { outcome: "hit", critical: false, automatic: null });
  assert.equal(resolveAttack({ total: 14, natural: 10, threat: false, defense: 15 }).outcome, "miss");
  assert.deepEqual(resolveAttack({ total: 18, natural: 20, threat: true, defense: 30 }), { outcome: "hit", critical: true, automatic: "nat20" });
  assert.deepEqual(resolveAttack({ total: 25, natural: 1, threat: true, defense: 10 }), { outcome: "miss", critical: false, automatic: "nat1" });
  assert.deepEqual(resolveAttack({ total: 14, natural: 19, threat: true, defense: 20 }), { outcome: "miss", critical: false, automatic: null });
  assert.deepEqual(resolveAttack({ total: 22, natural: 19, threat: true, defense: 20 }), { outcome: "hit", critical: true, automatic: null });
  assert.equal(resolveAttack({ total: 22, natural: 10, threat: false, defense: null }).outcome, "unknown");
});

test("combineWithConcealment: concealment turns any result into a miss without critical", () => {
  assert.deepEqual(combineWithConcealment({ outcome: "hit", critical: true }, true), {
    outcome: "miss",
    critical: false,
    concealment: true,
    defenseOutcome: "hit"
  });
  assert.deepEqual(combineWithConcealment({ outcome: "hit", critical: true }, false), { outcome: "hit", critical: true });
  assert.equal(combineWithConcealment({ outcome: "unknown", critical: false }, false).outcome, "unknown");
});

test("attack-outcome: finalOutcome and keepCritical", () => {
  assert.equal(finalOutcome("hit", true), "miss");
  assert.equal(finalOutcome("hit", false), "hit");
  assert.equal(finalOutcome(undefined, false), "unknown");
  assert.equal(keepCritical([]), true);
  assert.equal(keepCritical(["miss"]), false);
  assert.equal(keepCritical(["miss", "miss"]), false);
  assert.equal(keepCritical(["miss", "unknown"]), true);
  assert.equal(keepCritical(["miss", "hit"]), true);
});

test("canSeeDefense: GM, observer, character target or showFoeDc", () => {
  const base = { isGM: false, isObserver: false, actorType: "npc", showFoeDc: false };
  assert.equal(canSeeDefense(base), false);
  assert.equal(canSeeDefense({ ...base, isGM: true }), true);
  assert.equal(canSeeDefense({ ...base, showFoeDc: true }), true);
  assert.equal(canSeeDefense({ ...base, actorType: "character" }), true);
  assert.equal(canSeeDefense({ ...base, isObserver: true }), true);
});

/* -------------------------------------------- */
/*  Foundry mocks                               */
/* -------------------------------------------- */

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.classes = new Set();
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
    this.children.push(...nodes);
  }
  matches(selector) {
    const [, cls, attr] = selector.match(/^\.([\w-]+)(?:\[data-([\w-]+)\])?$/) ?? [];
    if (!cls || !this.classes.has(cls)) return false;
    return !attr || attr.replace(/-(\w)/g, (_, c) => c.toUpperCase()) in this.dataset;
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
const LANG = {
  "pt-BR": flatten(JSON.parse(readFileSync(new URL("../lang/pt-BR.json", import.meta.url)))),
  en: flatten(JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url))))
};

/** A token whose actor exposes what the rule reads. */
function makeToken(id, { name = id, defense = 15, type = "npc", prone = false, outros = 0, sourceOutros = 0, displayName = 50 } = {}) {
  const actor = {
    type,
    system: { attributes: { defesa: { value: defense, outros } } },
    _source: { system: { attributes: { defesa: { outros: sourceOutros } } } },
    statuses: new Set(prone ? ["caido"] : []),
    testUserPermission: () => false
  };
  return { actor, document: { uuid: `Scene.s.Token.${id}`, name, displayName, actor, isOwner: false } };
}

function setup({ rule = "on", lang = "pt-BR", isGM = true, showFoeDc = true, before } = {}) {
  const settings = { [`${MODULE}.attackVsDefenseRule`]: rule, "tormenta20.showFoeDc": showFoeDc };
  const strings = LANG[lang];
  const docs = new Map();
  const seen = [];
  const calls = [];
  const hooks = {};
  globalThis.game = {
    user: { isGM, targets: new Set() },
    settings: { get: (scope, key) => settings[`${scope}.${key}`] },
    i18n: {
      has: (key) => key in strings,
      localize: (key) => strings[key] ?? key,
      format: (key, data) => (strings[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => data[k])
    }
  };
  globalThis.foundry = { utils: { fromUuidSync: (uuid) => docs.get(uuid) ?? null } };
  globalThis.document = { createElement: (tag) => new FakeElement(tag), createTextNode: (text) => ({ textContent: String(text) }) };

  class ItemT20 {
    constructor(system) {
      this.system = system;
    }
    clone() {
      return new ItemT20(structuredClone({ ...this.system, rolled: undefined }));
    }
    /** Mirrors the system: synchronous clone, the use dialog, then attack, damage and card on the clone. */
    async roll() {
      const item = this.clone({}, { keepId: true });
      await tick();
      hooks.duringDialog?.(item);
      item.system.rolled = {};
      await item.rollAttack({ options: {} });
      await item.rollDamage();
      return item;
    }
    /** Fake original: one roll per attack entry, with the d20 picked by the test. */
    async rollAttack(...args) {
      calls.push({ self: this, args });
      hooks.duringAttack?.(this);
      await tick();
      const naturals = [...(this.system.naturals ?? [])];
      for (const r of this.system.rolls.filter((x) => x.type === "ataque")) {
        const natural = naturals.shift() ?? 10;
        const roll = { terms: [{ faces: 20, total: natural }], total: natural + this.system.bonus, options: { type: "attack" } };
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
  before?.();
  installAttackVsDefenseRule();

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
  const data = (item, name = "Ataque") => item.system.rolled[name].options[MODULE]?.attackVsDefense;
  return { ItemT20, ChatMessageT20, weapon, target, data, seen, calls, hooks, docs, settings };
}

/* -------------------------------------------- */
/*  rollAttack                                  */
/* -------------------------------------------- */

test("a threat that misses the only target loses the critical before the damage", async () => {
  const env = setup();
  env.target(makeToken("A", { name: "Goblin", defense: 25 }));
  const item = await env.weapon({ naturals: [19] }).roll();
  const roll = item.system.rolled.Ataque;
  assert.equal(roll._critical, false);
  assert.equal(env.seen[0].critical, false);
  const data = env.data(item);
  assert.deepEqual({ v: data.v, kind: data.kind, threat: data.threat, critical: data.critical }, { v: 1, kind: "melee", threat: true, critical: false });
  assert.deepEqual(data.targets, [
    { uuid: "Scene.s.Token.A", name: "Goblin", actorType: "npc", displayName: 50, defense: 25, adjustments: [], outcome: "miss", critical: false, automatic: null }
  ]);
});

test("rule off, no targets or a maneuver resistance use: the system's result is untouched", async () => {
  for (const variant of ["off", "none", "maneuver"]) {
    const env = setup({ rule: variant === "off" ? "off" : "on" });
    if (variant !== "none") env.target(makeToken("A", { defense: 20 }));
    const weapon = env.weapon({ naturals: [19] });
    const item = variant === "maneuver" ? await withUsePurpose(USE_PURPOSES.MANEUVER_RESISTANCE, () => weapon.roll()) : await weapon.roll();
    assert.equal(item.system.rolled.Ataque._critical, true, variant);
    assert.equal(env.data(item), undefined, variant);
    assert.equal(env.seen[0].critical, true, variant);
  }
});

test("the wrapper keeps this, arguments and the return value", async () => {
  const env = setup();
  env.target(makeToken("A"));
  const item = env.weapon();
  item.system.rolled = {};
  const args = { options: { x: 1 } };
  assert.equal(await item.rollAttack(args), "attack-result");
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].self, item);
  assert.deepEqual(env.calls[0].args, [args]);
});

test("natural 20 hits with a critical against any Defense; natural 1 misses against any Defense", async () => {
  const env = setup();
  env.target(makeToken("A", { defense: 40 }));
  const nat20 = await env.weapon({ naturals: [20] }).roll();
  assert.equal(nat20.system.rolled.Ataque._critical, true);
  assert.deepEqual(
    (({ outcome, critical, automatic }) => ({ outcome, critical, automatic }))(env.data(nat20).targets[0]),
    { outcome: "hit", critical: true, automatic: "nat20" }
  );
  env.target(makeToken("B", { defense: 2 }));
  const nat1 = await env.weapon({ naturals: [1] }).roll();
  assert.equal(env.data(nat1).targets[0].outcome, "miss");
  assert.equal(env.data(nat1).targets[0].automatic, "nat1");
});

test("a critical survives when one target is hit, or when one target has an unknown Defense", async () => {
  const env = setup();
  env.target(makeToken("A", { defense: 40 }), makeToken("B", { defense: 10 }));
  const hit = await env.weapon({ naturals: [19] }).roll();
  assert.deepEqual(env.data(hit).targets.map((t) => [t.outcome, t.critical]), [["miss", false], ["hit", true]]);
  assert.equal(hit.system.rolled.Ataque._critical, true);
  assert.equal(env.data(hit).critical, true);

  env.target(makeToken("C", { defense: 40 }), makeToken("D", { defense: null, type: "perigo" }));
  const unknown = await env.weapon({ naturals: [19] }).roll();
  assert.deepEqual(env.data(unknown).targets.map((t) => t.outcome), ["miss", "unknown"]);
  assert.equal(unknown.system.rolled.Ataque._critical, true);
});

test("prone: ranged attacks use Defense +5 without the condition, melee uses the prepared Defense", async () => {
  const env = setup();
  env.target(makeToken("A", { defense: 10, prone: true, outros: -5, sourceOutros: 0 }));
  const melee = await env.weapon().roll();
  assert.deepEqual([env.data(melee).kind, env.data(melee).targets[0].defense], ["melee", 10]);
  const ranged = await env.weapon({ rolls: [{ type: "ataque", name: "Ataque", parts: [["1d20"], ["pont"]] }] }).roll();
  assert.deepEqual([env.data(ranged).kind, env.data(ranged).targets[0].defense, env.data(ranged).targets[0].adjustments], ["ranged", 20, ["prone-ranged"]]);
  // Two attacks, Luta first: the system adds the first skill's bonuses to both, so both are melee.
  const both = await env
    .weapon({
      rolls: [
        { type: "ataque", name: "Ataque", parts: [["1d20"], ["luta"]] },
        { type: "ataque", name: "Disparo", parts: [["1d20"], ["pont"]] }
      ]
    })
    .roll();
  assert.equal(env.data(both, "Disparo").kind, "melee");
  assert.equal(env.data(both, "Disparo").targets[0].defense, 10);
});

test("targets and names are frozen at the start of the use; Defense is read from the token matched by UUID", async () => {
  const env = setup();
  const A = makeToken("A", { name: "Original", defense: 12 });
  env.target(A);
  env.hooks.duringDialog = () => {
    A.document.name = "Renamed";
    env.target(makeToken("B"));
  };
  env.hooks.duringAttack = () => env.target(makeToken("C"));
  const item = await env.weapon().roll();
  assert.deepEqual(env.data(item).targets.map((t) => [t.uuid, t.name, t.defense]), [["Scene.s.Token.A", "Original", 12]]);
});

test("two direct rollAttack calls on the same item read the targets at each call", async () => {
  const env = setup();
  const item = env.weapon();
  env.target(makeToken("A"));
  item.system.rolled = {};
  await item.rollAttack({ options: {} });
  assert.equal(env.data(item).targets[0].uuid, "Scene.s.Token.A");
  env.target(makeToken("B"));
  item.system.rolled = {};
  await item.rollAttack({ options: {} });
  assert.equal(env.data(item).targets[0].uuid, "Scene.s.Token.B");
});

test("overlapping uses on different clones do not mix their targets", async () => {
  const env = setup();
  env.target(makeToken("A", { defense: 40 }));
  const first = env.weapon({ naturals: [19] }).roll();
  env.target(makeToken("B", { defense: 5 }));
  const second = env.weapon({ naturals: [19] }).roll();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual([env.data(a).targets[0].uuid, env.data(a).targets[0].outcome], ["Scene.s.Token.A", "miss"]);
  assert.deepEqual([env.data(b).targets[0].uuid, env.data(b).targets[0].outcome], ["Scene.s.Token.B", "hit"]);
});

test("Defense adjustments registered on the clone are added per target", async () => {
  const env = setup();
  env.target(makeToken("A", { defense: 10 }), makeToken("B", { defense: 10, prone: true, outros: -5 }));
  env.hooks.duringDialog = (clone) =>
    addDefenseAdjustments(clone, new Map([["Scene.s.Token.A", [{ id: "cover", delta: 5 }]], ["Scene.s.Token.B", [{ id: "x", delta: -2 }]]]));
  const item = await env.weapon({ rolls: [{ type: "ataque", name: "Ataque", parts: [["1d20"], ["pont"]] }] }).roll();
  assert.deepEqual(env.data(item).targets.map((t) => [t.defense, t.adjustments]), [[15, ["cover"]], [18, ["prone-ranged", "x"]]]);
});

test("a target without a matching token or with a broken actor gives an unknown Defense, never a rejection", async () => {
  const env = setup();
  const broken = makeToken("A");
  Object.defineProperty(broken, "actor", { get: () => { throw new Error("boom"); } });
  env.target(broken);
  const originalError = console.error;
  console.error = () => {};
  try {
    const item = await env.weapon({ naturals: [19] }).roll();
    assert.equal(item.system.rolled.Ataque._critical, true);
  } finally {
    console.error = originalError;
  }
});

/** A stand-in for the concealment rule (#49): publishes checks before the original, cancels after it. */
function installConcealmentDouble(missedUuids) {
  const proto = CONFIG.Item.documentClass.prototype;
  const original = proto.rollAttack;
  proto.rollAttack = markWrapper(async function (...args) {
    setConcealmentChecks(this, missedUuids.map((uuid) => ({ rollName: "Ataque", targetUuid: uuid, missed: true })));
    const result = await original.apply(this, args);
    const roll = this.system.rolled?.Ataque;
    const uuids = [...game.user.targets].map((t) => t.document.uuid);
    if (roll?._critical && !keepCritical(uuids.map((u) => finalOutcome(undefined, missedUuids.includes(u))))) roll._critical = false;
    return result;
  }, original);
}

test("concealment: a target missed by concealment is a miss without critical, in both wrapper orders", async () => {
  for (const inside of [true, false]) {
    for (const missB of [true, false]) {
      const label = `double ${inside ? "inside" : "outside"}, B ${missB ? "missed" : "passed"}`;
      const missed = missB ? ["Scene.s.Token.B"] : [];
      const env = setup({ before: inside ? () => installConcealmentDouble(missed) : undefined });
      if (!inside) installConcealmentDouble(missed);
      env.target(makeToken("A", { defense: 30 }), makeToken("B", { defense: 10 }));
      const item = await env.weapon({ naturals: [19] }).roll();
      const targets = env.data(item).targets;
      assert.equal(env.calls.length, 1, label);
      assert.equal(targets[0].outcome, "miss", label);
      if (missB) {
        assert.deepEqual([targets[1].outcome, targets[1].critical, targets[1].concealment, targets[1].defenseOutcome], ["miss", false, true, "hit"], label);
        assert.deepEqual([env.data(item).threat, env.data(item).critical, item.system.rolled.Ataque._critical, env.seen[0].critical], [true, false, false, false], label);
      } else {
        assert.deepEqual([targets[1].outcome, targets[1].critical], ["hit", true], label);
        assert.equal(item.system.rolled.Ataque._critical, true, label);
      }
    }
  }
});

test("a critical cancelled by another rule is not restored, and the threat is still recorded", async () => {
  const env = setup({
    before: () => {
      const proto = CONFIG.Item.documentClass.prototype;
      const original = proto.rollAttack;
      proto.rollAttack = async function (...args) {
        const result = await original.apply(this, args);
        this.system.rolled.Ataque._critical = false;
        return result;
      };
    }
  });
  env.target(makeToken("A", { defense: 5 }));
  const item = await env.weapon({ naturals: [19] }).roll();
  assert.equal(item.system.rolled.Ataque._critical, false);
  assert.deepEqual([env.data(item).threat, env.data(item).critical, env.data(item).targets[0].outcome], [true, true, "hit"]);
});

/* -------------------------------------------- */
/*  Card                                        */
/* -------------------------------------------- */

function card({ title = "Ataque", critical = true } = {}) {
  const root = new FakeElement("li");
  const container = new FakeElement("div");
  container.className = "roll";
  container.dataset.rollTitle = title;
  const total = new FakeElement("h4");
  total.className = critical ? "dice-total success critical" : "dice-total";
  container.append(total);
  root.append(container);
  return { root, container, total };
}

function message(env, data, { visible = true } = {}) {
  const msg = new env.ChatMessageT20();
  msg.isContentVisible = visible;
  msg.rolls = [{ options: { title: "Ataque", type: "attack", [MODULE]: { attackVsDefense: data } } }];
  return msg;
}

const recorded = (overrides = {}) => ({
  uuid: "Scene.s.Token.A",
  name: "Orc Combatente",
  actorType: "npc",
  displayName: 50,
  defense: 17,
  adjustments: [],
  outcome: "miss",
  critical: false,
  automatic: null,
  ...overrides
});

test("renderHTML: one block per roll, idempotent, and a cancelled critical loses its highlight", async () => {
  const env = setup();
  const { root, container, total } = card();
  const msg = message(env, { v: 1, kind: "melee", threat: true, critical: false, targets: [recorded()] });
  msg.html = root;
  await msg.renderHTML();
  await msg.renderHTML();
  assert.equal(container.querySelectorAll(".t20cp-attack-vs-defense").length, 1);
  assert.deepEqual([total.classList.contains("critical"), total.classList.contains("success"), total.classList.contains("failure")], [false, false, true]);
  const text = container.querySelector(".t20cp-attack-vs-defense").textContent;
  assert.match(text, /Sem acerto crítico: o ataque errou todos os alvos\./);
  assert.match(text, /Orc Combatente: Errou · Defesa 17/);
});

test("renderHTML: a kept critical keeps the highlight; hidden content and messages without data are not decorated", async () => {
  const env = setup();
  const kept = card();
  const msg = message(env, { v: 1, kind: "melee", threat: true, critical: true, targets: [recorded({ outcome: "hit", critical: true, automatic: "nat20" })] });
  msg.html = kept.root;
  await msg.renderHTML();
  assert.equal(kept.total.classList.contains("critical"), true);
  assert.match(kept.container.textContent, /Acertou \(crítico\) · 20 natural · Defesa 17/);

  const hidden = card();
  const blind = message(env, { v: 1, kind: "melee", threat: true, critical: false, targets: [recorded()] }, { visible: false });
  blind.html = hidden.root;
  await blind.renderHTML();
  assert.equal(hidden.container.querySelector(".t20cp-attack-vs-defense"), null);
  assert.equal(hidden.total.classList.contains("critical"), true);

  const plain = card();
  const none = new env.ChatMessageT20();
  Object.assign(none, { isContentVisible: true, rolls: [{ options: { title: "Ataque" } }], html: plain.root });
  await none.renderHTML();
  assert.equal(plain.container.querySelector(".t20cp-attack-vs-defense"), null);
});

test("describeTarget: names follow ownership and display mode; the recorded name is always the one shown", () => {
  const env = setup({ isGM: false });
  const token = makeToken("A", { name: "Renamed", displayName: 0 });
  env.docs.set(token.document.uuid, token.document);
  // Observer without ownership, name mode "Never" or "Owner": hidden.
  token.actor.testUserPermission = () => true;
  assert.equal(describeTarget(recorded(), 0).name, "Alvo 1");
  token.document.displayName = 40;
  assert.equal(describeTarget(recorded(), 1).name, "Alvo 2");
  token.document.isOwner = true;
  assert.equal(describeTarget(recorded(), 0).name, "Orc Combatente");
  // Deleted token: recorded display mode.
  env.docs.clear();
  assert.equal(describeTarget(recorded({ displayName: 30 }), 0).name, "Orc Combatente");
  assert.equal(describeTarget(recorded({ displayName: 0 }), 0).name, "Alvo 1");
});

test("describeTarget: the Defense number follows showFoeDc for foes, with GM, observer and character exceptions", () => {
  const env = setup({ isGM: false, showFoeDc: false });
  const token = makeToken("A");
  env.docs.set(token.document.uuid, token.document);
  assert.equal(describeTarget(recorded(), 0).text, "Errou");
  assert.equal(describeTarget(recorded({ actorType: "character" }), 0).text, "Errou · Defesa 17");
  token.actor.testUserPermission = (user, level) => level === "OBSERVER";
  assert.equal(describeTarget(recorded(), 0).text, "Errou · Defesa 17");
  game.user.isGM = true;
  token.actor.testUserPermission = () => false;
  assert.equal(describeTarget(recorded(), 0).text, "Errou · Defesa 17");
  env.settings["tormenta20.showFoeDc"] = true;
  game.user.isGM = false;
  assert.equal(describeTarget(recorded(), 0).text, "Errou · Defesa 17");
});

test("describeTarget: adjustment labels come from the shared namespace, in the user's language", () => {
  for (const [lang, prone, unknown, miss] of [
    ["pt-BR", "caído: +5 contra ataque à distância", "Defesa desconhecida", "Errou (camuflagem)"],
    ["en", "prone: +5 against ranged attack", "Unknown Defense", "Miss (concealment)"]
  ]) {
    setup({ lang });
    assert.match(describeTarget(recorded({ adjustments: ["prone-ranged", "no-such-id"] }), 0).text, new RegExp(`${prone.replace(/[+()]/g, "\\$&")} · no-such-id`), lang);
    assert.match(describeTarget(recorded({ outcome: "unknown", defense: null }), 0).text, new RegExp(unknown), lang);
    assert.match(describeTarget(recorded({ concealment: true }), 0).text, new RegExp(miss.replace(/[()]/g, "\\$&")), lang);
  }
});

test("buildTargetResult: records only the frozen identity and the computed result", () => {
  const result = buildTargetResult(
    { uuid: "u", name: "N", displayName: "30", actorType: "npc", value: 12, prone: false },
    { kind: "melee", total: 12, natural: 7, threat: false }
  );
  assert.deepEqual(result, { uuid: "u", name: "N", actorType: "npc", displayName: 30, defense: 12, adjustments: [], outcome: "hit", critical: false, automatic: null });
});
