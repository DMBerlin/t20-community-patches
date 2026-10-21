/**
 * Spell PM cost dropped to zero by a false cantrip (tormenta20 1.6.5).
 *
 * Bug: applyOnUseEffects (module-local) marks the use as a cantrip when `!Number(custo + 1)` for any applied usage
 * effect of a spell. The test was written for the "Truque" text the dialog sends, but it also matches the number -1
 * (ItemT20#roll builds numbers for "Aplicar Sempre" effects when the dialog is skipped) and a missing cost (the dialog
 * template has no hidden cost input for effects with cost 0). The spell then costs 0 PM. The dialog also lets a
 * Truque be combined with other enhancements, which the rules forbid (Tormenta20 JdA, p. 171).
 *
 * Fix: the rolled spell's usage effects reach the system with a cost its test reads correctly (-1 becomes "-1", as
 * the dialog form already sends it), the dialog gets the missing hidden cost input (empty value), and a checked
 * Truque locks the other enhancements and shows a total of 0.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";

export const CANTRIP_COST = "Truque";

const LOCK_CLASS = "t20cp-cantrip-locked";
const TOTAL_SELECTOR = ".total-cost .cost";
const ROW_SELECTOR = ".aprimoramentos-list li";
const APLICA = /^aprs\.([^.]+)\.aplica$/;

/**
 * The system's cantrip test (applyOnUseEffects): `!Number(applied[ef.id]?.custo + 1)`.
 * @param {unknown} custo  Cost of an applied usage effect, as the system receives it.
 * @returns {boolean}
 */
export function systemReadsAsCantrip(custo) {
  return !Number(custo + 1);
}

/**
 * Cost to hand the system. A number its test misreads as a cantrip (-1) goes as text, as the dialog form sends it:
 * `"-1" + 1` is "-11", and `Number("-1") * aplica` still adds -1 PM. Every other value is returned untouched.
 * @param {unknown} custo  abilityUse.custo of the effect.
 * @returns {unknown}
 */
export function safeUsageCost(custo) {
  return typeof custo === "number" && Number.isFinite(custo) && systemReadsAsCantrip(custo) ? String(custo) : custo;
}

/**
 * Whether the effect is a disposable copy that may be changed in place: an effect of the rolled item's clone, or a
 * copy that is not in its parent's collection (appended-usage-changes). Stored effects, and anything uncertain,
 * return false and are cloned before any change.
 * @param {{id: string, parent?: {id: string, effects?: {get?: Function}}}} effect
 * @param {{items?: {get?: Function}}} actor  Actor of the rolled item.
 * @returns {boolean}
 */
export function isDisposableEffect(effect, actor) {
  const parent = effect?.parent;
  if (!parent || !actor || typeof parent.effects?.get !== "function") return false;
  if (parent.effects.get(effect.id) !== effect) return true;
  return parent !== actor && actor.items?.get?.(parent.id) !== parent;
}

/**
 * The effect with a safe cost: the same object when nothing changes, the effect itself when it is a disposable copy,
 * or a clone (same id) when it is a stored document, which is never changed.
 * @param {object} effect
 * @param {object} actor
 * @returns {object}
 */
export function withSafeCost(effect, actor) {
  const custo = effect?.system?.abilityUse?.custo;
  const safe = safeUsageCost(custo);
  if (safe === custo) return effect;
  const target = isDisposableEffect(effect, actor) ? effect : effect.clone({}, { keepId: true });
  target.system.abilityUse.custo = safe;
  return target;
}

/**
 * @typedef {object} DialogRow
 * @property {string} id        Usage effect id.
 * @property {boolean} own      The effect belongs to the rolled spell (one of its enhancements).
 * @property {boolean} cantrip  Its hidden cost is "Truque".
 * @property {number} cost      Number(hidden cost): NaN for "Truque", 0 for empty.
 * @property {boolean} active   Checked, or applied at least once.
 */

