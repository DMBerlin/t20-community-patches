import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  COMBATANT_ATTACK,
  ENTRIES,
  combatantLevelIsCorrect,
  combatantLevelIsWrong,
  fixCombatant
} from "../scripts/patches/partner-combatant.mjs";
import {
  classifyEntry,
  embeddedItemFixes,
  fixFor,
  outdatedItemIds,
  outdatedMarker,
  summarize
} from "../scripts/compendium-copy.mjs";
import { applyUpdate, cleanItem, withEffect } from "./fixtures/clean-source.mjs";
import { COMBATENTE } from "./fixtures/partner-combatant-1.6.5.mjs";

const [INICIANTE, VETERANO, MESTRE] = Object.keys(COMBATANT_ATTACK);
const EXTRA = "Q5PEZSKgxKFlG2RJ";
const SYS = "Compendium.tormenta20.parceiros.Item.nNpGA5SWMj7rtUQR";
const WORLD = "Compendium.world.parceiros.Item.nNpGA5SWMj7rtUQR";

const attack = (src) => Object.fromEntries(src.effects.map((e) => [e._id, e.system.changes.map((c) => c.value)]));
const fixed = (src = COMBATENTE) => applyUpdate(src, fixCombatant(src));
const level = (id) => Object.keys(COMBATANT_ATTACK).indexOf(id);
/** A dragged copy: new _id and the system origin recorded by the core. */
const dragged = (src = COMBATENTE, origin = SYS) => ({ ...structuredClone(src), _id: "COPY000000000000", _stats: { ...src._stats, compendiumSource: origin } });

test("patch metadata", () => {
  assert.equal(patch.id, "partner-combatant");
  assert.equal(patch.group, "items");
  assert.equal(patch.issue, 56);
  assert.equal(patch.guarded, true);
  assert.deepEqual(patch.system, { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } });
  assert.deepEqual(patch.isNeeded(), { bug: "unknown", confidence: "low", evidence: "compendium data can only be read after ready" });
});

test("fixCombatant: the 1.6.5 pack gets +2/+3/+4, as numbers, and the extra attack effect is untouched", () => {
  const out = fixed();
  assert.deepEqual(attack(COMBATENTE), { [INICIANTE]: [1], [VETERANO]: [2], [MESTRE]: [3], [EXTRA]: [] });
  assert.deepEqual(attack(out), { [INICIANTE]: [2], [VETERANO]: [3], [MESTRE]: [4], [EXTRA]: [] });
  for (const id of [INICIANTE, VETERANO, MESTRE]) assert.equal(typeof out.effects[level(id)].system.changes[0].value, "number");
  // Nothing else changes: every effect keeps its _id, and the other fields stay equal.
  const strip = (src) => src.effects.map((e) => ({ ...e, system: { ...e.system, changes: e.system.changes.map(({ value, ...c }) => c) } }));
  assert.deepEqual(strip(out), strip(cleanItem(COMBATENTE)));
  assert.equal(fixCombatant(out), null);
});

test("fixCombatant: a text value stays text", () => {
  const src = withEffect(COMBATENTE, (e) => (e.system.changes[0].value = "1"));
  assert.equal(fixed(src).effects[0].system.changes[0].value, "2");
});

test("fixCombatant: each level is corrected on its own (partial system fix)", () => {
  const set = (src, id, value) => withEffect(src, (e) => (e.system.changes[0].value = value), level(id));
  const novice = set(COMBATENTE, INICIANTE, 2);
  assert.deepEqual(attack(fixed(novice)), { [INICIANTE]: [2], [VETERANO]: [3], [MESTRE]: [4], [EXTRA]: [] });
  const two = set(novice, VETERANO, 3);
  const update = fixCombatant(two);
  assert.deepEqual(attack(applyUpdate(two, update)), { [INICIANTE]: [2], [VETERANO]: [3], [MESTRE]: [4], [EXTRA]: [] });
  assert.deepEqual(update.effects.slice(0, 2), two.effects.slice(0, 2));
  assert.equal(fixCombatant(set(two, MESTRE, 4)), null);
});

