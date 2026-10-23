import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOAK,
  UPGRADE_FIXES,
  correctItem,
  correctUpgrade,
  diagnoseSources,
  dropOverrides,
  enableCloakEffects,
  hashText,
  matchesDefect,
  sourceEffectId
} from "../scripts/patches/enchantment-data.mjs";
import { CLOAK_SOURCE, UPGRADE_SOURCES } from "./fixtures/enchantment-data-1.6.5.mjs";

const textKey = (text) => [hashText(text), text.length];

/** UPGRADE_FIXES and CLOAK with the fixture's placeholder descriptions instead of the real hashes. */
const FIXES = Object.fromEntries(
  Object.entries(UPGRADE_FIXES).map(([id, fix]) => [
    id,
    { ...fix, defect: { ...fix.defect, description: textKey(UPGRADE_SOURCES[id].description) } }
  ])
);
const CLOAK_T = { ...CLOAK, description: textKey(CLOAK_SOURCE.system.description.value) };

const ID = {
  guardian: "87bEYYpPzWdzX3zT",
  protector: "S4FlovY4Qj03y6KB",
  lightning: "n39Gxf7O7DPC0R5V",
  shadow: "nG4DzcxM7auuQKxw",
  mithril: "K9RtA8a5aPdqyRUR",
  incandescent: "UWWimfZsadIwa18F",
  iceWeapon: "RKOYBmM5NVeVkAC5",
  iceArmor: "tdrbB9k7sDcQbhPr",
  adamant: "LdQuKLoY9UexlLFJ",
  invArmor: "9qtyaxELLc4xqkMk",
  invShield: "hlCxCLAj9zaurVbw",
  delicate: "0oBNqjSt3Ax3aO3a",
  discreet: "SXtfjuLdQwXZUU1t",
  mithrilWeapon: "7apVrQDXAOmTvcQW",
  mithrilEsoteric: "QL2A7Lhlh9tVDqcB"
};

/** Item effect as created by _manageUpgradeEffects: fromCompendium of the world.item-upgrades copy. */
function itemEffect(id, edit) {
  const source = structuredClone(UPGRADE_SOURCES[id]);
  delete source._id;
  source._stats.compendiumSource = `Compendium.world.item-upgrades.ActiveEffect.${id}`;
  edit?.(source);
  return source;
}

const fix = (id, context, edit) => correctUpgrade(itemEffect(id, edit), context, FIXES);
const summary = (changes) => changes.map(({ key, value }) => [key, value]);

test("sourceEffectId reads the effect id of a compendium ActiveEffect only", () => {
  assert.equal(sourceEffectId("Compendium.world.item-upgrades.ActiveEffect.87bEYYpPzWdzX3zT"), "87bEYYpPzWdzX3zT");
  assert.equal(sourceEffectId("Compendium.x.y.Item.abc"), null);
  assert.equal(sourceEffectId(null), null);
  assert.equal(sourceEffectId(42), null);
});

test("hashText is FNV-1a", () => {
  assert.equal(hashText(""), "811c9dc5");
  assert.equal(hashText("a"), "e40c292c");
});

test("matchesDefect recognizes every 1.6.5 upgrade source and the cloak effect", () => {
  for (const [id, entry] of Object.entries(FIXES)) assert.ok(matchesDefect(UPGRADE_SOURCES[id], entry.defect), id);
  assert.ok(matchesDefect(CLOAK_SOURCE.effects[0], CLOAK.effect));
});

test("matchesDefect rejects a single edited field", () => {
  const edits = {
    name: (s) => (s.name += "!"),
    description: (s) => (s.description += " "),
    transfer: (s) => (s.transfer = true),
    disabled: (s) => (s.disabled = true),
    onuse: (s) => (s.system.onuse = true),
    automatic: (s) => (s.system.abilityUse.automatic = true),
    types: (s) => (s.system.abilityUse.types = ["self"]),
    identifier: (s) => (s.system.identifier = "x"),
    upgradeType: (s) => (s.system.upgrade.type = "material"),
    itemType: (s) => (s.system.upgrade.itemType = ["armor"]),
    extraChange: (s) => s.system.changes.push({ ...s.system.changes[0] }),
    key: (s) => (s.system.changes[0].key = "system.attributes.defesa.value"),
    type: (s) => (s.system.changes[0].type = "override"),
    value: (s) => (s.system.changes[0].value = "2"),
    phase: (s) => (s.system.changes[0].phase = "final"),
    priority: (s) => (s.system.changes[0].priority = 99)
  };
  for (const [name, edit] of Object.entries(edits)) {
    const source = itemEffect(ID.guardian, edit);
    assert.equal(matchesDefect(source, FIXES[ID.guardian].defect), false, name);
  }
  const reordered = itemEffect(ID.adamant, (s) => s.system.changes.reverse());
  assert.equal(matchesDefect(reordered, FIXES[ID.adamant].defect), false, "order");
});

