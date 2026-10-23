import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PENDING,
  buffFamily,
  isBuffTemplate,
  increaseMarkers,
  isForOtherWeapon,
  isZeroPlaceholder,
  linkedTemplateValues,
  mergeDiceChange,
  needsAttackType,
  planWeaponChoice,
  skillAttributeKey,
  templateLabels,
  weaponBinding
} from "../scripts/patches/usage-buff-templates.mjs";

const template = (over = {}) => ({ onuse: true, temporary: true, disabled: true, name: "Arma Mágica", description: "", names: [], ...over });

test("disabled temporary usage templates are buffs; enabled ones (Profanar) and other effects are not", () => {
  assert.equal(isBuffTemplate(template(), { itemName: "Arma Mágica" }), true);
  assert.equal(isBuffTemplate(template({ disabled: false, name: "Profanar - Dano" }), { itemName: "Profanar" }), false);
  assert.equal(isBuffTemplate(template({ temporary: false }), { itemName: "Arma Mágica" }), false);
  assert.equal(isBuffTemplate(template({ onuse: false }), { itemName: "Arma Mágica" }), false);
});

test("templates reached through an efeito change (Esgrima Mágica) or re-offered on their own item are skipped", () => {
  const linked = linkedTemplateValues([
    { system: { changes: [{ key: "efeito", value: " Inspiração (Esgrima Mágica) " }, { key: "efeito.dano", value: ":1d8" }] } }
  ]);
  assert.deepEqual([...linked], ["Inspiração (Esgrima Mágica)"]);
  const esgrima = template({ name: "Esgrima Mágica", description: "<p>Inspiração (Esgrima Mágica)</p>" });
  assert.equal(isBuffTemplate(esgrima, { itemName: "Esgrima Mágica", linked }), false);
  assert.equal(isBuffTemplate(template({ name: "Inspiração (Esgrima Mágica)" }), { itemName: "X", linked }), false);
  const espiritual = template({ name: "Arma Espiritual2", names: new Set(["Arma Espiritual"]) });
  assert.equal(isBuffTemplate(espiritual, { itemName: "Arma Espiritual" }), false);
  assert.equal(isBuffTemplate(template({ name: "Marca da Presa" }), { itemName: "Marca da Presa", linked }), true);
});

test("buffFamily: weapon choice, only system.* changes, or roll changes", () => {
  assert.equal(buffFamily([{ key: "ataque" }, { key: "dano&magico" }, { key: "?.items.arma" }]), "weapon");
  assert.equal(buffFamily([{ key: "system.attributes.movement.fly.base" }]), "passive");
  assert.equal(buffFamily([{ key: "system.attributes.defesa.bonus" }, { key: "dano" }]), "usage");
  assert.equal(buffFamily([{ key: "ataque" }, { key: "dano" }]), "usage");
  assert.equal(buffFamily([]), "usage");
});

test("templateLabels keeps unique names and tells repeated ones apart by description or position", () => {
  const labels = templateLabels([
    { id: "a", name: "Animar Objetos", description: "<p>Assassino Iniciante</p>" },
    { id: "b", name: "Animar Objetos", description: "Combatente Iniciante" },
    { id: "c", name: "Combatente", description: "Combatente Mestre" },
    { id: "d", name: "Combatente", description: "Combatente Mestre" },
    { id: "e", name: "Combatente", description: "" },
    { id: "f", name: "Duelo", description: "x" }
  ]);
  assert.equal(labels.get("a"), "Animar Objetos (Assassino Iniciante)");
  assert.equal(labels.get("b"), "Animar Objetos (Combatente Iniciante)");
  assert.equal(labels.get("c"), "Combatente (1)");
  assert.equal(labels.get("d"), "Combatente (2)");
  assert.equal(labels.get("e"), "Combatente (3)");
  assert.equal(labels.get("f"), "Duelo");
});

test("only an enabled non-usage effect named like a template with all-zero changes is a placeholder", () => {
  const names = new Set(["Botas Aladas"]);
  const zero = { onuse: false, disabled: false, name: "Botas Aladas", changes: [{ value: "0" }] };
  assert.equal(isZeroPlaceholder(zero, names), true);
  assert.equal(isZeroPlaceholder({ ...zero, changes: [{ value: "0" }, { value: "2" }] }, names), false);
  assert.equal(isZeroPlaceholder({ ...zero, changes: [{ value: "" }] }, names), false);
  assert.equal(isZeroPlaceholder({ ...zero, changes: [] }, names), false);
  assert.equal(isZeroPlaceholder({ ...zero, name: "Profanar - Bônus" }, names), false);
  assert.equal(isZeroPlaceholder({ ...zero, onuse: true }, names), false);
  assert.equal(isZeroPlaceholder({ ...zero, disabled: true }, names), false);
});

