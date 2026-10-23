import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSaveData,
  damageMultiplier,
  installSaveButtonRule,
  latestResults,
  naturalD20,
  parseSaveText,
  pendingKey,
  pickDamageRoll,
  saveOutcome,
  shouldHideDc
} from "../scripts/rules/save-button.mjs";
import { USE_PURPOSES, withUsePurpose } from "../scripts/rules/shared/targets.mjs";

const MODULE = "t20-community-patches";

/* -------------------------------------------- */
/*  Pure functions                              */
/* -------------------------------------------- */

test("parseSaveText: skills, effects, typos and texts without a skill", () => {
  const cases = {
    "Vontade anula": [["vont", "anula"]],
    "Reflexos reduz à metade": [["refl", "metade"]],
    "Reflexos Metade": [["refl", "metade"]],
    "Fortitude parcial": [["fort", "parcial"]],
    "Vontade desacredita": [["vont", "desacredita"]],
    "Fortitude evita": [["fort", "evita"]],
    "Vontade Anula, Fortitude Parcial": [["vont", "anula"], ["fort", "parcial"]],
    "Fortitude parcial ou Reflexos anula": [["fort", "parcial"], ["refl", "anula"]],
    "Relfexos parcial": [["refl", "parcial"]],
    "Vontade anual": [["vont", "anula"]],
    "Vontade": [["vont", null]],
    "Fortitude (veja texto)": [["fort", null]],
    "Fortitude Varia": [["fort", null]],
    "Vontade anula; Vontade parcial": [["vont", "anula"]],
    "veja texto": [],
    "nenhuma": [],
    "varia (veja o texto)": [],
    "": []
  };
  for (const [text, expected] of Object.entries(cases)) {
    assert.deepEqual(parseSaveText(text).map(({ skill, effect }) => [skill, effect]), expected, text);
  }
  assert.deepEqual(parseSaveText(undefined), []);
});

test("buildSaveData: needs a skill and a positive DC; drops empty and repeated targets", () => {
  assert.equal(buildSaveData({ txt: "Reflexos reduz à metade", dc: 0 }), null);
  assert.equal(buildSaveData({ txt: "Reflexos reduz à metade", dc: NaN }), null);
  assert.equal(buildSaveData({ txt: "veja texto", dc: 21 }), null);
  const A = { uuid: "T.A", name: "A", displayName: 50 };
  const save = buildSaveData({ txt: "Reflexos reduz à metade", dc: "21", itemName: "Relâmpago", casterType: "npc", targets: [A, null, { name: "x" }, { ...A, name: "dup" }] });
  assert.equal(save.dc, 21);
  assert.deepEqual(save.targets, [A]);
  assert.deepEqual(save.saves, [{ skill: "refl", effect: "metade" }]);
});

test("naturalD20 reads the single kept d20", () => {
  assert.equal(naturalD20({ dice: [{ faces: 20, results: [{ result: 20, active: true }] }] }), 20);
  assert.equal(naturalD20({ dice: [{ faces: 20, results: [{ result: 3, active: false, discarded: true }, { result: 17, active: true }] }] }), 17);
  assert.equal(naturalD20({ dice: [{ faces: 6, results: [{ result: 6 }] }] }), null);
  assert.equal(naturalD20({ dice: [] }), null);
});

test("saveOutcome: total >= DC passes; natural 20 always passes and natural 1 always fails", () => {
  assert.deepEqual(saveOutcome({ total: 21, natural: 10, dc: 21 }), { success: true, auto: false });
  assert.deepEqual(saveOutcome({ total: 20, natural: 10, dc: 21 }), { success: false, auto: false });
  assert.deepEqual(saveOutcome({ total: 15, natural: 20, dc: 30 }), { success: true, auto: true });
  assert.deepEqual(saveOutcome({ total: 40, natural: 1, dc: 10 }), { success: false, auto: true });
  assert.equal(saveOutcome({ total: 10, natural: 10, dc: 0 }), null);
  assert.equal(saveOutcome({ total: NaN, natural: 10, dc: 10 }), null);
});

test("shouldHideDc mirrors ChatMessageT20#_hideDC", () => {
  assert.equal(shouldHideDc({ showFoeDc: false, isGM: false, casterType: "npc" }), true);
  assert.equal(shouldHideDc({ showFoeDc: false, isGM: false, casterType: "character" }), false);
  assert.equal(shouldHideDc({ showFoeDc: false, isGM: true, casterType: "npc" }), false);
  assert.equal(shouldHideDc({ showFoeDc: true, isGM: false, casterType: "npc" }), false);
  assert.equal(shouldHideDc({ showFoeDc: false, isGM: false, casterType: "" }), false);
});

