import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  attackFromRolls,
  buildResultContent,
  findCanonicalResult,
  installCombatManeuversRule,
  isMeleeAttackCard,
  maneuverConcealment,
  maneuverOutcome,
  maneuverSizeModifier,
  maneuverState,
  maneuverTest,
  maneuverWeapons,
  onManeuverClick,
  onPassageClick,
  onResistClick,
  resolveOpposed,
  selectVisibleResults,
  targetNameFor,
  versatileDefault
} from "../scripts/rules/combat-maneuvers.mjs";
import { installAttackVsDefenseRule } from "../scripts/rules/attack-vs-defense.mjs";
import { installConcealmentRule } from "../scripts/rules/concealment-miss-chance.mjs";
import { installSaveButtonRule } from "../scripts/rules/save-button.mjs";
import { installSituationalModifiersRule } from "../scripts/rules/situational-modifiers.mjs";
import { installNonlethalAttackRule } from "../scripts/rules/nonlethal-attack.mjs";
import { USE_PURPOSES, usePurposeOf, useTargetRecords, useTargets, withUsePurpose } from "../scripts/rules/shared/targets.mjs";

const MODULE = "t20-community-patches";
const SIZES = { min: 5, peq: 2, med: 0, gra: -2, eno: -5, col: -10 };

/* -------------------------------------------- */
/*  Pure functions                              */
/* -------------------------------------------- */

const roll = (d20, bonus, type = "attack", faces = 20) => ({
  total: d20 + bonus,
  dice: [{ faces, total: d20 }],
  terms: [{ faces, total: d20 }],
  options: type ? { type } : {}
});
const damage = { type: "dano", name: "Dano", parts: [["1d6", "corte"]] };
const meleeRolls = [{ type: "ataque", name: "Ataque", parts: [["1d20"], ["luta", "", ""]] }, damage];
const rangedRolls = [{ type: "ataque", name: "Ataque", parts: [["1d20"], ["pont", "", ""]] }, damage];

test("maneuverSizeModifier is the opposite of the Stealth modifier", () => {
  assert.equal(maneuverSizeModifier("med", SIZES), 0);
  assert.equal(maneuverSizeModifier("gra", SIZES), 2);
  assert.equal(maneuverSizeModifier("peq", SIZES), -2);
  assert.equal(maneuverSizeModifier("min", SIZES), -5);
  assert.equal(maneuverSizeModifier("col", SIZES), 10);
  assert.equal(maneuverSizeModifier("xyz", SIZES), 0);
  assert.equal(maneuverSizeModifier("gra", {}), 0);
});

test("isMeleeAttackCard: only a Luta attack", () => {
  assert.equal(isMeleeAttackCard({ rolls: meleeRolls }), true);
  assert.equal(isMeleeAttackCard({ rolls: rangedRolls }), false);
  assert.equal(isMeleeAttackCard({ rolls: [{ type: "dano", parts: [["1d6"]] }] }), false);
  assert.equal(isMeleeAttackCard(null), false);
  assert.equal(isMeleeAttackCard({ rolls: "x" }), false);
});

test("maneuverWeapons: Luta weapons, wielded first", () => {
  const loose = { type: "arma", name: "Adaga", system: { equipado: 0, rolls: meleeRolls } };
  const held = { type: "arma", name: "Chicote", system: { equipado: 1, rolls: meleeRolls } };
  const bow = { type: "arma", name: "Arco", system: { equipado: 1, rolls: rangedRolls } };
  const armor = { type: "equipamento", name: "Couro", system: { rolls: meleeRolls } };
  assert.deepEqual(maneuverWeapons([loose, bow, armor, held]).map((w) => w.name), ["Chicote", "Adaga"]);
  assert.deepEqual(maneuverWeapons([]), []);
});

test("attackFromRolls: first d20 test that is not damage", () => {
  assert.deepEqual(attackFromRolls([roll(12, 7)]), { roll: 19, d20: 12, bonus: 7 });
  const kh = { total: 18, dice: [{ faces: 20, total: 15, results: [{ result: 5 }, { result: 15 }] }], options: { type: "attack" } };
  assert.deepEqual(attackFromRolls([kh]), { roll: 18, d20: 15, bonus: 3 });
  assert.deepEqual(attackFromRolls([roll(10, 4, null)]), { roll: 14, d20: 10, bonus: 4 });
  assert.equal(attackFromRolls([roll(4, 2, "damage", 6)]), null);
  assert.equal(attackFromRolls([]), null);
  assert.deepEqual(attackFromRolls([roll(3, 1), roll(20, 1)]), { roll: 4, d20: 3, bonus: 1 });
});

test("maneuverTest adds size, Versátil and other modifiers", () => {
  assert.deepEqual(maneuverTest({ roll: 19, d20: 12 }, { sizeMod: 2, versatile: true, other: "1" }), { total: 24, bonus: 12 });
  assert.deepEqual(maneuverTest({ roll: 19, d20: 12 }, { other: "abc" }), { total: 19, bonus: 7 });
});

test("resolveOpposed: total, then bonus, then a new test", () => {
  assert.deepEqual(resolveOpposed({ total: 20, bonus: 5 }, { total: 15, bonus: 5 }), { winner: "attacker", margin: 5, tieBreak: false });
  assert.deepEqual(resolveOpposed({ total: 14, bonus: 5 }, { total: 18, bonus: 5 }), { winner: "defender", margin: 4, tieBreak: false });
  assert.equal(resolveOpposed({ total: 17, bonus: 9 }, { total: 17, bonus: 7 }).winner, "attacker");
  assert.equal(resolveOpposed({ total: 17, bonus: 6 }, { total: 17, bonus: 8 }).winner, "defender");
  assert.equal(resolveOpposed({ total: 17, bonus: 7 }, { total: 17, bonus: 7 }).winner, "reroll");
});

test("resolveOpposed: the defender's own effects count (asymmetry)", () => {
  const attacker = maneuverTest({ roll: 18, d20: 10 });
  assert.deepEqual(resolveOpposed(attacker, maneuverTest({ roll: 20, d20: 10 })), { winner: "defender", margin: 2, tieBreak: false });
  assert.equal(resolveOpposed(attacker, maneuverTest({ roll: 18, d20: 10 })).winner, "reroll");
});

test("maneuverOutcome: conditions and pushes", () => {
  const win = (margin) => ({ winner: "attacker", margin, tieBreak: false });
  assert.deepEqual([maneuverOutcome("derrubar", win(4)).condition, maneuverOutcome("derrubar", win(4)).pushMeters], ["caido", 0]);
  assert.deepEqual([maneuverOutcome("derrubar", win(5)).condition, maneuverOutcome("derrubar", win(5)).pushMeters], ["caido", 1.5]);
  assert.deepEqual([0, 4, 5, 11].map((m) => maneuverOutcome("empurrar", win(m)).pushMeters), [1.5, 1.5, 3, 4.5]);
  assert.equal(maneuverOutcome("agarrar", win(0)).condition, "agarrado");
  assert.deepEqual([maneuverOutcome("desarmar", win(5)).condition, maneuverOutcome("desarmar", win(5)).pushMeters], [null, 1.5]);
  assert.equal(maneuverOutcome("quebrar", win(9)).condition, null);
  assert.equal(maneuverOutcome("atropelar", win(1)).condition, "caido");
  for (const winner of ["defender", "reroll"]) {
    const out = maneuverOutcome("empurrar", { winner, margin: 7, tieBreak: false });
    assert.deepEqual([out.condition, out.pushMeters], [null, 0]);
  }
});

