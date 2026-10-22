/**
 * Initiative rolled from the actor sheet (tormenta20 1.6.5).
 *
 * Bug: ActorT20#rollPericia (T20:7589-7701) writes the Initiative total to the combat tracker in a local closure,
 * toInitiative (T20:7663-7677). It finds the combatant with `combatant.actor.id === actor.id`, but an unlinked
 * token's synthetic actor keeps the base actor's id, so with two tokens of the same creature in combat the roll of
 * token B goes to token A (or nowhere, if A already has initiative). It also only acts when the skill label is the
 * Portuguese "Iniciativa", so a renamed or translated label writes nothing (in 1.6.5 the system maps "en" to
 * lang/pt-BR.json, so the language setting alone keeps "Iniciativa").
 *
 * Fix: the closure cannot be wrapped. rollPericia is wrapped: while any skill roll is in flight, the
 * Combat#setInitiative call made from the toInitiative frame (read from the call stack, so a macro's call goes through)
 * is suppressed, and after the "inic" chat card is created its total is written to the
 * combatants of this token (or of this actor, when linked) that have no initiative yet, as core
 * Actor#rollInitiative selects them.
 */
import { markWrapper, stripComments, unwrap } from "../utils.mjs";

const LOG = "t20-community-patches | sheet-initiative-token:";
export const INITIATIVE_KEY = "inic";

/**
 * @typedef {object} CombatantInfo
 * @property {string} id
 * @property {string|null} [actorId]
 * @property {string|null} [tokenId]
 * @property {string|null} [sceneId]
 * @property {boolean} [linked]           The combatant represents the world actor (linked token or no token).
 * @property {number|null} [initiative]
 * @property {boolean} [isOwner]
 */

/**
 * Combatants that a roll of the Initiative skill sets, following core Actor#rollInitiative: a token's actor sets the
 * combatants of that token; any other actor sets its combatants without token or with a linked token. When the actor
 * has none of those and exactly one combatant of it is in the combat (an unlinked token), that one is used, as the
 * system did. Only combatants without initiative that the user owns are returned.
 * @param {object} args
 * @param {{id: string, isToken?: boolean, tokenId?: string|null, sceneId?: string|null}} args.actor
 * @param {CombatantInfo[]} args.combatants
 * @returns {string[]} Combatant ids.
 */
export function initiativeTargets({ actor, combatants }) {
  const list = Array.isArray(combatants) ? combatants : [];
  let matches;
  if (actor?.isToken) {
    matches = list.filter(
      (c) => !!c.tokenId && c.tokenId === actor.tokenId && (!c.sceneId || !actor.sceneId || c.sceneId === actor.sceneId)
    );
  } else {
    const own = list.filter((c) => !!c.actorId && c.actorId === actor?.id);
    matches = own.filter((c) => !c.tokenId || c.linked);
    if (!matches.length && own.length === 1) matches = own;
  }
  return matches.filter((c) => c.initiative === null && c.isOwner !== false).map((c) => c.id);
}

/**
 * The roll total of the chat message the system created for the skill roll.
 * @param {{rolls?: {total?: number}[], flags?: {tormenta20?: {rollTotal?: number}}}|undefined} message
 * @returns {number|null}
 */
export function rollTotal(message) {
  const total = message?.rolls?.[0]?.total ?? message?.flags?.tormenta20?.rollTotal;
  return Number.isFinite(total) ? total : null;
}

/**
 * Whether a Combat#setInitiative call is the one toInitiative makes: on the active combat, for a combatant without
 * initiative whose actor has an Initiative roll in flight.
 * @param {object} args
 * @param {Iterable<string>} args.pending   Actor ids with an Initiative roll in flight.
 * @param {string|null|undefined} args.actorId  Id of the combatant's actor.
 * @param {number|null|undefined} args.initiative
 * @param {boolean} args.active             The combat is game.combats.active.
 * @returns {boolean}
 */
export function suppressesSetInitiative({ pending, actorId, initiative, active }) {
  return !!active && initiative === null && !!actorId && [...(pending ?? [])].includes(actorId);
}

/**
 * Whether a call stack comes from the system's toInitiative closure (V8 "at toInitiative (" or Firefox/Safari
 * "toInitiative@"). Without a readable stack it answers true, so the system's wrong write stays suppressed.
 * @param {unknown} stack
 * @returns {boolean}
 */
export function fromToInitiative(stack) {
  if (typeof stack !== "string" || !stack) return true;
  return /(?:^|[\s.])toInitiative(?: \(|@)/m.test(stack);
}

/**
 * Reads the source of the system's rollPericia. Source reading never proves a fix, so it never returns fixed/high.
 * @param {string|undefined} source
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseSource(source) {
  if (typeof source !== "string") return { bug: "unknown", confidence: "low", evidence: "rollPericia not found" };
  const code = stripComments(source);
  if (!/\bsetInitiative\s*\(/.test(code)) {
    return { bug: "unknown", confidence: "low", evidence: "setInitiative call not found in rollPericia" };
  }
  const found = [
    /\.actor\.id\s*===\s*actor\.id\b/.test(code) && "combatant matched by actor id",
    /\.label\s*===\s*["']Iniciativa["']/.test(code) && 'skill matched by the label "Iniciativa"'
  ].filter(Boolean);
  if (found.length === 2) return { bug: "present", confidence: "high", evidence: found.join(", ") };
  if (found.length) return { bug: "present", confidence: "low", evidence: found.join(", ") };
  return { bug: "fixed", confidence: "low", evidence: "combatant and skill matching not recognized" };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

/** Actor ids with an Initiative roll in flight (one entry per call). */
const pending = [];
let warned = false;

function callStack() {
  const limit = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = 50;
    return new Error().stack;
  } finally {
    Error.stackTraceLimit = limit;
  }
}

