/**
 * Ongoing damage of Em Chamas / Sangrando (tormenta20 1.6.5).
 *
 * Bug: both conditions store their per-turn damage in a "dano" change (1d6[fogo] / 1d6[perda]), but
 * CombatT20#_manageDOTEffects (through ActiveEffectT20#isOngoingDamage) only rolls "danoContinuo" changes, so the
 * damage is never rolled. Sangrando also lacks the Constitution test (DC 15) that ends the condition.
 *
 * Fix: after the system's own routine, the start of the turn also handles these two conditions when no copy of the
 * condition is already rolled by the system. Em Chamas rolls the damage like the system does; Sangrando first rolls
 * the system's Constitution test: success removes the condition, failure rolls the loss. Turn starts of the same actor
 * run one after the other. No data is changed.
 */
import { markWrapper, stripComments, unwrap } from "../utils.mjs";

export const LEGACY_KEY = "dano";
export const OFFICIAL_KEY = "danoContinuo";
export const STATUS_PACK = "world.statuses";
/** Conditions handled by this patch, by status id. `test`: the test that ends the condition, if any. */
export const ONGOING_CONDITIONS = Object.freeze({
  emchamas: Object.freeze({ test: null }),
  sangrando: Object.freeze({ test: Object.freeze({ ability: "con", dc: 15 }) })
});
/** CombatT20#_manageDOTEffects of tormenta20 1.6.5 (T20:18484-18506), the only implementation the patch complements. */
export const KNOWN_DOT_SOURCE = [
  "async _manageDOTEffects(combatant, context) {",
  "if (!combatant.actor) return;",
  "if (!combatant.actor.isOwner) return;",
  "const ongoingDamage = combatant.actor.effects.filter((e) => e.isOngoingDamage);",
  "const rollData = combatant.actor.getRollData();",
  "for (const effect of ongoingDamage) {",
  "const messageData = {",
  "flavor: effect.name,",
  "speaker: ChatMessage.getSpeaker({ actor: combatant.actor }),",
  "rolls: []",
  "};",
  "for (const change of effect.system.changes) {",
  'if (change.key != "danoContinuo") continue;',
  "const roll = Roll.create(`${change.value}`, rollData, {",
  "title: effect.name",
  "});",
  "await roll.evaluate();",
  "messageData.rolls.push(roll);",
  "}",
  "if (!messageData.rolls.length) continue;",
  "await ChatMessage.create(messageData);",
  "}",
  "}"
].join("\n");
const LOG = "t20-community-patches | ongoing-damage-conditions:";

const hasKey = (changes, key) => Array.isArray(changes) && changes.some((c) => c?.key === key);

/**
 * Formulas of the legacy "dano" changes of a condition. An effect that also has "danoContinuo" is left to the system.
 * @param {{key?: string, value?: unknown}[]} changes
 * @returns {string[]}
 */
export function legacyOngoingFormulas(changes) {
  if (!Array.isArray(changes) || hasKey(changes, OFFICIAL_KEY)) return [];
  return changes
    .filter((c) => c?.key === LEGACY_KEY)
    .map((c) => String(c.value ?? "").trim())
    .filter(Boolean);
}

/**
 * Picks, for each handled condition, the effect that deals its damage this turn. A condition is skipped when any of
 * its copies is rolled by the system (ActiveEffectT20#isOngoingDamage: active, own source, "danoContinuo").
 * @param {{id: string, active: boolean, fromOtherSource: boolean, statuses: Iterable<string>, changes: object[]}[]} effects
 * @returns {{status: string, effectId: string, formulas: string[], removeIds: string[]}[]}
 */
export function selectOngoingConditions(effects) {
  const list = Array.isArray(effects) ? effects : [];
  const result = [];
  for (const status of Object.keys(ONGOING_CONDITIONS)) {
    const withStatus = list.filter((e) => new Set(e?.statuses ?? []).has(status));
    const eligible = withStatus.filter((e) => e.active === true && !e.fromOtherSource);
    if (eligible.some((e) => hasKey(e.changes, OFFICIAL_KEY))) continue;
    const source = eligible.find((e) => legacyOngoingFormulas(e.changes).length > 0);
    if (!source) continue;
    result.push({
      status,
      effectId: source.id,
      formulas: legacyOngoingFormulas(source.changes),
      removeIds: withStatus.map((e) => e.id)
    });
  }
  return result;
}