test("selectVisibleResults and findCanonicalResult", () => {
  const c = (id, of, timestamp, isContentVisible = true) => ({
    id,
    timestamp,
    isContentVisible,
    visible: true,
    flags: { [MODULE]: { maneuverResult: { of } } }
  });
  const list = [c("c1", "B", 2), c("c2", "X", 1), c("c3", "B", 1, false), c("c4", "B", 2)];
  assert.deepEqual(selectVisibleResults(list, "B").map((m) => m.id), ["c1", "c4"]);
  assert.deepEqual(selectVisibleResults([], "B"), []);
  assert.equal(findCanonicalResult([c("b", "B", 5), c("a", "B", 3)]).id, "a");
  assert.equal(findCanonicalResult([c("z", "B", 3), c("y", "B", 3)]).id, "y");
  assert.equal(findCanonicalResult([c("y", "B", 3), c("z", "B", 3)]).id, "y");
  assert.equal(findCanonicalResult([]), null);
});

test("maneuverState and versatileDefault", () => {
  assert.equal(maneuverState({ kind: "derrubar" }), "resist");
  assert.equal(maneuverState({ kind: "atropelar" }), "resist+passage");
  assert.equal(maneuverState({ kind: "derrubar", resultIds: ["c"] }), "resolved");
  assert.equal(maneuverState({ kind: "derrubar", resultIds: ["c", "d"], canonicalId: "c", selfId: "c" }), "result");
  assert.equal(maneuverState({ kind: "derrubar", resultIds: ["c", "d"], canonicalId: "c", selfId: "d" }), "superseded");
  assert.equal(versatileDefault("derrubar", { ver: true }), true);
  assert.equal(versatileDefault("desarmar", { ver: true }), true);
  assert.equal(versatileDefault("empurrar", { ver: true }), false);
  assert.equal(versatileDefault("derrubar", {}), false);
});

test("maneuverConcealment: only a failed check against the maneuver's target; maneuverState concealed", () => {
  const check = (targetUuid, total, missed) => ({ rollName: "Ataque", targetUuid, formula: "1d10", threshold: 5, chance: 50, total, missed });
  const annotated = { options: { type: "attack", [MODULE]: { concealment: { v: 1, checks: [check("lobo", 2, true), check("ogro", 8, false)] } } } };
  assert.deepEqual(maneuverConcealment(annotated, "lobo"), { formula: "1d10", total: 2, threshold: 5, chance: 50 });
  assert.equal(maneuverConcealment(annotated, "ogro"), null);
  assert.equal(maneuverConcealment(annotated, "outro"), null);
  assert.equal(maneuverConcealment(annotated, null), null);
  assert.equal(maneuverConcealment({ options: { [MODULE]: { concealment: { v: 2, checks: [check("lobo", 2, true)] } } } }, "lobo"), null);
  assert.equal(maneuverConcealment(roll(12, 7), "lobo"), null);
  assert.equal(maneuverState({ kind: "atropelar", concealed: true }), "concealed");
  assert.equal(maneuverState({ kind: "derrubar", resultIds: ["c"], canonicalId: "c", selfId: "c", concealed: true }), "result");
});

test("targetNameFor: live token first, recorded display mode when the token is gone", () => {
  const record = { name: "Lobo", displayName: 0 };
  assert.equal(targetNameFor(record, { isGM: true }), "Lobo");
  assert.equal(targetNameFor(record, { isGM: false, token: { isOwner: true, displayName: 0 } }), "Lobo");
  assert.equal(targetNameFor(record, { isGM: false, token: { isOwner: false, displayName: 30 } }), "Lobo");
  assert.equal(targetNameFor(record, { isGM: false, token: { isOwner: false, displayName: 40 } }), null);
  assert.equal(targetNameFor(record, { isGM: false, token: null }), null);
  assert.equal(targetNameFor({ name: "Lobo", displayName: 50 }, { isGM: false, token: null }), "Lobo");
});

/* -------------------------------------------- */
/*  Foundry mocks                               */
/* -------------------------------------------- */

const LANG = JSON.parse(readFileSync(new URL("../lang/pt-BR.json", import.meta.url), "utf8"));

class FakeText {
  constructor(text) {
    this.textContent = text;
  }
  matches() {
    return false;
  }
  querySelectorAll() {
    return [];
  }
}

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
    this.style = {};
    this.classList = {
      add: (...names) => (this.className = [this.className, ...names].filter(Boolean).join(" ")),
      toggle: (name, force) => {
        const names = this.className.split(/\s+/).filter((n) => n && n !== name);
        if (force) names.push(name);
        this.className = names.join(" ");
      }
    };
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
  /** "tag#id.class.class[name=x]" subsets. */
  matches(selector) {
    const match = /^([a-z0-9]*)(#[\w-]+)?((?:\.[\w-]+)*)(?:\[name="?(\w+)"?\])?$/i.exec(selector);
    if (!match) return false;
    const [, tag, id, classes, name] = match;
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    if (id && this.id !== id.slice(1)) return false;
    if (name && this.name !== name) return false;
    const own = this.className.split(/\s+/);
    return classes.split(".").filter(Boolean).every((c) => own.includes(c));
  }
  closest(selector) {
    let node = this;
    while (node && !node.matches?.(selector)) node = node.parent;
    return node ?? null;
  }
  after(node) {
    const siblings = this.parent.children;
    siblings.splice(siblings.indexOf(this) + 1, 0, node);
    node.parent = this.parent;
  }
  change(value) {
    this.value = value;
    return this.listeners.change?.({});
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
  buttons() {
    return this.querySelectorAll(".t20cp-maneuver-button");
  }
}

const decode = (text) =>
  text.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]);

/** Parses the small HTML subset the rule writes (no void elements but input/br). */
function parseInto(parent, html) {
  const stack = [parent];
  for (const [, close, tag, attrs, text] of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/g)) {
    if (text !== undefined) {
      stack.at(-1).append(new FakeText(decode(text)));
      continue;
    }
    if (close) {
      stack.pop();
      continue;
    }
    const node = new FakeElement(tag);
    node.className = /class="([^"]*)"/.exec(attrs)?.[1] ?? "";
    for (const [, key, value] of attrs.matchAll(/data-([a-z-]+)="([^"]*)"/g)) node.dataset[key] = value;
    stack.at(-1).append(node);
    if (!["input", "br"].includes(tag)) stack.push(node);
  }
  return parent;
}

class Messages extends Map {
  [Symbol.iterator]() {
    return this.values();
  }
  get contents() {
    return [...this.values()];
  }
}

function setProperty(object, path, value) {
  const keys = path.split(".");
  let target = object;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = value;
}

function expandFlags(flags = {}) {
  const out = {};
  for (const [key, value] of Object.entries(flags)) setProperty(out, key, value);
  return JSON.parse(JSON.stringify(out));
}

