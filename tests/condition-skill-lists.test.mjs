import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  conditionAbilities,
  diagnoseConditionLists,
  keyAbility,
  planConditionChanges,
  skillRepresentation
} from "../scripts/patches/condition-skill-lists.mjs";
import { isSystemVersionAffected, statusEffectSources } from "../scripts/utils.mjs";

// Key attribute of each skill in Tormenta20 1.6.5 (CONFIG.T20.pericias[key].abl, T20:3411-3447).
const ABL = {
  acro: "des", ades: "car", atle: "for", atua: "car", cava: "des", conh: "int", cura: "sab", dipl: "car", enga: "car",
  fort: "con", furt: "des", guer: "int", inic: "des", inti: "car", intu: "sab", inve: "int", joga: "car", ladi: "des",
  luta: "for", mist: "int", nobr: "int", perc: "sab", pilo: "des", pont: "des", refl: "des", reli: "sab", sobr: "sab",
  vont: "sab", alfa: "int", alqu: "int", arme: "int", arte: "int", cozi: "int", enge: "int"
};
const SKILL_CONFIG = Object.fromEntries(Object.entries(ABL).map(([id, abl]) => [id, { abl }]));
const OFICIOS = ["alfa", "alqu", "arme", "arte", "cozi", "enge"];
const PHYSICAL = ["acro", "atle", "cava", "fort", "furt", "inic", "luta", "pilo", "pont", "refl"];
const MENTAL = ["ades", "atua", "conh", "cura", "dipl", "enga", "guer", "inti", "intu", "inve", "joga", "mist", "nobr", "perc", "reli", "sobr", "vont"];

const change = (key, value, type = "downgrade", extra = {}) => ({ key, value, type, phase: "initial", priority: type === "add" ? 10 : type === "override" ? 50 : 30, ...extra });
const penalty = (ids, value, extra) => ids.map((id) => change(`system.pericias.${id}.condi`, value, "downgrade", extra));
const ability = (ids, value) => ids.map((id) => change(`system.modificadores.atributos.${id}`, value, "add"));
// Changes of the 1.6.5 conditions (T20Conditions and the tormenta20.efeitos pack are identical).
const CONDITIONS = {
  cego: penalty(PHYSICAL.filter((id) => id !== "fort"), -5),
  fraco: [...ability(["for", "des", "con"], -2), ...penalty(PHYSICAL, -2)],
  debilitado: [...ability(["for", "des", "con"], -5), ...penalty(PHYSICAL, -5)],
  frustrado: [...ability(["int", "sab", "car"], -2), ...penalty(MENTAL, -2)],
  esmorecido: [...ability(["int", "sab", "car"], -5), ...penalty(MENTAL, -5)]
};
const effect = (status, changes) => ({ statuses: new Set([status]), changes });

/** Actor with the system's skills (current attribute = table attribute) plus optional extra/changed skills. */
function makeActor(skillOverrides = {}) {
  const pericias = Object.fromEntries(Object.entries(ABL).map(([id, atributo]) => [id, { atributo, condi: 0 }]));
  for (const [id, atributo] of Object.entries(skillOverrides)) pericias[id] = { atributo, condi: 0 };
  return { pericias, modificadores: { pericias: { atr: { for: [], des: [], con: [], int: [], sab: [], car: [] } } } };
}

/**
 * Mirrors Actor#applyActiveEffects (core actor.mjs:211-262) for one phase, with the patch's plan when `patched`:
 * shouldApplyChange filter, stable sort by priority, then downgrade/add/override.
 */
function runPhase(actor, effects, phase, { patched = true, shouldApply = (c) => c.phase === phase } = {}) {
  const all = [];
  for (const ef of effects) {
    const plan = patched
      ? planConditionChanges({ statuses: ef.statuses, changes: ef.changes, skills: actor.pericias, skillConfig: SKILL_CONFIG, isEligible: shouldApply })
      : null;
    for (const c of plan?.changes ?? ef.changes) if (shouldApply(c)) all.push({ ...c });
  }
  all.sort((a, b) => a.priority - b.priority);
  for (const c of all) {
    const path = c.key.replace(/^system\./, "").split(".");
    const last = path.pop();
    const target = path.reduce((o, k) => (o[k] ??= {}), actor);
    if (c.type === "downgrade") target[last] = Math.min(target[last] ?? 0, Number(c.value));
    else if (c.type === "override") target[last] = Number(c.value);
    else if (Array.isArray(target[last])) target[last].push(Number(c.value));
    else target[last] = (target[last] ?? 0) + Number(c.value);
  }
  return actor;
}

