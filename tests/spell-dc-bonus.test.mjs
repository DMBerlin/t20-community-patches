import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  KNOWN_PREPARE_FINAL_ATTRIBUTES,
  arcaneEmpowermentBonus,
  casterProgress,
  classProgression,
  correctedSaveDC,
  diagnoseSaveDC,
  findArcaneEmpowerments,
  isShippedEmpowermentEffect,
  matchesSource,
  normalizeSource,
  withoutEmpowermentEffects
} from "../scripts/patches/spell-dc-bonus.mjs";
import { resolvePatchState } from "../scripts/registry.mjs";
import { markWrapper } from "../scripts/utils.mjs";

const SOURCE_165 = `prepareFinalAttributes() {
		const item = this.parent;
		const actor = item.parent ?? {};
		if (!item.isOwned) return;
		if ((this.resistencia?.atributo || actor.type === "npc") && this.resistencia?.txt) {
			const atr = foundry.utils.getProperty(actor.system, \`atributos.\${this.resistencia.atributo}.value\`);
			const nvl = Math.floor(foundry.utils.getProperty(actor.system, "attributes.nivel.value") / 2);
			if (actor.type === "npc") this.resistencia.cd = actor.system.attributes.cd;
			else this.resistencia.cd = 10 + nvl + atr + this.resistencia.bonus;
		}
	}`;

const fakeFoundry = { utils: { getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj) } };
const compendium = (pack, id) => ({ compendiumSource: `Compendium.tormenta20.${pack}.Item.${id}` });
const cls = (name, niveis, id) => ({ type: "classe", name, system: { niveis }, _stats: id ? compendium("classes", id) : {} });
const spell = (circulo) => ({ type: "magia", name: `M${circulo}`, system: { circulo } });
const ID = { arcanista: "TH7OIKaDqtLLQUrs", clerigo: "EnHy1teosvZmcp4D", bardo: "u3fr3IOtTXmsk2BT", druida: "ROLLbOHDe9gWNazQ", guerreiro: "DPhWNP689FygcOSZ", paladino: "VnjstNLqk1lgxsEn" };

function shippedEffect(overrides = {}, use = {}) {
  return {
    isTemporary: false,
    system: {
      onuse: true,
      changes: [{ key: "CD", type: "add", value: 1 }],
      abilityUse: { automatic: false, aumenta: true, custo: null, types: new Set(["spell"]), names: new Set(), ...use },
      ...overrides
    }
  };
}

function empowerment(id, effects = [shippedEffect()]) {
  const item = { id, type: "poder", name: "Fortalecimento Arcano", _stats: compendium("poderes", "KhQoVoaIZ8huXnPY"), effects };
  for (const e of effects) e.parent = item;
  return item;
}

test("correctedSaveDC", () => {
  assert.equal(correctedSaveDC({ actorType: "character", itemType: "magia", actorDC: 14, ability: 3, bonus: 1 }), 18);
  assert.equal(correctedSaveDC({ actorType: "character", itemType: "poder", actorDC: 14, ability: 3, bonus: 1 }), undefined);
  assert.equal(correctedSaveDC({ actorType: "npc", itemType: "magia", actorDC: 26, bonus: 2 }), 28);
  assert.equal(correctedSaveDC({ actorType: "npc", itemType: "poder", actorDC: 26, bonus: 0 }), 26);
  assert.equal(correctedSaveDC({ actorType: "simple", itemType: "magia", actorDC: 26, ability: 3, bonus: 2 }), undefined);
  assert.equal(correctedSaveDC({ actorType: "npc", itemType: "magia", actorDC: undefined, bonus: 2 }), undefined);
  assert.equal(correctedSaveDC({ actorType: "character", itemType: "magia", actorDC: 14, ability: undefined, bonus: 0 }), undefined);
});

test("arcaneEmpowermentBonus", () => {
  assert.equal(arcaneEmpowermentBonus({}), 1);
  assert.equal(arcaneEmpowermentBonus({ maxCircle: 4 }), 2);
  assert.equal(arcaneEmpowermentBonus({ fourthCircleClass: true }), 2);
  assert.equal(arcaneEmpowermentBonus({ maxCircle: 3, fourthCircleClass: false }), 1);
});

test("classProgression: official source wins over the name", () => {
  assert.equal(classProgression(cls("Clérigo", 1, ID.druida)).level, 14);
  assert.ok(classProgression(cls("Arcanista", 1, ID.bardo)).names.has("bardo"));
  assert.ok(classProgression(cls("Clérigo", 1)).names.has("clérigo"));
  assert.ok(classProgression({ type: "classe", name: "Bardo", _stats: { compendiumSource: "Compendium.world.x.Item.abc" } }).names.has("bardo"));
  assert.equal(classProgression(cls("Arcanista", 1, ID.guerreiro)), undefined);
  assert.equal(classProgression(cls("Clérigo", 1, ID.paladino)), undefined);
  assert.equal(classProgression(cls("Mago", 1)), undefined);
});