test("latestResults: newest per target and skill, ties to the greater id", () => {
  const r = (id, timestamp, tokenUuid, skill = "refl") => ({ id, timestamp, result: { tokenUuid, skill } });
  const latest = latestResults([r("a", 1, "T.A"), r("b", 2, "T.A"), r("c", 2, "T.B"), r("d", 2, "T.B"), r("e", 1, "T.A", "fort"), r("f", 9, undefined)]);
  assert.equal(latest.get("T.A|refl").id, "b");
  assert.equal(latest.get("T.B|refl").id, "d");
  assert.equal(latest.get("T.A|fort").id, "e");
  assert.equal(latest.size, 3);
});

test("damageMultiplier and pickDamageRoll", () => {
  assert.equal(damageMultiplier({ effect: "metade", success: true }), 0.5);
  assert.equal(damageMultiplier({ effect: "metade", success: false }), 1);
  for (const effect of ["anula", "parcial", null]) assert.equal(damageMultiplier({ effect, success: true }), null);
  const damage = { options: { type: "damage" }, terms: [{ options: { flavor: "fogo" } }] };
  assert.equal(pickDamageRoll([{ options: { type: "attack" } }, damage]), damage);
  assert.equal(pickDamageRoll([damage, damage]), null);
  assert.equal(pickDamageRoll([]), null);
  assert.equal(pickDamageRoll([{ options: { type: "damage" }, terms: [{ options: { flavor: "curapv" } }] }]), null);
});

test("pendingKey separates cards, tokens and skills", () => {
  const keys = new Set([pendingKey("c1", "T.A", "refl"), pendingKey("c2", "T.A", "refl"), pendingKey("c1", "T.B", "refl"), pendingKey("c1", "T.A", "fort")]);
  assert.equal(keys.size, 4);
});