/** Condition part of a skill total as T20 prepareSkill builds it (T20:19847-19865): condi + atr[current attribute]. */
const total = (actor, id) => {
  const skill = actor.pericias[id];
  return skill.condi + actor.modificadores.pericias.atr[skill.atributo].reduce((a, b) => a + b, 0);
};
const apply = (effects, opts, overrides) => {
  const actor = makeActor(overrides);
  runPhase(actor, effects, "initial", opts);
  runPhase(actor, effects, "final", opts);
  return actor;
};
const added = (status, overrides) =>
  planConditionChanges({ statuses: [status], changes: CONDITIONS[status], skills: makeActor(overrides).pericias, skillConfig: SKILL_CONFIG })
    ?.added.map((k) => k.split(".")[2]).sort();

test("1.6.5 lists: Ladinagem in the physical conditions, the Ofícios in the mental ones", () => {
  assert.deepEqual(added("cego"), ["ladi"]);
  assert.deepEqual(added("fraco"), ["ladi"]);
  assert.deepEqual(added("debilitado"), ["ladi"]);
  assert.deepEqual(added("frustrado"), OFICIOS);
  assert.deepEqual(added("esmorecido"), OFICIOS);
  assert.equal(total(apply([effect("cego", CONDITIONS.cego)]), "ladi"), -5);
  assert.equal(total(apply([effect("cego", CONDITIONS.cego)], { patched: false }), "ladi"), 0);
  assert.equal(total(apply([effect("frustrado", CONDITIONS.frustrado)]), "alqu"), -2);
});

test("conditions do not stack: Fraco with Debilitado gives -5, not -7", () => {
  const actor = apply([effect("fraco", CONDITIONS.fraco), effect("debilitado", CONDITIONS.debilitado)]);
  assert.equal(total(actor, "ladi"), -5);
  assert.equal(total(actor, "acro"), -5);
});

test("key attribute: system table for system skills, stored attribute for custom skills; ofic is ignored", () => {
  assert.equal(keyAbility("atle", { atributo: "car" }, SKILL_CONFIG), "for");
  assert.equal(keyAbility("_pc1", { atributo: "des" }, SKILL_CONFIG), "des");
  const overrides = { ofi1: "int", _pc1: "des", ofic: "int", atle: "car" };
  assert.deepEqual(added("frustrado", overrides), [...OFICIOS, "ofi1"].sort());
  assert.deepEqual(added("cego", overrides), ["_pc1", "ladi"]);
  const frustrated = apply([effect("frustrado", CONDITIONS.frustrado)], {}, overrides);
  assert.equal(total(frustrated, "atle"), 0); // Atletismo is a Força skill even when rolled with Carisma
  assert.equal(total(frustrated, "ofi1"), -2);
  assert.equal(total(apply([effect("cego", CONDITIONS.cego)], {}, overrides), "atle"), -5); // system behavior kept
});

test("custom skills follow the attribute currently stored: _pc1 Des -> Int", () => {
  const both = [effect("cego", CONDITIONS.cego), effect("frustrado", CONDITIONS.frustrado)];
  const asDes = apply(both, {}, { _pc1: "des" });
  assert.equal(total(asDes, "_pc1"), -5);
  const asInt = apply(both, {}, { _pc1: "int" });
  assert.equal(total(asInt, "_pc1"), -2);
  assert.ok(!added("cego", { _pc1: "int" }).includes("_pc1"));
  assert.ok(added("frustrado", { _pc1: "int" }).includes("_pc1"));
});

