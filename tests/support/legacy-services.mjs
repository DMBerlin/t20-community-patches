/**
 * Services for the tests of rules that still read the Foundry globals (#87). The services are installed over the
 * fake Foundry of the current setup, once per CONFIG.Item.documentClass, so every rule installed in the same setup
 * shares them, as in main.mjs, and a new setup gets new ones.
 */
import { createPlatform } from "../../scripts/platform/foundry.mjs";
import { createTestKernel } from "./fake-platform.mjs";

const kernels = new WeakMap();

function kernel() {
  const key = globalThis.CONFIG?.Item?.documentClass;
  if (!key) throw new Error("legacy-services: set CONFIG.Item.documentClass first");
  if (!kernels.has(key)) kernels.set(key, createTestKernel({ platform: createPlatform() }));
  return kernels.get(key);
}

/** The use-targets service of the current setup. */
export const currentUseTargets = () => kernel().service("use-targets");

/** The attack-outcome service of the current setup. */
export const currentAttackOutcome = () => kernel().service("attack-outcome");
