/**
 * Racial attribute choice (tormenta20 1.6.5).
 *
 * Bug: the "Atributos Dinâmicos" dialog (ItemT20._onCreateOwnedRace) shows a free number input per attribute and adds
 * whatever is typed to the racial value, so "+1 in three different attributes" accepts +5, all zeros or four +1s.
 * Closing the dialog silently creates the race without the bonus.
 *
 * Fix: for races whose description is "+1 in three different attributes", the inputs are hidden and driven by
 * +1 toggle buttons: exactly three distinct attributes, the others locked at three, Apply enabled only with three.
 * The system's callback still reads the (hidden, numeric) inputs. Closing without applying warns the user.
 */
import { ON_CREATE_RACE, install, isNeeded } from "./integration.mjs";

export default {
  id: "racial-attribute-choice",
  group: "items",
  issue: 75,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  sources: [ON_CREATE_RACE],
  guarded: true,
  isNeeded,
  install
};