test("no intervention when the condition penalizes skills another way (no double penalty)", () => {
  // Skill penalty by attribute next to a direct one: the system sums atr and condi (T20:19853-19865).
  const byAttribute = [...penalty(["acro"], -5), change("system.modificadores.pericias.atr.des", -5, "add")];
  assert.equal(planConditionChanges({ statuses: ["cego"], changes: byAttribute, skills: makeActor().pericias, skillConfig: SKILL_CONFIG }), null);
  assert.equal(total(apply([effect("cego", byAttribute)]), "ladi"), -5);
  // The same in another phase.
  const otherPhase = [...penalty(["acro"], -5), change("system.modificadores.pericias.atr.des", -5, "add", { phase: "final" })];
  assert.equal(total(apply([effect("cego", otherPhase)]), "ladi"), -5);
  // Wildcard, condi with "add", skill bonus: unknown representations.
  for (const extra of [
    change("system.pericias.*.condi", -5),
    change("system.pericias.ladi.condi", -5, "add"),
    change("system.pericias.ladi.bonus", -5, "add")
  ]) {
    assert.equal(planConditionChanges({ statuses: ["cego"], changes: [...penalty(["acro"], -5), extra], skills: makeActor().pericias, skillConfig: SKILL_CONFIG }), null);
  }
  // Only attribute coverage, no direct anchor.
  assert.equal(planConditionChanges({ statuses: ["cego"], changes: [change("system.modificadores.pericias.atr.des", -5, "add")], skills: makeActor().pericias, skillConfig: SKILL_CONFIG }), null);
});

test("direct coverage and legacy copies: listed skills get no extra change", () => {
  const fixedUpstream = [...CONDITIONS.cego, ...penalty(["ladi"], -5)];
  assert.equal(planConditionChanges({ statuses: ["cego"], changes: fixedUpstream, skills: makeActor().pericias, skillConfig: SKILL_CONFIG }), null);
  assert.equal(total(apply([effect("cego", fixedUpstream)]), "ladi"), -5);
  // An old copy of the condition next to a fixed one: downgrade keeps -5.
  assert.equal(total(apply([effect("cego", CONDITIONS.cego), effect("cego", fixedUpstream)]), "ladi"), -5);
  // Other statuses or no skill penalty: nothing.
  assert.equal(planConditionChanges({ statuses: ["abalado"], changes: [change("system.pericias.*.condi", -2)], skills: makeActor().pericias, skillConfig: SKILL_CONFIG }), null);
  assert.equal(planConditionChanges({ statuses: ["fraco"], changes: ability(["for"], -2), skills: makeActor().pericias, skillConfig: SKILL_CONFIG }), null);
});

test("anchor and coverage come from the changes applied in this phase", () => {
  const skills = makeActor().pericias;
  // Anchor rejected, another direct penalty applied: still corrected, from the applied one.
  const rejectAcro = (c) => c.phase === "initial" && c.key !== "system.pericias.acro.condi";
  const plan = planConditionChanges({ statuses: ["cego"], changes: CONDITIONS.cego, skills, skillConfig: SKILL_CONFIG, isEligible: rejectAcro });
  assert.deepEqual(plan.added.map((k) => k.split(".")[2]).sort(), ["acro", "ladi"]);
  // Copies go through the same decision: a rejected key stays rejected.
  const rejectLadi = (c) => c.phase === "initial" && c.key !== "system.pericias.ladi.condi";
  assert.equal(total(apply([effect("cego", CONDITIONS.cego)], { shouldApply: rejectLadi }), "ladi"), 0);
  // A listed but rejected skill is not treated as covered.
  const listedLadi = [...CONDITIONS.cego, ...penalty(["ladi"], -5)];
  assert.ok(planConditionChanges({ statuses: ["cego"], changes: listedLadi, skills, skillConfig: SKILL_CONFIG, isEligible: rejectLadi }).added.includes("system.pericias.ladi.condi"));
  // Penalties in the "final" phase: nothing in "initial", copies in "final" with that phase.
  const late = penalty(PHYSICAL.filter((id) => id !== "fort"), -5, { phase: "final" });
  assert.equal(planConditionChanges({ statuses: ["cego"], changes: late, skills, skillConfig: SKILL_CONFIG, isEligible: (c) => c.phase === "initial" }), null);
  const finalPlan = planConditionChanges({ statuses: ["cego"], changes: late, skills, skillConfig: SKILL_CONFIG, isEligible: (c) => c.phase === "final" });
  assert.deepEqual(finalPlan.changes.filter((c) => c.key.includes("ladi")).map((c) => c.phase), ["final"]);
  assert.equal(total(apply([effect("cego", late)]), "ladi"), -5);
});

