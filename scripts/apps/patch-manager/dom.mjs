/**
 * DOM side of the Center (#89): the rows a tab's view shows, the facet counts, the tablist state and the controls of
 * each patch row. Works on the elements it receives; reads nothing global.
 */
import { modeFromControls } from "../../kernel/modes.mjs";
import { facetCounts, matchesView } from "./view.mjs";
import { ALWAYS_INPUT, PATCH_INPUT, normalizeSearch } from "./rows.mjs";

/**
 * @param {HTMLElement} button
 * @param {boolean} active
 * @param {number} count
 */
function markButton(button, active, count) {
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", String(active));
  const badge = button.querySelector(".t20cp-count");
  if (badge) badge.textContent = String(count);
}

/**
 * Shows the rows of a tab that match its search, group and status filter, hides empty groups, marks the active
 * buttons and writes the facet counts.
 * @param {HTMLElement} panel  The tab's panel.
 * @param {import("./view.mjs").View} view
 * @param {string[]} filters   PATCH_FILTERS or RULE_FILTERS.
 * @param {string} lang        game.i18n.lang
 */
export function applyFilter(panel, view, filters, lang) {
  const normalized = { ...view, query: normalizeSearch(view.query, lang) };
  const rows = [...panel.querySelectorAll(".t20cp-list .t20cp-row[data-bucket]")];
  const data = rows.map((row) => ({ group: row.dataset.group, bucket: row.dataset.bucket, search: row.dataset.search ?? "" }));
  rows.forEach((row, i) => (row.hidden = !matchesView(data[i], normalized)));
  for (const group of panel.querySelectorAll(".t20cp-group")) {
    group.hidden = !group.querySelector(".t20cp-row:not([hidden])");
  }
  // With one group selected, its title would only repeat the sidebar.
  panel.classList.toggle("t20cp-single-group", !!view.group);

  const counts = facetCounts(data, normalized, filters);
  for (const button of panel.querySelectorAll('[data-action="group"]')) {
    const id = button.dataset.groupId || null;
    markButton(button, id === view.group, id ? (counts.groups[id] ?? 0) : counts.allGroups);
  }
  for (const button of panel.querySelectorAll('[data-action="filter"]')) {
    markButton(button, button.dataset.filter === view.filter, counts.filters[button.dataset.filter] ?? 0);
  }
  const empty = panel.querySelector(".t20cp-empty");
  if (empty) empty.hidden = rows.some((row) => !row.hidden);
}

/**
 * Marks the selected tab of a tablist, and leaves only it in the Tab order.
 * @param {HTMLElement} root
 * @param {string} tab
 * @param {string} group
 */
export function markTabs(root, tab, group) {
  for (const button of root.querySelectorAll(`[role="tab"][data-group="${group}"]`)) {
    const selected = button.dataset.tab === tab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
}

/**
 * Opens the closed detail of a patch row around a control.
 * @param {HTMLElement} control
 */
export function openDetail(control) {
  const detail = control.closest(".t20cp-detail");
  if (!detail?.hidden) return;
  detail.hidden = false;
  detail.closest(".t20cp-row")?.classList.add("expanded");
  detail.closest(".t20cp-row")?.querySelector(".t20cp-expand")?.setAttribute("aria-expanded", "true");
}

/**
 * Mode the controls of a patch row show; the rendered mode when the row has no switch.
 * @param {HTMLElement} root
 * @param {string} id
 * @param {string} rendered
 */
export function readMode(root, id, rendered) {
  const enabled = root.querySelector(`[name="${PATCH_INPUT}${id}"]`);
  const always = root.querySelector(`[name="${ALWAYS_INPUT}${id}"]`);
  if (!enabled) return rendered;
  return modeFromControls({ enabled: enabled.checked, always: !!always?.checked });
}

/** A switch turned off clears and hides the "Apply always" box of its patch. */
function syncAlways(root, target, id) {
  const always = root.querySelector(`[name="${ALWAYS_INPUT}${id}"]`);
  if (always && !target.checked) always.checked = false;
  always?.closest(".t20cp-always")?.toggleAttribute("hidden", !target.checked);
}

/**
 * Opens or closes the detail of a patch row from its expand button.
 * @param {HTMLElement} target
 */
export function toggleDetail(target) {
  const row = target.closest(".t20cp-row");
  const detail = row?.querySelector(".t20cp-detail");
  if (!detail) return;
  const open = detail.hidden;
  detail.hidden = !open;
  target.setAttribute("aria-expanded", String(open));
  row.classList.toggle("expanded", open);
}

/**
 * Keeps the "Apply always" box and the "always" tag of a patch row in sync with its switch.
 * @param {HTMLElement} root
 * @param {HTMLElement} target   The changed control.
 * @param {(id: string) => string} modeOf  readMode of a row.
 */
export function syncPatchControls(root, target, modeOf) {
  const name = target?.name ?? "";
  if (name.startsWith(PATCH_INPUT)) syncAlways(root, target, name.slice(PATCH_INPUT.length));
  if (!name.startsWith(PATCH_INPUT) && !name.startsWith(ALWAYS_INPUT)) return;
  const row = target.closest(".t20cp-row");
  const id = row?.dataset.id;
  if (id) row.querySelector(".t20cp-tag")?.toggleAttribute("hidden", modeOf(id) !== "force");
}
