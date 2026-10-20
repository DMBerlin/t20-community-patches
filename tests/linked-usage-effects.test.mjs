import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  OwnChangeList,
  findLinkedCandidates,
  linkedValues,
  plainText
} from "../scripts/patches/linked-usage-effects.mjs";
import { PATCHES } from "../scripts/patches/index.mjs";
import appendedUsageChanges from "../scripts/patches/appended-usage-changes.mjs";

test("plainText strips tags, decodes common entities and collapses whitespace", () => {
  assert.equal(plainText("<p>Inspiração&nbsp;(Arte  Mágica)</p>\n"), "Inspiração (Arte Mágica)");
  assert.equal(plainText("<p>A &amp; B</p>"), "A & B");
  assert.equal(plainText(undefined), "");
});

test("findLinkedCandidates matches by name or plain description and skips the usage effect", () => {
  const effects = [
    { id: "use", name: "Arte Mágica", description: "" },
    { id: "byDesc", name: "Arte Mágica", description: "<p>Inspiração (Arte Mágica)</p>" },
    { id: "byName", name: "Inspiração (Arte Mágica)" },
    { id: "other", name: "Outro", description: "<p>Outro</p>" }
  ];
  const ids = (list) => list.map((e) => e.id);
  assert.deepEqual(ids(findLinkedCandidates(effects, " Inspiração (Arte Mágica) ", "use")), ["byDesc", "byName"]);
  assert.deepEqual(ids(findLinkedCandidates(effects, "Arte Mágica", "use")), ["byDesc"]);
  assert.deepEqual(findLinkedCandidates(effects, "", "use"), []);
  assert.deepEqual(findLinkedCandidates(undefined, "x"), []);
});

test("linkedValues keeps only trimmed, non-empty efeito values", () => {
  const changes = [
    { key: "efeito", value: " Inspiração (Arte Mágica) " },
    { key: "efeito", value: null },
    { key: "efeito", value: "  " },
    { key: "condicao", value: "Abalado" },
    { key: "cd", value: 2 }
  ];
  assert.deepEqual(linkedValues(changes), ["Inspiração (Arte Mágica)"]);
  assert.deepEqual(linkedValues(undefined), []);
});

test("OwnChangeList drops efeito/condicao on push and derives plain arrays", () => {
  const list = OwnChangeList.from([{ key: "a" }]);
  assert.equal(list.push({ key: "efeito" }, { key: "b" }, { key: "condicao" }), 2);
  assert.deepEqual(list.map((c) => c.key), ["a", "b"]);
  assert.equal(Object.getPrototypeOf(list.map((c) => c)), Array.prototype);
  assert.equal(Object.getPrototypeOf(list.filter(Boolean)), Array.prototype);
  assert.equal(list.sort(() => 0), list);
});

test("runs after suppressed-usage-effects and appended-usage-changes", () => {
  const index = (id) => PATCHES.findIndex((p) => p.id === id);
  assert.ok(index("linked-usage-effects") > index("suppressed-usage-effects"));
  assert.ok(index("linked-usage-effects") > index("appended-usage-changes"));
});

/* Integration: fake documents and a reduced copy of the system's applyOnUseEffects ("efeito" branch,
 * addToChange and the chat card list). */

let nextId = 0;

class FakeCollection extends Map {
  constructor(docs = []) {
    super(docs.map((d) => [d.id, d]));
    this.sourceWrites = 0;
  }
  set(key, value, { modifySource = true } = {}) {
    if (modifySource) this.sourceWrites = (this.sourceWrites ?? 0) + 1;
    return super.set(key, value);
  }
  some(fn) {
    return [...this.values()].some(fn);
  }
  [Symbol.iterator]() {
    return this.values();
  }
}

class FakeEffect {
  constructor(data, { parent } = {}) {
    this._source = structuredClone(data);
    this.id = data._id;
    this.name = data.name;
    this.description = data.description ?? "";
    this.disabled = !!data.disabled;
    this.duration = data.duration ?? {};
    this.origin = data.origin ?? null;
    this.parent = parent;
    this.system = structuredClone(data.system);
  }
  get isTemporary() {
    return !!this.duration.expiry;
  }
  clone(data = {}, { keepId, parent = this.parent } = {}) {
    const source = { ...structuredClone(this._source), ...data };
    if (!keepId) delete source._id;
    return new FakeEffect(source, { parent });
  }
}

const effect = (data, parent) => new FakeEffect({ _id: data._id ?? `e${++nextId}`, ...data }, { parent });

