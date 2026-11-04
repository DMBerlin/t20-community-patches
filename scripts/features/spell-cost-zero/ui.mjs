import { CANTRIP_COST, cantripLocks } from "./domain.mjs";

const LOCK_CLASS = "t20cp-cantrip-locked";
export const TOTAL_SELECTOR = ".total-cost .cost";
const ROW_SELECTOR = ".aprimoramentos-list li";
export const APLICA = /^aprs\.([^.]+)\.aplica$/;

export function toElement(html) {
  if (html instanceof HTMLElement) return html;
  return html?.[0] instanceof HTMLElement ? html[0] : null;
}

function costInput(li, id) {
  return li.querySelector(`input[type=hidden][name="aprs.${id}.custo"]`);
}

/** Reads the enhancement rows of the dialog. */
export function readRows(app, root) {
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
export function addMissingCostInputs(app, root) {
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
 * @param {(key: string) => string} localize
 * @returns {boolean} Whether the total was refreshed.
 */
export function syncCantrip(app, html, localize) {
  const root = toElement(html);
  if (!root || app.item?.type !== "magia") return false;
  const hint = localize("T20CP.SpellCost.Locked");
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
