import { stripComments } from "../../lib/source.mjs";

export const SOURCES = { onUpdate: "ItemT20#_onUpdate", onDelete: "ItemT20#_onDelete", preCreate: "ItemT20#_preCreate" };

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

/** ItemT20#_preCreate does nothing for classes (`case "classe"`, T20:7101-7104). */
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
 * @returns {import("../../registry.mjs").Diagnosis}
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
 * and only when the actor had no class (the system's own rule for the first drop, `system.inicial`, T20:13191).
 * @param {boolean} actorHasClass  Whether the actor already has a class.
 * @param {number} count           Number of classes accepted in the operation.
 * @returns {boolean[]}
 */
export function initialMarksOnCreate(actorHasClass, count) {
  return Array.from({ length: Math.max(0, count | 0) }, (_, i) => !actorHasClass && i === 0);
}
