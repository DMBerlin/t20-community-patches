/**
 * Legacy condition status (tormenta20 1.6.5–1.6.6, worlds migrated from 1.5).
 *
 * Bug: migration 1.6.0 (migrateEffectsV2, T20:20824-20832) writes the 1.5 condition data to a root `status` key,
 * which the ActiveEffect drops, so migrated conditions keep `system.status` null; unlinked token actors are never
 * migrated (shadowed `operations` in migration_1_6_0, T20:20640, token loop at 20667-20682). With no `system.status`, BaseEffect#isSuppressed (T20:16569)
 * skips immunity, upgrade, duplicate and inheritance, and deleting the condition leaves its child effects behind.
 *
 * Fix: a GM-only tool in the module settings lists those conditions, previews `system.status` rebuilt from the 1.5
 * flags still on the effect (`flags.tormenta20.category|stack|childEffect|ignoreImunity`) and, once confirmed, writes
 * it with a module mark that allows undoing.
 */
import { SOURCES, install, isNeeded, lateProbe } from "./integration/index.mjs";

export default {
  id: "legacy-condition-status",
  group: "conditions",
  issue: 95,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  sources: [...SOURCES, "BaseEffect#isSuppressed"],
  isNeeded,
  lateProbe,
  install
};