function describeActor(actor) {
  return {
    id: actor.id,
    isToken: !!actor.isToken,
    tokenId: actor.token?.id ?? null,
    sceneId: actor.token?.parent?.id ?? null
  };
}

function describeCombatant(c) {
  const token = c.token;
  return {
    id: c.id,
    actorId: c.actorId ?? null,
    tokenId: c.tokenId ?? null,
    sceneId: c.sceneId ?? null,
    // Without its token document, core Combatant#actor falls back to the world actor.
    linked: token ? !!token.actorLink : true,
    initiative: c.initiative ?? null,
    isOwner: !!c.isOwner
  };
}

async function writeInitiative(actor, message) {
  try {
    const total = rollTotal(message);
    const combat = game.combats.active;
    if (total === null || !combat) return;
    const ids = initiativeTargets({
      actor: describeActor(actor),
      combatants: combat.combatants.contents.map(describeCombatant)
    });
    if (!ids.length) return;
    await combat.updateEmbeddedDocuments("Combatant", ids.map((_id) => ({ _id, initiative: total })));
  } catch (err) {
    console.warn(`${LOG} could not set the initiative`, actor?.uuid, err);
  }
}

function apply() {
  const proto = CONFIG.Actor.documentClass?.prototype;
  const CombatClass = foundry.documents.Combat;
  if (typeof proto?.rollPericia !== "function") throw new Error("ActorT20#rollPericia not found");
  if (typeof CombatClass?.prototype?.setInitiative !== "function") throw new Error("Combat#setInitiative not found");

  // Whether this call is the system's write; must run synchronously in the caller's stack.
  function isSystemCall(combat, id) {
    try {
      if (!pending.length) return false;
      const combatant = combat.combatants.get(id);
      const skip = suppressesSetInitiative({
        pending,
        actorId: combatant?.actor?.id,
        initiative: combatant?.initiative,
        active: combat === game.combats.active
      });
      return skip && fromToInitiative(callStack());
    } catch (err) {
      if (!warned) console.warn(`${LOG} could not check setInitiative`, err);
      warned = true;
      return false;
    }
  }

  const setInitiative = CombatClass.prototype.setInitiative;
  CombatClass.prototype.setInitiative = markWrapper(function (id, value) {
    if (isSystemCall(this, id)) return Promise.resolve();
    return setInitiative.call(this, id, value);
  }, setInitiative);

  // While a roll is in flight, an own property on each combat runs before any other module's Combat#setInitiative
  // wrapper, so the check still sees the toInitiative frame when such a wrapper awaits before delegating.
  function shadowed(id, value) {
    if (isSystemCall(this, id)) return Promise.resolve();
    return Object.getPrototypeOf(this).setInitiative.call(this, id, value);
  }
  function shadow() {
    for (const combat of game.combats ?? []) {
      if (Object.hasOwn(combat, "setInitiative")) continue;
      Object.defineProperty(combat, "setInitiative", { value: shadowed, configurable: true, writable: true });
    }
  }
  function unshadow() {
    for (const combat of game.combats ?? []) {
      if (Object.getOwnPropertyDescriptor(combat, "setInitiative")?.value === shadowed) delete combat.setInitiative;
    }
  }

  const rollPericia = proto.rollPericia;
  proto.rollPericia = markWrapper(async function (key, options = {}) {
    if (options?.message === false) return rollPericia.call(this, key, options);
    // Any skill labelled "Iniciativa" reaches the system's write, so it is suppressed for every key; only "inic" writes.
    const actorId = this.id;
    pending.push(actorId);
    let message;
    try {
      try { shadow(); } catch (err) { console.warn(`${LOG} could not guard the combats`, err); }
      message = await rollPericia.call(this, key, options);
    } finally {
      const index = pending.indexOf(actorId);
      if (index >= 0) pending.splice(index, 1);
      if (!pending.length) {
        try { unshadow(); } catch (err) { console.warn(`${LOG} could not unguard the combats`, err); }
      }
    }
    if (key === INITIATIVE_KEY) await writeInitiative(this, message);
    return message;
  }, rollPericia);
}

function isNeeded() {
  const original = unwrap(CONFIG.Actor.documentClass?.prototype?.rollPericia);
  if (typeof original !== "function") return { bug: "unknown", confidence: "low", evidence: "rollPericia not found" };
  if (typeof foundry.documents.Combat?.prototype?.setInitiative !== "function") {
    return { bug: "unknown", confidence: "low", evidence: "Combat#setInitiative not found" };
  }
  try {
    return diagnoseSource(Function.prototype.toString.call(original));
  } catch (err) {
    return { bug: "unknown", confidence: "low", evidence: `rollPericia probe failed: ${err.message}` };
  }
}

export default {
  id: "sheet-initiative-token",
  group: "actor",
  issue: 67,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  apply
};
