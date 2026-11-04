import stackingExclusions from "./stacking-exclusions.mjs";
import attackOutcome from "./attack-outcome.mjs";
import manaQueue from "./mana-queue.mjs";
import useDialogGuard from "./use-dialog-guard.mjs";
import useTargets from "./use-targets.mjs";
import appliedChanges from "./applied-changes.mjs";

/**
 * Shared stateful contracts (#87), installed by the kernel on demand (scripts/kernel/services.mjs). A feature uses
 * one by declaring its id in `services` and reading `ctx.services[id]`.
 * @type {import("../kernel/services.mjs").Service[]}
 */
export const SERVICES = [stackingExclusions, useDialogGuard, manaQueue, useTargets, attackOutcome, appliedChanges];