function setup({ extraArte = [], ownLinked = false } = {}) {
  globalThis.foundry = { utils: { deepClone: (v) => structuredClone(v), randomID: () => `r${++nextId}` } };
  const actor = { items: new FakeCollection() };
  const item = (id, name, effects) => {
    const it = { documentName: "Item", id, name, uuid: `Actor.a.Item.${id}`, actor };
    it.effects = new FakeCollection(effects.map((e) => effect(e, it)));
    actor.items.set(id, it);
    return it;
  };
  const provider = (key, name, value, change, types) =>
    item(key, name, [
      { _id: `${key}Use`, name, system: { onuse: true, abilityUse: { names: ["Inspiração"] }, changes: [{ key: "efeito", value, type: "custom" }] }, disabled: true },
      { _id: `${key}Target`, name, description: `<p>${value}</p>`, duration: { expiry: "sceneEnd" }, disabled: true, system: { onuse: true, abilityUse: { types }, changes: [change] } }
    ]);
  const arte = provider("arte", "Arte Mágica", "Inspiração (Arte Mágica)", { key: "cd", value: 2, type: "add" }, ["power", "spell"]);
  for (const extra of extraArte) arte.effects.set(extra._id, effect(extra, arte));
  const esgrima = provider("esgrima", "Esgrima Mágica", "Inspiração (Esgrima Mágica)", { key: "pericia", value: "atua", type: "override" }, ["attack"]);
  const inspiracaoEffects = [
    { _id: "aumento", name: "Inspiração", disabled: true, system: { onuse: true, abilityUse: { aumenta: true }, changes: [{ key: "@modificador", value: 1, type: "add" }] } },
    {
      _id: "main",
      name: "Inspiração",
      duration: { expiry: "sceneEnd" },
      system: {
        onuse: false,
        changes: [
          { key: "@modificador", value: 1, type: "add" },
          { key: "system.modificadores.pericias.geral", value: "@modificador", type: "add" }
        ]
      }
    }
  ];
  if (ownLinked) {
    inspiracaoEffects.push({ _id: "ownLinked", name: "Inspiração (Arte Mágica)", disabled: true, duration: { expiry: "sceneEnd" }, system: { onuse: true, changes: [{ key: "cd", value: 5, type: "add" }] } });
  }
  const inspiracao = item("inspiracao", "Inspiração", inspiracaoEffects);

  class Item {
    _allApplicableOnUseEffects() {
      const own = [...this.effects].filter((e) => e.id === "aumento");
      const others = [arte, esgrima].flatMap((it) => [...it.effects].filter((e) => e.id.endsWith("Use")));
      return [...own, ...others];
    }
  }
  const rolledClone = () => {
    const clone = Object.create(Item.prototype);
    Object.assign(clone, { documentName: "Item", id: inspiracao.id, name: inspiracao.name, actor });
    clone.effects = new FakeCollection([...inspiracao.effects].map((e) => e.clone({}, { keepId: true, parent: clone })));
    return clone;
  };
  return { Item, arte, esgrima, inspiracao, rolledClone };
}

function systemApplyOnUse(item, applied) {
  const onUseEffects = item._allApplicableOnUseEffects().filter((ef) => applied[ef.id]);
  const effects = [...item.effects];
  const effectList = effects.filter((ef) => (ef.system.onuse && ef.isTemporary && !ef.disabled) || (!ef.system.onuse && !ef.disabled));
  const optEffectList = effects.filter((ef) => (ef.system.onuse && ef.isTemporary && ef.disabled) || (!ef.system.onuse && ef.disabled));
  for (const ef of onUseEffects) {
    const qty = applied[ef.id];
    for (const ch of ef.system.changes) {
      ch.value = ch.value.toString();
      if (ch.key === "efeito") {
        let tef = optEffectList.find((e) => e.name === ch.value);
        if (!tef && ef.origin?.match(/Item.[A-Za-z0-9]+/)) tef = undefined;
        if (tef) effectList.push(tef);
      }
      const addToChange = (t) => {
        if (ch.key.startsWith("@")) {
          t.system.changes.forEach((c) => {
            if (c.key == ch.key) c.value = Number(c.value) + (Number(ch.value * qty) || ch.value);
          });
        } else if (!ch.key.startsWith("+")) {
          const include = ef.system.abilityUse?.aumenta ? t.system.changes.some((i) => i.key == ch.key) : true;
          if (include) t.system.changes.push({ key: ch.key, value: Number(ch.value * qty) || ch.value, type: ch.type });
        }
      };
      effectList.forEach(addToChange);
      optEffectList.forEach(addToChange);
    }
  }
  return effectList.map((ef) => ({ name: ef.name, changes: ef.system.changes.map(({ key, value }) => ({ key, value: String(value) })) }));
}

