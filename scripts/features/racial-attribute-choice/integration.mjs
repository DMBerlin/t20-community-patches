import { PICK_COUNT, isThreeDistinctRule, raceDialogDiagnosis, selectionState, toggleSelection } from "./domain.mjs";

export const ON_CREATE_RACE = "ItemT20#_onCreateOwnedRace";

const enhancedForms = new WeakSet();
const watchedApps = new WeakMap();

function toElement(html) {
  if (html instanceof HTMLElement) return html;
  return html?.[0] instanceof HTMLElement ? html[0] : null;
}

/** Warns once when the dialog closes without Apply. */
function watchClose(ctx, app) {
  if (watchedApps.has(app)) return watchedApps.get(app);
  const state = { applied: false };
  watchedApps.set(app, state);
  app.addEventListener?.(
    "close",
    () => {
      if (!state.applied) ctx.platform.notify.warn(ctx.platform.i18n.localize("T20CP.RacialAttributes.Skipped"));
    },
    { once: true }
  );
  return state;
}

/** The numeric inputs of the dialog, when they are exactly the system attributes, distinct and all at zero. */
function attributeInputs(ctx, content) {
  const attributes = Object.keys(ctx.platform.t20Config()?.atributos ?? {});
  const inputs = [...content.querySelectorAll('.dialog-content input[type="number"][name]')];
  if (inputs.length < PICK_COUNT) return null;
  if (inputs.some((input) => !attributes.includes(input.name) || input.value === "" || Number(input.value) !== 0)) return null;
  if (new Set(inputs.map((input) => input.name)).size !== inputs.length) return null;
  return inputs;
}

/** The parts of a "+1 in three different attributes" dialog not enhanced yet, or null. */
function dialogParts(ctx, app, html) {
  const root = toElement(html) ?? toElement(app?.element);
  const content = root?.querySelector(".window-content.attribute-config");
  if (!content) return null;
  const form = content.querySelector("form");
  if (!form || enhancedForms.has(form)) return null;
  if (ctx.platform.settingsOf("tormenta20").get("openRaces")) return null;
  const heading = content.querySelector(".dialog-content h4");
  if (!isThreeDistinctRule(heading?.textContent, ctx.platform.i18n.localize("T20.DynamicAbilitiesDesc"))) return null;
  const inputs = attributeInputs(ctx, content);
  if (!inputs) return null;
  const apply = content.querySelector('button[data-action="apply"]');
  return apply ? { content, form, inputs, apply } : null;
}

function createToggle(content, input, i18n, onClick) {
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
    onClick();
  });
  return { input, button, label };
}

function enhance(ctx, app, html) {
  const parts = dialogParts(ctx, app, html);
  if (!parts) return;
  const { content, form, inputs, apply } = parts;

  const i18n = ctx.platform.i18n;
  const keys = inputs.map((input) => input.name);
  let selected = [];

  // Build every control first; the DOM is only changed once everything is ready.
  const counter = document.createElement("p");
  counter.className = "t20cp-attr-count hint";
  counter.setAttribute("aria-live", "polite");
  const toggles = inputs.map((input) =>
    createToggle(content, input, i18n, () => {
      selected = toggleSelection(selected, input.name);
      sync();
    })
  );

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

  const closeState = watchClose(ctx, app);
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

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const source = ctx.platform.sourceOfMethod(ON_CREATE_RACE);
  if (source == null) return { bug: "unknown", confidence: "low", evidence: "_onCreateOwnedRace not found" };
  return raceDialogDiagnosis(source);
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  ctx.hooks.on("renderDialogV2", (app, html) => {
    try {
      enhance(ctx, app, html);
    } catch (err) {
      ctx.log.error("failed to enhance the dialog", err);
    }
  });
}