const event = { shiftKey: false };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup({ rule = "on", user = "mago", messageMode = "public", extra = {} } = {}) {
  const settings = { [`${MODULE}.combatManeuversRule`]: rule, "core.messageMode": messageMode, ...extra };
  const users = {
    gm: { id: "gm", name: "Mestre", isGM: true, targets: new Set() },
    mago: { id: "mago", name: "mago", isGM: false, targets: new Set() },
    clerigo: { id: "clerigo", name: "clerigo", isGM: false, targets: new Set() }
  };
  const hooks = {};
  const created = [];
  const writes = [];
  const redraws = [];
  const warnings = [];
  const dialogs = [];
  const messages = new Messages();
  const actors = new Map();
  const tokens = new Map();
  const queues = new Map();
  const seen = [];
  let nextId = 0;
  let clock = 100;

  const makeMessage = (data) => {
    const message = {
      id: data.id ?? `m${++nextId}`,
      timestamp: data.timestamp ?? (clock += 100),
      author: data.user ?? game.user.id,
      speaker: { ...(data.speaker ?? {}) },
      whisper: [...(data.whisper ?? [])],
      blind: !!data.blind,
      content: data.content ?? "",
      rolls: data.rolls ?? [],
      flags: expandFlags(data.flags),
      get isAuthor() {
        return this.author === game.user.id;
      },
      // Replica of core v14 ChatMessage#visible and #isContentVisible (chat-message.mjs:70-105).
      get visible() {
        if (this.whisper.length && !this.rolls.length) return this.whisper.includes(game.user.id) || this.isAuthor || game.user.isGM;
        return true;
      },
      get isContentVisible() {
        if (!this.visible) return false;
        if (this.whisper.length) return this.whisper.includes(game.user.id) || (this.isAuthor && !this.blind);
        return true;
      },
      get speakerActor() {
        return actors.get(`Actor.${this.speaker.actor}`) ?? null;
      },
      get alias() {
        return this.speaker.alias || this.speakerActor?.name || users[this.author]?.name;
      },
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
      render() {
        redraws.push(`render:${this.id}`);
      },
      update: () => writes.push(`update:${message.id}`),
      delete: () => writes.push(`delete:${message.id}`),
      setFlag: () => writes.push(`setFlag:${message.id}`)
    };
    return message;
  };

  const insert = (data) => {
    const message = makeMessage(data);
    messages.set(message.id, message);
    return message;
  };

  const owns = (actor, user = game.user) => user.isGM || actor.owners.includes(user.id);

  const makeActor = ({ id, name, size = "med", owners = [], luta = true }) => {
    const actor = {
      id,
      uuid: `Actor.${id}`,
      name,
      owners,
      items: [],
      system: { tracos: { tamanho: size }, pericias: luta ? { luta: { value: 5 } } : {}, attributes: { defesa: { value: 15 } } },
      testUserPermission: (user, level) => level === "OWNER" && owns(actor, user),
      rollPericia: async (skill, options) => {
        seen.push({ rollPericia: skill, options });
        const next = queues.get(`${id}.luta`)?.shift();
        return next === undefined ? roll(10, 5, "attack") : next;
      },
      update: () => writes.push(`update:${id}`),
      toggleStatusEffect: () => writes.push(`toggleStatusEffect:${id}`)
    };
    actors.set(actor.uuid, actor);
    return actor;
  };

  const makeToken = (id, actor, displayName = 0) => {
    const token = {
      id,
      uuid: `Scene.s.Token.${id}`,
      name: actor.name,
      displayName,
      actor,
      get isOwner() {
        return owns(actor);
      }
    };
    tokens.set(token.uuid, token);
    return token;
  };

  class ItemT20 {
    constructor(data) {
      Object.assign(this, data);
    }
    clone() {
      return new ItemT20({ ...this, system: JSON.parse(JSON.stringify(this.system)) });
    }
    async roll({ createMessage = true, event, rollMode } = {}) {
      void event.shiftKey; // the system reads it without "?."
      const item = this.clone();
      seen.push({ phase: "roll", purpose: usePurposeOf(item), records: useTargetRecords(item), tokens: useTargets(item) });
      if (this.onDialog) await this.onDialog(item);
      // The use dialog: its form values become the use options (T20:8575-8578).
      const options = { ...((await this.useDialog?.(item)) ?? {}) };
      const next = queues.get(this.id)?.shift();
      if (next === null) return undefined;
      item.next = next;
      options.rolls = [];
      item.system.rolled = {};
      await item.rollAttack({ options });
      if (item.system.rolls.some((r) => r.type === "dano")) await item.rollDamage({ options });
      return item.displayCard({ options, rollMode, createMessage });
    }
    async rollAttack({ options } = {}) {
      seen.push({ phase: "rollAttack", purpose: usePurposeOf(this), parts: this.system.rolls.find((r) => r.type === "ataque")?.parts.length });
      const [d20, bonus] = this.next ?? [10, 5];
      this.system.rolled.Ataque = roll(d20, bonus, "attack");
      options?.rolls?.push(this.system.rolled.Ataque);
    }
    async rollDamage() {
      seen.push({ phase: "rollDamage", purpose: usePurposeOf(this) });
      this.system.rolled.Dano = roll(4, 2, "damage", 6);
    }
    async displayCard({ createMessage = true } = {}) {
      seen.push({ phase: "displayCard", purpose: usePurposeOf(this), createMessage });
      const actor = this.actor;
      const chatData = {
        user: game.user.id,
        speaker: { scene: "s", actor: actor.id, token: `t${actor.id}`, alias: actor.name },
        content: `<div class="tormenta20 chat-card">${this.name}</div>`,
        rolls: Object.values(this.system.rolled ?? {}),
        flags: { "tormenta20.itemData": this.system }
      };
      ChatMessage.applyMode(chatData, game.settings.get("core", "messageMode"));
      return createMessage ? ChatMessage.create(chatData) : chatData;
    }
  }

  const weapon = (actor, id, name, { rolls = meleeRolls, equipado = 1, ver = false } = {}) => {
    const item = new ItemT20({ id, name, type: "arma", actor, system: { equipado, propriedades: { ver }, rolls } });
    actor.items.push(item);
    return item;
  };

  globalThis.document = { createElement: (tag) => new FakeElement(tag), createTextNode: (text) => new FakeText(text) };
  globalThis.Hooks = { on: (name, fn) => (hooks[name] ??= []).push(fn) };
  globalThis.ui = {
    notifications: { warn: (m) => warnings.push(m), error: (m) => warnings.push(`error:${m}`), info() {} },
    chat: { updateMessage: (m) => redraws.push(`chat:${m.id}`) }
  };
  globalThis.CONFIG = {
    Item: { documentClass: ItemT20 },
    ChatMessage: { documentClass: class { async renderHTML() { return null; } } },
    T20: { sizeModifiers: SIZES }
  };
  globalThis.foundry = {
    utils: { setProperty, fromUuidSync: (uuid) => tokens.get(uuid) ?? actors.get(uuid) ?? null },
    applications: {
      api: {
        DialogV2: {
          wait: async (config) => {
            const responder = dialogs.shift();
            if (!responder) throw new Error("unexpected dialog");
            return responder(config);
          }
        }
      }
    }
  };
  globalThis.ChatMessage = {
    getSpeaker: ({ actor }) => ({ scene: "s", actor: actor.id, token: `t${actor.id}`, alias: actor.name }),
    applyMode(chatData, mode) {
      const gms = Object.values(users).filter((u) => u.isGM).map((u) => u.id);
      if (mode === "public") chatData.whisper = [];
      else if (mode === "self") chatData.whisper = [game.user.id];
      else if (mode === "gm" || mode === "blind") chatData.whisper = chatData.whisper?.length ? chatData.whisper : gms;
      chatData.blind = mode === "blind";
      return chatData;
    },
    async create(data) {
      created.push(data);
      const message = insert(data);
      for (const fn of hooks.createChatMessage ?? []) fn(message, {}, game.user.id);
      return message;
    }
  };
  globalThis.game = {
    user: users[user],
    users: Object.values(users),
    messages,
    settings: { get: (scope, key) => settings[`${scope}.${key}`] },
    i18n: {
      lang: "pt-BR",
      localize: (key) => key.split(".").reduce((o, k) => o?.[k], LANG) ?? key,
      format: (key, data) => game.i18n.localize(key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ""))
    }
  };

  /** Renders a message like ChatMessage#renderHTML: header (alias or "private roll") and content. */
  const render = (message) => {
    if (!message.visible) return null;
    const html = new FakeElement("li");
    html.root = true;
    const header = new FakeElement("header");
    header.textContent = message.isContentVisible ? message.alias : `${users[message.author].name} rolou em privado`;
    const content = new FakeElement("div");
    content.className = "message-content";
    if (message.isContentVisible) parseInto(content, message.content);
    html.append(header, content);
    for (const fn of hooks.renderChatMessageHTML ?? []) fn(message, html, {});
    return html;
  };

  const as = (id) => (game.user = users[id]);

  // Characters and threats of the manual plan.
  const guerreiro = makeActor({ id: "guerreiro", name: "Guerreiro", owners: ["mago"] });
  const lobo = makeActor({ id: "lobo", name: "Lobo" });
  const ogro = makeActor({ id: "ogro", name: "Ogro", size: "gra" });
  const chicote = weapon(guerreiro, "chicote", "Chicote", { ver: true });
  const arco = weapon(guerreiro, "arco", "Arco curto", { rolls: rangedRolls });
  const mordida = weapon(lobo, "mordida", "Mordida");
  const clava = weapon(ogro, "clava", "Clava");
  const tGuerreiro = makeToken("tguerreiro", guerreiro, 50);
  const tLobo = makeToken("tlobo", lobo, 0);
  const tOgro = makeToken("togro", ogro, 0);

  return {
    users, hooks, created, writes, redraws, warnings, dialogs, messages, queues, seen, tokens, settings,
    insert, render, as, ItemT20, guerreiro, lobo, ogro, chicote, arco, mordida, clava, tGuerreiro, tLobo, tOgro
  };
}

