/**
 * Encumbered condition out of sync (tormenta20 1.6.5).
 *
 * Bug: ActorT20._checkEncumbered only runs from ActorT20._onUpdate and ItemT20._onUpdate, so creating or deleting
 * items never applies or removes "sobrecarregado". It also decides before awaiting the creation, so overlapping
 * checks create duplicate copies, and only one copy is ever removed.
 *
 * Fix: the check runs after items are created or deleted on the actor, and is serialized per actor, awaiting the
 * creation/removal. Every copy is removed when the character is no longer encumbered.
 */
import { stripComments, unwrap } from "../utils.mjs";

export const ENCUMBERED = "sobrecarregado";
const LOG = "t20-community-patches | encumbered-status-sync:";

/**
 * What to do with the condition, following the system's rule (characters only).
 * Extra copies (e.g. from simultaneous checks on different clients) are removed, keeping the first one.
 * @param {{isCharacter: boolean, isEncumbered: boolean, effectIds: string[]}} state
 * @returns {{create: boolean, deleteIds: string[]}}
 */
export function encumbranceAction({ isCharacter, isEncumbered, effectIds }) {
  if (!isCharacter) return { create: false, deleteIds: [] };
  if (isEncumbered) return { create: effectIds.length === 0, deleteIds: effectIds.slice(1) };
  return { create: false, deleteIds: [...effectIds] };
}

/**
 * Whether a descendant operation changed the actor's own items, made by this client.
 * @param {{collection: string, parentIsActor: boolean, userId: string, currentUserId: string}} state
 * @returns {boolean}
 */
export function shouldCheckAfterItems({ collection, parentIsActor, userId, currentUserId }) {
  return collection === "items" && parentIsActor && userId === currentUserId;
}

/**
 * Serializes async work per key: calls made while a run is active schedule one more run and share its promise.
 * @param {(key: object) => Promise<void>} task
 * @returns {(key: object) => Promise<void>}
 */
export function createSerializer(task) {
  const runs = new WeakMap();
  return function run(key) {
    const active = runs.get(key);
    if (active) {
      active.again = true;
      return active.promise;
    }
    const entry = { again: false, promise: null };
    runs.set(key, entry);
    entry.promise = (async () => {
      try {
        do {
          entry.again = false;
          await task(key);
        } while (entry.again);
      } finally {
        runs.delete(key);
      }
    })();
    return entry.promise;
  };
}

/**
 * Wraps a descendant-documents callback so that `after` runs once the original (sync or async) finishes.
 * The original's return value, including a rejected promise, reaches the caller unchanged.
 * @param {Function} original
 * @param {(self: object, args: any[]) => void} after
 * @returns {Function}
 */
export function wrapDescendantCallback(original, after) {
  return function (...args) {
    const result = original.apply(this, args);
    Promise.resolve(result).then(
      () => after(this, args),
      () => {}
    );
    return result;
  };
}

/**
 * Whether a source is a class method definition (`name(…) {` or `async name(…) {`), as opposed to a function or
 * arrow assigned by another module, whose body only forwards to code that cannot be read.
 * @param {string} src
 * @returns {boolean}
 */
export function isMethodSource(src) {
  return /^\s*(?:async\s+)?(?!function\b|async\s*\()[A-Za-z_$][\w$]*\s*\(/.test(src ?? "");
}

/**
 * Reads the sources of the create and delete paths (actor descendant callbacks and Item#_onCreate/_onDelete).
 * Only reading code, the result is never a high-confidence fix: even with both paths calling the check, the
 * system's _checkEncumbered (tormenta20 1.6.5) does not await its writes and removes only one copy. The bug is
 * confirmed only when every source is a readable class method: a wrapper may hide a call.
 * @param {{create: string[], delete: string[]}} sources
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseEncumbranceHooks(sources) {
  const calls = (list) => (list ?? []).some((src) => /_checkEncumbered\s*\(/.test(stripComments(src) ?? ""));
  const onCreate = calls(sources?.create);
  const onDelete = calls(sources?.delete);
  if (onCreate && onDelete) {
    return { bug: "fixed", confidence: "low", evidence: "item create and delete call _checkEncumbered" };
  }
  if (onCreate || onDelete) {
    return {
      bug: "unknown",
      confidence: "low",
      evidence: `only item ${onCreate ? "create" : "delete"} calls _checkEncumbered`
    };
  }
  const all = [...(sources?.create ?? []), ...(sources?.delete ?? [])];
  if (!all.length || !all.every(isMethodSource)) {
    return { bug: "unknown", confidence: "low", evidence: "item create/delete paths are wrapped or missing" };
  }
  return { bug: "present", confidence: "high", evidence: "no item create/delete path calls _checkEncumbered" };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

async function syncOnce(actor) {
  const effectIds = actor.effects.filter((ef) => ef.statuses?.has(ENCUMBERED)).map((ef) => ef.id);
  const { create, deleteIds } = encumbranceAction({
    isCharacter: actor.type === "character",
    isEncumbered: Boolean(actor.system?.attributes?.carga?.encumbered),
    effectIds
  });
  if (create) {
    const effect = await foundry.documents.ActiveEffect.fromStatusEffect(ENCUMBERED);
    await actor.createEmbeddedDocuments("ActiveEffect", [effect.toObject()]);
  }
  if (deleteIds.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", deleteIds);
  }
}

const sync = createSerializer(async (actor) => {
  try {
    await syncOnce(actor);
  } catch (err) {
    console.error(`${LOG} could not update "${ENCUMBERED}" on ${actor.name}`, err);
  }
});

function checkAfterItems(actor, [parent, collection, , , , userId]) {
  if (!shouldCheckAfterItems({ collection, parentIsActor: parent === actor, userId, currentUserId: game.userId })) return;
  actor._checkEncumbered();
}

function apply() {
  const proto = CONFIG.Actor.documentClass.prototype;
  proto._checkEncumbered = function () {
    return sync(this);
  };
  for (const name of ["_onCreateDescendantDocuments", "_onDeleteDescendantDocuments"]) {
    proto[name] = wrapDescendantCallback(proto[name], checkAfterItems);
  }
}

function isNeeded() {
  const ActorClass = CONFIG.Actor?.documentClass;
  const ItemClass = CONFIG.Item?.documentClass;
  if (typeof ActorClass?.prototype?._checkEncumbered !== "function") return undefined;
  const source = (fn) => (typeof fn === "function" ? Function.prototype.toString.call(unwrap(fn)) : "");
  return diagnoseEncumbranceHooks({
    create: [source(ActorClass.prototype._onCreateDescendantDocuments), source(ItemClass?.prototype?._onCreate)],
    delete: [source(ActorClass.prototype._onDeleteDescendantDocuments), source(ItemClass?.prototype?._onDelete)]
  });
}

export default {
  id: "encumbered-status-sync",
  group: "conditions",
  issue: 21,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  apply
};
