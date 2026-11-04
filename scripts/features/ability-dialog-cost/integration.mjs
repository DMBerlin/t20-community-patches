import { SOURCES, baseActivationCost, computeDialogCost, dialogCostIsBroken } from "./domain.mjs";

const TOTAL_SELECTOR = ".total-cost .cost";

function toElement(html) {
  if (html instanceof HTMLElement) return html;
  return html?.[0] instanceof HTMLElement ? html[0] : null;
}

/** Mirrors the system's reading of the enhancement rows (checkbox or quantity input + hidden cost). */
function readCosts(root) {
  const costs = [];
  for (const input of root.querySelectorAll(".aprimoramentos-list li input:not([type=hidden])")) {
    const hidden = input.closest("div")?.querySelector("input[type=hidden]");
    if (!hidden) continue;
    if (input.type === "checkbox") {
      if (input.checked) costs.push({ cost: hidden.value });
    } else if (Number(input.value)) {
      costs.push({ cost: hidden.value, quantity: input.value });
    }
  }
  return costs;
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const [onInputChange, create] = SOURCES.map((label) => ctx.platform.sourceOfMethod(label));
  if (onInputChange == null || create == null) return undefined;
  return dialogCostIsBroken(onInputChange, create);
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const AbilityUseDialog = ctx.platform.t20()?.applications?.AbilityUseDialog;
  if (typeof AbilityUseDialog?.prototype?._onInputChange !== "function") {
    throw new Error("Tormenta20 AbilityUseDialog not found");
  }

  ctx.wrap(AbilityUseDialog.prototype, "_onInputChange", function (original, html, ...args) {
    const root = toElement(html);
    const inputCost = root?.querySelector(TOTAL_SELECTOR);
    if (!inputCost) return original.call(this, html, ...args);
    inputCost.value = computeDialogCost({
      costs: readCosts(root),
      initialCost: inputCost.dataset.initialCost,
      adjustment: root.querySelector("input[name=ajustecusto]")?.value
    });
  });

  ctx.hooks.on("renderAbilityUseDialog", (app, html) => {
    try {
      if (!(app instanceof AbilityUseDialog)) return;
      const root = toElement(html);
      const inputCost = root?.querySelector(TOTAL_SELECTOR);
      if (!inputCost) return;
      inputCost.dataset.initialCost = String(baseActivationCost(app.item?.system));
      app._onInputChange(html);
    } catch (err) {
      ctx.log.error("failed to compute the initial cost", err);
    }
  });
}