const formOf = (values) => ({
  elements: {
    namedItem: (name) => (name in values ? { value: String(values[name]), checked: !!values[name] } : null)
  }
});
/** A dialog answer that goes through the module's own button callback. */
const choose = (values) => (config) => config.buttons[0].callback({}, { form: formOf(values) });

/** Attack (A) and maneuver card (B) from the current user. */
async function attackAndManeuver(env, { weapon, target, kind = "derrubar", versatile = false, other = 0, d20 = 12, bonus = 7 }) {
  game.user.targets = new Set([target]);
  env.queues.set(weapon.id, [[d20, bonus]]);
  const A = await weapon.roll({ event });
  env.dialogs.push(choose({ kind, versatile, other }));
  const B = await onManeuverClick(A, event);
  return { A, B };
}

/** The defender's test from the current user. */
async function resist(env, B, { weapon, d20 = 10, bonus = 5, versatile = false, other = 0 }) {
  env.queues.set(weapon.id, [[d20, bonus]]);
  env.dialogs.push(choose({ weapon: weapon.id, versatile, other }));
  return onResistClick(B, event);
}

/* -------------------------------------------- */
/*  Integration                                 */
/* -------------------------------------------- */

test("rule off: displayCard is untouched and no button is added", async () => {
  const env = setup({ rule: "off" });
  installCombatManeuversRule();
  game.user.targets = new Set([env.tLobo]);
  const chatData = await env.chicote.roll({ event, createMessage: false });
  assert.equal(chatData.flags[`${MODULE}.maneuverTargets`], undefined);
  assert.equal(chatData.flags[MODULE], undefined);
  assert.deepEqual(env.seen.find((s) => s.phase === "displayCard").createMessage, false);
  const A = await env.chicote.roll({ event });
  assert.equal(env.render(A).buttons().length, 0);
});

test("targets frozen at the start of the use; createMessage: false returns the chatData", async () => {
  const env = setup();
  installCombatManeuversRule();
  game.user.targets = new Set([env.tLobo]);
  env.chicote.onDialog = () => (game.user.targets = new Set([env.tOgro]));
  const chatData = await env.chicote.roll({ event, createMessage: false });
  assert.deepEqual(chatData.flags[MODULE].maneuverTargets, [{ uuid: env.tLobo.uuid, name: "Lobo", displayName: 0 }]);
  assert.equal(env.created.length, 0);
  game.user.targets = new Set([env.tLobo]);
  const A = await env.chicote.roll({ event });
  assert.equal(A.flags[MODULE].maneuverTargets[0].name, "Lobo");
  const html = env.render(A);
  assert.equal(html.buttons().length, 1);
  assert.equal(html.buttons()[0].textContent, "Manobra");
});

test("Manobra: only for the author or the GM, and only on melee attacks", async () => {
  const env = setup();
  installCombatManeuversRule();
  game.user.targets = new Set([env.tLobo]);
  const A = await env.chicote.roll({ event });
  const ranged = await env.arco.roll({ event });
  assert.equal(env.render(ranged).buttons().length, 0);
  env.as("clerigo");
  assert.equal(env.render(A).buttons().length, 0);
  env.as("gm");
  assert.equal(env.render(A).buttons().length, 1);
});

test("Manobra warns without a target, with several targets and against the attacker", async () => {
  const env = setup();
  installCombatManeuversRule();
  for (const targets of [[], [env.tLobo, env.tOgro], [env.tGuerreiro]]) {
    game.user.targets = new Set(targets);
    const A = await env.chicote.roll({ event });
    assert.equal(await onManeuverClick(A, event), null);
  }
  assert.deepEqual(env.warnings, [
    LANG.T20CP.CombatManeuvers.Warn.NoTarget,
    LANG.T20CP.CombatManeuvers.Warn.ManyTargets,
    LANG.T20CP.CombatManeuvers.Warn.SelfTarget
  ]);
  assert.equal(env.dialogs.length, 0);
});

test("maneuver card: test with size and Versátil, no target name in the content", async () => {
  const env = setup();
  installCombatManeuversRule();
  const { B } = await attackAndManeuver(env, { weapon: env.chicote, target: env.tLobo, versatile: true, other: 1 });
  const data = B.flags[MODULE].maneuver;
  assert.equal(data.kind, "derrubar");
  assert.equal(data.target.uuid, env.tLobo.uuid);
  assert.deepEqual([data.attack.roll, data.attack.total, data.attack.bonus], [19, 22, 10]);
  assert.equal(B.content.includes("Lobo"), false);
  assert.match(env.render(B).textContent, /Alvo/);
  assert.doesNotMatch(env.render(B).textContent, /Lobo/);
  // Not the target's owner: no Resistir.
  assert.equal(env.render(B).buttons().length, 0);
  env.as("gm");
  const gmView = env.render(B);
  assert.match(gmView.textContent, /Lobo/);
  assert.deepEqual(gmView.buttons().map((b) => b.textContent), ["Resistir"]);
});

test("resist with a weapon: maneuver-resistance purpose, no targets, attack roll only, no writes", async () => {
  const env = setup();
  installCombatManeuversRule();
  const { B } = await attackAndManeuver(env, { weapon: env.chicote, target: env.tLobo, d20: 12, bonus: 7 });
  env.as("gm");
  game.user.targets = new Set([env.tOgro]);
  env.seen.length = 0;
  const C = await resist(env, B, { weapon: env.mordida, d20: 8, bonus: 6 });
  const call = env.seen.find((s) => s.phase === "roll");
  assert.equal(call.purpose, USE_PURPOSES.MANEUVER_RESISTANCE);
  assert.deepEqual([call.records.length, call.tokens.length], [0, 0]);
  assert.equal(env.seen.find((s) => s.phase === "rollAttack").purpose, USE_PURPOSES.MANEUVER_RESISTANCE);
  assert.deepEqual(env.seen.find((s) => s.phase === "displayCard"), { phase: "displayCard", purpose: USE_PURPOSES.MANEUVER_RESISTANCE, createMessage: false });
  // Only B and C were created: the defender's card is not posted.
  assert.equal(env.created.length, 3);
  assert.equal(C.rolls.length, 1);
  assert.equal(C.rolls[0].options.type, "attack");
  const result = C.flags[MODULE].maneuverResult;
  assert.deepEqual([result.attack.total, result.defender.total], [19, 14]);
  assert.deepEqual([result.outcome.winner, result.outcome.margin, result.outcome.condition, result.outcome.pushMeters], ["attacker", 5, "caido", 1.5]);
  assert.equal(C.content.includes("Lobo"), false);
  // Nested rolls started later have no purpose.
  env.seen.length = 0;
  await env.mordida.roll({ event, createMessage: false });
  assert.equal(env.seen.find((s) => s.phase === "roll").purpose, null);
  assert.deepEqual(env.writes, []);
});