test("casterProgress: 4th circle by class level, never summed across classes", () => {
  const low = [spell(1), spell(3)];
  const has = (...items) => casterProgress([...low, ...items]).fourthCircleClass;
  assert.equal(has(cls("Arcanista", 13, ID.arcanista)), true);
  assert.equal(has(cls("Arcanista", 12, ID.arcanista)), false);
  assert.equal(has(cls("Arcanista", 5, ID.arcanista), cls("Clérigo", 13, ID.clerigo)), true);
  assert.equal(has(cls("Clérigo", 12, ID.clerigo)), false);
  assert.equal(has(cls("Bardo", 13, ID.bardo)), false);
  assert.equal(has(cls("Bardo", 14, ID.bardo)), true);
  assert.equal(has(cls("Natureza", 14, ID.druida)), true);
  assert.equal(has(cls("Clérigo", 13, ID.druida)), false);
  assert.equal(has(cls("Arcanista", 13, ID.bardo)), false);
  assert.equal(has(cls("Clérigo", 13, ID.druida), cls("Clérigo", 1, ID.clerigo)), false);
  assert.equal(has(cls("Arcanista", 13, ID.guerreiro)), false);
  assert.equal(has(cls("Arcanista", 12, ID.arcanista), cls("Arcanista", 1, ID.guerreiro)), false);
  assert.equal(has(cls("Arcanista", 12, ID.arcanista), cls("Clérigo", 12, ID.clerigo)), false);
  assert.equal(has(cls("Paladino", 20, ID.paladino)), false);
  assert.equal(casterProgress([spell(1), spell(4)]).maxCircle, 4);
  assert.deepEqual(casterProgress([]), { maxCircle: 0, fourthCircleClass: false });
});

test("matchesSource", () => {
  const ref = { id: "KhQoVoaIZ8huXnPY", names: new Set(["fortalecimento arcano"]) };
  assert.ok(matchesSource({ name: "X", _stats: compendium("poderes", "KhQoVoaIZ8huXnPY") }, ref));
  assert.ok(matchesSource({ name: " Fortalecimento Arcano " }, ref));
  assert.ok(!matchesSource({ name: "Outro", _stats: compendium("poderes", "abc") }, ref));
});

test("isShippedEmpowermentEffect accepts only the shipped signature", () => {
  assert.ok(isShippedEmpowermentEffect(shippedEffect()));
  assert.ok(isShippedEmpowermentEffect(shippedEffect({}, { automatic: true })));
  assert.ok(isShippedEmpowermentEffect(shippedEffect({}, { types: ["spell"], names: [] })));
  assert.ok(isShippedEmpowermentEffect(shippedEffect({}, { custo: 0 })));
  assert.ok(!isShippedEmpowermentEffect({ ...shippedEffect(), isTemporary: true }));
  const changed = [
    shippedEffect({ changes: [{ key: "CD", type: "add", value: 5 }] }),
    shippedEffect({ changes: [{ key: "CD", type: "add", value: "2" }] }),
    shippedEffect({}, { custo: 1 }),
    shippedEffect({}, { types: new Set(["spell", "power"]) }),
    shippedEffect({}, { types: new Set() }),
    shippedEffect({}, { names: new Set(["Amedrontar"]) }),
    shippedEffect({}, { aumenta: false }),
    shippedEffect({ changes: [{ key: "CD", type: "override", value: 1 }] }),
    shippedEffect({ changes: [{ key: "system.attributes.cd", type: "add", value: 1 }] }),
    shippedEffect({ changes: [{ key: "CD", type: "add", value: 1 }, { key: "cd", type: "add", value: 1 }] }),
    shippedEffect({ onuse: false })
  ];
  for (const effect of changed) assert.ok(!isShippedEmpowermentEffect(effect), JSON.stringify(effect.system, (k, v) => (v instanceof Set ? [...v] : v)));
});

