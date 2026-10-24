import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appliedGrant,
  isTrainedFor,
  isTrainedOnlySkill,
  plainUseEffect,
  skillUseEffects,
  trainingGrantKind,
  trainingGrants
} from "../scripts/rules/skill-training.mjs";
import { automaticApplied } from "../scripts/rules/mana-limit.mjs";

const CONFIG_PERICIAS = { mist: { trainedOnly: true }, atle: {}, ladi: { trainedOnly: true } };

const ECLETICO = { key: "roll", type: "add", value: "@treino" };
const CULTURA = { key: "treinado", type: "override", value: true };

/** Usage effect in the shape of the system's ActiveEffect. */
function useEffect({ id, name = id, automatic = false, custo = 1, changes = [], parent = null, names = [] }) {
  return {
    documentName: "ActiveEffect",
    id,
    name,
    parent,
    isTemporary: false,
    system: { onuse: true, abilityUse: { automatic, custo, types: new Set(["skill"]), names: new Set(names) }, changes }
  };
}

test("isTrainedOnlySkill: the system's config or the actor's st", () => {
  assert.equal(isTrainedOnlySkill("mist", { st: false }, CONFIG_PERICIAS), true);
  assert.equal(isTrainedOnlySkill("atle", { st: false }, CONFIG_PERICIAS), false);
  assert.equal(isTrainedOnlySkill("ofi1", { st: true }, CONFIG_PERICIAS), true);
  assert.equal(isTrainedOnlySkill("_pc1", { st: false }, CONFIG_PERICIAS), false);
  assert.equal(isTrainedOnlySkill("atle", { st: true }, CONFIG_PERICIAS), true);
});

test("plainUseEffect normalizes an ActiveEffect for automaticApplied", () => {
  const ef = useEffect({ id: "e1", name: "Eclético", automatic: true, custo: 1, changes: [ECLETICO] });
  const plain = plainUseEffect(ef);
  assert.deepEqual(plain, { id: "e1", name: "Eclético", automatic: true, custo: 1, changes: [ECLETICO] });
  assert.deepEqual(automaticApplied([plain]), { e1: { aplica: 1, custo: 1 } });
  // The raw ActiveEffect has no top-level `automatic`: it would be ignored.
  assert.deepEqual(automaticApplied([ef]), {});
  const bare = plainUseEffect({ id: "x", name: "X", system: {} });
  assert.equal(bare.automatic, false);
  assert.equal(bare.custo, 0);
});

test("trainingGrantKind recognizes only the exact shapes of Cultura Exótica and Eclético", () => {
  const kind = (ch) => trainingGrantKind([ch]);
  assert.equal(kind(CULTURA), "ignore");
  assert.equal(kind({ ...CULTURA, value: "true" }), "ignore");
  assert.equal(kind({ ...CULTURA, value: " TRUE " }), "ignore");
  assert.equal(kind(ECLETICO), "bonus");
  assert.equal(kind({ ...ECLETICO, value: "+@treino" }), "bonus");
  assert.equal(kind({ ...ECLETICO, value: " @treino " }), "bonus");
  assert.equal(kind({ ...ECLETICO, value: "+ @treino" }), "bonus");

  for (const ch of [
    { ...CULTURA, value: "false" },
    { ...CULTURA, value: false },
    { ...CULTURA, value: "1" },
    { ...CULTURA, type: "add" },
    { ...ECLETICO, value: "-@treino" },
    { ...ECLETICO, type: "multiply" },
    { ...ECLETICO, value: "0 * @treino" },
    { ...ECLETICO, value: "@treino + 2" },
    { ...ECLETICO, value: "@treinoExtra" },
    { ...ECLETICO, value: "+2" }
  ]) {
    assert.equal(kind(ch), null, JSON.stringify(ch));
  }
  assert.equal(trainingGrantKind(undefined), null);
});

test("trainingGrants keeps only the grants with automatic, custo and kind", () => {
  const effects = [
    useEffect({ id: "e", name: "Eclético", automatic: true, changes: [ECLETICO] }),
    useEffect({ id: "o", name: "Outro", changes: [{ key: "roll", type: "add", value: "2" }] }),
    useEffect({ id: "c", name: "Cultura Exótica", changes: [CULTURA] })
  ].map(plainUseEffect);
  assert.deepEqual(trainingGrants(effects), [
    { id: "e", name: "Eclético", automatic: true, custo: 1, kind: "bonus" },
    { id: "c", name: "Cultura Exótica", automatic: false, custo: 1, kind: "ignore" }
  ]);
});

