/**
 * Sheet breakdowns of tokens and of the Defesa (tormenta20 1.6.5).
 *
 * The `fieldBonuses` Handlebars helper (T20:3081-3290) builds the breakdown shown when hovering a value on the actor
 * sheet (atributos, PV, PM, Defesa, perícias). It rebuilds the total from its own list instead of reading the
 * prepared value, and has two bugs:
 * - It finds the actor with `game.actors.get(sheet.actor._id)` before `fromUuidSync(sheet.uuid)`. The sheet of an
 *   unlinked token has the base actor's _id, so every breakdown of that sheet shows the base actor's data.
 * - The Defesa branch never lists `defesa.condi`, the Defesa penalty of conditions (Desprevenido, Cego, Enredado,
 *   Vulnerável…), which prepareDefense adds to the value (`defesa.condi`, T20:18751).
 *
 * Fix: for a token sheet the helper receives a root whose actor has no _id, so it resolves the sheet's own actor by
 * uuid; the Defesa breakdown gets a "Condição" line before the total, which is corrected. Each part is installed
 * only when its bug is recognized in the helper's source, so a partial fix upstream is never undone or doubled.
 */
import { HELPER, install, isNeeded } from "./integration.mjs";

export default {
  id: "field-bonuses-tooltip",
  group: "sheet-effects",
  issue: 39,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  sources: [HELPER, "AttributesFields.prepareDefense"],
  isNeeded,
  install
};