test("planWeaponChoice picks the only wielded weapon and otherwise lists wielded weapons first", () => {
  assert.deepEqual(planWeaponChoice([]), { none: true });
  assert.deepEqual(planWeaponChoice([{ id: "a", name: "Adaga" }, { id: "e", name: "Espada", wielded: true }]), { auto: "e" });
  assert.deepEqual(planWeaponChoice([{ id: "a", name: "Adaga" }]).choices.map((w) => w.id), ["a"]);
  const two = planWeaponChoice([{ id: "a", name: "Adaga" }, { id: "e", name: "Espada", wielded: true }, { id: "m", name: "Maça", wielded: true }]);
  assert.deepEqual(two.choices.map((w) => w.id), ["e", "m", "a"]);
});

test("weaponBinding restricts the buff to the weapon, makes it automatic and drops the ? change", () => {
  const changes = [{ key: "ataque", value: "2" }, { key: "dano", value: "2" }, { key: "?.items.arma", value: "items.name" }];
  const update = weaponBinding({ name: "Arma Mágica", changes }, { id: "w1", name: "Espada Longa" });
  assert.equal(update.name, "Arma Mágica (Espada Longa)");
  assert.deepEqual(update["system.abilityUse.names"], ["Espada Longa"]);
  assert.deepEqual(update["system.abilityUse.types"], []);
  assert.equal(update["system.abilityUse.automatic"], true);
  assert.deepEqual(update["system.changes"].map((c) => c.key), ["ataque", "dano"]);
  assert.equal(update["flags.t20-community-patches.buffWeapon"], "w1");
});

test("a weapon buff is skipped on every other weapon, even after the bound one is gone", () => {
  assert.equal(isForOtherWeapon("w1", "w2"), true);
  assert.equal(isForOtherWeapon("w1", "w1"), false);
  assert.equal(isForOtherWeapon(PENDING, "w2"), false);
  assert.equal(isForOtherWeapon(undefined, "w2"), false);
});

test("Duelo's efeito.* enhancement gets a +0 marker so the card can raise the template", () => {
  const template = [{ key: "ataque", type: "add", value: 2 }, { key: "dano", type: "add", value: 2 }];
  const increase = [{ key: "efeito.ataque", type: "add", value: 1 }, { key: "efeito.dano", type: "add", value: 1 }];
  assert.deepEqual(increaseMarkers(template, increase).map((m) => [m.key, m.value]), [["efeito.ataque", 0], ["efeito.dano", 0]]);
  assert.deepEqual(increaseMarkers([...template, { key: "efeito.ataque", type: "add", value: 0 }], increase).map((m) => m.key), ["efeito.dano"]);
  assert.deepEqual(increaseMarkers([{ key: "dano", type: "add", value: "1d6" }], increase), [], "dice would sum to NaN");
  assert.deepEqual(increaseMarkers(template, [{ key: "ataque", type: "add", value: 1 }]), [], "plain keys already match");
  assert.deepEqual(increaseMarkers(template, [{ key: "efeito.pericia", type: "add", value: 1 }]), []);
});

test("an attack template without types or names (Comandar) is meant for attacks", () => {
  const changes = [{ key: "ataque", value: 4 }, { key: "dano", value: 4 }];
  assert.equal(needsAttackType({ types: [], names: [], changes }), true);
  assert.equal(needsAttackType({ types: ["attack"], names: [], changes }), false);
  assert.equal(needsAttackType({ types: [], names: ["Espada"], changes }), false);
  assert.equal(needsAttackType({ types: [], names: [], changes: [] }), false);
  assert.equal(needsAttackType({ types: [], names: [], changes: [{ key: "dano&magico" }] }), true);
});

test("Folião's skill attribute key points at the field the system reads", () => {
  assert.equal(skillAttributeKey("system.modificadores.pericias.car"), "system.modificadores.pericias.atr.car");
  assert.equal(skillAttributeKey("system.modificadores.pericias.atr.car"), "system.modificadores.pericias.atr.car");
  assert.equal(skillAttributeKey("system.modificadores.pericias.geral"), "system.modificadores.pericias.geral");
});

test("dice appended by enhancements merge into one formula instead of summing to NaN", () => {
  const changes = [{ key: "ataque", type: "add", value: 1 }, { key: "dano&magico", type: "add", value: 1 }];
  assert.equal(mergeDiceChange(changes, { key: "dano", type: "add", value: "1d6" }), false);
  changes.push({ key: "dano", type: "add", value: "1d6" });
  assert.equal(mergeDiceChange(changes, { key: "dano", type: "add", value: "1d6" }), true);
  assert.equal(changes.at(-1).value, "1d6 + 1d6");
  assert.equal(mergeDiceChange(changes, { key: "ataque", type: "add", value: 1 }), false, "numbers keep the system sum");
  assert.equal(mergeDiceChange(changes, { key: "dano", type: "custom", value: "1d6" }), false);
  const numeric = [{ key: "dano", type: "add", value: 2 }];
  assert.equal(mergeDiceChange(numeric, { key: "dano", type: "add", value: "1d6" }), true);
  assert.equal(numeric[0].value, "2 + 1d6");
});
