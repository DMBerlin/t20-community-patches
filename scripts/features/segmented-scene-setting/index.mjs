/**
 * Segmented Scene setting (tormenta20 1.6.5).
 *
 * Bug: "tormenta20.segmentedScene" is registered with config:true and a SchemaField type. SettingsConfig cannot render
 * a field without form support (SchemaField has no _toInput); the formGroup helper logs the error and drops the row,
 * so the GM gets a console error every time the settings window opens and the optional rule cannot be configured.
 *
 * Fix: hide the broken row (config=false) and add a menu button in the system tab opening a small ApplicationV2 form
 * that edits `max` and `value`, saving the same {value, max} object through game.settings.set.
 *
 * The system draws one circle per segment in the players list on every client, so `max` is capped by a module
 * setting (default 10). Values above the cap are rejected; a stored value above it only warns the GMs.
 */
import { LIMIT_SPEC, install, isNeeded } from "./integration.mjs";

export default {
  id: "segmented-scene-setting",
  group: "settings",
  issue: 9,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  probeKind: "behavior",
  sources: ["#local:SystemSettings"],
  settings: [LIMIT_SPEC],
  isNeeded,
  install
};