test("resist with Luta: rollPericia without a message", async () => {
  const env = setup();
  installCombatManeuversRule();
  const { B } = await attackAndManeuver(env, { weapon: env.chicote, target: env.tOgro, kind: "agarrar" });
  env.as("gm");
  env.queues.set("ogro.luta", [roll(15, 3, "attack")]);
  env.dialogs.push(choose({ weapon: "luta", other: 0 }));
  const C = await onResistClick(B, event);
  assert.deepEqual(env.seen.at(-1), { rollPericia: "luta", options: { message: false, event } });
  const { defender } = C.flags[MODULE].maneuverResult;
  assert.deepEqual([defender.roll, defender.sizeMod, defender.total, defender.weaponId], [18, 2, 20, null]);
});

test("a cancelled roll creates nothing and releases the lock", async () => {
  const env = setup();
  installCombatManeuversRule();
  const { B } = await attackAndManeuver(env, { weapon: env.chicote, target: env.tLobo });
  env.as("gm");
  env.queues.set("mordida", [null]);
  env.dialogs.push(choose({ weapon: "mordida" }));
  assert.equal(await onResistClick(B, event), null);
  assert.equal(env.created.length, 2);
  env.lobo.rollPericia = async () => undefined;
  env.dialogs.push(choose({ weapon: "luta" }));
  assert.equal(await onResistClick(B, event), null);
  assert.equal(env.created.length, 2);
  assert.ok(await resist(env, B, { weapon: env.mordida }));
  assert.equal(env.created.length, 3);
});

test("Resistir and Dar passagem share the lock: one result", async () => {
  const env = setup();
  installCombatManeuversRule();
  const { B } = await attackAndManeuver(env, { weapon: env.chicote, target: env.tLobo, kind: "atropelar" });
  env.as("gm");
  assert.deepEqual(env.render(B).buttons().map((b) => b.textContent), ["Resistir", "Dar passagem"]);
  let answer;
  env.dialogs.push((config) => new Promise((resolve) => (answer = () => resolve(choose({ weapon: "mordida" })(config)))));
  env.queues.set("mordida", [[10, 5]]);
  const pending = onResistClick(B, event);
  await tick();
  assert.equal(await onPassageClick(B), null);
  answer();
  await pending;
  assert.equal(await onPassageClick(B), null);
  const results = [...env.messages.values()].filter((m) => m.flags[MODULE]?.maneuverResult);
  assert.equal(results.length, 1);
  assert.match(env.render(B).textContent, /Resolvida/);
});

test("Dar passagem: result without a test or condition", async () => {
  const env = setup();
  installCombatManeuversRule();
  const { B } = await attackAndManeuver(env, { weapon: env.chicote, target: env.tLobo, kind: "atropelar" });
  env.as("gm");
  const C = await onPassageClick(B);
  const result = C.flags[MODULE].maneuverResult;
  assert.deepEqual([result.passage, result.defender, result.outcome.condition], [true, null, null]);
  assert.match(env.render(C).textContent, /Lobo dá passagem/);
});

test("a result before the dialog warns; one arriving during the roll creates nothing", async () => {
  const env = setup();
  installCombatManeuversRule();
  const { B } = await attackAndManeuver(env, { weapon: env.chicote, target: env.tLobo });
  env.as("gm");
  const C = await resist(env, B, { weapon: env.mordida });
  env.seen.length = 0;
  assert.equal(await onResistClick(B, event), null);
  assert.equal(env.warnings.at(-1), LANG.T20CP.CombatManeuvers.Warn.Resolved);
  assert.equal(env.seen.length, 0);

  const second = await attackAndManeuver(env, { weapon: env.mordida, target: env.tGuerreiro });
  env.as("mago");
  env.chicote.onDialog = () => env.insert({ user: "gm", flags: { [MODULE]: { maneuverResult: { ...C.flags[MODULE].maneuverResult, of: second.B.id } } } });
  const count = env.created.length;
  assert.equal(await resist(env, second.B, { weapon: env.chicote }), null);
  assert.equal(env.created.length, count);
  assert.equal(env.warnings.at(-1), LANG.T20CP.CombatManeuvers.Warn.Resolved);
});

test("two results: the oldest is canonical, a late older one takes over, without writes", async () => {
  const env = setup();
  installCombatManeuversRule();
  const { B } = await attackAndManeuver(env, { weapon: env.chicote, target: env.tLobo });
  env.as("gm");
  const C1 = await resist(env, B, { weapon: env.mordida });
  const C2 = await ChatMessage.create({ user: "gm", content: C1.content, rolls: C1.rolls, flags: C1.flags, timestamp: C1.timestamp + 50 });
  assert.ok(env.redraws.includes(`chat:${B.id}`) && env.redraws.includes(`chat:${C1.id}`));
  for (const viewer of ["gm", "mago"]) {
    env.as(viewer);
    assert.match(env.render(B).textContent, /Resolvida/);
    assert.doesNotMatch(env.render(C1).textContent, /substituído/);
    assert.match(env.render(C2).textContent, /Resultado substituído/);
  }
  const C0 = await ChatMessage.create({ user: "gm", content: C1.content, rolls: C1.rolls, flags: C1.flags, timestamp: C1.timestamp - 50 });
  assert.doesNotMatch(env.render(C0).textContent, /substituído/);
  assert.match(env.render(C1).textContent, /Resultado substituído/);
  assert.deepEqual(env.writes, []);
});

test("visibility: whispered B is inherited; otherwise the resister's real message mode", async () => {
  const cases = {
    public: { whisper: [], blind: false },
    gm: { whisper: ["gm"], blind: false },
    blind: { whisper: ["gm"], blind: true },
    self: { whisper: ["gm"], blind: false }
  };
  for (const [mode, expected] of Object.entries(cases)) {
    const env = setup();
    installCombatManeuversRule();
    const { B } = await attackAndManeuver(env, { weapon: env.chicote, target: env.tLobo });
    env.as("gm");
    env.settings["core.messageMode"] = mode;
    await resist(env, B, { weapon: env.mordida });
    const chatData = env.created.at(-1);
    assert.deepEqual([chatData.whisper ?? [], !!chatData.blind], [expected.whisper, expected.blind], mode);
  }
  const env = setup({ messageMode: "blind" });
  installCombatManeuversRule();
  const { A, B } = await attackAndManeuver(env, { weapon: env.chicote, target: env.tLobo });
  assert.deepEqual([A.whisper, A.blind, B.whisper, B.blind], [["gm"], true, ["gm"], true]);
  env.as("gm");
  env.settings["core.messageMode"] = "public";
  await resist(env, B, { weapon: env.mordida });
  assert.deepEqual([env.created.at(-1).whisper, env.created.at(-1).blind], [["gm"], true]);
});

