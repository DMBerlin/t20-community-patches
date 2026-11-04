/**
 * Entry point kept for the tools, the tests and the JSDoc types: the code lives in scripts/kernel (#89).
 * @typedef {import("./kernel/diagnosis.mjs").PatchState} PatchState
 * @typedef {import("./kernel/diagnosis.mjs").PatchMode} PatchMode
 * @typedef {import("./kernel/diagnosis.mjs").Diagnosis} Diagnosis
 */

export * from "./kernel/diagnosis.mjs";
export * from "./kernel/notifications.mjs";
export * from "./kernel/modes.mjs";
export * from "./kernel/center.mjs";