function withPatch(Item, fn) {
  globalThis.CONFIG = { Item: { documentClass: Item } };
  try {
    patch.apply();
    return fn();
  } finally {
    delete globalThis.CONFIG;
  }
}

const ALL = { aumento: 2, arteUse: 1, esgrimaUse: 1 };
const MAIN = {
  name: "Inspiração",
  changes: [
    { key: "@modificador", value: "3" },
    { key: "system.modificadores.pericias.geral", value: "@modificador" }
  ]
};

test("reduced system flow loses the linked effects and leaks the efeito change", () => {
  const { rolledClone } = setup();
  const card = systemApplyOnUse(rolledClone(), ALL);
  assert.equal(card.length, 1);
  assert.deepEqual(card[0].changes.filter((c) => c.key === "efeito").map((c) => c.value), [
    "Inspiração (Arte Mágica)",
    "Inspiração (Esgrima Mágica)"
  ]);
});

test("with the patch the card carries the isolated linked effects and a clean main effect", () => {
  const { Item, arte, esgrima, rolledClone } = setup();
  withPatch(Item, () => {
    const clone = rolledClone();
    assert.deepEqual(systemApplyOnUse(clone, ALL), [
      MAIN,
      { name: "Inspiração (Arte Mágica)", changes: [{ key: "cd", value: "2" }] },
      { name: "Inspiração (Esgrima Mágica)", changes: [{ key: "pericia", value: "atua" }] }
    ]);
    assert.equal(clone.effects.sourceWrites, 0);
    const linked = [...clone.effects].find((e) => e.name === "Inspiração (Arte Mágica)");
    assert.equal(linked.parent, clone);
    assert.equal(linked.disabled, true);
    assert.notEqual(linked.id, "arteTarget");
  });
  assert.deepEqual(arte.effects.get("arteTarget").system.changes, [{ key: "cd", value: 2, type: "add" }]);
  assert.equal(esgrima.effects.get("esgrimaTarget").name, "Esgrima Mágica");
});

test("works on the isolated copies made by appended-usage-changes", () => {
  const { Item, rolledClone } = setup();
  globalThis.CONFIG = { Item: { documentClass: Item } };
  try {
    appendedUsageChanges.apply();
    patch.apply();
    assert.deepEqual(systemApplyOnUse(rolledClone(), ALL).map((e) => e.name), [
      "Inspiração",
      "Inspiração (Arte Mágica)",
      "Inspiração (Esgrima Mágica)"
    ]);
  } finally {
    delete globalThis.CONFIG;
  }
});

test("only the selected link is delivered", () => {
  const { Item, rolledClone } = setup();
  withPatch(Item, () => {
    assert.deepEqual(systemApplyOnUse(rolledClone(), { esgrimaUse: 1 }), [
      { name: "Inspiração", changes: [{ key: "@modificador", value: "1" }, { key: "system.modificadores.pericias.geral", value: "@modificador" }] },
      { name: "Inspiração (Esgrima Mágica)", changes: [{ key: "pericia", value: "atua" }] }
    ]);
  });
});

test("a rolled item that already has the named effect keeps the official path", () => {
  const { Item, rolledClone } = setup({ ownLinked: true });
  withPatch(Item, () => {
    const card = systemApplyOnUse(rolledClone(), { arteUse: 1 });
    assert.deepEqual(card.map((e) => e.name), ["Inspiração", "Inspiração (Arte Mágica)"]);
    assert.deepEqual(card[1].changes[0], { key: "cd", value: "5" });
  });
});

test("ambiguous links are not injected and warn once", () => {
  const twin = { _id: "twin", name: "Inspiração (Arte Mágica)", disabled: true, duration: { expiry: "sceneEnd" }, system: { onuse: true, changes: [] } };
  const { Item, rolledClone } = setup({ extraArte: [twin] });
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    withPatch(Item, () => {
      systemApplyOnUse(rolledClone(), { arteUse: 1 });
      assert.deepEqual(systemApplyOnUse(rolledClone(), { arteUse: 1 }).map((e) => e.name), ["Inspiração"]);
    });
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ambiguous/);
});

test("the live item is left untouched", () => {
  const { Item, inspiracao } = setup();
  Object.setPrototypeOf(inspiracao, Item.prototype);
  withPatch(Item, () => {
    inspiracao._allApplicableOnUseEffects();
    assert.equal(inspiracao.effects.size, 2);
    assert.ok(!(inspiracao.effects.get("main").system.changes instanceof OwnChangeList));
  });
});