test("transfer-only fixes keep the source changes", () => {
  for (const id of [ID.guardian, ID.protector, ID.lightning]) {
    const result = fix(id);
    assert.equal(result.transfer, true, id);
    assert.deepEqual(summary(result.changes), summary(UPGRADE_SOURCES[id].system.changes), id);
  }
  assert.equal(fix(ID.guardian, {}, (s) => (s.transfer = true)), null);
});

test("own effects of ready-made items (no compendium source, other values) are left alone", () => {
  const sunShield = itemEffect(ID.guardian, (s) => {
    s._stats.compendiumSource = null;
    s.system.changes[0].value = 4;
  });
  assert.equal(correctUpgrade(sunShield, {}, FIXES), null);
  const noSource = itemEffect(ID.adamant, (s) => (s._stats.compendiumSource = null));
  assert.equal(correctUpgrade(noSource, { tipo: "pesada" }, FIXES), null);
});

test("Sombrio drops the unresolvable @item.pda change and keeps +5 Stealth", () => {
  const result = fix(ID.shadow);
  assert.equal(result.transfer, true);
  assert.deepEqual(summary(result.changes), [["system.pericias.furt.bonus", 5]]);
});

test("Incandescente gains fire resistance 10", () => {
  assert.deepEqual(summary(fix(ID.incandescent).changes), [["system.tracos.resistencias.fogo.bonus", 10]]);
});

test("Mitral is only transferred when armor-penalty-reduction is applied", () => {
  assert.equal(fix(ID.mithril, { penaltyFix: false }), null);
  assert.equal(fix(ID.mithril, { penaltyFix: () => false }), null);
  const result = fix(ID.mithril, { penaltyFix: () => true });
  assert.equal(result.transfer, true);
  assert.deepEqual(summary(result.changes), [["system.attributes.defesa.pda", -2]]);
});

test("Gelo Eterno (weapon) adds a plain +2 damage and keeps any other field", () => {
  const result = fix(ID.iceWeapon);
  assert.equal(result.transfer, false);
  // A flavored value would gain the weapon type too and break the roll ("2[frio][corte]").
  assert.deepEqual(summary(result.changes), [["dano", "2"]]);
  const extra = fix(ID.iceWeapon, {}, (s) => (s.system.changes[0].extra = "kept"));
  assert.equal(extra.changes[0].extra, "kept");
  assert.equal(extra.changes[0].key, "dano");
});

test("Gelo Eterno and Adamante (armor) give the value of the armor type", () => {
  const fire = "system.tracos.resistencias.fogo.bonus";
  const dr = "system.tracos.resistencias.dano.bonus";
  assert.deepEqual(summary(fix(ID.iceArmor, { tipo: "pesada" }).changes), [[fire, 10]]);
  assert.deepEqual(summary(fix(ID.iceArmor, { tipo: "leve" }).changes), [[fire, 5]]);
  assert.deepEqual(summary(fix(ID.iceArmor, { tipo: "escudo" }).changes), [[fire, 5]]);
  assert.equal(fix(ID.iceArmor, { tipo: undefined }), null);
  assert.deepEqual(summary(fix(ID.adamant, { tipo: "pesada" }).changes), [[dr, 5]]);
  assert.deepEqual(summary(fix(ID.adamant, { tipo: "escudo" }).changes), [[dr, 2]]);
  assert.equal(fix(ID.adamant, { tipo: "outro" }), null);
});

