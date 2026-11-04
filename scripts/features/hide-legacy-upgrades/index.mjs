/**
 * Hide the legacy "Deprecated" upgrades area (tormenta20 1.6.5).
 *
 * Bug: templates/item/parts/item-enhancements.hbs renders a <fieldset><legend>Deprecated</legend> block with the
 * old upgrade UI. Its selects have no `name` (never saved), its checkbox targets a non-existent field and its only
 * change handler returns immediately. It duplicates the new upgrade fields and misleads users.
 *
 * Fix: remove the fieldset from item sheets on render. No data is changed.
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "hide-legacy-upgrades",
  group: "items",
  issue: 8,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  // The template can't be inspected synchronously during init; the hook only acts when the legacy block exists.
  guarded: true,
  isNeeded,
  install
};