test("duplicate anchors that disagree on value or priority: no intervention", () => {
  const skills = makeActor().pericias;
  const values = [...penalty(["acro"], -5), ...penalty(["atle"], -2)];
  const priorities = [...penalty(["acro"], -5), ...penalty(["atle"], -5, { priority: 40 })];
  assert.equal(planConditionChanges({ statuses: ["cego"], changes: values, skills, skillConfig: SKILL_CONFIG }), null);
  assert.equal(planConditionChanges({ statuses: ["cego"], changes: priorities, skills, skillConfig: SKILL_CONFIG }), null);
  // Disagreeing changes in another phase do not count.
  const plan = planConditionChanges({ statuses: ["cego"], changes: [...penalty(["acro"], -5), ...penalty(["atle"], -2, { phase: "final" })], skills, skillConfig: SKILL_CONFIG, isEligible: (c) => c.phase === "initial" });
  assert.ok(plan);
});

test("copies keep the anchor's position, so the order against other effects is the system's", () => {
  const changes = [...ability(["for"], -5), ...penalty(["acro", "atle"], -5), change("system.attributes.defesa.condi", -5)];
  const plan = planConditionChanges({ statuses: ["cego"], changes, skills: makeActor().pericias, skillConfig: SKILL_CONFIG });
  const keys = plan.changes.map((c) => c.key);
  assert.deepEqual(keys.slice(0, 3), changes.slice(0, 3).map((c) => c.key));
  assert.equal(keys.at(-1), "system.attributes.defesa.condi");
  assert.ok(plan.changes.slice(3, -1).every((c) => c.type === "downgrade" && c.value === -5 && c.priority === 30 && c.phase === "initial"));
  // Another effect overriding condi (priority 50) wins for copies exactly as for listed skills.
  const override = { statuses: new Set(), changes: [change("system.pericias.ladi.condi", 0, "override"), change("system.pericias.acro.condi", 0, "override")] };
  const actor = apply([effect("cego", CONDITIONS.cego), override]);
  assert.deepEqual([total(actor, "ladi"), total(actor, "acro")], [0, 0]);
});

test("representation and abilities helpers", () => {
  assert.equal(skillRepresentation(change("system.pericias.ladi.condi", -5)), "direct");
  assert.equal(skillRepresentation(change("system.modificadores.pericias.atr.des", -5, "add")), "other");
  assert.equal(skillRepresentation(change("system.modificadores.pericias", -5, "add")), "other");
  assert.equal(skillRepresentation(change("system.modificadores.atributos.des", -5, "add")), "none");
  assert.equal(skillRepresentation(change("system.attributes.defesa.condi", -5)), "none");
  assert.deepEqual([...conditionAbilities(new Set(["cego", "frustrado", "lento"]))].sort(), ["car", "des", "for", "int", "sab"]);
});

test("diagnosis from CONFIG.T20.conditions", () => {
  const conditions = Object.fromEntries(Object.entries(CONDITIONS).map(([id, changes]) => [id, { system: { changes } }]));
  const present = diagnoseConditionLists(conditions, SKILL_CONFIG);
  assert.deepEqual([present.bug, present.confidence], ["present", "high"]);
  assert.match(present.evidence, /cego \(ladi\)/);
  const complete = Object.fromEntries(
    Object.entries(CONDITIONS).map(([id, changes]) => [id, { system: { changes: [...changes, ...penalty(["ladi", ...OFICIOS], changes.at(-1).value)] } }])
  );
  assert.deepEqual(Object.values(diagnoseConditionLists(complete, SKILL_CONFIG)).slice(0, 2), ["fixed", "low"]);
  const remodeled = { ...complete, cego: { system: { changes: [change("system.modificadores.pericias.atr.des", -5, "add")] } } };
  assert.equal(diagnoseConditionLists(remodeled, SKILL_CONFIG).bug, "unknown");
  assert.equal(diagnoseConditionLists(undefined, SKILL_CONFIG).bug, "unknown");
  assert.equal(diagnoseConditionLists({ lento: { system: { changes: [] } } }, SKILL_CONFIG).bug, "unknown");
});