test("different readers: each user reads only their own result as canonical", async () => {
  const env = setup({ user: "gm" });
  installCombatManeuversRule();
  const { B } = await attackAndManeuver(env, { weapon: env.mordida, target: env.tGuerreiro });
  env.settings["core.messageMode"] = "gm";
  const C1 = await resist(env, B, { weapon: env.chicote });
  assert.deepEqual(C1.whisper, ["gm"]);

  env.as("mago");
  assert.deepEqual(selectVisibleResults(env.messages, B.id), []);
  assert.deepEqual(env.render(B).buttons().map((b) => b.textContent), ["Resistir"]);
  // The hidden result gets nothing from the hook.
  const hidden = env.render(C1);
  assert.match(hidden.textContent, /rolou em privado/);
  assert.equal(hidden.querySelectorAll(".t20cp-maneuver-state").length, 0);
  assert.doesNotMatch(hidden.textContent, /Lobo|Guerreiro/);

  env.settings["core.messageMode"] = "self";
  const C2 = await resist(env, B, { weapon: env.chicote });
  assert.deepEqual(C2.whisper, ["mago"]);
  assert.deepEqual(selectVisibleResults(env.messages, B.id).map((m) => m.id), [C2.id]);
  assert.doesNotMatch(env.render(C2).textContent, /substituído/);
  assert.match(env.render(B).textContent, /Resolvida/);

  env.as("gm");
  assert.deepEqual(selectVisibleResults(env.messages, B.id).map((m) => m.id), [C1.id]);
  assert.doesNotMatch(env.render(C1).textContent, /substituído/);
  assert.match(env.render(C2).textContent, /rolou em privado/);
  assert.deepEqual(env.writes, []);
});

test("result speaker is neutral and the full render never leaks the target's name", async () => {
  const env = setup();
  installCombatManeuversRule();
  const { B } = await attackAndManeuver(env, { weapon: env.chicote, target: env.tLobo });
  env.as("gm");
  const C = await resist(env, B, { weapon: env.mordida });
  assert.deepEqual(C.speaker, { scene: null, actor: null, token: null, alias: "Manobra de combate" });
  assert.equal(C.alias, "Manobra de combate");
  env.as("mago");
  const html = env.render(C);
  assert.match(html.textContent, /^Manobra de combate/);
  assert.doesNotMatch(html.textContent, /Lobo/);
  assert.match(html.textContent, /Alvo fica Caído/);
});

test("names: GM, owner and public display modes see it; others see Alvo; deleted token uses the record", async () => {
  const env = setup();
  installCombatManeuversRule();
  const { B } = await attackAndManeuver(env, { weapon: env.chicote, target: env.tLobo });
  env.as("gm");
  const C = await resist(env, B, { weapon: env.mordida });
  env.as("mago");
  const sees = (message) => /Lobo/.test(env.render(message).textContent);
  for (const [displayName, visible] of [[0, false], [40, false], [30, true], [50, true]]) {
    env.tLobo.displayName = displayName;
    assert.deepEqual([sees(B), sees(C)], [visible, visible], `displayName ${displayName}`);
  }
  env.tLobo.displayName = 0;
  env.lobo.owners.push("mago");
  assert.deepEqual([sees(B), sees(C)], [true, true]);
  env.lobo.owners.pop();
  env.tokens.delete(env.tLobo.uuid);
  assert.deepEqual([sees(B), sees(C)], [false, false]);
});

test("result content: markers only, tie-break and reroll texts", () => {
  setup();
  const base = {
    kind: "empurrar",
    passage: false,
    attacker: { name: "Guerreiro" },
    target: { uuid: "x", name: "Lobo", displayName: 0 },
    attack: { roll: 18, total: 18, sizeMod: 0, versatile: false, other: 0 },
    defender: { roll: 18, total: 18, sizeMod: 0, versatile: false, other: 0, weaponId: "m", weaponName: "Mordida" }
  };
  const reroll = buildResultContent({ ...base, outcome: maneuverOutcome("empurrar", { winner: "reroll", margin: 0, tieBreak: true }) });
  assert.match(reroll, /façam outro teste/);
  const tie = buildResultContent({ ...base, outcome: maneuverOutcome("empurrar", { winner: "attacker", margin: 0, tieBreak: true }) });
  assert.match(tie, /Empate nos totais: vence Guerreiro/);
  assert.match(tie, /empurrado 1,5m/);
  assert.equal(tie.includes("Lobo"), false);
});

test("install orders: the resistance skips #42 and the stubs of #49 and #59 in both orders", async () => {
  for (const order of ["maneuvers-first", "maneuvers-last"]) {
    const env = setup({ extra: { [`${MODULE}.attackVsDefenseRule`]: "on" } });
    const stubLog = [];
    const proto = env.ItemT20.prototype;
    const installStubs = () => {
      // #49 (concealment) and #59 (charge): contract stubs that skip a maneuver resistance.
      const rollAttack = proto.rollAttack;
      proto.rollAttack = async function (...args) {
        if (usePurposeOf(this) !== USE_PURPOSES.MANEUVER_RESISTANCE && useTargetRecords(this).length) stubLog.push("concealment");
        return rollAttack.apply(this, args);
      };
      const displayCard = proto.displayCard;
      proto.displayCard = async function (...args) {
        if (usePurposeOf(this) !== USE_PURPOSES.MANEUVER_RESISTANCE) stubLog.push("charge");
        return displayCard.apply(this, args);
      };
    };
    if (order === "maneuvers-first") {
      installCombatManeuversRule();
      installAttackVsDefenseRule();
      installStubs();
    } else {
      installStubs();
      installAttackVsDefenseRule();
      installCombatManeuversRule();
    }
    const { A, B } = await attackAndManeuver(env, { weapon: env.chicote, target: env.tLobo });
    assert.ok(A.rolls[0].options[MODULE]?.attackVsDefense, `${order}: #42 compares the attack`);
    assert.deepEqual(stubLog, ["concealment", "charge"], order);
    assert.equal(A.flags[MODULE].maneuverTargets[0].name, "Lobo", order);
    env.as("gm");
    game.user.targets = new Set([env.tOgro]);
    stubLog.length = 0;
    const C = await resist(env, B, { weapon: env.mordida });
    assert.equal(C.rolls[0].options[MODULE]?.attackVsDefense, undefined, order);
    assert.deepEqual(stubLog, [], order);
  }
});

/* -------------------------------------------- */
/*  Maneuver declared in the use dialog         */
/* -------------------------------------------- */

/** The system's use dialog: a form with "Melhor/Pior de 2d20" (and the nonlethal radios), then the render hooks. */
function openUseDialog(env, item) {
  const root = new FakeElement("div");
  const form = new FakeElement("form");
  form.id = "ability-use-form";
  const keep = new FakeElement("div");
  keep.className = "form-group";
  const select = new FakeElement("select");
  select.name = "rollKeep";
  keep.append(select);
  const nonlethal = new FakeElement("input");
  nonlethal.name = "t20cpNonlethal";
  form.append(keep, nonlethal);
  root.append(form);
  const app = { item, setPosition: () => (app.positioned = true) };
  for (const fn of env.hooks.renderAbilityUseDialog ?? []) fn(app, [root]);
  return { app, form, keep, nonlethal, field: form.querySelector(".t20cp-maneuver-use") };
}

/** A use whose dialog declares `values` (the FormDataExtended object reaches the use options). */
function declare(env, weapon, values, { d20 = 12, bonus = 7 } = {}) {
  env.queues.set(weapon.id, [[d20, bonus]]);
  weapon.useDialog = (item) => {
    env.lastDialog = openUseDialog(env, item);
    return values;
  };
}