test("findArcaneEmpowerments and withoutEmpowermentEffects", () => {
  const a = empowerment("a");
  const b = empowerment("b");
  const custom = empowerment("c", [shippedEffect({ changes: [{ key: "CD", type: "add", value: 5 }] })]);
  assert.deepEqual(findArcaneEmpowerments([a, b]), [a, b]);
  assert.deepEqual(findArcaneEmpowerments([a, custom]), [a]);
  assert.deepEqual(findArcaneEmpowerments([empowerment("d", [shippedEffect(), { system: {} }])]), []);
  assert.deepEqual(findArcaneEmpowerments([empowerment("e", [])]), []);
  assert.deepEqual(findArcaneEmpowerments([{ ...empowerment("f"), type: "magia" }]), []);

  const school = { parent: { id: "s" }, system: { onuse: true } };
  const effects = [a.effects[0], b.effects[0], school, custom.effects[0]];
  assert.deepEqual(withoutEmpowermentEffects(effects, [a, b]), [school, custom.effects[0]]);
});

test("normalizeSource recognizes only the 1.6.5 body", () => {
  const reformatted = SOURCE_165.replace("const item", "// copied\n  const   item").replace(/\t/g, "    ");
  assert.equal(normalizeSource(reformatted), KNOWN_PREPARE_FINAL_ATTRIBUTES);
  const changed = SOURCE_165.replace("actor.system.attributes.cd;", "actor.system.attributes.cd + this.resistencia.bonus;");
  assert.notEqual(normalizeSource(changed), KNOWN_PREPARE_FINAL_ATTRIBUTES);
});

test("diagnoseSaveDC", () => {
  const r = (character, npcSpell, npcPower) => diagnoseSaveDC({ character, npcSpell, npcPower });
  let d = r(15, 20, 20);
  assert.deepEqual([d.bug, d.confidence], ["present", "low"]);
  assert.match(d.evidence, /character, npcSpell, npcPower/);
  assert.match(d.evidence, /Fortalecimento Arcano not checked/);
  assert.doesNotMatch(d.evidence, /not confirmed/);
  d = r(15, 22, 22);
  assert.deepEqual([d.bug, d.confidence], ["present", "low"]);
  assert.match(d.evidence, /not confirmed in npcSpell, npcPower/);
  assert.deepEqual([r(16, 20, NaN).bug, r(16, 20, NaN).confidence], ["present", "low"]);
  d = r(16, 22, 22);
  assert.deepEqual([d.bug, d.confidence], ["fixed", "low"]);
  assert.match(d.evidence, /Fortalecimento Arcano not checked/);
  assert.deepEqual([r(NaN, NaN, NaN).bug, r(NaN, NaN, NaN).confidence], ["unknown", "low"]);
  assert.equal(r(17, 22, 22).bug, "unknown");
});

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function withFoundry(prepareFinalAttributes, fn) {
  class ItemData {}
  if (prepareFinalAttributes) ItemData.prototype.prepareFinalAttributes = prepareFinalAttributes;
  class SpellData extends ItemData {}
  class CharacterData {
    prepareBaseData() {
      this.attributes.cd = 10 + Math.floor(this.attributes.nivel.value / 2);
    }
  }
  let list = [];
  class Item {
    _allApplicableOnUseEffects() {
      return list;
    }
  }
  globalThis.CONFIG = {
    Item: { dataModels: { magia: SpellData }, documentClass: Item },
    Actor: { dataModels: { character: CharacterData } }
  };
  globalThis.foundry = fakeFoundry;
  try {
    return fn({ ItemData, CharacterData, Item, setList: (l) => (list = l) });
  } finally {
    delete globalThis.CONFIG;
    delete globalThis.foundry;
  }
}

const compile = (source) => new Function(`return class { ${source} }`)().prototype.prepareFinalAttributes;
const counting = () => {
  const spy = function () {
    spy.calls++;
  };
  spy.calls = 0;
  return spy;
};

test("isNeeded never runs unrecognized code", () => {
  const spy = counting();
  withFoundry(spy, () => {
    assert.deepEqual([patch.isNeeded().bug, spy.calls], ["unknown", 0]);
    for (const [mode, systemVersion] of [["off", "1.6.5"], ["auto", "99.0.0"]]) {
      const state = resolvePatchState({ patch, mode, systemId: "tormenta20", systemVersion, probe: patch.isNeeded });
      assert.equal(state.diagnosis.bug, "unknown");
    }
    assert.equal(spy.calls, 0);
  });
  const inner = compile(SOURCE_165);
  let calls = 0;
  const foreign = function (...args) {
    calls++;
    return inner.apply(this, args);
  };
  withFoundry(foreign, () => {
    assert.equal(patch.isNeeded().bug, "unknown");
    assert.equal(calls, 0);
  });
  withFoundry(undefined, () => assert.equal(patch.isNeeded().bug, "unknown"));
});

