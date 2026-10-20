/**
 * Validation guard for the Tormenta20 ability use dialog, shared by the optional rules.
 *
 * Wraps AbilityUseDialog#submit (Dialog v1: runs the button callback, then closes). Each registered validator
 * reads the submitted form before the system applies it. Warnings are shown and the use goes on; a blocking
 * result skips the original submit, so the dialog stays open and nothing is spent. Covers every button
 * ("Usar", "Poção") and the Enter key, which all go through submit.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";

/**
 * @typedef {object} UseViolation
 * @property {string} message  Already localized text shown to the user.
 * @property {boolean} [block] Whether the use must be stopped.
 */

/**
 * @typedef {object} UseContext
 * @property {object} dialog    The AbilityUseDialog being submitted.
 * @property {object} item      The rolled item (the system's clone, before the form is applied).
 * @property {object} formData  Flat FormDataExtended object of the dialog form, as the system reads it.
 * @property {object} [button]  Configuration of the clicked button.
 */

/** @type {((context: UseContext) => UseViolation[]|UseViolation|null|undefined)[]} */
const validators = [];

/** @param {(context: UseContext) => UseViolation[]|UseViolation|null|undefined} validator */
export function registerUseValidator(validator) {
  if (typeof validator === "function" && !validators.includes(validator)) validators.push(validator);
}

/**
 * Runs every validator on its own; a validator that throws is reported and ignored, so it never stops a use.
 * @param {Function[]} list
 * @param {UseContext} context
 * @param {(err: unknown) => void} [onError]
 * @returns {{block: boolean, messages: string[]}}
 */
export function runValidators(list, context, onError = () => {}) {
  const messages = [];
  let block = false;
  for (const validator of list) {
    let result;
    try {
      result = validator(context);
    } catch (err) {
      onError(err);
      continue;
    }
    for (const violation of [result].flat()) {
      if (!violation?.message) continue;
      messages.push(violation.message);
      if (violation.block) block = true;
    }
  }
  return { block, messages };
}

function toElement(html) {
  if (html instanceof HTMLElement) return html;
  return html?.[0] instanceof HTMLElement ? html[0] : null;
}

let installed = false;

/** Installs the submit wrapper once. Throws when the system's dialog is missing. */
export function installUseDialogGuard() {
  if (installed) return;
  const AbilityUseDialog = globalThis.tormenta20?.applications?.AbilityUseDialog;
  const original = AbilityUseDialog?.prototype?.submit;
  if (typeof original !== "function") throw new Error("Tormenta20 AbilityUseDialog not found");

  AbilityUseDialog.prototype.submit = markWrapper(function (button, event) {
    let verdict = { block: false, messages: [] };
    try {
      const form = toElement(this.element)?.querySelector("form");
      if (form && this.item && validators.length) {
        const formData = new foundry.applications.ux.FormDataExtended(form).object;
        verdict = runValidators(validators, { dialog: this, item: this.item, formData, button }, (err) =>
          console.error(`${MODULE_ID} | Use dialog validator failed`, err)
        );
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Use dialog guard failed`, err);
    }
    for (const message of verdict.messages) ui.notifications.warn(message);
    if (verdict.block) return;
    return original.call(this, button, event);
  }, original);
  installed = true;
}