const EDITS = {
  "type multiply": (e) => (e.system.changes[0].type = "multiply"),
  "value 5": (e) => (e.system.changes[0].value = 5),
  "phase final": (e) => (e.system.changes[0].phase = "final"),
  "priority null": (e) => (e.system.changes[0].priority = null),
  "priority missing": (e) => delete e.system.changes[0].priority,
  "other key": (e) => (e.system.changes[0].key = "dano"),
  "extra change": (e) => e.system.changes.push({ key: "dano", type: "add", value: 1, priority: 0, phase: "initial" }),
  "no change": (e) => (e.system.changes = []),
  "disabled false": (e) => (e.disabled = false),
  "transfer true": (e) => (e.transfer = true),
  "onuse false": (e) => (e.system.onuse = false),
  statuses: (e) => (e.statuses = ["prone"]),
  targets: (e) => (e.system.targets = ["self"]),
  status: (e) => (e.system.status = { category: "x" }),
  "abilityUse.automatic": (e) => (e.system.abilityUse.automatic = true),
  "abilityUse.aumenta": (e) => (e.system.abilityUse.aumenta = true),
  "abilityUse.custo 1": (e) => (e.system.abilityUse.custo = 1),
  "abilityUse.names": (e) => (e.system.abilityUse.names = ["Ataque"]),
  "abilityUse.types skill": (e) => (e.system.abilityUse.types = ["skill"]),
  "aura.isAura": (e) => (e.system.aura.isAura = true),
  "aura.range": (e) => (e.system.aura.range = 3),
  "aura.behaviors": (e) => (e.system.aura.behaviors = { a: { type: "applyActiveEffect" } }),
  identifier: (e) => (e.system.identifier = "combatente"),
  "upgrade.type": (e) => (e.system.upgrade.type = "enchantment"),
  "upgrade.itemType": (e) => (e.system.upgrade.itemType = ["arma"]),
  "duration.value": (e) => (e.duration.value = 1),
  "duration.units": (e) => (e.duration.units = "rounds"),
  "duration.expiry null": (e) => (e.duration.expiry = null),
  "other name": (e) => (e.name = "Combatente Iniciante")
};

test("fixCombatant: an edited effect is left alone and the others are corrected", () => {
  for (const [label, edit] of Object.entries(EDITS)) {
    const src = withEffect(COMBATENTE, edit, level(VETERANO));
    const out = applyUpdate(src, fixCombatant(src));
    assert.deepEqual(out.effects[1], src.effects[1], label);
    assert.deepEqual(attack(out)[INICIANTE], [2], label);
    assert.deepEqual(attack(out)[MESTRE], [4], label);
  }
});

test("fixCombatant: another item name or type is never corrected", () => {
  assert.equal(fixCombatant({ ...structuredClone(COMBATENTE), name: "Combatente (homebrew)" }), null);
  assert.equal(fixCombatant({ ...structuredClone(COMBATENTE), type: "magia" }), null);
  assert.equal(fixCombatant({}), null);
});

test("origin: system copy and Import all are corrected; another compendium is not", () => {
  assert.ok(fixFor(dragged(), ENTRIES, "Item"));
  assert.ok(fixFor(cleanItem(COMBATENTE), ENTRIES, "Item"));
  assert.equal(fixFor(dragged(COMBATENTE, WORLD), ENTRIES, "Item"), null);
  const legacy = { ...dragged(COMBATENTE, WORLD), flags: { core: { sourceId: SYS } } };
  assert.equal(fixFor(legacy, ENTRIES, "Item"), null);
  assert.equal(fixFor(dragged(COMBATENTE, "Compendium.tormenta20.poderes.Item.nNpGA5SWMj7rtUQR"), ENTRIES, "Item"), null);
  assert.equal(fixFor({ ...structuredClone(COMBATENTE), _id: "OTHER00000000000" }, ENTRIES, "Item"), null);
});

test("embedded items of a new actor are corrected by id", () => {
  const items = [dragged(), dragged(fixed()), dragged(COMBATENTE, WORLD)];
  items[1]._id = "COPY000000000001";
  items[2]._id = "COPY000000000002";
  const fixes = embeddedItemFixes(items, ENTRIES, {});
  assert.deepEqual(fixes.map((f) => f.id), ["COPY000000000000"]);
});