test("isNeeded runs the recognized 1.6.5 body, also behind a module wrapper", () => {
  const original = compile(SOURCE_165);
  let calls = 0;
  const known = markWrapper(function (...args) {
    calls++;
    return original.apply(this, args);
  }, original);
  withFoundry(original, () => {
    const d = patch.isNeeded();
    assert.deepEqual([d.bug, d.confidence], ["present", "low"]);
  });
  withFoundry(known, () => {
    assert.equal(patch.isNeeded().bug, "present");
    assert.equal(calls, 0);
  });
});

function character(items, base = { nivel: 5 }) {
  return { type: "character", items, system: { atributos: { int: { value: 3 } }, attributes: { nivel: { value: base.nivel } } } };
}

function prepare(CharacterData, actor) {
  const data = Object.assign(new CharacterData(), actor.system);
  data.parent = actor;
  data.prepareBaseData();
  return data.attributes.cd;
}

test("apply(): Fortalecimento Arcano is a single passive bonus and leaves the usage list", () => {
  withFoundry(compile(SOURCE_165), ({ CharacterData, Item, setList }) => {
    patch.apply();
    const arcanista = cls("Arcanista", 5, ID.arcanista);
    const a = empowerment("a");
    const b = empowerment("b");
    const school = { parent: { id: "s" }, system: { onuse: true } };
    assert.equal(prepare(CharacterData, character([arcanista, a, b])), 13);
    assert.equal(prepare(CharacterData, character([arcanista, a, spell(4)])), 14);
    assert.equal(prepare(CharacterData, character([cls("Arcanista", 5, ID.arcanista), cls("Clérigo", 13, ID.clerigo), a, spell(3)], { nivel: 18 })), 21);

    const rolled = Object.assign(new Item(), { actor: { type: "character", items: [arcanista, a, b] } });
    setList([a.effects[0], b.effects[0], school]);
    assert.deepEqual(rolled._allApplicableOnUseEffects(), [school]);

    const temporary = empowerment("t");
    temporary.effects[0].isTemporary = true;
    assert.equal(prepare(CharacterData, character([arcanista, temporary])), 12);
    assert.equal(prepare(CharacterData, character([arcanista, a, temporary])), 13);
    rolled.actor.items = [arcanista, a, temporary];
    setList([a.effects[0], school]);
    assert.deepEqual(rolled._allApplicableOnUseEffects(), [school]);

    const five = empowerment("c", [shippedEffect({ changes: [{ key: "CD", type: "add", value: 5 }] })]);
    assert.equal(prepare(CharacterData, character([arcanista, a, five])), 13);
    rolled.actor.items = [arcanista, a, five];
    setList([a.effects[0], five.effects[0]]);
    assert.deepEqual(rolled._allApplicableOnUseEffects(), [five.effects[0]]);

    const costly = empowerment("k", [shippedEffect({}, { custo: 1 })]);
    assert.equal(prepare(CharacterData, character([arcanista, costly])), 12);
    rolled.actor.items = [arcanista, costly];
    setList([costly.effects[0]]);
    assert.deepEqual(rolled._allApplicableOnUseEffects(), [costly.effects[0]]);

    const npcRolled = Object.assign(new Item(), { actor: { type: "npc", items: [a] } });
    setList([a.effects[0]]);
    assert.deepEqual(npcRolled._allApplicableOnUseEffects(), [a.effects[0]]);
  });
});

test("apply(): save DC of characters and NPCs", () => {
  withFoundry(compile(SOURCE_165), ({ ItemData }) => {
    patch.apply();
    const dc = (actor, itemType, resistencia) => {
      const data = Object.assign(new ItemData(), { parent: { type: itemType, isOwned: true, parent: actor }, resistencia: { txt: "Vontade parcial", cd: 0, ...resistencia } });
      data.prepareFinalAttributes();
      return data.resistencia.cd;
    };
    const pc = { type: "character", system: { atributos: { int: { value: 3 } }, attributes: { cd: 14, nivel: { value: 4 } } } };
    assert.equal(dc(pc, "magia", { atributo: "int", bonus: 1 }), 18);
    assert.equal(dc(pc, "poder", { atributo: "int", bonus: 1 }), 16);
    assert.equal(dc(pc, "magia", { atributo: "", bonus: 1 }), 0);
    const npc = { type: "npc", system: { atributos: {}, attributes: { cd: 20, nivel: { value: 7 } } } };
    assert.equal(dc(npc, "poder", { atributo: "", bonus: 2 }), 22);
    assert.equal(dc(npc, "magia", { atributo: "", bonus: 2 }), 22);
    assert.equal(dc({ type: "npc", system: { attributes: { cd: 26 } } }, "magia", { atributo: "", bonus: 0 }), 26);
  });
});