/**
 * Rows locked by a checked Truque. The first active Truque wins. It locks the spell's other enhancements, any other
 * Truque and any paid row from another source (enhancement powers such as Magia Ampliada, +2 PM). Bonuses and
 * reductions from other sources (no cost, 0 or negative, such as Foco em Magia) stay free.
 * @param {DialogRow[]} rows
 * @returns {{cantrip: string|null, locked: Set<string>}}
 */
export function cantripLocks(rows = []) {
  const cantrip = rows.find((row) => row.cantrip && row.active)?.id ?? null;
  const locked = new Set();
  if (cantrip === null) return { cantrip, locked };
  for (const row of rows) {
    if (row.id === cantrip) continue;
    if (row.own || row.cantrip || Number(row.cost) > 0) locked.add(row.id);
  }
  return { cantrip, locked };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function toElement(html) {
  if (html instanceof HTMLElement) return html;
  return html?.[0] instanceof HTMLElement ? html[0] : null;
}

function getDialogClass() {
  return globalThis.tormenta20?.applications?.AbilityUseDialog;
}

function costInput(li, id) {
  return li.querySelector(`input[type=hidden][name="aprs.${id}.custo"]`);
}

/** Reads the enhancement rows of the dialog. */
function readRows(app, root) {
  const effects = new Map((app.item?.applicableOnUseEffects ?? []).map((ef) => [ef.id, ef]));
  const rows = [];
  for (const li of root.querySelectorAll(ROW_SELECTOR)) {
    const input = [...li.querySelectorAll("input[name]")].find((el) => el.type !== "hidden" && APLICA.test(el.name));
    if (!input) continue;
    const id = input.name.match(APLICA)[1];
    const hidden = costInput(li, id);
    const effect = effects.get(id);
    rows.push({
      id,
      li,
      input,
      own: !!effect && effect.parent?.id === app.item.id,
      cantrip: hidden?.value === CANTRIP_COST,
      cost: Number(hidden?.value ?? 0),
      active: input.type === "checkbox" ? input.checked : Number(input.value) > 0
    });
  }
  return rows;
}

/** Rows of effects with cost 0 have no hidden cost input, so the system reads `undefined` (a cantrip). */
function addMissingCostInputs(app, root) {
  for (const row of readRows(app, root)) {
    if (costInput(row.li, row.id)) continue;
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.name = `aprs.${row.id}.custo`;
    hidden.value = "";
    (row.input.closest("div") ?? row.li).append(hidden);
  }
}

function setDisabled(li, input, disabled) {
  input.disabled = disabled;
  for (const button of li.querySelectorAll(".numCtrl")) button.disabled = disabled;
}

function lockRow({ li, input }, hint) {
  li.dataset.t20cpPrev = input.type === "checkbox" ? (input.checked ? "1" : "") : String(input.value);
  if (input.type === "checkbox") input.checked = false;
  else input.value = 0;
  setDisabled(li, input, true);
  li.classList.add(LOCK_CLASS);
  li.style.opacity = "0.5";
  li.dataset.tooltip = hint;
}

function unlockRow({ li, input }) {
  const prev = li.dataset.t20cpPrev ?? "";
  if (input.type === "checkbox") input.checked = prev === "1";
  else input.value = prev || 0;
  setDisabled(li, input, false);
  li.classList.remove(LOCK_CLASS);
  li.style.opacity = "";
  delete li.dataset.t20cpPrev;
  delete li.dataset.tooltip;
}

/**
 * Applies the Truque locks to the dialog and refreshes the total when a row changed. Unlocking restores rows, which
 * may check another Truque again, so the locks are recomputed until nothing changes (each pass either locks around
 * the first active Truque, which stays active, or unlocks everything, so it settles in two passes; the bound is a
 * safety net).
 * @returns {boolean} Whether the total was refreshed.
 */
function syncCantrip(app, html) {
  const root = toElement(html);
  if (!root || app.item?.type !== "magia") return false;
  const hint = game.i18n.localize("T20CP.SpellCost.Locked");
  let changed = false;
  for (let pass = 0; pass < 5; pass++) {
    const rows = readRows(app, root);
    const { locked } = cantripLocks(rows);
    let passChanged = false;
    for (const row of rows) {
      const isLocked = row.li.classList.contains(LOCK_CLASS);
      if (locked.has(row.id) && !isLocked) {
        lockRow(row, hint);
        passChanged = true;
      } else if (!locked.has(row.id) && isLocked) {
        unlockRow(row);
        passChanged = true;
      }
    }
    if (!passChanged) break;
    changed = true;
  }
  if (changed) app._onInputChange(html);
  return changed;
}

/** applyOnUseEffects and its cantrip test are module-local in the system bundle, so the bug cannot be probed. */
function isNeeded() {
  return {
    bug: "unknown",
    confidence: "low",
    evidence: "applyOnUseEffects (cantrip test) and the dialog template cannot be read during init"
  };
}

function apply() {
  const ItemClass = CONFIG.Item.documentClass;
  const AbilityUseDialog = getDialogClass();
  const allApplicable = ItemClass?.prototype?._allApplicableOnUseEffects;
  const onInputChange = AbilityUseDialog?.prototype?._onInputChange;
  if (typeof allApplicable !== "function" || typeof onInputChange !== "function") {
    throw new Error("Tormenta20 usage effect API not found");
  }

  // `this` is the rolled item's clone (ItemT20#roll). Only spells: the system's cantrip test checks item.type.
  ItemClass.prototype._allApplicableOnUseEffects = markWrapper(function (...args) {
    const effects = allApplicable.apply(this, args);
    if (this.type !== "magia" || !Array.isArray(effects)) return effects;
    return effects.map((effect) => {
      try {
        return withSafeCost(effect, this.actor);
      } catch (err) {
        console.warn(`${MODULE_ID} | spell-cost-zero: could not fix the cost of`, effect?.uuid, err);
        return effect;
      }
    });
  }, allApplicable);

  // The total stays the one computed below (system or ability-dialog-cost); a checked Truque makes it 0.
  AbilityUseDialog.prototype._onInputChange = markWrapper(function (html, ...args) {
    const result = onInputChange.call(this, html, ...args);
    try {
      const root = toElement(html);
      if (root && this.item?.type === "magia" && cantripLocks(readRows(this, root)).cantrip !== null) {
        const total = root.querySelector(TOTAL_SELECTOR);
        if (total) total.value = 0;
      }
    } catch (err) {
      console.error(`${MODULE_ID} | spell-cost-zero: failed to show the cantrip cost`, err);
    }
    return result;
  }, onInputChange);

  Hooks.on("renderAbilityUseDialog", (app, html) => {
    try {
      if (!(app instanceof AbilityUseDialog) || app.item?.type !== "magia") return;
      const root = toElement(html);
      const form = root?.querySelector("form");
      if (!form) return;
      addMissingCostInputs(app, root);
      if (!form.dataset.t20cpCantrip) {
        form.dataset.t20cpCantrip = "1";
        form.addEventListener("change", (event) => {
          if (APLICA.test(event.target?.name ?? "")) syncCantrip(app, html);
        });
        // The +/- buttons change the value without a change event; the system's handler runs first.
        form.addEventListener("click", (event) => {
          if (event.target?.closest?.(".numCtrl")) syncCantrip(app, html);
        });
      }
      // Always refresh the total: the template starts with the base cost even when a Truque comes checked
      // ("Aplicar Sempre") and no row needs a lock, and ability-dialog-cost may be off.
      if (!syncCantrip(app, html)) app._onInputChange(html);
    } catch (err) {
      console.error(`${MODULE_ID} | spell-cost-zero: failed to prepare the dialog`, err);
    }
  });
}

export default {
  id: "spell-cost-zero",
  group: "usage-effects",
  issue: 34,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  apply
};
