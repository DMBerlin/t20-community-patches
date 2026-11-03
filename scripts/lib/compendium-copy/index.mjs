/**
 * Helpers for patches that correct, in _preCreate, the world copy of a system compendium entry whose data diverges
 * from the rulebook. A copy is corrected only when it comes from the known entry and still holds the exact wrong
 * mechanical data, so manual edits, other modules' data and a future system fix are left alone.
 */
export * from "./signatures.mjs";
export * from "./passive.mjs";
export * from "./copies.mjs";
