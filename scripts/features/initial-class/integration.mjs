import { markWrapper, unwrap } from "../../lib/source.mjs";
import { fromFactory } from "../../kernel/wrap.mjs";
import {
  diagnoseInitialClass,
  initialMarksOnCreate,
  initialUpdatesOnChange,
  pickInitialClass,
  recognizeParts,
  SOURCES
} from "./domain.mjs";

function ownerOf(proto, name) {
  for (let p = proto; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    if (Object.prototype.hasOwnProperty.call(p, name)) return p;
  }
  return null;
}

function methodOf(ctx, name) {
  const owner = ownerOf(ctx.platform.classes.item?.prototype, name);
  const fn = owner?.[name];
  return typeof fn === "function" ? { owner, fn } : null;
}

function readSources(ctx) {
  const source = (label) => ctx.platform.sourceOfMethod(label) ?? "";
  return Object.fromEntries(Object.entries(SOURCES).map(([part, label]) => [part, source(label)]));
}

/** The methods the wrappers replace, read where install() puts them (the owner may be core). */
function installedSources(ctx) {
  const source = (name) => {
    const method = methodOf(ctx, name);
    return method ? Function.prototype.toString.call(unwrap(method.fn)) : "";
  };
  return { onUpdate: source("_onUpdate"), onDelete: source("_onDelete"), preCreate: source("_preCreate") };
}

function classList(actor) {
  return actor.items
    .filter((item) => item.type === "classe")
    .map((item) => ({ id: item.id, inicial: Boolean(item.system?.inicial) }));
}

function send(ctx, actor, updates) {
  if (!updates.length) return;
  Promise.resolve(actor.updateEmbeddedDocuments("Item", updates)).catch((err) =>
    ctx.log.error(`could not update the initial class of ${actor.name}`, err)
  );
}

/** Same as ItemT20#_onUpdate (T20:7129-7157) for a class whose "inicial" changed, with the mark rule fixed. */
function wrapOnUpdate(ctx, original, parentOnUpdate) {
  const { hasProperty } = ctx.platform.utils;
  return markWrapper(function (changed, options, userId) {
    const isInitialChange = this.type === "classe" && this.parent && hasProperty(changed?.system ?? {}, "inicial");
    if (!isInitialChange) return original.call(this, changed, options, userId);
    parentOnUpdate.call(this, changed, options, userId);
    if (ctx.platform.user.id() !== userId) return;
    try {
      send(ctx, this.actor, initialUpdatesOnChange(classList(this.actor), this.id, Boolean(changed.system.inicial)));
      if (hasProperty(changed.system, "niveis")) {
        this.actor.update({ "system.attributes.nivel.value": this.actor.nivel });
      }
    } catch (err) {
      ctx.log.error(`could not update the initial class of ${this.actor?.name}`, err);
    }
    if (this.actor) this.actor._checkEncumbered();
  }, original);
}

/** Same as ItemT20#_onDelete (T20:7162-7175) for a class, with the mark rule fixed. */
function wrapOnDelete(ctx, original, parentOnDelete) {
  return markWrapper(function (options, userId) {
    if (this.type !== "classe" || !this.parent) return original.call(this, options, userId);
    parentOnDelete.call(this, options, userId);
    if (ctx.platform.user.id() !== userId) return;
    try {
      const id = pickInitialClass(classList(this.actor));
      if (id) send(ctx, this.actor, [{ _id: id, "system.inicial": true }]);
      this.actor.update({ "system.attributes.nivel.value": this.actor.nivel });
    } catch (err) {
      ctx.log.error(`could not update the initial class of ${this.actor?.name}`, err);
    }
  }, original);
}

/** Sets system.inicial on the classes of one creation operation, when the actor follows the class rule. */
function markCreatedClasses(documents, operation) {
  const actor = operation?.parent;
  const applies =
    actor?.documentName === "Actor" && actor.type !== "vehicle" && !(actor.type === "npc" && operation.statblockParsing);
  if (!applies) return;
  const classes = (documents ?? []).filter((doc) => doc?.type === "classe");
  const marks = initialMarksOnCreate(
    actor.items.some((item) => item.type === "classe"),
    classes.length
  );
  classes.forEach((doc, i) => {
    if (Boolean(doc.system?.inicial) !== marks[i]) doc.updateSource({ "system.inicial": marks[i] });
  });
}

/**
 * After the Item class's _preCreateOperation: the core calls it once per creation, with only the documents that
 * _preCreate and the preCreateItem hooks accepted (core client-backend.mjs:102-121). A vetoed class never takes the mark.
 */
function wrapPreCreateOperation(ctx, original) {
  return markWrapper(async function (documents, operation, user) {
    const allowed = await original.call(this, documents, operation, user);
    if (allowed === false) return allowed;
    try {
      markCreatedClasses(documents, operation);
    } catch (err) {
      ctx.log.error("could not set the initial class", err);
    }
    return allowed;
  }, original);
}

/** Wraps one class method when it is the exact, unwrapped 1.6.5 code; returns whether it did. */
function wrapClassMethod(ctx, name, factory, recognized) {
  const method = methodOf(ctx, name);
  // The class path replaces the system method, so only the exact, unwrapped 1.6.5 code is replaced.
  if (!recognized || !method || unwrap(method.fn) !== method.fn) return false;
  const parent = Object.getPrototypeOf(method.owner)?.[name];
  if (typeof parent !== "function") return false;
  ctx.wrap(method.owner, name, fromFactory((original) => factory(ctx, original, parent)));
  return true;
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const parts = recognizeParts(installedSources(ctx));
  const skipped = [];
  for (const [name, factory] of [
    ["_onUpdate", wrapOnUpdate],
    ["_onDelete", wrapOnDelete]
  ]) {
    if (!wrapClassMethod(ctx, name, factory, parts[name])) skipped.push(name);
  }
  // The system's class branch of _preCreate is empty; the creation rule goes in the operation-level hook.
  const itemClass = ctx.platform.classes.item;
  if (parts._preCreate && typeof itemClass?._preCreateOperation === "function") {
    ctx.wrap(itemClass, "_preCreateOperation", fromFactory((original) => wrapPreCreateOperation(ctx, original)));
  } else skipped.push("_preCreate");
  if (skipped.length) ctx.log.warn(`system code not recognized, left untouched: ${skipped.join(", ")}`);
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  return diagnoseInitialClass(recognizeParts(readSources(ctx)));
}
