import { test } from "node:test";
import assert from "node:assert/strict";
import patch, { SPELL_FIXES, applySpellFix, findSpellFix, matchesFingerprint } from "../scripts/patches/spell-compendium-data.mjs";

const entryOf = (effect) => SPELL_FIXES.find((e) => e.effect === effect);
const CURAR = "E5Ynb8D45IFPkqGc";
const ARMA = "RZOdJ2cuNeEPfdQ7";
const FORCA = "TXbZz91XvGCAtmTP";
const QUEDA = "8eo5YfHSFivsjjan";

/** The buggy compendium `_source` of an entry, as stored in tormenta20 1.6.5. */
function sourceOf(entry) {
  return {
    type: "base",
    description: entry.description,
    system: {
      onuse: true,
      abilityUse: { automatic: false, aumenta: entry.match.aumenta, custo: entry.match.custo, description: "", names: [], types: ["self"] },
      changes: structuredClone(entry.match.changes)
    }
  };
}

/** A prepared effect system built from a source (separate objects, as the data model does). */
const preparedOf = (source) => structuredClone(source.system);

const find = (effect, source = sourceOf(entryOf(effect)), itemType = "magia") => findSpellFix({ itemType, effectId: effect, source });

test("the Curar Ferimentos cantrip gains a 1d8 light damage roll and Will save", () => {
  const entry = find(CURAR);
  assert.ok(entry);
  const system = preparedOf(sourceOf(entry));
  applySpellFix(system, entry);
  assert.equal(system.changes.length, 4);
  assert.deepEqual(
    system.changes.map(({ key, type, value }) => [key, type, value]),
    [
      ["alvo", "override", "1 morto-vivo"],
      ["dano", "override", "1d8"],
      ["tipoDano", "override", "luz"],
      ["resistencia", "override", "Vontade reduz à metade"]
    ]
  );
});

test("an already corrected effect is left untouched", () => {
  const source = sourceOf(entryOf(CURAR));
  source.system.changes.push({ key: "dano", type: "override", value: "1d8", phase: "initial", priority: null });
  assert.equal(find(CURAR, source), null);
});

test("only spell items are fixed", () => {
  assert.equal(find(CURAR, undefined, "poder"), null);
  assert.equal(findSpellFix({ itemType: undefined, effectId: CURAR, source: sourceOf(entryOf(CURAR)) }), null);
});

test("any edit to the Arma Mágica source disables its fix", () => {
  const edits = [
    (s) => { s.description += " "; },
    (s) => { s.system.changes[0].phase = "final"; },
    (s) => { s.system.changes[0].priority = 99; },
    (s) => { s.system.onuse = false; },
    (s) => { s.system.abilityUse.automatic = true; },
    (s) => { s.type = "other"; },
    (s) => { s.system.abilityUse.custo = 4; },
    (s) => { s.system.abilityUse.names = ["x"]; },
    (s) => { s.system.abilityUse.types = ["target"]; }
  ];
  for (const [i, edit] of edits.entries()) {
    const source = sourceOf(entryOf(ARMA));
    edit(source);
    assert.equal(find(ARMA, source), null, `edit ${i}`);
  }
});

test("Arma Mágica +2d6 costs 3 PM and adds 1d6 on top of the +1d6 enhancement", () => {
  const entry = find(ARMA);
  const system = preparedOf(sourceOf(entry));
  applySpellFix(system, entry);
  assert.equal(system.abilityUse.custo, 3);
  assert.deepEqual(system.changes.map(({ key, type, value }) => [key, type, value]), [["dano", "add", "1d6"]]);
  assert.equal(system.changes[0].priority, 0);
});

test("no type coercion: Físico Divino with a text value does not match", () => {
  const source = sourceOf(entryOf(FORCA));
  source.system.changes[0].value = "2";
  assert.equal(find(FORCA, source), null);
});

test("Físico Divino choices become single applications and keep their changes", () => {
  const entry = find(FORCA);
  const system = preparedOf(sourceOf(entry));
  const changes = system.changes;
  applySpellFix(system, entry);
  assert.equal(system.abilityUse.aumenta, false);
  assert.equal(system.abilityUse.custo, 0);
  assert.equal(system.changes, changes);
});

test("Queda Suave size increase becomes repeatable", () => {
  const entry = find(QUEDA);
  const system = preparedOf(sourceOf(entry));
  applySpellFix(system, entry);
  assert.equal(system.abilityUse.aumenta, true);
});

test("a cantrip with cost 0 instead of null does not match", () => {
  const source = sourceOf(entryOf(CURAR));
  source.system.abilityUse.custo = 0;
  assert.equal(matchesFingerprint(source, entryOf(CURAR)), false);
});

test("every fix stops matching its own fingerprint once applied", () => {
  for (const entry of SPELL_FIXES) {
    const source = sourceOf(entry);
    assert.equal(matchesFingerprint(source, entry), true, `${entry.spell}/${entry.effect} buggy`);
    source.system = preparedOf(source);
    applySpellFix(source.system, entry);
    assert.equal(matchesFingerprint(source, entry), false, `${entry.spell}/${entry.effect} fixed`);
  }
});

test("applied changes are fresh copies, so the system's mutations never reach the table", () => {
  const entry = find(CURAR);
  const system = preparedOf(sourceOf(entry));
  applySpellFix(system, entry);
  system.changes[1].value = "999";
  assert.equal(entry.fix.changes[1].value, "1d8");
});

test("the wrapper fixes matching spell effects before the original and preserves this, args and result", () => {
  const calls = [];
  class Model {
    prepareBaseData(...args) {
      calls.push({ self: this, args, custo: this.abilityUse.custo });
      return "result";
    }
  }
  const original = Model.prototype.prepareBaseData;
  globalThis.CONFIG = { ActiveEffect: { dataModels: { base: Model } } };
  try {
    patch.apply();
    const make = (effectId, itemType) => {
      const source = sourceOf(entryOf(effectId));
      const model = Object.assign(new Model(), preparedOf(source));
      model.parent = { id: effectId, _source: source, parent: { type: itemType } };
      return model;
    };
    const spell = make(ARMA, "magia");
    assert.equal(spell.prepareBaseData(1, 2), "result");
    assert.equal(calls[0].self, spell);
    assert.deepEqual(calls[0].args, [1, 2]);
    assert.equal(calls[0].custo, 3);
    assert.equal(spell.parent._source.system.abilityUse.custo, 5);

    const power = make(ARMA, "poder");
    power.prepareBaseData();
    assert.equal(power.abilityUse.custo, 5);

    const broken = new Model();
    broken.abilityUse = { custo: 7 };
    Object.defineProperty(broken, "parent", { get() { throw new Error("boom"); } });
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.equal(broken.prepareBaseData(), "result");
    } finally {
      console.warn = warn;
    }
  } finally {
    Model.prototype.prepareBaseData = original;
    delete globalThis.CONFIG;
  }
});
