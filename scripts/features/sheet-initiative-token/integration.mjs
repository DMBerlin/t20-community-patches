import {
  diagnoseSource,
  fromToInitiative,
  initiativeTargets,
  INITIATIVE_KEY,
  ROLL_PERICIA,
  rollTotal,
  suppressesSetInitiative
} from "./domain.mjs";

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

async function writeInitiative(ctx, actor, message) {
  try {
    const total = rollTotal(message);
    const combat = ctx.platform.documents.combats().active;
    if (total === null || !combat) return;
    const ids = initiativeTargets({
      actor: describeActor(actor),
      combatants: combat.combatants.contents.map(describeCombatant)
    });
    if (!ids.length) return;
    await combat.updateEmbeddedDocuments("Combatant", ids.map((_id) => ({ _id, initiative: total })));
  } catch (err) {
    ctx.log.warn("could not set the initiative", actor?.uuid, err);
  }
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const proto = ctx.platform.classes.actor?.prototype;
  const CombatClass = ctx.platform.core.Combat;
  if (typeof proto?.rollPericia !== "function") throw new Error("ActorT20#rollPericia not found");
  if (typeof CombatClass?.prototype?.setInitiative !== "function") throw new Error("Combat#setInitiative not found");
  const combats = () => ctx.platform.documents.combats();

  /** Actor ids with an Initiative roll in flight (one entry per call). */
  const pending = [];
  let warned = false;

  // Whether this call is the system's write; must run synchronously in the caller's stack.
  function isSystemCall(combat, id) {
    try {
      if (!pending.length) return false;
      const combatant = combat.combatants.get(id);
      const skip = suppressesSetInitiative({
        pending,
        actorId: combatant?.actor?.id,
        initiative: combatant?.initiative,
        active: combat === combats().active
      });
      return skip && fromToInitiative(callStack());
    } catch (err) {
      if (!warned) ctx.log.warn("could not check setInitiative", err);
      warned = true;
      return false;
    }
  }

  ctx.wrap(CombatClass.prototype, "setInitiative", function (setInitiative, id, value) {
    if (isSystemCall(this, id)) return Promise.resolve();
    return setInitiative.call(this, id, value);
  });

  // While a roll is in flight, an own property on each combat runs before any other module's Combat#setInitiative
  // wrapper, so the check still sees the toInitiative frame when such a wrapper awaits before delegating.
  function shadowed(id, value) {
    if (isSystemCall(this, id)) return Promise.resolve();
    return Object.getPrototypeOf(this).setInitiative.call(this, id, value);
  }
  function shadow() {
    for (const combat of combats() ?? []) {
      if (Object.hasOwn(combat, "setInitiative")) continue;
      Object.defineProperty(combat, "setInitiative", { value: shadowed, configurable: true, writable: true });
    }
  }
  function unshadow() {
    for (const combat of combats() ?? []) {
      if (Object.getOwnPropertyDescriptor(combat, "setInitiative")?.value === shadowed) delete combat.setInitiative;
    }
  }

  ctx.wrap(proto, "rollPericia", async function (rollPericia, key, options = {}) {
    if (options?.message === false) return rollPericia.call(this, key, options);
    // Any skill labelled "Iniciativa" reaches the system's write, so it is suppressed for every key; only "inic" writes.
    const actorId = this.id;
    pending.push(actorId);
    let message;
    try {
      try { shadow(); } catch (err) { ctx.log.warn("could not guard the combats", err); }
      message = await rollPericia.call(this, key, options);
    } finally {
      const index = pending.indexOf(actorId);
      if (index >= 0) pending.splice(index, 1);
      if (!pending.length) {
        try { unshadow(); } catch (err) { ctx.log.warn("could not unguard the combats", err); }
      }
    }
    if (key === INITIATIVE_KEY) await writeInitiative(ctx, this, message);
    return message;
  });
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const source = ctx.platform.sourceOfMethod(ROLL_PERICIA);
  if (source == null) return { bug: "unknown", confidence: "low", evidence: "rollPericia not found" };
  try {
    return diagnoseSource(source);
  } catch (err) {
    return { bug: "unknown", confidence: "low", evidence: `rollPericia probe failed: ${err.message}` };
  }
}
