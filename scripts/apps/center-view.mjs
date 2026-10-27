/**
 * Pure view logic of the Center's sidebar: status buckets, row matching and facet counts. No Foundry dependency.
 */

/** Status filters of each tab, in display order. */
export const PATCH_FILTERS = ["all", "on", "off", "fixed", "attention"];
export const RULE_FILTERS = ["all", "on", "off"];

/**
 * Status filter bucket of a patch category (see registry.stateCategory).
 * @param {"active"|"unneeded"|"attention"|"off"} category
 * @returns {"on"|"off"|"fixed"|"attention"}
 */
export function patchBucket(category) {
  if (category === "active") return "on";
  if (category === "unneeded") return "fixed";
  if (category === "attention") return "attention";
  return "off";
}

/**
 * Whether a rule counts as on: its first setting is not "off". Settings without an "off" choice are on.
 * @param {unknown[]} values  Saved values of the rule's settings, in RULE_SETTINGS order.
 * @returns {"on"|"off"}
 */
export function ruleBucket(values) {
  return values[0] === "off" ? "off" : "on";
}

/**
 * @typedef {{group: string, bucket: string, search: string}} ViewRow
 * @typedef {{query: string, group: string|null, filter: string}} View  group null = all groups; filter "all" = any.
 */

/**
 * @param {ViewRow} row
 * @param {View} view  The query must already be lowercased like row.search.
 * @param {{ignoreGroup?: boolean, ignoreFilter?: boolean}} [skip]
 */
export function matchesView(row, view, skip = {}) {
  const query = (view.query ?? "").trim();
  if (query && !row.search.includes(query)) return false;
  if (!skip.ignoreGroup && view.group && row.group !== view.group) return false;
  if (!skip.ignoreFilter && view.filter && view.filter !== "all" && row.bucket !== view.filter) return false;
  return true;
}

/**
 * Facet counts: each group counts the rows that pass the query and the filter; each filter counts the rows that pass
 * the query and the group.
 * @param {ViewRow[]} rows
 * @param {View} view
 * @param {string[]} filters  PATCH_FILTERS or RULE_FILTERS.
 * @returns {{groups: Record<string, number>, allGroups: number, filters: Record<string, number>}}
 */
export function facetCounts(rows, view, filters) {
  const groups = {};
  let allGroups = 0;
  const counts = Object.fromEntries(filters.map((f) => [f, 0]));
  for (const row of rows) {
    if (matchesView(row, view, { ignoreGroup: true })) {
      groups[row.group] = (groups[row.group] ?? 0) + 1;
      allGroups++;
    }
    if (matchesView(row, view, { ignoreFilter: true })) {
      counts.all++;
      if (row.bucket !== "all" && row.bucket in counts) counts[row.bucket]++;
    }
  }
  return { groups, allGroups, filters: counts };
}