test("statusEffectSources waits for every requested condition and ignores entries without _source", () => {
  const cego = { system: { changes: [] } };
  assert.deepEqual(statusEffectSources(["cego"], { cego: { id: "cego", _source: cego } }), { cego });
  assert.equal(statusEffectSources(["cego", "fraco"], { cego: { id: "cego", _source: cego } }), null);
  // Core default (before the system's "ready"): an array without _source.
  assert.equal(statusEffectSources(["cego"], [{ id: "cego", name: "Blind" }]), null);
  assert.deepEqual(statusEffectSources(["cego"], [{ id: "cego", _source: cego }]), { cego });
  assert.equal(statusEffectSources(["cego"], undefined), null);
});

test("lateProbe (1.6.6): reads the conditions from CONFIG.statusEffects[id]._source; nothing new while CONFIG.T20.conditions exists", async () => {
  const previous = globalThis.CONFIG;
  const statusEffects = Object.fromEntries(
    Object.entries(CONDITIONS).map(([id, changes]) => [id, { id, _source: { system: { changes } } }])
  );
  try {
    globalThis.CONFIG = { T20: { pericias: SKILL_CONFIG }, statusEffects };
    const late = await patch.lateProbe();
    assert.deepEqual([late.bug, late.confidence], ["present", "high"]);
    assert.match(late.evidence, /cego \(ladi\)/);
    globalThis.CONFIG = { T20: { pericias: SKILL_CONFIG, conditions: {} }, statusEffects };
    assert.equal(await patch.lateProbe(), undefined);
  } finally {
    globalThis.CONFIG = previous;
  }
});

test("system version range check", () => {
  const range = { minimum: "1.6.5", maximum: "1.6.5" };
  assert.ok(isSystemVersionAffected("1.6.5", range));
  assert.ok(!isSystemVersionAffected("1.6.6", range));
});

test("installed wrapper: copies seen by the core, original array restored, same-phase reentry while planning", () => {
  const seen = [];
  let reenter = null;
  class Actor {
    constructor(effects) {
      this.effects = effects;
      this._completedActiveEffectPhases = new Set();
      this.system = { pericias: makeActor().pericias };
    }
    getRollData() {
      reenter?.(this);
      return {};
    }
    allApplicableEffects() {
      return this.effects;
    }
    // Same order as the core: refuse completed phases, mark the phase, then read data and apply.
    applyActiveEffects(phase) {
      if (this._completedActiveEffectPhases.has(phase)) return "refused";
      this._completedActiveEffectPhases.add(phase);
      this.getRollData();
      for (const ef of this.effects) for (const c of ef.system.changes) if (ef.shouldApplyChange(c, { phase })) seen.push(c.key);
      if (phase === "final") throw new Error("core failure");
      return `done-${phase}`;
    }
  }
  const previous = globalThis.CONFIG;
  globalThis.CONFIG = { Actor: { documentClass: Actor }, T20: { pericias: SKILL_CONFIG } };
  try {
    patch.apply();
    const changes = CONDITIONS.cego;
    const ef = { active: true, statuses: new Set(["cego"]), system: { changes }, getReplacementData: () => ({}), shouldApplyChange: (c, { phase }) => c.phase === phase };
    const actor = new Actor([ef]);
    let inner;
    reenter = (a) => { reenter = null; inner = a.applyActiveEffects("initial"); };
    assert.equal(actor.applyActiveEffects("initial"), "done-initial");
    assert.equal(inner, undefined);
    assert.ok(seen.includes("system.pericias.ladi.condi"));
    assert.equal(ef.system.changes, changes);
    assert.equal(actor.applyActiveEffects("initial"), "refused");
    assert.throws(() => actor.applyActiveEffects("final"), /core failure/);
    assert.equal(ef.system.changes, changes);
  } finally {
    globalThis.CONFIG = previous;
  }
});
