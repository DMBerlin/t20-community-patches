import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  ENTRIES,
  fixDwarf,
  fixElf,
  fixHynne,
  fixMinotaur,
  hynneIsCorrect,
  minotaurIsCorrect,
  outdatedItemIds,
  racialUnset,
  senseIsCorrect
} from "../scripts/patches/race-data.mjs";
import { classify, classifyEntry, effectSignature, embeddedItemFixes, sameSignature, summarize } from "../scripts/compendium-copy.mjs";
import { applyUpdate, cleanItem, withEffect, withExtraEffect } from "./fixtures/clean-source.mjs";
import {
  CONHECIMENTO_DAS_ROCHAS,
  MINOTAURO,
  PEQUENO_E_RECHONCHUDO,
  PESTE_ESGUIA,
  SENTIDOS_ELFICOS
} from "./fixtures/race-data-1.6.5.mjs";

const SENSES = "system.attributes.sentidos.value";
globalThis.foundry ??= { utils: { randomID: () => "RANDOM0000000000" } };
const WALK = "system.attributes.movement.walk.base";
const newId = () => "NEWEFFECT0000000";
const fixed = {
  minotaur: () => applyUpdate(MINOTAURO, fixMinotaur(MINOTAURO)),
  hynne: () => applyUpdate(PEQUENO_E_RECHONCHUDO, fixHynne(PEQUENO_E_RECHONCHUDO)),
  dwarf: () => applyUpdate(CONHECIMENTO_DAS_ROCHAS, fixDwarf(CONHECIMENTO_DAS_ROCHAS, newId)),
  elf: () => applyUpdate(SENTIDOS_ELFICOS, fixElf(SENTIDOS_ELFICOS))
};
const passive = (changes, extra = {}) => ({ _id: "EXTRA00000000000", name: "Extra", system: { changes }, ...extra });
const c = (key, type, value, priority, phase) => ({ key, type, value, priority, phase });

test("patch metadata", () => {
  assert.equal(patch.id, "race-data");
  assert.equal(patch.issue, 57);
  assert.equal(patch.guarded, true);
  assert.deepEqual(patch.isNeeded(), { bug: "unknown", confidence: "low", evidence: "compendium data can only be read after ready" });
});

test("fixMinotaur: Con +1 instead of Des +1, only on the exact 1.6.5 data", () => {
  assert.deepEqual(fixMinotaur(MINOTAURO), { system: { atributos: { des: 0, con: 1 } } });
  const variant = (mutate) => {
    const src = structuredClone(MINOTAURO);
    mutate(src);
    return fixMinotaur(src);
  };
  assert.equal(variant((s) => (s.system.atributos.con = 1)), null);
  assert.equal(variant((s) => (s.system.atributos.int = 1)), null);
  assert.equal(variant((s) => (s.system.atributosDinamicos.value = ["for"])), null);
  assert.equal(variant((s) => (s.name = "Minotauro Editado")), null);
  assert.equal(variant((s) => (s.type = "poder")), null);
  assert.equal(variant((s) => s.effects.push({ _id: "x" })), null);
  assert.deepEqual(variant((s) => (s.system.description.value = "outra")), fixMinotaur(MINOTAURO));
});

test("fixHynne: Small and 6m appended to the existing effect", () => {
  const out = fixed.hynne();
  assert.equal(out.effects.length, 1);
  assert.equal(out.effects[0]._id, "HI65tXsIJK8edUPr");
  assert.deepEqual(
    out.effects[0].system.changes.map(({ key, type, value }) => [key, type, value]),
    [
      ["system.pericias.enga.bonus", "add", 2],
      [WALK, "override", 6],
      ["system.tracos.tamanho", "override", "peq"]
    ]
  );
});