/* -------------------------------------------- */
/*  Foundry mocks                               */
/* -------------------------------------------- */

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.className = "";
    this.disabled = false;
    this.listeners = {};
    this.parent = null;
    this._text = "";
    this.classList = { add: (...names) => (this.className = [this.className, ...names].filter(Boolean).join(" ")) };
  }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }
  get isConnected() {
    let node = this;
    while (node.parent) node = node.parent;
    return node.root === true;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  addEventListener(type, fn) {
    this.listeners[type] = fn;
  }
  click() {
    return this.listeners.click?.({ preventDefault() {}, stopPropagation() {}, shiftKey: false });
  }
  matches(selector) {
    const classes = this.className.split(/\s+/);
    return selector.split(".").filter(Boolean).every((name) => classes.includes(name));
  }
  querySelectorAll(selector) {
    const out = [];
    for (const child of this.children) {
      if (child.matches(selector)) out.push(child);
      out.push(...child.querySelectorAll(selector));
    }
    return out;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

class Messages extends Map {
  [Symbol.iterator]() {
    return this.values();
  }
}

function setupFoundry({ isGM = false, rule = "on", showFoeDc = false } = {}) {
  const settings = { [`${MODULE}.saveButtonRule`]: rule, "tormenta20.showFoeDc": showFoeDc };
  const hooks = {};
  const created = [];
  const redraws = [];
  const tokens = new Map();
  const messages = new Messages();
  let nextId = 0;
  let clock = 0;

  const makeMessage = (data) => {
    const message = {
      id: data.id ?? `m${++nextId}`,
      documentName: "ChatMessage",
      timestamp: ++clock,
      flags: JSON.parse(JSON.stringify(data.flags ?? {})),
      rolls: data.rolls ?? [],
      isOwner: true,
      isContentVisible: data.isContentVisible ?? true,
      render() {
        redraws.push(`window:${this.id}`);
      },
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
      async setFlag(scope, key, value) {
        this.flags[scope] ??= {};
        this.flags[scope][key] = value;
        hooks.updateChatMessage?.(this);
        return this;
      }
    };
    messages.set(message.id, message);
    return message;
  };

  class ItemT20 {
    constructor({ txt = "Reflexos reduz à metade", cd = 21, name = "Relâmpago", casterType = "npc" } = {}) {
      this.name = name;
      this.system = { resistencia: { txt, cd } };
      this.actor = { type: casterType };
      this.displayCalls = [];
    }
    clone() {
      const copy = new ItemT20({ ...this.system.resistencia, name: this.name, casterType: this.actor.type });
      copy.displayCalls = this.displayCalls;
      copy.hooks = this.hooks;
      return copy;
    }
    async roll() {
      const item = this.clone({}, { keepId: true });
      await null;
      await this.hooks?.rollAttack?.(item);
      await this.hooks?.rollDamage?.(item);
      return item.displayCard({ options: { effects: [] }, rollMode: "publicroll", createMessage: true });
    }
    async displayCard(params = {}) {
      this.displayCalls.push(params);
      await this.hooks?.insideDisplay?.(this);
      const chatData = { content: "<p>card</p>", flags: { tormenta20: { itemData: {} } } };
      return params.createMessage === false ? chatData : globalThis.ChatMessage.create(chatData);
    }
  }

  Object.assign(globalThis, {
    CONFIG: { Item: { documentClass: ItemT20 }, T20: { resistencias: { fort: "Fortitude", refl: "Reflexos", vont: "Vontade" } } },
    game: {
      settings: { get: (scope, key) => settings[`${scope}.${key}`] },
      user: { id: "u1", isGM, targets: new Set() },
      messages,
      i18n: {
        localize: (key) => key.replace(/^T20CP\.SaveButton\./, ""),
        format: (key, data) => `${key.replace(/^T20CP\.SaveButton\./, "")}${JSON.stringify(data)}`
      }
    },
    ui: {
      chat: { updateMessage: (message) => redraws.push(message.id) },
      notifications: { warn() {}, error() {} }
    },
    Hooks: { on: (name, fn) => (hooks[name] = fn) },
    ChatMessage: {
      create: async (chatData) => {
        created.push(chatData);
        return makeMessage(chatData);
      }
    },
    foundry: {
      utils: {
        setProperty(obj, path, value) {
          const keys = path.split(".");
          const last = keys.pop();
          let node = obj;
          for (const key of keys) node = node[key] ??= {};
          node[last] = value;
        },
        fromUuidSync: (uuid) => tokens.get(uuid) ?? null
      }
    },
    document: { createElement: (tag) => new FakeElement(tag) }
  });
  installSaveButtonRule();

  const addToken = (id, { name = id, displayName = 50, isOwner = true, rollPericia } = {}) => {
    const doc = {
      uuid: `Scene.s.Token.${id}`,
      name,
      displayName,
      isOwner,
      actor: { isOwner, system: { pericias: { fort: {}, refl: {}, vont: {} } }, rollPericia, applyDamageV2: async () => {} }
    };
    tokens.set(doc.uuid, doc);
    return doc;
  };
  const render = (message) => {
    const root = new FakeElement("li");
    root.root = true;
    const content = new FakeElement("div");
    content.className = "message-content";
    root.append(content);
    hooks.renderChatMessageHTML(message, root);
    return root;
  };
  const rows = (root) => root.querySelectorAll(".t20cp-save-row");
  const buttons = (node) => node.querySelectorAll(".t20cp-save-button");
  return { ItemT20, hooks, created, redraws, tokens, messages, settings, makeMessage, addToken, render, rows, buttons };
}

const record = (doc) => ({ uuid: doc.uuid, name: doc.name, displayName: doc.displayName });

/* -------------------------------------------- */
/*  displayCard wrapper                         */
/* -------------------------------------------- */

test("on: the original gets createMessage false and the created card carries the save and the targets", async () => {
  const env = setupFoundry();
  const A = env.addToken("A", { name: "Guerreiro" });
  game.user.targets = new Set([{ document: A }]);
  const item = new env.ItemT20();
  const message = await item.roll();
  assert.equal(item.displayCalls[0].createMessage, false);
  assert.equal(env.created.length, 1);
  const save = message.flags[MODULE].save;
  assert.equal(save.dc, 21);
  assert.equal(save.casterType, "npc");
  assert.deepEqual(save.targets, [record(A)]);
});

test("targets changed during the damage or the attack do not reach the card", async () => {
  for (const step of ["rollAttack", "rollDamage"]) {
    const env = setupFoundry();
    const A = env.addToken("A");
    const B = env.addToken("B");
    game.user.targets = new Set([{ document: A }]);
    const item = new env.ItemT20();
    item.hooks = { [step]: async () => (game.user.targets = new Set([{ document: B }])) };
    const message = await item.roll();
    assert.deepEqual(message.flags[MODULE].save.targets.map((t) => t.uuid), [A.uuid], step);
  }
});

test("renaming the token during the use keeps the clicked name", async () => {
  const env = setupFoundry();
  const A = env.addToken("A", { name: "Guerreiro" });
  game.user.targets = new Set([{ document: A }]);
  const item = new env.ItemT20();
  item.hooks = { rollDamage: async () => (A.name = "Outro") };
  const message = await item.roll();
  assert.equal(message.flags[MODULE].save.targets[0].name, "Guerreiro");
});

test("a direct call outside roll reads the current targets each time", async () => {
  const env = setupFoundry();
  const A = env.addToken("A");
  const B = env.addToken("B");
  const item = new env.ItemT20();
  game.user.targets = new Set([{ document: A }]);
  const first = await item.displayCard({ options: {} });
  game.user.targets = new Set([{ document: B }]);
  const second = await item.displayCard({ options: {} });
  assert.deepEqual(first.flags[MODULE].save.targets.map((t) => t.uuid), [A.uuid]);
  assert.deepEqual(second.flags[MODULE].save.targets.map((t) => t.uuid), [B.uuid]);
});

test("createMessage false returns the chat data with the flag and creates nothing", async () => {
  const env = setupFoundry();
  const chatData = await new env.ItemT20().displayCard({ options: {}, createMessage: false });
  assert.equal(env.created.length, 0);
  assert.equal(chatData.flags[MODULE].save.dc, 21);
});

test("off, an unrecognized save or a maneuver resistance use: the original gets the same arguments", async () => {
  const cases = [
    [{ rule: "off" }, {}],
    [{}, { txt: "veja texto" }],
    [{}, { cd: 0 }]
  ];
  for (const [options, data] of cases) {
    const env = setupFoundry(options);
    const item = new env.ItemT20(data);
    const params = { options: {}, createMessage: true };
    const message = await item.displayCard(params);
    assert.equal(item.displayCalls[0], params);
    assert.equal(message.flags[MODULE], undefined);
  }
  const env = setupFoundry();
  const item = new env.ItemT20();
  const message = await withUsePurpose(USE_PURPOSES.MANEUVER_RESISTANCE, () => item.roll());
  assert.equal(item.displayCalls[0].createMessage, true);
  assert.equal(message.flags[MODULE], undefined);
});

test("overlapping calls keep their own flag", async () => {
  const env = setupFoundry();
  const release = {};
  const one = new env.ItemT20({ name: "Um", cd: 11 });
  const two = new env.ItemT20({ name: "Dois", cd: 22 });
  for (const [item, key] of [[one, "one"], [two, "two"]]) {
    item.hooks = { insideDisplay: () => new Promise((resolve) => (release[key] = resolve)) };
  }
  const p1 = one.displayCard({ options: {} });
  const p2 = two.displayCard({ options: {} });
  await null;
  release.two();
  release.one();
  const [m1, m2] = await Promise.all([p1, p2]);
  assert.deepEqual([m1.flags[MODULE].save.itemName, m1.flags[MODULE].save.dc], ["Um", 11]);
  assert.deepEqual([m2.flags[MODULE].save.itemName, m2.flags[MODULE].save.dc], ["Dois", 22]);
});

/* -------------------------------------------- */
/*  Card rendering and rolls                    */
/* -------------------------------------------- */

const saveFlag = (targets, extra = {}) => ({
  [MODULE]: { save: { text: "Reflexos reduz à metade", dc: 21, itemName: "Relâmpago", casterType: "npc", saves: [{ skill: "refl", effect: "metade" }], targets, ...extra } }
});
const resultMessage = (env, card, doc, { total = 25, natural = 15, success = true, target, visible = true } = {}) =>
  env.makeMessage({
    isContentVisible: visible,
    flags: {
      [MODULE]: {
        saveResult: { cardId: card.id, itemName: "Relâmpago", casterType: "npc", tokenUuid: doc.uuid, target, skill: "refl", effect: "metade", dc: 21, total, natural, success }
      }
    }
  });

test("names: recorded name, 'Alvo N' for non-owners when the token hides it, unavailable when deleted", () => {
  const env = setupFoundry();
  const A = env.addToken("A", { name: "Guerreiro", isOwner: false });
  const card = env.makeMessage({ flags: saveFlag([{ uuid: A.uuid, name: "Guerreiro", displayName: 50 }]) });
  A.name = "Outro";
  assert.equal(env.rows(env.render(card))[0].children[0].textContent, "Guerreiro");
  A.displayName = 0;
  assert.equal(env.rows(env.render(card))[0].children[0].textContent, 'Target{"n":1}');
  env.tokens.delete(A.uuid);
  assert.equal(env.rows(env.render(card))[0].children[0].textContent, "Guerreiro UnavailableSuffix");
});

test("a token that only has a result shows 'Alvo N' to players and its name to the GM", () => {
  for (const isGM of [false, true]) {
    const env = setupFoundry({ isGM });
    const C = env.addToken("C", { name: "Esqueleto", displayName: 0, isOwner: false });
    const card = env.makeMessage({ flags: saveFlag([]) });
    env.hooks.createChatMessage(resultMessage(env, card, C, { target: { uuid: C.uuid, name: "Esqueleto", displayName: 0 } }));
    const name = env.rows(env.render(card))[0].children[0].textContent;
    assert.equal(name, isGM ? "Esqueleto" : 'Target{"n":1}');
  }
});

test("outcome, hidden result and DC hidden for players", () => {
  const env = setupFoundry();
  const A = env.addToken("A");
  const card = env.makeMessage({ flags: saveFlag([record(A)]), rolls: [{ options: { type: "damage" }, terms: [] }] });
  const header = env.render(card).querySelector(".t20cp-save-title").textContent;
  assert.match(header, /"dc":"\?\?"/);
  const result = resultMessage(env, card, A, { total: 25 });
  env.hooks.createChatMessage(result);
  const outcome = env.render(card).querySelector(".t20cp-save-outcome");
  assert.match(outcome.textContent, /25 · Success/);
  assert.match(outcome.textContent, /Effect\.metade/);
  assert.match(outcome.textContent, /ApplyHalfDamage/);
  assert.match(env.render(result).querySelector(".t20cp-save-result").textContent, /"dc":"\?\?"/);
  result.isContentVisible = false;
  assert.equal(env.render(card).querySelector(".t20cp-save-outcome").textContent, "Hidden");
});

test("a pending roll stays locked across redraws and is released when the dialog is cancelled or fails", async () => {
  for (const finish of ["cancel", "error"]) {
    const env = setupFoundry();
    const calls = [];
    let settle;
    const A = env.addToken("A", {
      rollPericia: (skill) => {
        calls.push(skill);
        return new Promise((resolve, reject) => (settle = finish === "cancel" ? () => resolve(undefined) : () => reject(new Error("x"))));
      }
    });
    const B = env.addToken("B");
    const card = env.makeMessage({ flags: saveFlag([record(A), record(B)]) });
    const [buttonA] = env.buttons(env.rows(env.render(card))[0]);
    const clicked = buttonA.click();
    assert.deepEqual(calls, ["refl"]);

    env.hooks.createChatMessage(resultMessage(env, card, B, { total: 7, success: false }));
    let html = env.render(card);
    assert.equal(env.buttons(env.rows(html)[0])[0].disabled, true);
    assert.match(env.rows(html)[1].textContent, /7 · Failure/);
    await env.buttons(env.rows(html)[0])[0].click();
    assert.deepEqual(calls, ["refl"]);

    settle();
    await clicked;
    html = env.render(card);
    assert.equal(env.buttons(env.rows(html)[0])[0].disabled, false, finish);
  }
});

test("a finished roll stores the outcome on the roll message and the card redraws", async () => {
  const env = setupFoundry();
  let rolled;
  const A = env.addToken("A", {
    rollPericia: async () => (rolled = env.makeMessage({ rolls: [{ total: 12, dice: [{ faces: 20, results: [{ result: 20, active: true }] }] }] }))
  });
  const card = env.makeMessage({ flags: saveFlag([record(A)]) });
  await env.buttons(env.rows(env.render(card))[0])[0].click();
  const result = rolled.flags[MODULE].saveResult;
  assert.deepEqual([result.cardId, result.total, result.natural, result.success, result.target.uuid], [card.id, 12, 20, true, A.uuid]);
  assert.ok(env.redraws.includes(card.id));
  assert.ok(env.redraws.includes(`window:${card.id}`));
  assert.match(env.render(card).querySelector(".t20cp-save-outcome").textContent, /12 · Success Natural20/);
});

test("a card drawn before the rule is turned off does not roll", async () => {
  const env = setupFoundry();
  let calls = 0;
  const A = env.addToken("A", { rollPericia: async () => (calls++, env.makeMessage({})) });
  const card = env.makeMessage({ flags: saveFlag([record(A)]) });
  const [button] = env.buttons(env.rows(env.render(card))[0]);
  env.settings[`${MODULE}.saveButtonRule`] = "off";
  await button.click();
  assert.equal(calls, 0);
  assert.equal(card.flags[MODULE].saveResult, undefined);
});

test("off: no footer on cards that already have the flag", () => {
  const env = setupFoundry({ rule: "off" });
  const A = env.addToken("A");
  const card = env.makeMessage({ flags: saveFlag([record(A)]) });
  assert.equal(env.render(card).querySelector(".t20cp-save"), null);
});
