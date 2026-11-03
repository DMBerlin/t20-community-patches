/**
 * Validation guard for the Tormenta20 ability use dialog (service, #87), shared by the optional rules.
 *
 * Wraps AbilityUseDialog#submit (Dialog v1: runs the button callback, then closes). Each registered validator
 * reads the submitted form before the system applies it. Warnings are shown and the use goes on; a blocking
 * result skips the original submit, so the dialog stays open and nothing is spent. Covers every button
 * ("Usar", "Poção") and the Enter key, which all go through submit.
 */

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

/** The element of the dialog: an HTMLElement, or the first element of a jQuery object. */
function toElement(html) {
  if (typeof html?.querySelector === "function") return html;
  return typeof html?.[0]?.querySelector === "function" ? html[0] : null;
}

/**
 * Wraps the submit of the system's dialog. When the dialog is missing the service still installs, and `register`
 * throws: each rule decides whether that stops it (casting-restrictions goes on without its dialog check).
 * @param {import("../kernel/services.mjs").ServiceContext} ctx
 */
export function installUseDialogGuard(ctx) {
  const { platform } = ctx;
  /** @type {((context: UseContext) => UseViolation[]|UseViolation|null|undefined)[]} */
  const validators = [];
  const AbilityUseDialog = platform.t20()?.applications?.AbilityUseDialog;
  if (typeof AbilityUseDialog?.prototype?.submit !== "function") {
    return {
      register() {
        throw new Error("Tormenta20 AbilityUseDialog not found");
      }
    };
  }

  ctx.wrap(AbilityUseDialog.prototype, "submit", function (original, button, event) {
    let verdict = { block: false, messages: [] };
    try {
      const form = toElement(this.element)?.querySelector("form");
      if (form && this.item && validators.length) {
        const formData = platform.forms.data(form);
        verdict = runValidators(validators, { dialog: this, item: this.item, formData, button }, (err) =>
          platform.log.error("Use dialog validator failed", err)
        );
      }
    } catch (err) {
      platform.log.error("Use dialog guard failed", err);
    }
    for (const message of verdict.messages) platform.notify.warn(message);
    if (verdict.block) return;
    return original.call(this, button, event);
  });

  return {
    /** @param {(context: UseContext) => UseViolation[]|UseViolation|null|undefined} validator */
    register(validator) {
      if (typeof validator === "function" && !validators.includes(validator)) validators.push(validator);
    }
  };
}

/** @type {import("../kernel/services.mjs").Service} */
export default {
  id: "use-dialog-guard",
  install: installUseDialogGuard
};