test("Invulnerável gives damage reduction by item type, whatever the variant", () => {
  const dr = "system.tracos.resistencias.dano.bonus";
  assert.deepEqual(summary(fix(ID.invArmor, { tipo: "escudo" }).changes), [[dr, 2]]);
  assert.deepEqual(summary(fix(ID.invShield, { tipo: "leve" }).changes), [[dr, 5]]);
  assert.deepEqual(summary(fix(ID.invShield, { tipo: "escudo" }).changes), [[dr, 2]]);
});

test("every returned change is an initial change without priority, and a copy", () => {
  const all = [
    fix(ID.guardian),
    fix(ID.shadow),
    fix(ID.incandescent),
    fix(ID.mithril, { penaltyFix: true }),
    fix(ID.iceWeapon),
    fix(ID.iceArmor, { tipo: "leve" }),
    fix(ID.adamant, { tipo: "pesada" }),
    fix(ID.invArmor, { tipo: "pesada" })
  ];
  for (const result of all) {
    for (const change of result.changes) {
      assert.equal(change.phase, "initial", result.id);
      assert.equal(change.priority, null, result.id);
    }
  }
  const source = itemEffect(ID.guardian);
  const result = correctUpgrade(source, {}, FIXES);
  result.changes[0].value = 99;
  assert.equal(source.system.changes[0].value, 2);
  const adamant = fix(ID.adamant, { tipo: "pesada" });
  adamant.changes[0].value = 99;
  assert.equal(fix(ID.adamant, { tipo: "pesada" }).changes[0].value, 5);
});

/** Item data as sent by each creation path, from the cloak compendium document. */
function cloakData(edit) {
  const data = structuredClone(CLOAK_SOURCE);
  edit?.(data);
  return data;
}

test("Manto da Resistência straight from the compendium is created enabled", () => {
  const paths = {
    sheetDrop: (d) => (d._stats.compendiumSource = CLOAK.source),
    sidebarImport: (d) => (d._stats.compendiumSource = CLOAK.source),
    folderDrop: (d) => (d._stats.compendiumSource = null)
  };
  for (const [name, edit] of Object.entries(paths)) {
    const effects = enableCloakEffects(cloakData(edit), CLOAK_T);
    assert.equal(effects?.length, 1, name);
    assert.deepEqual(effects[0], { ...CLOAK_SOURCE.effects[0], disabled: false }, name);
  }
});

test("existing, duplicated or edited cloaks are left alone", () => {
  const cases = {
    worldCopy: (d) => (d._stats.createdTime = 1),
    duplicate: (d) => (d._stats.duplicateSource = "Item.abc"),
    otherDescription: (d) => (d.system.description.value += " "),
    otherName: (d) => (d.name = "Manto"),
    alreadyEnabled: (d) => (d.effects[0].disabled = false),
    otherChange: (d) => (d.effects[0].system.changes[0].value = 3),
    twoEffects: (d) => d.effects.push(structuredClone(d.effects[0])),
    otherSource: (d) => (d._stats.compendiumSource = "Compendium.world.items.Item.zPxlM4MNoKihGsDn")
  };
  for (const [name, edit] of Object.entries(cases)) {
    assert.equal(enableCloakEffects(cloakData(edit), CLOAK_T), null, name);
  }
});

test("enableCloakEffects returns a copy", () => {
  const data = cloakData();
  enableCloakEffects(data, CLOAK_T)[0].system.changes[0].value = 9;
  assert.equal(data.effects[0].system.changes[0].value, 2);
  assert.equal(data.effects[0].disabled, true);
});

test("diagnoseSources reports present defects with high confidence, never fixed/high", () => {
  const present = diagnoseSources({ [ID.guardian]: UPGRADE_SOURCES[ID.guardian] }, null, FIXES, CLOAK_T);
  assert.equal(present.bug, "present");
  assert.equal(present.confidence, "high");
  assert.match(present.evidence, /Guardião/);
  const cloakOnly = diagnoseSources({}, CLOAK_SOURCE.effects[0], FIXES, CLOAK_T);
  assert.match(cloakOnly.evidence, /Manto da Resistência/);
  const fixedSource = itemEffect(ID.guardian, (s) => (s.transfer = true));
  assert.deepEqual(
    { ...diagnoseSources({ [ID.guardian]: fixedSource }, null, FIXES, CLOAK_T), evidence: undefined },
    { bug: "fixed", confidence: "low", evidence: undefined }
  );
});