/**
 * Whether a test that ends a condition passed. A natural 20 always passes and a natural 1 always fails.
 * @param {{natural?: number, total: number, dc: number}} result
 * @returns {boolean}
 */
export function testPassed({ natural, total, dc }) {
  if (natural === 20) return true;
  if (natural === 1) return false;
  return Number(total) >= dc;
}

/**
 * Event that makes ActorT20#rollAtributo skip its dialog, following the client setting tormenta20.UsageConfig.
 * @param {string} usageConfig
 * @returns {{shiftKey: boolean}}
 */
export function skipDialogEvent(usageConfig) {
  return { shiftKey: usageConfig === "default" };
}

/**
 * Runs tasks with the same key one after the other, in call order. A failed task does not block the next ones, and
 * no task is dropped.
 * @returns {(key: string, task: () => unknown) => Promise<unknown>}
 */
export function createKeyedQueue() {
  const tails = new Map();
  return function run(key, task) {
    const next = (tails.get(key) ?? Promise.resolve()).then(() => task());
    const tail = next.then(
      () => undefined,
      () => undefined
    );
    tails.set(key, tail);
    tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return next;
  };
}

/** Source without comments and with every whitespace run collapsed, for an exact comparison. */
export function normalizeSource(source) {
  if (typeof source !== "string") return "";
  return (stripComments(source) ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Reads the system's CombatT20#_manageDOTEffects source. Only the known 1.6.5 body is recognized; anything else is
 * unknown, and the patch then does not complement it. Only reading code, never a high-confidence result.
 * @param {string} source
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseDotSource(source) {
  if (normalizeSource(source) === normalizeSource(KNOWN_DOT_SOURCE)) {
    return { bug: "present", confidence: "low", evidence: "_manageDOTEffects is the 1.6.5 body (only rolls danoContinuo)" };
  }
  return { bug: "unknown", confidence: "low", evidence: "_manageDOTEffects is missing, wrapped or changed" };
}

/**
 * Combines the code diagnosis with the condition data of world.statuses (after "ready").
 * @param {import("../registry.mjs").Diagnosis} code   Result of diagnoseDotSource
 * @param {Record<string, object[]|undefined>} changesByStatus   Changes of each handled condition, by status id
 * @returns {import("../registry.mjs").Diagnosis|undefined}
 */
export function diagnoseConditionData(code, changesByStatus) {
  if (code?.bug !== "present") return undefined;
  const statuses = Object.keys(ONGOING_CONDITIONS);
  const missing = statuses.filter((s) => !Array.isArray(changesByStatus?.[s]));
  if (missing.length === statuses.length) return undefined;
  if (missing.length) {
    return { bug: "unknown", confidence: "low", evidence: `world.statuses lacks ${missing.join(", ")}` };
  }
  const legacy = statuses.filter((s) => legacyOngoingFormulas(changesByStatus[s]).length > 0);
  if (legacy.length === statuses.length) {
    return {
      bug: "present",
      confidence: "high",
      evidence: `${legacy.join(", ")} use "dano" and _manageDOTEffects only rolls danoContinuo`
    };
  }
  if (!legacy.length) {
    return { bug: "fixed", confidence: "low", evidence: "world.statuses conditions no longer use the dano key" };
  }
  return { bug: "unknown", confidence: "low", evidence: `only ${legacy.join(", ")} still use the dano key` };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const runForActor = createKeyedQueue();

function originalSource() {
  const fn = unwrap(CONFIG.Combat?.documentClass?.prototype?._manageDOTEffects);
  return typeof fn === "function" ? Function.prototype.toString.call(fn) : "";
}

function describeEffect(effect, actor) {
  let fromOtherSource = false;
  const duplicate = effect._stats?.duplicateSource;
  if (duplicate) {
    try {
      fromOtherSource = foundry.utils.fromUuidSync(duplicate) != actor;
    } catch {
      fromOtherSource = true;
    }
  }
  return {
    id: effect.id,
    active: effect.active === true,
    fromOtherSource,
    statuses: [...(effect.statuses ?? [])],
    changes: effect.system?.changes ?? []
  };
}

async function rollDamage(actor, name, formulas) {
  const rollData = actor.getRollData();
  const rolls = [];
  for (const formula of formulas) {
    const roll = Roll.create(formula, rollData, { title: name });
    await roll.evaluate();
    rolls.push(roll);
  }
  if (rolls.length) await ChatMessage.create({ flavor: name, speaker: ChatMessage.getSpeaker({ actor }), rolls });
}

/** @returns {Promise<boolean|null>} null when the test could not be rolled. */
async function rollEndingTest(actor, name, { ability, dc }) {
  if (!actor.system?.atributos?.[ability]) return null;
  const event = skipDialogEvent(game.settings.get("tormenta20", "UsageConfig"));
  const roll = await actor.rollAtributo(ability, { message: false, event });
  if (!roll) return null;
  const natural = roll.dice?.find((d) => d.faces === 20)?.total;
  const passed = testPassed({ natural, total: roll.total, dc });
  const key = passed ? "T20CP.OngoingDamage.TestPassed" : "T20CP.OngoingDamage.TestFailed";
  await ChatMessage.create({
    flavor: game.i18n.format(key, { name, dc }),
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: [roll]
  });
  return passed;
}

/** Runs inside the actor's queue: the conditions are read only now, after any previous turn start finished. */
async function handleConditions(actor) {
  if (!actor?.isOwner) return;
  const conditions = selectOngoingConditions(actor.effects.map((e) => describeEffect(e, actor)));
  for (const condition of conditions) {
    try {
      const name = actor.effects.get(condition.effectId)?.name ?? condition.status;
      const { test } = ONGOING_CONDITIONS[condition.status];
      if (test) {
        let passed = null;
        try {
          passed = await rollEndingTest(actor, name, test);
        } catch (err) {
          console.warn(`${LOG} could not roll the test for ${name}`, err);
        }
        if (passed === null) console.warn(`${LOG} no test for ${name} on ${actor.name}; rolling the damage`);
        if (passed) {
          const ids = condition.removeIds.filter((id) => actor.effects.has(id));
          if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
          continue;
        }
      }
      await rollDamage(actor, name, condition.formulas);
    } catch (err) {
      console.error(`${LOG} could not handle ${condition.status} on ${actor.name}`, err);
    }
  }
}

function apply() {
  const CombatClass = CONFIG.Combat?.documentClass;
  const original = CombatClass?.prototype?._manageDOTEffects;
  if (typeof original !== "function") throw new Error("Tormenta20 ongoing damage API not found");
  const recognized = diagnoseDotSource(originalSource()).bug === "present";
  if (!recognized) console.warn(`${LOG} _manageDOTEffects not recognized; the conditions are left to the system`);

  CombatClass.prototype._manageDOTEffects = markWrapper(async function (...args) {
    const result = await original.apply(this, args);
    const actor = args[0]?.actor;
    if (recognized && actor) {
      try {
        await runForActor(actor.uuid, () => handleConditions(actor));
      } catch (err) {
        console.error(`${LOG} could not handle the conditions of ${actor.name}`, err);
      }
    }
    return result;
  }, original);
}

function isNeeded() {
  return diagnoseDotSource(originalSource());
}

async function lateProbe() {
  const code = diagnoseDotSource(originalSource());
  if (code.bug !== "present") return undefined;
  const pack = game.packs.get(STATUS_PACK);
  if (!pack?.index?.size) return undefined;
  const docs = await pack.getDocuments();
  const changesByStatus = {};
  for (const status of Object.keys(ONGOING_CONDITIONS)) {
    const doc = docs.find((d) => d.statuses?.has(status));
    if (doc) changesByStatus[status] = doc.system?.changes ?? [];
  }
  return diagnoseConditionData(code, changesByStatus);
}

export default {
  id: "ongoing-damage-conditions",
  group: "conditions",
  issue: 45,
  guarded: true,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  lateProbe,
  apply
};