test("fixHynne: any mechanical difference leaves the copy alone", () => {
  const cases = {
    _id: (e) => (e._id = "OTHER00000000000"),
    name: (e) => (e.name = "Outro"),
    disabled: (e) => (e.disabled = true),
    transfer: (e) => (e.transfer = false),
    statuses: (e) => (e.statuses = ["prone"]),
    "duration.value": (e) => (e.duration.value = 1),
    "duration.units": (e) => (e.duration.units = "rounds"),
    "duration.expiry": (e) => (e.duration.expiry = "turnEnd"),
    value: (e) => (e.system.changes[0].value = 99),
    type: (e) => (e.system.changes[0].type = "override"),
    phase: (e) => (e.system.changes[0].phase = "final"),
    priority: (e) => (e.system.changes[0].priority = 5),
    key: (e) => (e.system.changes[0].key = "system.pericias.furt.bonus"),
    "extra change": (e) => e.system.changes.push({ key: "system.pericias.furt.bonus", type: "add", value: 2 }),
    targets: (e) => (e.system.targets = ["ally"]),
    status: (e) => (e.system.status = { category: "x" }),
    onuse: (e) => (e.system.onuse = true),
    "abilityUse.automatic": (e) => (e.system.abilityUse.automatic = true),
    "abilityUse.aumenta": (e) => (e.system.abilityUse.aumenta = true),
    "abilityUse.custo": (e) => (e.system.abilityUse.custo = 1),
    "abilityUse.names": (e) => (e.system.abilityUse.names = ["Enganação"]),
    "abilityUse.types": (e) => (e.system.abilityUse.types = ["skill"]),
    "aura.isAura": (e) => (e.system.aura.isAura = true),
    "aura.range": (e) => (e.system.aura.range = 3),
    "aura.behaviors": (e) => (e.system.aura.behaviors = { a: { type: "applyActiveEffect" } }),
    identifier: (e) => (e.system.identifier = "x"),
    "upgrade.type": (e) => (e.system.upgrade.type = "enchantment"),
    "upgrade.itemType": (e) => (e.system.upgrade.itemType = ["armor"]),
    "extra effect": (e, item) => item.effects.push(structuredClone(e)),
    "item name": (e, item) => (item.name = "Outro"),
    "item type": (e, item) => (item.type = "magia")
  };
  for (const [name, mutate] of Object.entries(cases)) {
    assert.equal(fixHynne(withEffect(PEQUENO_E_RECHONCHUDO, mutate)), null, name);
  }
});

test("fixHynne: descriptions and a second cleaning do not matter", () => {
  const described = withEffect(PEQUENO_E_RECHONCHUDO, (e) => {
    e.description = "outra";
    e.system.abilityUse.description = "outra";
  });
  assert.ok(fixHynne(described));
  assert.ok(fixHynne(cleanItem(cleanItem(PEQUENO_E_RECHONCHUDO))));
});

test("the raw pack shape (aura.disposition, no identifier/upgrade) is not the signature shape", () => {
  const raw = structuredClone(PEQUENO_E_RECHONCHUDO);
  raw.effects[0].system.aura.disposition = 1;
  delete raw.effects[0].system.identifier;
  delete raw.effects[0].system.upgrade;
  assert.ok(!sameSignature(effectSignature(raw.effects[0]), effectSignature(PEQUENO_E_RECHONCHUDO.effects[0])));
  assert.ok(fixHynne(cleanItem(raw)));
});

test("fixDwarf: keeps the usage effect and adds an always-on darkvision effect", () => {
  const out = fixed.dwarf();
  assert.equal(out.effects.length, 2);
  assert.ok(sameSignature(effectSignature(out.effects[0]), effectSignature(CONHECIMENTO_DAS_ROCHAS.effects[0])));
  const [, added] = out.effects;
  assert.equal(added._id, "NEWEFFECT0000000");
  assert.equal(added.transfer, true);
  assert.equal(added.disabled, false);
  assert.equal(added.system.onuse, false);
  assert.deepEqual(added.flags, { "t20-community-patches": { addedBy: "race-data" } });
  assert.deepEqual(added.system.changes.map(({ key, type, value }) => [key, type, value]), [[SENSES, "add", "escuro"]]);
  assert.equal(fixDwarf(withEffect(CONHECIMENTO_DAS_ROCHAS, (e) => (e.system.abilityUse.names = ["Percepção"])), newId), null);
  assert.equal(fixDwarf(withEffect(CONHECIMENTO_DAS_ROCHAS, (e) => (e.disabled = false)), newId), null);
});

test("fixElf: low-light vision appended to the existing effect", () => {
  const out = fixed.elf();
  assert.deepEqual(out.effects[0].system.changes.at(-1), { key: SENSES, type: "add", value: "penumbra", phase: "initial", priority: null });
  assert.equal(fixElf(withEffect(SENTIDOS_ELFICOS, (e) => e.system.changes.push({ key: SENSES, type: "add", value: "penumbra" }))), null);
  assert.equal(fixElf(withEffect(SENTIDOS_ELFICOS, (e) => (e.system.changes[1].value = 3))), null);
});

test("classify: the 1.6.5 entries are present; corrected copies are fixed and not corrected again", () => {
  const sources = [MINOTAURO, PEQUENO_E_RECHONCHUDO, CONHECIMENTO_DAS_ROCHAS, SENTIDOS_ELFICOS];
  const corrected = [fixed.minotaur(), fixed.hynne(), fixed.dwarf(), fixed.elf()];
  ENTRIES.forEach((entry, i) => {
    assert.equal(classify(entry, sources[i]), "present", entry.name);
    assert.equal(classify(entry, corrected[i]), "fixed", entry.name);
    assert.equal(entry.fix(corrected[i], newId), null, entry.name);
    assert.equal(classify(entry, undefined), "missing");
  });
  assert.deepEqual(
    summarize(ENTRIES.flatMap((entry, i) => classifyEntry(entry, sources[i]))),
    {
      bug: "present",
      confidence: "high",
      evidence: "wrong data: Minotauro, Pequeno e Rechonchudo, Conhecimento das Rochas, Sentidos Élficos"
    }
  );
  assert.equal(summarize(ENTRIES.flatMap((entry, i) => classifyEntry(entry, corrected[i]))).bug, "fixed");
});