test("Delicada loses the flat +1 Defense; item-only upgrades leave their effect alone", () => {
  const delicate = fix(ID.delicate);
  assert.deepEqual(delicate.changes, []);
  assert.equal(delicate.transfer, true);
  for (const id of [ID.discreet, ID.mithrilWeapon, ID.mithrilEsoteric]) assert.equal(fix(id), null, id);
});

const item = (data, ...ids) => correctItem({ effects: ids.map((id) => itemEffect(id)), ...data }, FIXES);
const heavy = { tipo: "pesada", maxAtr: 0, espacos: 5 };

test("heavy armor of Mitral or Delicada applies up to 2 or 1 point of the Defense attribute, never summed", () => {
  assert.deepEqual(item(heavy, ID.mithril), { maxAtr: 2, espacos: 4 });
  assert.deepEqual(item(heavy, ID.delicate), { maxAtr: 1 });
  assert.deepEqual(item(heavy, ID.mithril, ID.delicate), { maxAtr: 2, espacos: 4 });
  assert.deepEqual(item({ ...heavy, maxAtr: 3 }, ID.mithril), { espacos: 4 });
  assert.equal(item({ ...heavy, tipo: "leve", espacos: 2 }, ID.delicate), null);
  assert.deepEqual(item({ ...heavy, tipo: "leve", espacos: 2 }, ID.mithril), { espacos: 1 });
});

test("the Mitral Defense rule does not depend on armor-penalty-reduction", () => {
  assert.equal(fix(ID.mithril, { penaltyFix: false }), null);
  assert.deepEqual(item(heavy, ID.mithril), { maxAtr: 2, espacos: 4 });
});

test("Mitral and Discreto take one space less each, minimum 1; Mitral counts once", () => {
  assert.deepEqual(item({ espacos: 5 }, ID.mithril, ID.discreet), { espacos: 3 });
  assert.deepEqual(item({ espacos: 2 }, ID.mithril, ID.discreet), { espacos: 1 });
  assert.deepEqual(item({ espacos: 2 }, ID.mithrilWeapon, ID.mithrilEsoteric, ID.mithril), { espacos: 1 });
  assert.deepEqual(item({ espacos: 3 }, ID.mithrilWeapon, ID.mithrilEsoteric), { espacos: 2 });
  assert.equal(item({ espacos: 1 }, ID.discreet), null);
  assert.equal(item({ espacos: 0.5 }, ID.discreet), null);
  assert.equal(item({ espacos: 5 }), null);
});

test("edited, disabled or unknown upgrade effects change nothing on the item", () => {
  const edited = [
    itemEffect(ID.mithril, (s) => (s.disabled = true)),
    itemEffect(ID.delicate, (s) => (s.system.changes[0].value = 2)),
    itemEffect(ID.discreet, (s) => (s.name = "Discreto*")),
    itemEffect(ID.guardian),
    { name: "Mitral", _stats: {} }
  ];
  assert.equal(correctItem({ ...heavy, effects: edited }, FIXES), null);
});

test("dropOverrides only drops echoed prepared values, nested or dotted", () => {
  const overrides = { "system.armadura.maxAtr": 2, "system.espacos": 4 };
  const source = { system: { armadura: { maxAtr: 0 }, espacos: 5 } };
  const nested = { system: { armadura: { maxAtr: 2, value: 10 }, espacos: 4, qtd: 1 } };
  assert.deepEqual(dropOverrides(nested, overrides, source).sort(), ["system.armadura.maxAtr", "system.espacos"]);
  assert.deepEqual(nested, { system: { armadura: { value: 10 }, qtd: 1 } });
  const dotted = { "system.armadura.maxAtr": "2", "system.espacos": 3 };
  assert.deepEqual(dropOverrides(dotted, overrides, source), ["system.armadura.maxAtr"]);
  assert.deepEqual(dotted, { "system.espacos": 3 });
  const same = { system: { espacos: 4 } };
  assert.deepEqual(dropOverrides(same, overrides, { system: { espacos: 4, armadura: { maxAtr: 0 } } }), []);
});
