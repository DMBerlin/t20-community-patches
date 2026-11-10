import { stripComments } from "../../lib/source.mjs";

export const MODULE_SCOPE = "t20-community-patches";
export const MARK = "legacyConditionStatus";

const text = (value) => (typeof value === "string" ? value.trim() : "");
const ids = (value) => [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))];

/** A 1.5 condition that migration 1.6.0 left without `system.status`. */
export function isCandidate(source) {
  if (source?.flags?.tormenta20?.condition !== true) return false;
  if (source.system?.onuse) return false;
  return source.system?.status == null;
}

/** `system.status` rebuilt from the 1.5 flags, in the shape of the schema (T20:16409-16437). */
export function statusFromFlags(flags) {
  return {
    category: text(flags?.category),
    ignoreImunity: flags?.ignoreImunity === true,
    upgrade: text(flags?.stack),
    childEffect: ids(flags?.childEffect)
  };
}

export function repairUpdate(source, { at, moduleVersion }) {
  const status = statusFromFlags(source.flags.tormenta20);
  return {
    _id: source._id,
    "system.status": status,
    [`flags.${MODULE_SCOPE}.${MARK}`]: { status, at, moduleVersion }
  };
}

export const sameStatus = (a, b) =>
  !!a && !!b &&
  text(a.category) === text(b.category) &&
  !!a.ignoreImunity === !!b.ignoreImunity &&
  text(a.upgrade) === text(b.upgrade) &&
  // JSON, not join(): ["a,b"] and ["a", "b"] must differ.
  JSON.stringify(ids(a.childEffect).sort()) === JSON.stringify(ids(b.childEffect).sort());

/**
 * Undo of a repaired effect: only when its status is still the one the tool wrote.
 * @returns {{kind: "undo", update: object}|{kind: "changed"}|null} null when the effect was not repaired.
 */
export function undoPlan(source) {
  const mark = source?.flags?.[MODULE_SCOPE]?.[MARK];
  if (!mark) return null;
  if (!sameStatus(source.system?.status, mark.status)) return { kind: "changed" };
  return { kind: "undo", update: { _id: source._id, "system.status": null, [`flags.${MODULE_SCOPE}.-=${MARK}`]: null } };
}

/**
 * Candidates of one parent document, from raw sources.
 * @param {object[]} effectSources  `_source.effects` of the parent.
 */
export function candidatesOf(effectSources) {
  return (effectSources ?? []).filter(isCandidate).map((source) => ({
    id: source._id,
    name: source.name,
    status: statusFromFlags(source.flags.tormenta20)
  }));
}

/** Recognizes the 1.6.5–1.6.7 migration branch that writes `status` at the root. */
export function diagnose(source) {
  const code = typeof source === "string" ? stripComments(source).replace(/\s+/g, "") : "";
  if (!code) return { bug: "unknown", confidence: "low", evidence: "migrateEffectsV2 source not available" };
  if (code.includes("if(flags?.condition){Object.assign(updateData,{status:{")) {
    return { bug: "present", confidence: "low", evidence: "migration 1.6.0 writes the condition status at the root" };
  }
  return { bug: "unknown", confidence: "low", evidence: "migrateEffectsV2 implementation not recognized" };
}
