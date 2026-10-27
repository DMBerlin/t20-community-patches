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
import { MODULE_ID, stripComments, unwrap } from "../utils.mjs";

export const PICK_COUNT = 3;
const KNOWN_DESCRIPTIONS = ["+1 em tres atributos diferentes", "+1 in three different attributes"];

/**
 * Lowercase, without accents and with collapsed spaces.
 * @param {unknown} text
 */
export function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Whether the dialog description is the "+1 in three different attributes" rule.
 * @param {unknown} description  Text of the dialog heading.
 * @param {string} [localized]   The client's translation of T20.DynamicAbilitiesDesc.
 */
export function isThreeDistinctRule(description, localized) {
  const text = normalizeText(description);
  if (!text) return false;
  if (KNOWN_DESCRIPTIONS.includes(text)) return true;
  return !!localized && localized !== "T20.DynamicAbilitiesDesc" && text === normalizeText(localized);
}

/**
 * Toggles one attribute: removes it when selected, adds it while under the limit, otherwise keeps the selection.
 * @param {string[]} selected
 * @param {string} key
 * @param {number} [limit]
 * @returns {string[]}
 */
export function toggleSelection(selected, key, limit = PICK_COUNT) {
  if (selected.includes(key)) return selected.filter((k) => k !== key);
  if (selected.length >= limit) return selected;
  return [...selected, key];
}

/**
 * Which toggles are locked and whether Apply is allowed.
 * @param {string[]} keys      Attributes shown in the dialog.
 * @param {string[]} selected
 * @param {number} [limit]
 * @returns {{canApply: boolean, locked: string[]}}
 */
export function selectionState(keys, selected, limit = PICK_COUNT) {
  const chosen = [...new Set(selected.filter((k) => keys.includes(k)))];
  const full = chosen.length >= limit;
  return {
    canApply: chosen.length === limit,
    locked: full ? keys.filter((k) => !chosen.includes(k)) : []
  };
}

/**
 * Inspects the system's race creation code (comments stripped).
 * @param {unknown} source  Source of ItemT20.prototype._onCreateOwnedRace
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function raceDialogDiagnosis(source) {
  const code = typeof source === "string" ? stripComments(source) : "";
  if (code.includes("dynamic-attributes-dialog.hbs") && /base\s*\+\s*\(\s*value\s*\?\?\s*0\s*\)/.test(code)) {
    return { bug: "present", confidence: "high", evidence: "_onCreateOwnedRace adds the typed value without validation" };
  }
  return { bug: "unknown", confidence: "low", evidence: "_onCreateOwnedRace not recognized" };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const enhancedForms = new WeakSet();
const watchedApps = new WeakMap();

function toElement(html) {
  if (html instanceof HTMLElement) return html;
  return html?.[0] instanceof HTMLElement ? html[0] : null;
}

/** Warns once when the dialog closes without Apply. */
function watchClose(app) {
  if (watchedApps.has(app)) return watchedApps.get(app);
  const state = { applied: false };
  watchedApps.set(app, state);
  app.addEventListener?.(
    "close",
    () => {
      if (!state.applied) ui.notifications.warn(game.i18n.localize("T20CP.RacialAttributes.Skipped"));
    },
    { once: true }
  );
  return state;
}

function enhance(app, html) {
  const root = toElement(html) ?? toElement(app?.element);
  const content = root?.querySelector(".window-content.attribute-config");
  if (!content) return;
  const form = content.querySelector("form");
  if (!form || enhancedForms.has(form)) return;
  if (game.settings.get("tormenta20", "openRaces")) return;
  const heading = content.querySelector(".dialog-content h4");
  if (!isThreeDistinctRule(heading?.textContent, game.i18n.localize("T20.DynamicAbilitiesDesc"))) return;

  const attributes = Object.keys(CONFIG.T20?.atributos ?? {});
  const inputs = [...content.querySelectorAll('.dialog-content input[type="number"][name]')];
  if (inputs.length < PICK_COUNT) return;
  if (inputs.some((input) => !attributes.includes(input.name) || input.value === "" || Number(input.value) !== 0)) return;
  if (new Set(inputs.map((input) => input.name)).size !== inputs.length) return;
  const apply = content.querySelector('button[data-action="apply"]');
  if (!apply) return;

  const i18n = game.i18n;
  const keys = inputs.map((input) => input.name);
  let selected = [];

  // Build every control first; the DOM is only changed once everything is ready.
  const counter = document.createElement("p");
  counter.className = "t20cp-attr-count hint";
  counter.setAttribute("aria-live", "polite");
  const toggles = inputs.map((input) => {
    const label = input.id ? content.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "t20cp-attr-toggle";
    button.id = `${input.id || `attr-${input.name}`}-t20cp`;
    button.innerHTML = '<i class="fa-solid fa-plus" inert></i><span>1</span>';
    button.setAttribute("aria-pressed", "false");
    const name = label?.textContent?.trim() || input.name;
    button.setAttribute("aria-label", i18n.format("T20CP.RacialAttributes.Toggle", { attr: name }));
    button.addEventListener("click", (event) => {
      event.preventDefault();
      selected = toggleSelection(selected, input.name);
      sync();
    });
    return { input, button, label };
  });

  function sync() {
    const state = selectionState(keys, selected);
    for (const { input, button } of toggles) {
      const on = selected.includes(input.name);
      input.value = on ? "1" : "0";
      button.classList.toggle("active", on);
      button.setAttribute("aria-pressed", String(on));
      button.disabled = state.locked.includes(input.name);
    }
    apply.disabled = !state.canApply;
    counter.textContent = i18n.format("T20CP.RacialAttributes.Count", { count: selected.length, max: PICK_COUNT });
  }

  const closeState = watchClose(app);
  const markApplied = () => (closeState.applied = true);
  apply.addEventListener("click", markApplied, { capture: true });
  form.addEventListener("submit", markApplied, { capture: true });

  for (const { input, button, label } of toggles) {
    input.after(button);
    input.hidden = true;
    if (label) label.htmlFor = button.id;
  }
  (inputs.at(-1).closest(".form-group") ?? inputs.at(-1)).after(counter);
  enhancedForms.add(form);
  sync();
}

function isNeeded() {
  const method = unwrap(CONFIG.Item?.documentClass?.prototype?._onCreateOwnedRace);
  if (typeof method !== "function") return { bug: "unknown", confidence: "low", evidence: "_onCreateOwnedRace not found" };
  return raceDialogDiagnosis(Function.prototype.toString.call(method));
}

function apply() {
  Hooks.on("renderDialogV2", (app, html) => {
    try {
      enhance(app, html);
    } catch (err) {
      console.error(`${MODULE_ID} | racial-attribute-choice: failed to enhance the dialog`, err);
    }
  });
}

export default {
  id: "racial-attribute-choice",
  group: "items",
  issue: 75,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  guarded: true,
  isNeeded,
  apply
};
