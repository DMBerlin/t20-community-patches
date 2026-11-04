import { cantripLocks, withSafeCost } from "./domain.mjs";
import { APLICA, TOTAL_SELECTOR, addMissingCostInputs, readRows, syncCantrip, toElement } from "./ui.mjs";

/** applyOnUseEffects and its cantrip test are module-local in the system bundle, so the bug cannot be probed. */
export function isNeeded() {
  return {
    bug: "unknown",
    confidence: "low",
    evidence: "applyOnUseEffects (cantrip test) and the dialog template cannot be read during init"
  };
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const ItemClass = ctx.platform.classes.item;
  const AbilityUseDialog = ctx.platform.t20()?.applications?.AbilityUseDialog;
  const allApplicable = ItemClass?.prototype?._allApplicableOnUseEffects;
  const onInputChange = AbilityUseDialog?.prototype?._onInputChange;
  if (typeof allApplicable !== "function" || typeof onInputChange !== "function") {
    throw new Error("Tormenta20 usage effect API not found");
  }
  const localize = (key) => ctx.platform.i18n.localize(key);

  // `this` is the rolled item's clone (ItemT20#roll). Only spells: the system's cantrip test checks item.type.
  ctx.wrap(ItemClass.prototype, "_allApplicableOnUseEffects", function (allApplicable, ...args) {
    const effects = allApplicable.apply(this, args);
    if (this.type !== "magia" || !Array.isArray(effects)) return effects;
    return effects.map((effect) => {
      try {
        return withSafeCost(effect, this.actor);
      } catch (err) {
        ctx.log.warn("could not fix the cost of", effect?.uuid, err);
        return effect;
      }
    });
  });

  // The total stays the one computed below (system or ability-dialog-cost); a checked Truque makes it 0.
  ctx.wrap(AbilityUseDialog.prototype, "_onInputChange", function (onInputChange, html, ...args) {
    const result = onInputChange.call(this, html, ...args);
    try {
      const root = toElement(html);
      if (root && this.item?.type === "magia" && cantripLocks(readRows(this, root)).cantrip !== null) {
        const total = root.querySelector(TOTAL_SELECTOR);
        if (total) total.value = 0;
      }
    } catch (err) {
      ctx.log.error("failed to show the cantrip cost", err);
    }
    return result;
  });

  ctx.hooks.on("renderAbilityUseDialog", (app, html) => {
    try {
      if (!(app instanceof AbilityUseDialog) || app.item?.type !== "magia") return;
      const root = toElement(html);
      const form = root?.querySelector("form");
      if (!form) return;
      addMissingCostInputs(app, root);
      if (!form.dataset.t20cpCantrip) {
        form.dataset.t20cpCantrip = "1";
        form.addEventListener("change", (event) => {
          if (APLICA.test(event.target?.name ?? "")) syncCantrip(app, html, localize);
        });
        // The +/- buttons change the value without a change event; the system's handler runs first.
        form.addEventListener("click", (event) => {
          if (event.target?.closest?.(".numCtrl")) syncCantrip(app, html, localize);
        });
      }
      // Always refresh the total: the template starts with the base cost even when a Truque comes checked
      // ("Aplicar Sempre") and no row needs a lock, and ability-dialog-cost may be off.
      if (!syncCantrip(app, html, localize)) app._onInputChange(html);
    } catch (err) {
      ctx.log.error("failed to prepare the dialog", err);
    }
  });
}