test("Peste Esguia (Goblin) and other entries are not in the table", () => {
  assert.ok(ENTRIES.every((entry) => entry.id !== PESTE_ESGUIA._id));
  assert.ok(ENTRIES.every((entry) => entry.fix(PESTE_ESGUIA, newId) === null));
});

test("isCorrect: a later always-on change that undoes the correction is not fixed; disabled or usage ones are", () => {
  const undo = [
    [fixed.hynne, hynneIsCorrect, [c(WALK, "override", 9, 60)]],
    [fixed.hynne, hynneIsCorrect, [c("system.attributes.movement.*.base", "override", 9, 60)]],
    [fixed.hynne, hynneIsCorrect, [c("system.attributes.movement.walk", "add", 3)]],
    [fixed.hynne, hynneIsCorrect, [c("system.tracos.tamanho", "override", "med", 60)]],
    [fixed.elf, senseIsCorrect("penumbra"), [c(SENSES, "subtract", "penumbra")]],
    [fixed.dwarf, senseIsCorrect("escuro"), [c(SENSES, "subtract", "escuro")]],
    [fixed.minotaur, minotaurIsCorrect, [c("system.atributos.des.value", "add", 1)]]
  ];
  for (const [make, isCorrect, changes] of undo) {
    assert.equal(isCorrect(make()), true);
    assert.equal(isCorrect(withExtraEffect(make(), passive(changes))), false, JSON.stringify(changes));
    assert.equal(isCorrect(withExtraEffect(make(), passive(changes, { disabled: true }))), true);
    assert.equal(isCorrect(withExtraEffect(make(), passive(changes, { system: { changes, onuse: true } }))), true);
  }
});

test("isCorrect: changes in the final phase are not judged", () => {
  const moved = withEffect(fixed.hynne(), (e) => (e.system.changes[1].phase = "final"));
  assert.equal(hynneIsCorrect(moved), false);
  assert.equal(classify(ENTRIES[1], moved), "unknown");
  assert.equal(hynneIsCorrect(withExtraEffect(fixed.hynne(), passive([c(WALK, "override", 9, null, "final")]))), false);
  assert.equal(senseIsCorrect("penumbra")(withEffect(fixed.elf(), (e) => (e.system.changes[2].phase = "final"))), false);
  assert.equal(minotaurIsCorrect(withExtraEffect(fixed.minotaur(), passive([c("system.atributos.des.bonus", "add", 1, null, "final")]))), false);
  const results = [
    { name: "Pequeno e Rechonchudo", state: classify(ENTRIES[1], moved) },
    ...ENTRIES.filter((_, i) => i !== 1).map((entry) => ({ name: entry.name, state: "fixed" }))
  ];
  assert.notEqual(summarize(results).bug, "fixed");
});

test("isCorrect: auras that do not target self are not counted", () => {
  const behaviors = { a: { type: "applyActiveEffect" } };
  const aura = (targets, b = behaviors) => (e) => {
    e.system.aura = { isAura: true, range: 3, behaviors: b };
    e.system.targets = targets;
  };
  assert.equal(hynneIsCorrect(withEffect(fixed.hynne(), aura(["ally"]))), false);
  assert.equal(senseIsCorrect("penumbra")(withEffect(fixed.elf(), aura(["ally"]))), false);
  assert.equal(senseIsCorrect("escuro")(withEffect(fixed.dwarf(), aura(["ally"]), 1)), false);
  assert.equal(senseIsCorrect("penumbra")(withEffect(fixed.elf(), aura(["self"]))), true);
  assert.equal(senseIsCorrect("penumbra")(withEffect(fixed.elf(), aura(["ally"], { a: { type: "other" } }))), true);
  assert.equal(senseIsCorrect("penumbra")(withEffect(fixed.elf(), aura(["ally"], "{not json"))), false);
});