test("diagnosis: each level on its own", () => {
  const [entry] = ENTRIES;
  const states = (src) => classifyEntry(entry, src).map((r) => r.state);
  const names = classifyEntry(entry, COMBATENTE).map((r) => r.name);
  assert.deepEqual(names, ["Combatente (Iniciante)", "Combatente (Veterano)", "Combatente (Mestre)"]);

  assert.deepEqual(states(COMBATENTE), ["present", "present", "present"]);
  assert.deepEqual(summarize(classifyEntry(entry, COMBATENTE)).confidence, "high");
  assert.equal(summarize(classifyEntry(entry, COMBATENTE)).bug, "present");

  const book = fixed();
  assert.deepEqual(states(book), ["fixed", "fixed", "fixed"]);
  assert.deepEqual(summarize(classifyEntry(entry, book)), { bug: "fixed", confidence: "high", evidence: "every known entry holds the rulebook data" });
  assert.ok(entry.isCorrect(book));

  const novice = withEffect(COMBATENTE, (e) => (e.system.changes[0].value = 2));
  assert.deepEqual(states(novice), ["fixed", "present", "present"]);
  assert.equal(summarize(classifyEntry(entry, novice)).confidence, "high");

  const multiply = withEffect(COMBATENTE, (e) => (e.system.changes[0].type = "multiply"));
  assert.deepEqual(states(multiply), ["unknown", "present", "present"]);
  assert.deepEqual(
    [summarize(classifyEntry(entry, multiply)).bug, summarize(classifyEntry(entry, multiply)).confidence],
    ["present", "low"]
  );
  assert.equal(applyUpdate(multiply, fixCombatant(multiply)).effects[0].system.changes[0].type, "multiply");

  const noMaster = cleanItem({ ...structuredClone(COMBATENTE), effects: COMBATENTE.effects.filter((e) => e._id !== MESTRE) });
  assert.deepEqual(states(noMaster), ["present", "present", "unknown"]);
  assert.equal(summarize(classifyEntry(entry, noMaster)).confidence, "low");

  assert.deepEqual(states(undefined), ["missing", "missing", "missing"]);
  assert.deepEqual([summarize(classifyEntry(entry, undefined)).bug, summarize(classifyEntry(entry, undefined)).confidence], ["unknown", "low"]);
});

test("level predicates", () => {
  assert.ok(combatantLevelIsWrong(COMBATENTE, MESTRE));
  assert.ok(!combatantLevelIsCorrect(COMBATENTE, MESTRE));
  assert.ok(combatantLevelIsCorrect(fixed(), MESTRE));
  assert.ok(!combatantLevelIsWrong(fixed(), MESTRE));
});

test("outdated items: only old system copies still holding the 1.6.5 effects", () => {
  const old = dragged();
  const corrected = { ...dragged(fixed()), _id: "COPY000000000001" };
  const foreign = { ...dragged(COMBATENTE, WORLD), _id: "COPY000000000002" };
  const edited = { ...dragged(withEffect(COMBATENTE, (e) => (e.system.changes[0].value = 7))), _id: "COPY000000000003" };
  assert.deepEqual(outdatedItemIds([{ _source: old }, corrected, foreign, edited], ENTRIES), ["COPY000000000000", "COPY000000000003"]);
});