test("use dialog: Manobra and Arma versátil on eligible melee attacks only", async () => {
  const env = setup();
  installCombatManeuversRule();
  game.user.targets = new Set([env.tLobo]);
  declare(env, env.chicote, {});
  await env.chicote.roll({ event });
  const { form, keep, field, nonlethal, app } = env.lastDialog;
  assert.ok(field);
  assert.equal(form.children.indexOf(field), form.children.indexOf(keep) + 1);
  const kind = field.querySelector('[name="t20cpManeuver"]');
  const versatile = field.querySelector('[name="t20cpManeuverVersatile"]');
  assert.deepEqual(kind.children.map((o) => o.value), ["", "agarrar", "derrubar", "desarmar", "empurrar", "quebrar", "atropelar"]);
  assert.deepEqual([kind.value, kind.disabled, versatile.checked, app.positioned], ["", false, false, true]);
  kind.change("derrubar");
  assert.deepEqual([versatile.checked, nonlethal.disabled], [true, true]);
  kind.change("empurrar");
  assert.equal(versatile.checked, false);
  kind.change("");
  assert.equal(nonlethal.disabled, false);
  // Idempotent: another render of the same dialog adds nothing.
  for (const fn of env.hooks.renderAbilityUseDialog) fn(app, [form.parent]);
  assert.equal(form.querySelectorAll(".t20cp-maneuver-use").length, 1);

  // A weapon that is not versatile has no checkbox; a ranged attack has no field.
  game.user.targets = new Set([env.tGuerreiro]);
  declare(env, env.mordida, {});
  await env.mordida.roll({ event });
  assert.ok(env.lastDialog.field);
  assert.equal(env.lastDialog.field.querySelector('[name="t20cpManeuverVersatile"]'), null);
  declare(env, env.arco, {});
  await env.arco.roll({ event });
  assert.equal(env.lastDialog.field, null);
});

test("use dialog: no field with the rule off nor in the resistance test", async () => {
  const off = setup({ rule: "off" });
  installCombatManeuversRule();
  game.user.targets = new Set([off.tLobo]);
  declare(off, off.chicote, {});
  await off.chicote.roll({ event });
  assert.equal(off.lastDialog.field, null);

  const env = setup();
  installCombatManeuversRule();
  declare(env, env.mordida, {});
  env.as("gm");
  await withUsePurpose(USE_PURPOSES.MANEUVER_RESISTANCE, () => env.mordida.roll({ event, createMessage: false }));
  assert.equal(env.lastDialog.field, null);
});

test("use dialog: without exactly one valid target the field is disabled with the reason", async () => {
  const env = setup();
  installCombatManeuversRule();
  const W = LANG.T20CP.CombatManeuvers.Warn;
  for (const [targets, reason] of [[[], W.NoTarget], [[env.tLobo, env.tOgro], W.ManyTargets], [[env.tGuerreiro], W.SelfTarget]]) {
    game.user.targets = new Set(targets);
    declare(env, env.chicote, {});
    await env.chicote.roll({ event });
    const { field } = env.lastDialog;
    assert.equal(field.querySelector('[name="t20cpManeuver"]').disabled, true);
    assert.equal(field.querySelector('[name="t20cpManeuverVersatile"]').disabled, true);
    assert.equal(field.querySelector(".t20cp-maneuver-use-hint").textContent, reason);
  }
});

test("declared maneuver: one maneuver card with the attack roll, no attack card, no damage roll", async () => {
  const env = setup();
  installCombatManeuversRule();
  game.user.targets = new Set([env.tLobo]);
  declare(env, env.chicote, { t20cpManeuver: "derrubar", t20cpManeuverVersatile: true }, { d20: 12, bonus: 7 });
  const B = await env.chicote.roll({ event });
  assert.equal(env.created.length, 1);
  assert.equal(env.seen.some((s) => s.phase === "rollDamage"), false);
  assert.equal(B.flags.tormenta20, undefined);
  assert.deepEqual(B.rolls.map((r) => [r.options.type, r.total]), [["attack", 19]]);
  const data = B.flags[MODULE].maneuver;
  assert.deepEqual([data.kind, data.source, data.target.uuid, data.attacker.name], ["derrubar", null, env.tLobo.uuid, "Guerreiro"]);
  assert.deepEqual([data.attack.roll, data.attack.versatile, data.attack.total, data.attack.bonus], [19, true, 21, 9]);
  assert.deepEqual(B.speaker, { scene: "s", actor: "guerreiro", token: "tguerreiro", alias: "Guerreiro" });
  assert.equal(B.content.includes("Lobo"), false);
  env.as("gm");
  assert.deepEqual(env.render(B).buttons().map((b) => b.textContent), ["Resistir"]);
  const C = await resist(env, B, { weapon: env.mordida, d20: 8, bonus: 6 });
  assert.deepEqual([C.flags[MODULE].maneuverResult.of, C.flags[MODULE].maneuverResult.outcome.winner], [B.id, "attacker"]);

  // The same use without a maneuver keeps the system's card and damage.
  env.as("mago");
  env.seen.length = 0;
  declare(env, env.chicote, { t20cpManeuver: "" });
  const A = await env.chicote.roll({ event });
  assert.ok(A.flags.tormenta20.itemData);
  assert.equal(env.seen.some((s) => s.phase === "rollDamage"), true);
});

test("declared maneuver: roll mode and createMessage: false like the system's card", async () => {
  const env = setup({ messageMode: "blind" });
  installCombatManeuversRule();
  game.user.targets = new Set([env.tGuerreiro]);
  declare(env, env.mordida, { t20cpManeuver: "agarrar", t20cpManeuverVersatile: true });
  const B = await env.mordida.roll({ event });
  assert.deepEqual([B.whisper, B.blind, B.flags[MODULE].maneuver.attack.versatile], [["gm"], true, false]);
  game.user.targets = new Set([env.tLobo]);
  declare(env, env.chicote, { t20cpManeuver: "empurrar" });
  const count = env.created.length;
  const chatData = await env.chicote.roll({ event, createMessage: false, rollMode: "public" });
  assert.equal(env.created.length, count);
  assert.deepEqual([chatData.flags[MODULE].maneuver.kind, chatData.whisper, chatData.rolls.length], ["empurrar", [], 1]);
});

test("declared maneuver against an invalid target: warning, then the normal attack with damage", async () => {
  const env = setup();
  installCombatManeuversRule();
  const W = LANG.T20CP.CombatManeuvers.Warn;
  for (const [targets, reason] of [[[], W.NoTarget], [[env.tLobo, env.tOgro], W.ManyTargets], [[env.tGuerreiro], W.SelfTarget]]) {
    game.user.targets = new Set(targets);
    env.seen.length = 0;
    declare(env, env.chicote, { t20cpManeuver: "derrubar" });
    const A = await env.chicote.roll({ event });
    assert.equal(env.warnings.at(-1), W.Fallback.replace("{reason}", reason));
    assert.ok(A.flags.tormenta20.itemData);
    assert.equal(A.flags[MODULE].maneuver, undefined);
    assert.equal(env.seen.some((s) => s.phase === "rollDamage"), true);
  }
});

test("chat button setting off: no Manobra on attack cards, the dialog still declares", async () => {
  const env = setup({ extra: { [`${MODULE}.combatManeuversChatButton`]: "off" } });
  installCombatManeuversRule();
  game.user.targets = new Set([env.tLobo]);
  const A = await env.chicote.roll({ event });
  assert.equal(env.render(A).buttons().length, 0);
  env.settings[`${MODULE}.combatManeuversChatButton`] = "on";
  assert.equal(env.render(A).buttons().length, 1);
  env.settings[`${MODULE}.combatManeuversChatButton`] = "off";
  declare(env, env.chicote, { t20cpManeuver: "desarmar" });
  const B = await env.chicote.roll({ event });
  assert.equal(B.flags[MODULE].maneuver.kind, "desarmar");
});

