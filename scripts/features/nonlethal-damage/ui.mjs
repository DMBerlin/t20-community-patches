/**
 * Chat toggle and sheet field of the nonlethal damage rule. `state` is the one built by install (integration.mjs):
 * {platform, log, enabled(), t(key, data), toggleReady, listened}.
 */
import { FLAG_PATH, HP_PATH, effectiveNonlethal, nonlethalOf } from "../../lib/nonlethal.mjs";
import { ACTOR_TYPES, pickDamageRoll, recordedNonlethal, withNonlethalCall } from "./domain/index.mjs";

export const TOGGLE_CLASS = "t20cp-nonlethal";
export const FIELD_CLASS = "t20cp-nonlethal-field";
const FOOTER_CLASS = "t20cp-nonlethal-footer";

function rootOf(html) {
  if (globalThis.HTMLElement && html instanceof HTMLElement) return html;
  return html?.[0] ?? html ?? null;
}

function createToggle(state, pressed = false) {
  const { t } = state;
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add(TOGGLE_CLASS);
  button.setAttribute("aria-pressed", String(!!pressed && state.enabled()));
  button.title = t("Toggle");
  button.dataset.tooltip = `${t("Tooltip")} (${t("Reference")})`;
  button.innerHTML = '<i class="fa-solid fa-hand-fist" inert></i>';
  button.hidden = !state.enabled();
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const pressed = button.getAttribute("aria-pressed") === "true";
    button.setAttribute("aria-pressed", String(!pressed));
  });
  return button;
}

/** Applies the row's damage as nonlethal to the controlled tokens, like the system's _onChatApplyDamage. */
function applyNonlethal(state, message, row, multiplier) {
  const amount = Number(row.querySelector(".dice-total")?.innerText ?? row.querySelector(".dice-total")?.textContent);
  if (!amount || !multiplier) return;
  const tokens = state.platform.canvas.controlledTokens() ?? [];
  if (!tokens.length) return state.platform.notify.warn(state.t("NoTokens"));
  const roll = pickDamageRoll(message?.rolls, row.dataset?.rollTitle);
  return Promise.all(tokens.map(async (token) => {
    const actor = token.actor;
    if (!actor) return;
    const self = withNonlethalCall(actor);
    try {
      if (roll) return await actor.applyDamageV2.call(self, roll, multiplier);
      return await actor.applyDamage.call(self, amount, multiplier, true);
    } catch (err) {
      state.log.error(`failed to apply nonlethal damage to ${actor.name}`, err);
    }
  }));
}

/**
 * Capture listener on the message element: runs before the system's listener on the button. Only acts when the
 * rule is on, the button applies damage (data-mod > 0) and the toggle of the same row is pressed.
 */
export function onCaptureClick(state, event, message) {
  const button = event.target?.closest?.(".apply-dmg");
  if (!button || !state.enabled()) return;
  const multiplier = Number(button.dataset?.mod);
  if (!(multiplier > 0)) return;
  const row = button.closest(".roll");
  const toggle = row?.querySelector(`button.${TOGGLE_CLASS}`);
  if (!toggle || toggle.hidden || toggle.getAttribute("aria-pressed") !== "true") return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  return applyNonlethal(state, message, row, multiplier);
}

export function onRenderChatMessage(state, message, html) {
  try {
    if (!state.toggleReady) return;
    const root = rootOf(html);
    if (!root?.querySelectorAll) return;
    const containers = root.querySelectorAll(".roll.roll--dano .dice-btn.left");
    if (!containers.length) return;
    for (const container of containers) {
      if (container.querySelector(`button.${TOGGLE_CLASS}`)) continue;
      const row = container.closest?.(".roll");
      container.append(createToggle(state, recordedNonlethal(pickDamageRoll(message?.rolls, row?.dataset?.rollTitle))));
    }
    if (!state.listened.has(root)) {
      state.listened.add(root);
      root.addEventListener("click", (event) => onCaptureClick(state, event, message), true);
    }
  } catch (err) {
    state.log.error("failed to add the toggle to the chat card", err);
  }
}

export function onRenderActorSheet(state, sheet, html) {
  try {
    if (!state.enabled()) return;
    const actor = sheet?.actor;
    if (!ACTOR_TYPES.includes(actor?.type)) return;
    const root = rootOf(html);
    const hpInput = root?.querySelector?.(`input[name="${HP_PATH}"]`);
    const footer = hpInput?.closest("li.attribute.health")?.querySelector("footer.attribute-footer");
    if (!footer || footer.querySelector(`input.${FIELD_CLASS}`)) return;
    const pv = actor.system.attributes.pv;
    const n = effectiveNonlethal(nonlethalOf(actor), pv.value, pv.max);
    const input = document.createElement("input");
    input.type = "number";
    input.name = FLAG_PATH;
    input.classList.add(FIELD_CLASS);
    input.dataset.dtype = "Number";
    input.min = "0";
    input.step = "1";
    input.value = n ? String(n) : "";
    input.placeholder = state.t("Toggle");
    input.dataset.tooltip = state.t("Sheet", { nonlethal: n, lethal: Number(pv.value) + n });
    input.disabled = !sheet.isEditable;
    footer.classList.add(FOOTER_CLASS);
    footer.append(input);
  } catch (err) {
    state.log.error("failed to add the sheet field", err);
  }
}

/** Shows or hides the chat toggles already drawn (log, notifications and popouts share the document). */
export function syncChatToggles(enabled, doc = globalThis.document) {
  for (const button of doc?.querySelectorAll?.(`button.${TOGGLE_CLASS}`) ?? []) {
    button.hidden = !enabled;
    if (!enabled) button.setAttribute("aria-pressed", "false");
  }
}