test("appliedGrant follows the system's aplica truthiness", () => {
  const grants = [{ id: "e", kind: "bonus" }];
  assert.equal(appliedGrant(grants, { e: { aplica: 1 } }), grants[0]);
  assert.equal(appliedGrant(grants, { e: { aplica: true } }), grants[0]);
  assert.equal(appliedGrant(grants, { e: { aplica: 0 } }), null);
  assert.equal(appliedGrant(grants, { e: { aplica: false } }), null);
  assert.equal(appliedGrant(grants, {}), null);
  assert.equal(appliedGrant(grants, { x: { aplica: 1 } }), null);
});

test("isTrainedFor: requirement, real training and applied grants", () => {
  const config = CONFIG_PERICIAS;
  assert.deepEqual(isTrainedFor({ key: "atle", skill: {}, config }), { required: false, trained: true, grant: null });
  assert.deepEqual(isTrainedFor({ key: "mist", skill: { treinado: 1 }, config }), { required: true, trained: true, grant: null });
  assert.deepEqual(isTrainedFor({ key: "mist", skill: { treinado: 0 }, config }), { required: true, trained: false, grant: null });
  const grants = [{ id: "e", kind: "bonus", custo: 1 }];
  const result = isTrainedFor({ key: "mist", skill: { treinado: 0 }, config, grants, applied: { e: { aplica: 1 } } });
  assert.equal(result.trained, true);
  assert.equal(result.grant.kind, "bonus");
});

test("combined with #46: only an automatic grant counts outside the skill dialog", () => {
  const config = CONFIG_PERICIAS;
  const mist = { treinado: 0, st: true };
  const check = (effect) => {
    const grants = trainingGrants([plainUseEffect(effect)]);
    return isTrainedFor({ key: "mist", skill: mist, config, grants, applied: automaticApplied(grants) });
  };
  const bardo = check(useEffect({ id: "e", name: "Eclético", automatic: true, changes: [ECLETICO] }));
  assert.equal(bardo.trained, true);
  assert.deepEqual({ kind: bardo.grant.kind, custo: bardo.grant.custo }, { kind: "bonus", custo: 1 });
  assert.equal(check(useEffect({ id: "e", name: "Eclético", automatic: false, changes: [ECLETICO] })).trained, false);
  const forasteiro = check(useEffect({ id: "c", name: "Cultura Exótica", automatic: true, changes: [CULTURA] }));
  assert.equal(forasteiro.trained, true);
  assert.equal(forasteiro.grant.kind, "ignore");
});

test("skillUseEffects collects like rollPericia and drops suppressed item effects only when #4 is applied", () => {
  const sheathed = { documentName: "Item", id: "flauta", areEffectsSuppressed: true };
  const fromItem = useEffect({ id: "i", changes: [ECLETICO], parent: sheathed });
  const own = useEffect({ id: "a", changes: [ECLETICO] });
  const other = useEffect({ id: "n", changes: [ECLETICO], names: ["Atletismo"] });
  const temporaryOnItem = { ...useEffect({ id: "t", changes: [ECLETICO] }), isTemporary: true };
  const actor = {
    system: { pericias: { ladi: { label: "Ladinagem" } } },
    traverseEmbeddedDocuments: () =>
      [
        ["effects", own],
        ["items.effects", fromItem],
        ["items.effects", other],
        ["items.effects", temporaryOnItem]
      ][Symbol.iterator]()
  };
  const status = [];
  globalThis.game = { modules: { get: () => ({ api: { status } }) } };
  try {
    assert.deepEqual(skillUseEffects(actor, "ladi").map((ef) => ef.id), ["a", "i"]);
    status.push({ id: "suppressed-usage-effects", state: "applied" });
    assert.deepEqual(skillUseEffects(actor, "ladi").map((ef) => ef.id), ["a"]);
    assert.deepEqual(skillUseEffects(actor, "nope"), []);
  } finally {
    delete globalThis.game;
  }
});