test("isCorrect: non-scalar values are not judged", () => {
  const set = ["penumbra", "escuro"];
  assert.equal(senseIsCorrect("penumbra")(withExtraEffect(fixed.elf(), passive([c(SENSES, "subtract", set, 60)]))), false);
  assert.equal(classify(ENTRIES[3], withExtraEffect(fixed.elf(), passive([c(SENSES, "subtract", JSON.stringify(set), 60)]))), "unknown");
  const addArray = withEffect(SENTIDOS_ELFICOS, (e) => e.system.changes.push({ key: SENSES, type: "add", value: ["penumbra"] }));
  assert.equal(senseIsCorrect("penumbra")(addArray), false);
  const addRef = withEffect(SENTIDOS_ELFICOS, (e) => e.system.changes.push({ key: SENSES, type: "add", value: "@x" }));
  assert.equal(senseIsCorrect("penumbra")(addRef), false);
  assert.equal(hynneIsCorrect(withExtraEffect(fixed.hynne(), passive([c(WALK, "override", [9], 60)]))), false);
});

test("isCorrect: overrides of an ancestor path are not judged; siblings are", () => {
  const extra = (make, key, value) => withExtraEffect(make(), passive([c(key, "override", value, 60)]));
  assert.equal(senseIsCorrect("penumbra")(extra(fixed.elf, "system.attributes.sentidos", '{"value":[],"custom":""}')), false);
  assert.equal(classify(ENTRIES[3], extra(fixed.elf, "system.attributes.sentidos", '{"value":[],"custom":""}')), "unknown");
  assert.equal(senseIsCorrect("escuro")(withEffect(fixed.dwarf(), (e) => e.system.changes.push(c("system.attributes", "override", "x", 60)), 1)), false);
  for (const key of ["system.tracos", "system.attributes.movement", "system.attributes.movement.*", "system"]) {
    assert.equal(hynneIsCorrect(extra(fixed.hynne, key, "x")), false, key);
  }
  for (const key of ["system.atributos", "system"]) assert.equal(minotaurIsCorrect(extra(fixed.minotaur, key, "x")), false, key);
  assert.equal(senseIsCorrect("penumbra")(extra(fixed.elf, "system.attributes.sentidos.custom", "x")), true);
  assert.equal(hynneIsCorrect(extra(fixed.hynne, "system.attributes.movement.fly", 9)), true);
  assert.equal(hynneIsCorrect(withExtraEffect(fixed.hynne(), passive([c("system.attributes.movement.walk", "override", 6, 60)]))), true);
});

test("outdatedItemIds: owned copies still holding the 1.6.5 data", () => {
  const owned = (src, _id) => ({ _source: { ...structuredClone(src), _id } });
  const items = [
    owned(SENTIDOS_ELFICOS, "PEn3CaxnaMEIAXUR"),
    { _source: { ...fixed.elf(), _id: "FIXEDELF00000000", _stats: { compendiumSource: "Compendium.tormenta20.poderes.Item.PEn3CaxnaMEIAXUR" } } },
    { _source: { ...structuredClone(MINOTAURO), _id: "MINOWORLD0000000", _stats: { compendiumSource: "Compendium.tormenta20.racas.Item.UknA6Hsp6YvqPuuA" } } },
    { _source: { ...structuredClone(PEQUENO_E_RECHONCHUDO), _id: "HYNNEWORLD000000", _stats: { compendiumSource: "Compendium.world.x.Item.fLezjAZcNHYRx7rV" } } },
    owned(PESTE_ESGUIA, "y0onvqs27lHcbJK5")
  ];
  assert.deepEqual(outdatedItemIds(items), ["PEn3CaxnaMEIAXUR", "MINOWORLD0000000"]);
});

test("new actor: the Minotauro is corrected only when no race attributes were applied (duplicated actors keep it)", () => {
  const atributos = (racial) => Object.fromEntries(Object.entries(racial).map(([k, v]) => [k, { base: 0, racial: v, bonus: 0 }]));
  const fresh = { system: { atributos: atributos({ for: 0, des: 0, con: 0, int: 0, sab: 0, car: 0 }) } };
  const duplicated = { system: { atributos: atributos({ for: 2, des: 1, con: 0, int: 0, sab: -1, car: 0 }) } };
  assert.equal(racialUnset(fresh), true);
  assert.equal(racialUnset({}), true);
  assert.equal(racialUnset(duplicated), false);
  const items = [
    { ...structuredClone(MINOTAURO), _id: "MINOTAUROCOPY000", _stats: { compendiumSource: "Compendium.tormenta20.racas.Item.UknA6Hsp6YvqPuuA" } },
    { ...structuredClone(SENTIDOS_ELFICOS), _id: "PEn3CaxnaMEIAXUR" }
  ];
  assert.deepEqual(embeddedItemFixes(items, ENTRIES, fresh).map((f) => f.id), ["MINOTAUROCOPY000", "PEn3CaxnaMEIAXUR"]);
  assert.deepEqual(embeddedItemFixes(items, ENTRIES, duplicated).map((f) => f.id), ["PEn3CaxnaMEIAXUR"]);
  assert.deepEqual(outdatedItemIds(items.map((i) => ({ _source: i }))), ["MINOTAUROCOPY000", "PEn3CaxnaMEIAXUR"]);
});