test("maneuver and result cards: details collapsed, the title toggles them on this client", async () => {
  const env = setup();
  installCombatManeuversRule();
  game.user.targets = new Set([env.tLobo]);
  declare(env, env.chicote, { t20cpManeuver: "derrubar" });
  const B = await env.chicote.roll({ event });
  env.as("gm");
  const C = await resist(env, B, { weapon: env.mordida, d20: 8, bonus: 6 });
  for (const message of [B, C]) {
    const html = env.render(message);
    const details = html.querySelector(".t20cp-maneuver-details");
    const title = html.querySelector(".t20cp-maneuver-title");
    assert.equal(details.style.display, "none");
    assert.match(html.querySelector(".t20cp-maneuver-summary").textContent, message === B ? /Teste de manobra: 19/ : /Guerreiro 19 × Lobo 14/);
    assert.match(details.textContent, /ataque 19/);
    title.click();
    assert.equal(details.style.display, "");
    // Kept on a re-render of this client only, without writes.
    assert.equal(env.render(message).querySelector(".t20cp-maneuver-details").style.display, "");
    title.click();
    assert.equal(details.style.display, "none");
  }
  assert.match(env.render(C).querySelector(".t20cp-maneuver-outcome").textContent, /Lobo fica Caído/);
  assert.deepEqual(env.writes, []);
});

test("declared maneuver with Investida: the inner rules still run (attack bonus and the -2 Defense effect)", async () => {
  const env = setup({ extra: { [`${MODULE}.situationalModifiersRule`]: "on" } });
  const effects = [];
  Object.assign(env.guerreiro, { isOwner: true, effects, createEmbeddedDocuments: async (_, data) => effects.push(...data) });
  // Same order as scripts/main.mjs.
  installSaveButtonRule();
  installAttackVsDefenseRule();
  installSituationalModifiersRule();
  installCombatManeuversRule();
  installNonlethalAttackRule();
  game.user.targets = new Set([env.tLobo]);
  env.queues.set(env.chicote.id, [[12, 7]]);
  env.chicote.useDialog = () => ({ t20cpManeuver: "derrubar", t20cpSituationalAttack: ["charge"] });
  const B = await env.chicote.roll({ event });
  assert.equal(env.created.length, 1);
  assert.ok(B.flags[MODULE].maneuver);
  assert.equal(env.seen.some((s) => s.phase === "rollDamage"), false);
  assert.equal(env.seen.find((s) => s.phase === "rollAttack").parts, 3);
  assert.deepEqual(B.rolls[0].options[MODULE].situational.attack, ["charge"]);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].flags[MODULE].situational, "charge");
});

test("maneuver cards never carry or serialize the source rolls (button: none; dialog: a copy of the attack)", async () => {
  const env = setup();
  installCombatManeuversRule();
  class Roll {
    constructor(data) {
      Object.assign(this, data);
    }
    toJSON() {
      return { class: "Roll", ...this };
    }
  }
  const create = ChatMessage.create;
  // Like core: the rolls of the data are serialized in place.
  ChatMessage.create = (data) => {
    data.rolls?.forEach((r, i, list) => (list[i] = typeof r === "string" ? r : JSON.stringify(r)));
    return create.call(ChatMessage, data);
  };
  const live = [];
  const rollAttack = env.ItemT20.prototype.rollAttack;
  env.ItemT20.prototype.rollAttack = async function (...args) {
    await rollAttack.apply(this, args);
    this.system.rolled.Ataque = new Roll(this.system.rolled.Ataque);
    live.push(this.system.rolled);
  };

  game.user.targets = new Set([env.tLobo]);
  env.queues.set(env.chicote.id, [[12, 7]]);
  const A = await env.chicote.roll({ event });
  // Like ChatMessage#rolls: Roll instances rebuilt from the stored JSON.
  A.rolls = A.rolls.map((r) => new Roll(JSON.parse(r)));
  const before = [...A.rolls];
  env.dialogs.push(choose({ kind: "derrubar", versatile: false, other: 0 }));
  const B = await onManeuverClick(A, event);
  assert.ok(B.flags[MODULE].maneuver);
  assert.deepEqual(B.rolls, []);
  assert.equal(A.rolls.length, 2);
  assert.ok(A.rolls.every((r, i) => r === before[i] && r instanceof Roll));

  declare(env, env.chicote, { t20cpManeuver: "derrubar" });
  const D = await env.chicote.roll({ event });
  assert.equal(D.rolls.length, 1);
  assert.equal(JSON.parse(D.rolls[0]).options.type, "attack");
  assert.ok(live.at(-1).Ataque instanceof Roll);
});

/** Concealment (#49) installed like main.mjs (before this rule), with the d10 results queued. */
function withConcealment(env, d10s) {
  env.settings[`${MODULE}.concealmentMissChance`] = "on";
  env.guerreiro.statuses = new Set(["cego"]);
  const rolled = [];
  globalThis.foundry.dice = {
    Roll: class {
      constructor(formula) {
        this.formula = formula;
      }
      async evaluate() {
        rolled.push(this.formula);
        this.total = d10s.shift();
        return this;
      }
    }
  };
  installConcealmentRule();
  installCombatManeuversRule();
  return rolled;
}

test("concealment: a failed d10 makes the declared maneuver fail with no resistance test", async () => {
  const env = setup();
  const rolled = withConcealment(env, [2, 7]);
  game.user.targets = new Set([env.tLobo]);
  declare(env, env.chicote, { t20cpManeuver: "derrubar" });
  const B = await env.chicote.roll({ event });
  assert.deepEqual(rolled, ["1d10"]);
  assert.deepEqual(B.flags[MODULE].maneuver.concealment, { formula: "1d10", total: 2, threshold: 5, chance: 50, inCard: true });
  // The card carries the annotated roll: #49's block shows the d10, the maneuver line does not repeat it.
  assert.equal(B.rolls[0].options[MODULE].concealment.checks[0].total, 2);
  assert.ok(B.content.includes("Falhou por camuflagem. Não há teste de resistência."));
  assert.equal(B.content.includes("1d10"), false);
  assert.equal(B.content.includes("Lobo"), false);
  env.as("gm");
  assert.deepEqual(env.render(B).buttons(), []);
  env.dialogs.push(choose({ weapon: env.mordida.id }));
  assert.equal(await onResistClick(B, event), null);
  assert.deepEqual(env.warnings.at(-1), LANG.T20CP.CombatManeuvers.Warn.Concealed);
  assert.equal(env.dialogs.length, 1);
  assert.equal(env.created.length, 1);

  // "Passou pela camuflagem": the normal maneuver.
  env.as("mago");
  declare(env, env.chicote, { t20cpManeuver: "atropelar" });
  const B2 = await env.chicote.roll({ event });
  assert.equal(B2.flags[MODULE].maneuver.concealment, null);
  assert.equal(B2.content.includes("camuflagem"), false);
  env.as("gm");
  assert.deepEqual(env.render(B2).buttons().map((b) => b.textContent), ["Resistir", "Dar passagem"]);
});

test("concealment: the chat button reads the check of the attack card; rule off changes nothing", async () => {
  const env = setup();
  withConcealment(env, [4, 1]);
  const missed = await attackAndManeuver(env, { weapon: env.chicote, target: env.tLobo });
  assert.equal(missed.B.flags[MODULE].maneuver.concealment.total, 4);
  // No roll on the button's card: the maneuver line is the only place with the d10.
  assert.deepEqual(missed.B.rolls, []);
  assert.ok(missed.B.content.includes("Falhou por camuflagem (50%): 1d10 = 4, falha em 1 a 5."));
  env.as("gm");
  assert.deepEqual(env.render(missed.B).buttons(), []);
  env.as("mago");

  // The d10 of A failed (1), but the concealment rule is now off: the maneuver goes on as usual.
  const { A } = await attackAndManeuver(env, { weapon: env.chicote, target: env.tLobo });
  env.settings[`${MODULE}.concealmentMissChance`] = "off";
  env.dialogs.push(choose({ kind: "derrubar", versatile: false, other: 0 }));
  const B = await onManeuverClick(A, event);
  assert.equal(B.flags[MODULE].maneuver.concealment, null);
  env.as("gm");
  assert.deepEqual(env.render(B).buttons().map((b) => b.textContent), ["Resistir"]);
});