test("outdatedMarker: marks the rows of the outdated items once, and fails safe", (t) => {
  const created = [];
  globalThis.document ??= { createElement: () => ({ dataset: {}, setAttribute() {} }) };
  t.mock.method(globalThis.document, "createElement", () => {
    const icon = { dataset: {}, attributes: {}, setAttribute: (k, v) => (icon.attributes[k] = v) };
    created.push(icon);
    return icon;
  });
  globalThis.game ??= {};
  const prevI18n = game.i18n;
  game.i18n = { localize: (key) => `L(${key})` };
  t.after(() => (game.i18n = prevI18n));

  const row = (id) => {
    const children = [];
    return { id, children, querySelector: (sel) => (sel === ".t20cp-outdated" ? children[0] ?? null : null), append: (el) => children.push(el) };
  };
  const rows = [row("COPY000000000000"), row("COPY000000000001")];
  const root = { querySelectorAll: (sel) => rows.filter((r) => sel === `[data-item-id="${r.id}"]`) };
  const items = [dragged(), { ...dragged(fixed()), _id: "COPY000000000001" }];
  const hook = outdatedMarker(ENTRIES, "T20CP.PartnerCombatant.Outdated", "partner-combatant");

  hook({ actor: { items } }, [root]);
  hook({ actor: { items } }, [root]);
  assert.equal(rows[0].children.length, 1);
  assert.equal(rows[1].children.length, 0);
  assert.equal(created.length, 1);
  assert.equal(created[0].dataset.tooltip, "L(T20CP.PartnerCombatant.Outdated)");

  t.mock.method(console, "warn", () => {});
  assert.doesNotThrow(() => hook({ actor: { items } }, [{ querySelectorAll: () => { throw new Error("boom"); } }]));
  assert.doesNotThrow(() => hook({}, null));
});

/** What the system ready hook leaves when a usage effect _id repeats on the actor: same data, new _id. */
const renumber = (src, ids = [INICIANTE, VETERANO, MESTRE, EXTRA]) => {
  const copy = structuredClone(src);
  for (const e of copy.effects) if (ids.includes(e._id)) e._id = `NEW${e._id.slice(3)}`;
  return copy;
};

test("renumbered effects (system duplicate-id fix) are recognized by their data and keep their new _id", () => {
  const src = dragged(renumber(COMBATENTE));
  const out = applyUpdate(src, fixCombatant(src));
  assert.deepEqual(out.effects.map((e) => e._id), src.effects.map((e) => e._id));
  assert.deepEqual(out.effects.map((e) => e.system.changes.map((c) => c.value)), [[2], [3], [4], []]);
  assert.equal(fixCombatant(out), null);
  assert.deepEqual(classifyEntry(ENTRIES[0], out).map((r) => r.state), ["fixed", "fixed", "fixed"]);
  assert.deepEqual(outdatedItemIds([src], ENTRIES), ["COPY000000000000"]);
  assert.deepEqual(embeddedItemFixes([src], ENTRIES, {}).map((f) => f.id), ["COPY000000000000"]);
});

test("renumbered effects: the whole set decides; partial or ambiguous sets are left alone", () => {
  const values = (src) => src.effects.map((e) => e.system.changes.map((c) => c.value));
  const fix = (src) => applyUpdate(src, fixCombatant(src));
  // Iniciante already +2 after renumbering: +2/+2/+3 cannot be told apart, so nothing changes.
  const partial = renumber(withEffect(COMBATENTE, (e) => (e.system.changes[0].value = 2)));
  assert.equal(fixCombatant(partial), null);
  assert.deepEqual(classifyEntry(ENTRIES[0], partial).map((r) => r.state), ["unknown", "unknown", "unknown"]);
  // One level edited to +7: the set is incomplete, nothing changes.
  assert.equal(fixCombatant(renumber(withEffect(COMBATENTE, (e) => (e.system.changes[0].value = 7), level(MESTRE)))), null);
  // A repeated level: not exactly one of each.
  const twice = renumber(COMBATENTE);
  const again = cleanItem({ ...twice, effects: [...twice.effects, { ...structuredClone(twice.effects[0]), _id: "NEW2tJE9twft7P06" }] });
  assert.equal(fixCombatant(again), null);
  // An own level id present: only that id counts for its level, never a renumbered lookalike.
  const edited = withEffect(COMBATENTE, (e) => (e.system.changes[0].value = 7), level(VETERANO));
  const lookalike = { ...structuredClone(COMBATENTE.effects[level(VETERANO)]), _id: "NEWVETERANO00000" };
  const mixed = cleanItem({ ...edited, effects: [...edited.effects, lookalike] });
  assert.deepEqual(values(fix(mixed)), [[2], [7], [4], [], [2]]);
});
