/**
 * Initial class bookkeeping (tormenta20 1.6.5).
 *
 * Bug: ItemT20#_onUpdate and ItemT20#_onDelete move the "Inicial" mark whenever some class is not initial, instead
 * of only when no class is initial. Marking a third class as initial, or deleting a class while the initial one is
 * not the first, leaves the mark on another class; unmarking the only class throws. ItemT20#_preCreate keeps the
 * "inicial" value of the created data, so a class copied from another character, or a folder with several classes
 * dropped on a new character, leaves two initial classes. AttributesFields.preparePVPM gives the 1st level of every
 * initial class 4× its PV per level.
 *
 * Fix: while the actor has classes, exactly one is initial. The mark moves only when the user marks another class,
 * or when no class is initial anymore (the initial class was unmarked or deleted). A created class is initial only
 * when the actor had no class and it is the first class accepted in its creation operation.
 */
import { markWrapper, stripComments, unwrap } from "../utils.mjs";

const LOG = "t20-community-patches | initial-class:";

/**
 * FNV-1a (32 bits) of a source without comments and whitespace: recognizes the exact system method.
 * @param {string} src
 * @returns {string}
 */
export function sourceFingerprint(src) {
  const text = String(stripComments(String(src ?? ""))).replace(/\s+/g, "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Fingerprints of ItemT20#_onUpdate (T20:8301-8329) and #_onDelete (T20:8334-8358) in tormenta20 1.6.5. */
export const KNOWN_FINGERPRINTS = { _onUpdate: "c6ebd948", _onDelete: "0facae77" };

/** ItemT20#_preCreate does nothing for classes (T20:8273-8275). */
const PRECREATE_CLASS_NOOP = /switch\s*\(\s*data\.type\s*\)\s*\{\s*case\s*"classe"\s*:\s*break\s*;/;

/**
 * Which system methods are the known buggy code.
 * @param {{onUpdate?: string, onDelete?: string, preCreate?: string}} sources
 * @returns {{_onUpdate: boolean, _onDelete: boolean, _preCreate: boolean}}
 */
export function recognizeParts(sources) {
  return {
    _onUpdate: sourceFingerprint(sources?.onUpdate) === KNOWN_FINGERPRINTS._onUpdate,
    _onDelete: sourceFingerprint(sources?.onDelete) === KNOWN_FINGERPRINTS._onDelete,
    _preCreate: PRECREATE_CLASS_NOOP.test(stripComments(sources?.preCreate ?? "") ?? "")
  };
}

/**
 * Only reading code: "present"/high when the three methods are the known 1.6.5 code; anything else is unknown.
 * Never "fixed": a changed method may still move the mark wrongly.
 * @param {{_onUpdate: boolean, _onDelete: boolean, _preCreate: boolean}} parts
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseInitialClass(parts) {
  const missing = Object.keys(parts).filter((key) => !parts[key]);
  if (!missing.length) {
    return { bug: "present", confidence: "high", evidence: "Item _onUpdate/_onDelete/_preCreate are the 1.6.5 code" };
  }
  return { bug: "unknown", confidence: "low", evidence: `not recognized: ${missing.join(", ")}` };
}

/**
 * The class that must receive the mark, or null. The mark only moves when no class is initial.
 * @param {{id: string, inicial: boolean}[]} classes  The actor's classes, in collection order, after the change.
 * @param {string} [avoidId]                         Picked only when it is the only class (the one just unmarked).
 * @returns {string|null}
 */
export function pickInitialClass(classes, avoidId) {
  if (!classes.length || classes.some((c) => c.inicial)) return null;
  return (classes.find((c) => c.id !== avoidId) ?? classes[0]).id;
}

/**
 * Updates after the "inicial" field of a class changed.
 * Marked: unmark every other initial class. Unmarked: give the mark to another class only if none is initial.
 * @param {{id: string, inicial: boolean}[]} classes  After the change, including the changed class.
 * @param {string} selfId
 * @param {boolean} marked                           The new value of system.inicial.
 * @returns {{_id: string, "system.inicial": boolean}[]}
 */
export function initialUpdatesOnChange(classes, selfId, marked) {
  if (marked) {
    return classes.filter((c) => c.id !== selfId && c.inicial).map((c) => ({ _id: c.id, "system.inicial": false }));
  }
  const id = pickInitialClass(classes, selfId);
  return id ? [{ _id: id, "system.inicial": true }] : [];
}

/**
 * Values of system.inicial for the classes of one creation operation, in order: only the first class is initial,
 * and only when the actor had no class (the system's own rule for the first drop, T20:14352).
 * @param {boolean} actorHasClass  Whether the actor already has a class.
 * @param {number} count           Number of classes accepted in the operation.
 * @returns {boolean[]}
 */
export function initialMarksOnCreate(actorHasClass, count) {
  return Array.from({ length: Math.max(0, count | 0) }, (_, i) => !actorHasClass && i === 0);
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function ownerOf(proto, name) {
  for (let p = proto; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    if (Object.prototype.hasOwnProperty.call(p, name)) return p;
  }
  return null;
}

function methodOf(name) {
  const owner = ownerOf(CONFIG.Item?.documentClass?.prototype, name);
  const fn = owner?.[name];
  return typeof fn === "function" ? { owner, fn } : null;
}

function readSources() {
  const source = (name) => {
    const method = methodOf(name);
    return method ? Function.prototype.toString.call(unwrap(method.fn)) : "";
  };
  return { onUpdate: source("_onUpdate"), onDelete: source("_onDelete"), preCreate: source("_preCreate") };
}

function classList(actor) {
  return actor.items
    .filter((item) => item.type === "classe")
    .map((item) => ({ id: item.id, inicial: Boolean(item.system?.inicial) }));
}

function send(actor, updates) {
  if (!updates.length) return;
  Promise.resolve(actor.updateEmbeddedDocuments("Item", updates)).catch((err) =>
    console.error(`${LOG} could not update the initial class of ${actor.name}`, err)
  );
}

/** Same as ItemT20#_onUpdate (T20:8301-8329) for a class whose "inicial" changed, with the mark rule fixed. */
function wrapOnUpdate(original, parentOnUpdate) {
  return markWrapper(function (changed, options, userId) {
    const isInitialChange =
      this.type === "classe" && this.parent && foundry.utils.hasProperty(changed?.system ?? {}, "inicial");
    if (!isInitialChange) return original.call(this, changed, options, userId);
    parentOnUpdate.call(this, changed, options, userId);
    if (game.userId !== userId) return;
    try {
      send(this.actor, initialUpdatesOnChange(classList(this.actor), this.id, Boolean(changed.system.inicial)));
      if (foundry.utils.hasProperty(changed.system, "niveis")) {
        this.actor.update({ "system.attributes.nivel.value": this.actor.nivel });
      }
    } catch (err) {
      console.error(`${LOG} could not update the initial class of ${this.actor?.name}`, err);
    }
    if (this.actor) this.actor._checkEncumbered();
  }, original);
}

/** Same as ItemT20#_onDelete (T20:8334-8347) for a class, with the mark rule fixed. */
function wrapOnDelete(original, parentOnDelete) {
  return markWrapper(function (options, userId) {
    if (this.type !== "classe" || !this.parent) return original.call(this, options, userId);
    parentOnDelete.call(this, options, userId);
    if (game.userId !== userId) return;
    try {
      const id = pickInitialClass(classList(this.actor));
      if (id) send(this.actor, [{ _id: id, "system.inicial": true }]);
      this.actor.update({ "system.attributes.nivel.value": this.actor.nivel });
    } catch (err) {
      console.error(`${LOG} could not update the initial class of ${this.actor?.name}`, err);
    }
  }, original);
}

/**
 * After the Item class's _preCreateOperation: the core calls it once per creation, with only the documents that
 * _preCreate and the preCreateItem hooks accepted (core client-backend.mjs:102-121). A vetoed class never takes the mark.
 */
function wrapPreCreateOperation(original) {
  return markWrapper(async function (documents, operation, user) {
    const allowed = await original.call(this, documents, operation, user);
    if (allowed === false) return allowed;
    try {
      const actor = operation?.parent;
      const applies =
        actor?.documentName === "Actor" &&
        actor.type !== "vehicle" &&
        !(actor.type === "npc" && operation.statblockParsing);
      if (applies) {
        const classes = (documents ?? []).filter((doc) => doc?.type === "classe");
        const marks = initialMarksOnCreate(
          actor.items.some((item) => item.type === "classe"),
          classes.length
        );
        classes.forEach((doc, i) => {
          if (Boolean(doc.system?.inicial) !== marks[i]) doc.updateSource({ "system.inicial": marks[i] });
        });
      }
    } catch (err) {
      console.error(`${LOG} could not set the initial class`, err);
    }
    return allowed;
  }, original);
}

function apply() {
  const parts = recognizeParts(readSources());
  const skipped = [];
  for (const [name, wrap] of [
    ["_onUpdate", wrapOnUpdate],
    ["_onDelete", wrapOnDelete]
  ]) {
    const method = methodOf(name);
    // The class path replaces the system method, so only the exact, unwrapped 1.6.5 code is replaced.
    if (!parts[name] || !method || unwrap(method.fn) !== method.fn) {
      skipped.push(name);
      continue;
    }
    const parent = Object.getPrototypeOf(method.owner)?.[name];
    if (typeof parent !== "function") {
      skipped.push(name);
      continue;
    }
    method.owner[name] = wrap(method.fn, parent);
  }
  // The system's class branch of _preCreate is empty; the creation rule goes in the operation-level hook.
  const itemClass = CONFIG.Item?.documentClass;
  if (parts._preCreate && typeof itemClass?._preCreateOperation === "function") {
    itemClass._preCreateOperation = wrapPreCreateOperation(itemClass._preCreateOperation);
  } else skipped.push("_preCreate");
  if (skipped.length) console.warn(`${LOG} system code not recognized, left untouched: ${skipped.join(", ")}`);
}

function isNeeded() {
  return diagnoseInitialClass(recognizeParts(readSources()));
}

export default {
  id: "initial-class",
  group: "actor",
  issue: 54,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  apply
};
