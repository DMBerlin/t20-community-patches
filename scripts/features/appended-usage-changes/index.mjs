/**
 * Appended usage changes (tormenta20 1.6.5).
 *
 * Bug: applyOnUseEffects mutates the live usage effects of other items (the "+" branch strips the "+" from the
 * change object and pushes that same object; the final reduce rewrites its value), and a "+system.*" change with
 * abilityUse.aumenta=false is appended twice to the main effect (once by the "+" branch, once by addToChange,
 * which already sees the stripped key). Inspiração Marcial doubles the damage bonus and leaks it to later uses.
 *
 * Fix: the applicable usage effects are isolated clones, and in that proven case the clone's "+system.*" key is
 * normalized to "system.*", so addToChange appends it exactly once.
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "appended-usage-changes",
  group: "usage-effects",
  issue: 23,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  sources: ["#local:applyEffectChanges", "#local:applyOnUseEffects"],
  isNeeded,
  install
};
